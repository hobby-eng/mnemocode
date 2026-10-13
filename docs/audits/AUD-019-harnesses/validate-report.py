"""AUD-019: checks that the published report pair is consistent; a valid record does not make a
failing probe pass.

    python3 docs/audits/AUD-019-harnesses/validate-report.py

Needs Python's jsonschema package, the sibling checkout multi-chain-wallet-tools (for the schema)
and the local evidence. Validates the JSON against the schema without duplicate keys, the finding
IDs and titles in both records, the check records and log hashes against the evidence, the
procedure hashes, the 32 ledger rows, home paths, English text, relative links, the index row,
and that no evidence file is tracked or staged. Writes report-validation.json and SHA256SUMS into
the evidence folder and exits 1 on the first failed assertion.
"""

import datetime
import hashlib
import json
import re
import subprocess
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-019-evidence"
REPORT = AUDITS / "AUD-019-2026-10-13"
PROCEDURE = ROOT.parent / "multi-chain-wallet-tools/docs"


def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"duplicate JSON key {key}"
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


record = load(REPORT.with_suffix(".json"))
markdown = REPORT.with_suffix(".md").read_text()
jsonschema.validate(record, load(PROCEDURE / "audit-report.schema.json"))
assert record["auditId"] == "AUD-019" and record["auditNumber"] == 19
for finding in record["findings"]:
    assert f"#### {finding['id']} — {finding['severity'].capitalize()} — {finding['title']}" in markdown
    assert f"| {finding['id']} | {finding['category']} | finding | {finding['severity']} | {finding['status']} |" in markdown
    assert finding["id"].split("-")[2].startswith(finding["category"])
for row in record["remediation"]:
    assert f"| {row['id']} | {row['status']} |" in markdown
for check in record["checks"]:
    raw = load(EVIDENCE / f"{check['label']}.command.json")
    assert raw["exitCode"] == check["exitCode"]
    assert raw["logSha256"] == check["evidence"]["sha256"] == digest(EVIDENCE / f"{check['label']}.log")
    assert raw["sourceBefore"] == raw["sourceAfter"] == record["snapshot"]["sourceFingerprint"]
    assert check["evidence"]["localOnly"] is True
for name, value in record["procedureHashes"].items():
    assert digest(PROCEDURE / name) == value, name
ledger = record["coverageLedger"]
assert len(ledger) == 32 and len({row["checkId"] for row in ledger}) == 32
for row in ledger:
    assert f"| {row['checkId']} |" in markdown
published = [REPORT.with_suffix(".md"), REPORT.with_suffix(".json"), AUDITS / "AUD-019-harnesses/README.md"]
for path in published:
    text = path.read_text()
    assert not re.search(r"/home/(?!user(?:/|\b))[^/\s\"'<>]+", text), f"home path in {path.name}"
    assert not re.search(r"[Ѐ-ӿ]", text), f"non-English text in {path.name}"
    assert not re.search(r"\b(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Z]\w+", text)
    if path.suffix == ".md":
        for target in re.findall(r"\[[^\]]*\]\(([^)\s]+)\)", text):
            if not re.match(r"[a-zA-Z][a-zA-Z+.-]*:", target) and not target.startswith("#"):
                assert (path.parent / target.split("#", 1)[0]).exists(), target
index = (AUDITS / "README.md").read_text()
assert index.count("| AUD-019 |") == 1
tracked = subprocess.check_output(["git", "ls-files", "docs/audits/AUD-019-evidence"], cwd=ROOT).decode()
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode()
assert tracked == "" and "AUD-019-evidence/" not in staged
for path in EVIDENCE.iterdir():
    subprocess.run(["git", "check-ignore", "--quiet", str(path.relative_to(ROOT))], cwd=ROOT, check=True)
result = {
    "auditId": "AUD-019",
    "validatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "outcome": "passed",
    "meaning": "Record consistency only; it verifies no finding and passes no probe.",
    "markdownSha256": digest(REPORT.with_suffix(".md")),
    "jsonSha256": digest(REPORT.with_suffix(".json")),
    "sourceFingerprint": record["snapshot"]["sourceFingerprint"],
    "checksValidated": len(record["checks"]),
}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
sums = [f"{digest(p)}  {p.name}" for p in sorted(EVIDENCE.iterdir()) if p.is_file() and p.name != "SHA256SUMS"]
(EVIDENCE / "SHA256SUMS").write_text("\n".join(sums) + "\n")
print(json.dumps(result))
