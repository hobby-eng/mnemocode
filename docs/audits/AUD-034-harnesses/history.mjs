// Persist the historical-schema helper so its exact input is available for reruns.
import { execFileSync } from "node:child_process";

const script = `
import hashlib, json, platform, re, subprocess
from pathlib import Path
from jsonschema import Draft202012Validator
root = Path.cwd()
folder = root / "docs/audits/AUD-034-evidence"
def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result
load = lambda path: json.loads(path.read_text(), object_pairs_hook=unique)
validator = Draft202012Validator(load(root.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"))
rows = []
for path in sorted((root / "docs/audits").glob("AUD-*-????-??-??.json")):
    if path.name.startswith("AUD-034"):
        continue
    record = load(path)
    validator.validate(record)
    rows.append({"path": str(path.relative_to(root)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "auditId": record["auditId"], "method": "Fresh schema and duplicate-key validation; historical/final-addendum scope remains retained, not replayed."})
assert {int(row["auditId"][4:]) for row in rows} == set(range(1, 33)) - {23}
assert "Not completed, no report" in (root / "docs/audits/README.md").read_text()
workflows = []
for path in (root / ".github").rglob("*.yml"):
    for line in path.read_text().splitlines():
        if "uses:" in line and "uses: ./" not in line:
            assert re.search(r"@[0-9a-f]{40}\\b", line), (str(path), line)
    workflows.append(str(path.relative_to(root)))
record = {"historyReportsValidated": rows, "abandonedAuditWithoutReport": "AUD-023, explicitly indexed; original32-count assumption was a harness error, not a product defect.", "workflowActionPinsInspected": workflows, "environment": {"os": platform.system(), "machine": platform.machine(), "kernel": platform.release(), "node": subprocess.check_output(["node", "--version"], text=True).strip(), "pnpm": subprocess.check_output(["pnpm", "--version"], text=True).strip(), "python": platform.python_version()}, "privateAudit033": "Reserved private record, not copied or published by this audit."}
(folder / "history-environment.json").write_text(json.dumps(record, indent=2) + "\\n")
print("Historical canonical records validated:", len(rows), "workflow/local action pin files:", len(workflows))
print(json.dumps(record["environment"]))
`;
execFileSync("python3", ["-B", "-c", script], { stdio: "inherit" });
