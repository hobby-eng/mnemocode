"""Validate the audit pair, procedure IDs, local evidence and source stability."""
import hashlib
import json
from pathlib import Path
import jsonschema

root = Path.cwd()
evidence = root / "docs/audits/AUD-009-evidence"
report = root / "docs/audits/AUD-009-2026-10-06.json"
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
assert len(ids) == len(set(ids))
assert all(identifier in markdown for identifier in ids)
assert set(ids) == {item["id"] for item in record["remediation"]}
assert len(record["checks"]) == 32
assert len({item["id"] for item in record["checks"]}) == 32
baseline = json.loads((evidence / "baseline-snapshot.json").read_text())
final = json.loads((evidence / "final-snapshot.json").read_text())
assert baseline["source"] == final["source"], "Source changed during audit"
assert baseline["artifacts"] == final["artifacts"], "Artifacts changed during audit"
for command in evidence.glob("*.command.json"):
    metadata = json.loads(command.read_text())
    log = command.with_name(command.name.removesuffix(".command.json") + ".log")
    assert hashlib.sha256(log.read_bytes()).hexdigest() == metadata["logSha256"]
for path, expected in record["procedureHashes"].items():
    assert hashlib.sha256((root.parent / path).read_bytes()).hexdigest() == expected
result = {"schema": "passed", "duplicateKeys": "rejected", "findings": len(ids),
          "checks": 32, "sourceAndArtifactsUnchanged": True, "commandHashes": "passed"}
(evidence / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
files = sorted(p for p in evidence.rglob("*") if p.is_file() and p.name != "SHA256SUMS")
(evidence / "SHA256SUMS").write_text("".join(
    hashlib.sha256(p.read_bytes()).hexdigest() + "  " + str(p.relative_to(evidence)) + "\n"
    for p in files))
print(json.dumps(result))
