"""Validates every docs/audits/AUD-*.json of MnemoCode against the workspace audit schema, without
duplicate keys, and checks that each finding ID appears in its Markdown twin. Run from the MnemoCode
repository root: python3 <this file>. Exit 1 on any failure."""
import json, sys
from pathlib import Path
import jsonschema
schema = json.load(open("../multi-chain-wallet-tools/docs/audit-report.schema.json"))
validator = jsonschema.Draft202012Validator(schema)
def no_duplicates(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError(f"duplicate keys {sorted({k for k in keys if keys.count(k) > 1})}")
    return dict(pairs)
failed = 0
for path in sorted(Path("docs/audits").glob("AUD-*.json")):
    try:
        record = json.loads(path.read_text(), object_pairs_hook=no_duplicates)
        errors = list(validator.iter_errors(record))
        markdown = path.with_suffix(".md").read_text()
        missing = [f["id"] for f in record.get("findings", []) if f["id"] not in markdown]
        if errors or missing:
            failed += 1
            print(f"FAIL {path.name}: {len(errors)} schema errors {errors[0].message[:120] if errors else ''} missing in md: {missing[:5]}")
        else:
            print(f"ok   {path.name}: {len(record.get('findings', []))} findings")
    except Exception as error:
        failed += 1
        print(f"FAIL {path.name}: {error}")
sys.exit(1 if failed else 0)
