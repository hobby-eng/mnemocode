"""Validate the AUD-010 report pair, the 32-item ledger, local evidence and source stability.

The baseline and review-end snapshots must agree (the review changed no source); the
remediation snapshot is recorded separately and is not compared with them.
"""
import hashlib
import json
from pathlib import Path
import jsonschema

root = Path.cwd()
evidence = root / "docs/audits/AUD-010-evidence"
report = next((root / "docs/audits").glob("AUD-010-*.json"))
markdown = report.with_suffix(".md").read_text()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


record = json.loads(report.read_text(), object_pairs_hook=unique_object)
procedure = root.parent / "multi-chain-wallet-tools/docs"
schema = json.loads((procedure / "audit-report.schema.json").read_text())
jsonschema.Draft202012Validator(schema).validate(record)
ids = [item["id"] for item in record["findings"]]
assert len(ids) == len(set(ids)), "Duplicate finding ID"
missing = [identifier for identifier in ids if identifier not in markdown]
assert not missing, "Finding IDs missing from the Markdown report: " + ", ".join(missing)
assert set(ids) == {item["id"] for item in record["remediation"]}, "Remediation rows differ"
assert len(record["checks"]) == 32, "The ledger must hold all 32 procedure checks"
assert len({item["id"] for item in record["checks"]}) == 32, "Duplicate check ID"
baseline = json.loads((evidence / "baseline-snapshot.json").read_text())
review_end = json.loads((evidence / "review-end-snapshot.json").read_text())
assert baseline["source"] == review_end["source"], "Source changed during the review"
assert baseline["fingerprint"] == record["snapshot"]["sourceFingerprint"], "Fingerprint differs"
commands = 0
for command in evidence.rglob("*.command.json"):
    metadata = json.loads(command.read_text())
    log = command.with_name(command.name.removesuffix(".command.json") + ".log")
    assert hashlib.sha256(log.read_bytes()).hexdigest() == metadata["logSha256"], str(command)
    commands += 1
for path, expected in record["procedureHashes"].items():
    actual = hashlib.sha256((root.parent / path).read_bytes()).hexdigest()
    assert actual == expected, "Procedure file changed: " + path
result = {"schema": "passed", "duplicateKeys": "rejected", "findings": len(ids), "checks": 32,
          "reviewSourceUnchanged": True, "commandRecords": commands, "commandHashes": "passed"}
(evidence / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
files = sorted(p for p in evidence.rglob("*") if p.is_file() and p.name != "SHA256SUMS"
               and "compiled" not in p.relative_to(evidence).parts)
(evidence / "SHA256SUMS").write_text("".join(
    hashlib.sha256(p.read_bytes()).hexdigest() + "  " + str(p.relative_to(evidence)) + "\n"
    for p in files))
print(json.dumps(result))
