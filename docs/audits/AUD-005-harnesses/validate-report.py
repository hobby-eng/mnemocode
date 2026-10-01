"""Validates the AUD-005 records before hand-off.

Checks: the JSON has no duplicate keys and matches the shared schema; the Markdown and JSON
name the same finding and observation IDs; 32 coverage rows with unique IDs; every relative
link in the report, the harness README and the decisions record resolves; every harness script
parses; every command record's log still has its recorded SHA-256; no evidence file is staged
or tracked. It then writes report-validation.json and SHA256SUMS into the local evidence folder.

    python3 docs/audits/AUD-005-harnesses/validate-report.py

Needs Python jsonschema and the workspace's multi-chain-wallet-tools/docs/audit-report.schema.json.
Exit 0 means every check passed; the first failed check stops it with an assertion error.
"""

import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-005-evidence"
HARNESSES = AUDITS / "AUD-005-harnesses"
SCHEMA = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"


def strict_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            assert key not in result, f"Duplicate JSON key {key} in {path}"
            result[key] = value
        return result

    return json.loads(path.read_text(), object_pairs_hook=pairs)


record = strict_json(AUDITS / "AUD-005-2026-10-01.json")
jsonschema.Draft202012Validator(strict_json(SCHEMA)).validate(record)

markdown = (AUDITS / "AUD-005-2026-10-01.md").read_text()
json_ids = {item["id"] for item in record["findings"] + record["observations"]}
markdown_ids = set(re.findall(r"AUD-005-(?:SEC|FUN|API|BLD|DOC|UI|ARC)\d{3}", markdown))
assert markdown_ids == json_ids, (markdown_ids ^ json_ids)
assert {item["id"] for item in record["remediation"]} == {item["id"] for item in record["findings"]}

coverage = record["checks"]["coverage"]
assert len(coverage) == 32 and len({item["id"] for item in coverage}) == 32

documents = [AUDITS / "AUD-005-2026-10-01.md", HARNESSES / "README.md", AUDITS / "AUD-005-decisions.md"]
for document in documents:
    if not document.exists():
        continue
    for target in re.findall(r"\]\(([^)]+)\)", document.read_text()):
        if target.startswith(("https://", "http://", "#")):
            continue
        assert (document.parent / target.split("#")[0]).exists(), (document.name, target)
    # A reference to local evidence must say that it is local.
    for line in document.read_text().splitlines():
        if "AUD-005-evidence/" in line and "](" in line:
            raise AssertionError(f"Evidence linked as a published file in {document.name}: {line}")

for script in HARNESSES.glob("*.py"):
    ast.parse(script.read_text())
for script in HARNESSES.glob("*.mjs"):
    subprocess.run(["node", "--check", str(script)], check=True)

for command in record["checks"]["commands"]:
    log = EVIDENCE / f"{command['label']}.log"
    assert hashlib.sha256(log.read_bytes()).hexdigest() == command["logSha256"], command["label"]

tracked = subprocess.check_output(["git", "ls-files", "docs/audits"], cwd=ROOT, text=True).splitlines()
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT, text=True).splitlines()
assert not any("-evidence/" in path for path in tracked + staged), "evidence is tracked or staged"

result = {
    "schemaValid": True,
    "duplicateKeys": False,
    "markdownJsonIdsMatch": True,
    "findings": len(record["findings"]),
    "observations": len(record["observations"]),
    "coverageChecks": len(coverage),
    "relativeLinksResolve": True,
    "harnessScriptsParse": True,
    "commandLogHashesMatch": len(record["checks"]["commands"]),
    "evidenceTrackedOrStaged": False,
}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
sums = []
for path in sorted(p for p in EVIDENCE.rglob("*") if p.is_file() and p.name != "SHA256SUMS"):
    sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(EVIDENCE)}")
(EVIDENCE / "SHA256SUMS").write_text("\n".join(sums) + "\n")
print(json.dumps(result, indent=2))
