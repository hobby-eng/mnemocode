"""AUD-014 inventory: local identity, procedure hashes, pins, and planned coverage."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-014-evidence"
PROCEDURE = ROOT.parent / "multi-chain-wallet-tools/docs"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(argv):
    result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=15)
    return {"command": argv, "exitCode": result.returncode,
            "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


pins = json.loads((ROOT / "package.json").read_text())
procedure = {str(path.relative_to(PROCEDURE)): digest(path) for path in [
    PROCEDURE / "FULL_AUDIT_GUIDE.md", PROCEDURE / "audits/AUDIT_STANDARD.md",
    PROCEDURE / "audits/AUDIT_TEMPLATE.md", PROCEDURE / "audit-report.schema.json"]}
groups = {
    "SEC": ["Threat model and ownership", "Permissions and offline isolation",
            "Network egress", "Randomness and encryption", "Secret exceptional paths",
            "Injection and persistence", "Input and availability bounds"],
    "FUN": ["BIP39 and representations", "Coin derivation", "Unimplemented protocols",
            "Address script classification", "Unimplemented transaction inspection",
            "Recovery and SSKR", "Local address search"],
    "API": ["Runtime and dependency contracts", "Cancellation and ownership",
            "Export contracts", "Codec interoperability"],
    "BLD": ["Module composition", "Portable source contracts", "Pins and notices",
            "SSKR source/output freshness", "Workflows and artifact relationship"],
    "UI": ["Terminal viewports", "Terminal inputs and navigation", "Help and privacy"],
    "ARC": ["Module and class ownership", "Semantic duplication and dead code",
            "Tests and comments"],
    "DOC": ["Capabilities and warnings", "Commands and licensing", "Audit integrity"],
}
plan = []
for category, labels in groups.items():
    for index, label in enumerate(labels, 1):
        check_id = f"CHECK-{category}-{index:03d}"
        plan.append({"checkId": check_id, "category": category, "group": label,
                     "owner": "coordinator and assigned subsystem reviewer",
                     "plannedEvidence": "Source trace, recorded bounded probes and targeted tests",
                     "restrictions": "No PDF generation, full vectors, release procedure or Docker rebuild"})

environment = {
    "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "os": platform.platform(), "architecture": platform.machine(),
    "tools": [command(["node", "--version"]), command(["pnpm", "--version"])],
    "installedPackages": {}, "declaredDependencies": pins["dependencies"],
    "declaredDevDependencies": pins["devDependencies"],
    "packageManager": pins["packageManager"], "nodePin": (ROOT / ".node-version").read_text().strip(),
    "lockfileSha256": digest(ROOT / "pnpm-lock.yaml"),
    "bridgeManifest": json.loads((ROOT / "sskr-wasm/integrity.json").read_text()),
    "procedureHashes": procedure,
    "memory": Path("/proc/meminfo").read_text(),
    "environment": {key: os.environ.get(key) for key in ["NODE_OPTIONS", "CARGO_HOME", "RUSTUP_HOME"]},
    "runtimeScope": "Linux Node only; no browser, other OS, or canonical Rust build executed",
}
for name in ["typescript", "vitest", "esbuild", "prettier", *pins["dependencies"]]:
    path = ROOT / "node_modules" / name / "package.json"
    environment["installedPackages"][name] = json.loads(path.read_text())["version"] if path.exists() else None
for name, value in [("resumed-environment.json", environment),
                    ("resumed-procedure-hashes.json", procedure), ("resumed-coverage-plan.json", plan)]:
    with (EVIDENCE / name).open("x") as output:
        output.write(json.dumps(value, indent=2) + "\n")
print(json.dumps(environment, indent=2))
