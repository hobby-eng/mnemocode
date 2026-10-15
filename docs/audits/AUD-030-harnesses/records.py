"""Independent schema and pairing check of retained baseline audit records; no product execution."""
import hashlib
import importlib.metadata
import json
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-030-evidence"


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def inspect():
    schema_path = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"
    validator = jsonschema.Draft202012Validator(json.loads(schema_path.read_text()))
    baseline = json.loads((EVIDENCE / "snapshot.json").read_text())
    rows = []
    for source in baseline["files"]:
        path = ROOT / source["path"]
        if not path.match("AUD-[0-9][0-9][0-9]-????-??-??.json"):
            continue
        problems = []
        try:
            record = json.loads(path.read_text(), object_pairs_hook=unique)
            problems.extend(str(error.message) for error in validator.iter_errors(record))
            companion = path.with_suffix(".md")
            text = companion.read_text()
            identifiers = [item["id"] for item in record["findings"]]
            if len(identifiers) != len(set(identifiers)):
                problems.append("Duplicate finding IDs")
            for identifier in identifiers:
                if identifier not in text:
                    problems.append("Missing paired finding: " + identifier)
            if record["auditId"] not in path.name or record["date"] not in path.name:
                problems.append("Identity/date mismatch with filename")
        except (ValueError, KeyError, OSError) as error:
            problems.append(str(error))
        rows.append({"path": source["path"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                     "problems": problems})
    result = {"schemaSha256": hashlib.sha256(schema_path.read_bytes()).hexdigest(),
              "jsonschemaVersion": importlib.metadata.version("jsonschema"),
              "records": rows, "failed": sum(bool(row["problems"]) for row in rows),
              "limitation": "Schema/pairing evidence only; not semantic verification of historical claims."}
    (EVIDENCE / "historical-record-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(inspect())
