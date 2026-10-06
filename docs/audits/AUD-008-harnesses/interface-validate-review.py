#!/usr/bin/env python3
"""Validate the scoped interface handoff against the shared schema and its retained bytes."""
import hashlib
import json
from pathlib import Path
import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
SCHEMA = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AssertionError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


review_path = EVIDENCE / "interface-review.json"
review = json.loads(review_path.read_text(), object_pairs_hook=unique_object)
schema = json.loads(SCHEMA.read_text(), object_pairs_hook=unique_object)
jsonschema.Draft202012Validator(schema).validate(review)
ids = [record["id"] for record in review["findings"]]
assert len(ids) == len(set(ids))
assert {item["checkId"] for item in review["checks"]} == {
    "CHECK-UI-001", "CHECK-UI-002", "CHECK-UI-003", "CHECK-API-003",
}
for path, expected in review["sourceManifest"].items():
    assert sha256(ROOT / path) == expected, path
for finding in review["findings"]:
    for affected in finding["affectedFiles"]:
        lines = (ROOT / affected["path"]).read_text().splitlines()
        assert all(1 <= line <= len(lines) for line in affected["lines"])

local_references = 0


def validate_evidence(value):
    global local_references
    if isinstance(value, dict):
        if value.get("local") is True and "path" in value:
            path = EVIDENCE / value["path"]
            assert path.is_file(), str(path)
            assert sha256(path) == value["sha256"], str(path)
            local_references += 1
        for nested in value.values():
            validate_evidence(nested)
    elif isinstance(value, list):
        for nested in value:
            validate_evidence(nested)


validate_evidence(review)
result = {
    "outcome": "passed", "schema": str(SCHEMA), "schemaSha256": sha256(SCHEMA),
    "reviewSha256": sha256(review_path), "duplicateKeys": False,
    "findingIds": ids, "localReferencesChecked": local_references,
    "sourceFilesChecked": len(review["sourceManifest"]),
    "scope": "Interface reviewer handoff only; coordinator validates final Markdown/JSON pair and combined evidence manifest.",
}
(EVIDENCE / "interface-review-validation.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
