"""Validate the report pair, evidence hashes, count definitions and unchanged source."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import jsonschema

root = Path.cwd()
evidence = root / "docs/audits/AUD-011-evidence"
def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result

report = root / "docs/audits/AUD-011-2026-10-08.json"
record = json.loads(report.read_text(), object_pairs_hook=unique_object)
markdown = report.with_suffix(".md").read_text()
schema = json.loads((root.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json").read_text())
jsonschema.Draft202012Validator(schema).validate(record)
ids = [f["id"] for f in record["findings"]]
assert len(ids) == len(set(ids)), "Duplicate finding ID"
assert set(ids) == set(re.findall(r"^#### (AUD-011-[A-Z]+[0-9]+)", markdown, re.M)), "Finding headings differ"
assert set(ids) == {f["id"] for f in record["remediation"]}, "Remediation IDs differ"
for finding in record["findings"]:
    expected = "#### " + finding["id"] + " — " + finding["severity"].capitalize() + " — " + finding["title"]
    assert expected in markdown, "Severity or title differs: " + finding["id"]
    assert finding["status"] == "open", "No remediation was authorized"
guide = (root.parent / "multi-chain-wallet-tools/docs/FULL_AUDIT_GUIDE.md").read_text()
expected_checks = set(re.findall(r"^### (CHECK-[A-Z]+-[0-9]+)", guide, re.M))
assert expected_checks == {c["id"] for c in record["checks"]}, "Coverage ledger differs"
assert len(expected_checks) == len(record["checks"]) == 32
baseline = json.loads((evidence / "baseline-snapshot.json").read_text())
end = json.loads((evidence / "review-end-snapshot.json").read_text())
assert baseline["source"] == end["source"], "Production/source files changed"
assert baseline["fingerprint"] == record["snapshot"]["sourceFingerprint"]
assert baseline["head"] == end["head"] == record["snapshot"]["commit"]
commands = 0
for command in evidence.glob("*.command.json"):
    metadata = json.loads(command.read_text())
    log = command.with_name(command.name.removesuffix(".command.json") + ".log")
    assert hashlib.sha256(log.read_bytes()).hexdigest() == metadata["logSha256"], str(command)
    commands += 1
# The owner's later edits of the procedure files are recorded where those files live, each with
# its reverse edit; this helper recovers the bytes this audit pinned (2026-10-09).
sys.path.insert(0, str(root.parent / "multi-chain-wallet-tools/docs/audits"))
from procedure_changes import matches_audited  # noqa: E402

for path, expected in record["procedureHashes"].items():
    assert matches_audited(root.parent / path, expected), path
for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", markdown):
    target = match.group(1).split("#")[0]
    if not target or "://" in target:
        continue
    assert (report.parent / target).exists(), "Broken report link: " + target
groups = record["duplicateGroups"]
assert len({g["key"] for g in groups}) == len(groups), "Duplicate catalog rule"
assert {g["findingId"] for g in groups} == set(ids), "Catalog finding IDs differ"
total = 0
for group in groups:
    assert group["findingId"] in ids
    assert group["implementations"] == len(group["locations"]) >= 2, group["key"]
    assert "`" + group["key"] + "`" in markdown, "Catalog rule missing from Markdown"
    for location in group["locations"]:
        lines = (root / location["path"]).read_text().splitlines()
        assert 0 < location["line"] <= len(lines), location
        assert location["anchor"] in "\n".join(lines[location["line"] - 1:location["line"] + 12]), location
        assert hashlib.sha256((root / location["path"]).read_bytes()).hexdigest() == location["sha256"], location
    total += group["implementations"]
counts = record["counts"]
assert counts["consolidationGroups"] == len(ids)
assert counts["rules"] == len(groups) and counts["sites"] == total
assert counts["surplusSites"] == total - len(groups)
for field, attribute in [("bySubsystem", "subsystem"), ("byKind", "kind")]:
    for name, expected in counts[field].items():
        selected = [g for g in groups if g[attribute] == name]
        assert expected == {"rules": len(selected), "sites": sum(len(g["locations"]) for g in selected)}
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"]).decode().splitlines()
assert not any("AUD-011-evidence/" in path for path in staged), "Evidence staged"
result = {"schema": "passed", "duplicateKeys": "rejected", "findingIds": "matched",
          "checks": 32, "sourceUnchanged": True, "commandRecords": commands,
          "catalog": record["counts"], "localEvidenceNotStaged": True}
(evidence / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
files = sorted(p for p in evidence.rglob("*") if p.is_file() and p.name != "SHA256SUMS")
(evidence / "SHA256SUMS").write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest()
    + "  " + str(p.relative_to(evidence)) + "\n" for p in files))
print(json.dumps(result, indent=2))
