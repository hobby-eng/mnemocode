"""AUD-014 final shared-schema, source, privacy, link and evidence validation."""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-014-evidence"


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


reports = list(AUDITS.glob("AUD-014-2*.json"))
if len(reports) != 1:
    raise SystemExit("Exactly one final AUD-014 report pair is required")
json_path = reports[0]
md_path = json_path.with_suffix(".md")
record = read(json_path)
schema = read(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
Draft202012Validator(schema).validate(record)
md = md_path.read_text()
ids = [item["id"] for item in record["findings"]]
assert len(ids) == len(set(ids))
assert set(ids) == set(re.findall(r"^#### (AUD-[0-9]+-[A-Z]+[0-9]+) ", md, re.M))
for finding in record["findings"]:
    assert f"#### {finding['id']} — {finding['severity'].capitalize()}" in md
    assert f"| {finding['id']} | {finding['category']} | finding | {finding['severity']} | {finding['status']} |" in md
    for source in finding["evidence"]["sourceLocations"]:
        assert digest(ROOT / source["path"]) == source["sha256"]
for recommendation in record["recommendations"]:
    for source in recommendation.get("locations", []):
        assert digest(ROOT / source["path"]) == source["sha256"]
assert record["snapshot"]["commit"] in md
assert record["snapshot"]["sourceFingerprint"] in md
assert record["date"] in md
for path in [json_path, md_path, AUDITS / "AUD-014-harnesses/README.md"]:
    text = path.read_text()
    assert not re.search(r"/home/(?!user(?:/|\b))[^/\s\"'<>]+", text)
    # Times are UTC only: no IANA time zone name may appear in a published record.
    assert not re.search(
        r"\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Z]\w+", text
    )
    assert not re.search(r"[\u0400-\u04ff]", text), "Unexpected non-English published prose"
for target in re.findall(r"\[[^\]]*\]\(([^)\s]+)\)", md):
    if re.match(r"[a-zA-Z][a-zA-Z+.-]*:", target) or target.startswith("#"):
        continue
    assert (md_path.parent / target.split("#", 1)[0]).exists(), target
for command in record["checks"]:
    label = command["name"]
    retained = read(EVIDENCE / f"{label}.command.json")
    assert digest(EVIDENCE / f"{label}.log") == retained["logSha256"]
    assert retained["sourceBefore"] == record["snapshot"]["sourceFingerprint"]
    assert retained["sourceAfter"] == record["snapshot"]["sourceFingerprint"]
    assert retained["changedFiles"] == []
assert len(record["coverageLedger"]) == 32
assert len({item["checkId"] for item in record["coverageLedger"]}) == 32
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode().splitlines()
assert not any("-evidence/" in path for path in staged)
assert subprocess.run(["git", "check-ignore", "-q", str(EVIDENCE / "report-validation.json")], cwd=ROOT).returncode == 0
index = (AUDITS / "README.md").read_text()
assert md_path.name in index and json_path.name in index
assert not list((AUDITS / "AUD-014-harnesses").glob("*.test.*")), "Audit failures must not enter ordinary test discovery"
result = {"schema": "passed", "duplicateKeys": "absent", "pairedFindings": len(ids),
          "sourceBindings": "passed", "commandLogs": "passed", "coverageChecks": 32,
          "privacy": "passed", "links": "passed", "evidenceIgnoredUnstaged": True,
          "ordinaryTestDiscovery": "unaffected", "reportSha256": digest(md_path),
          "jsonSha256": digest(json_path)}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
paths = [p for p in sorted(EVIDENCE.rglob("*")) if p.is_file() and p.name != "SHA256SUMS"]
paths += [json_path, md_path, *sorted((AUDITS / "AUD-014-harnesses").glob("*"))]
lines = [f"{digest(path)}  {path.relative_to(ROOT)}" for path in paths if path.is_file()]
(EVIDENCE / "SHA256SUMS").write_text("\n".join(lines) + "\n")
print(json.dumps(result, indent=2))
