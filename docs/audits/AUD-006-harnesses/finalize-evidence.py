#!/usr/bin/env python3
"""Validate the AUD-006 report pair and seal its ignored local evidence."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

import jsonschema


ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-006-evidence"
REPORT_MD = AUDITS / "AUD-006-2026-10-01.md"
REPORT_JSON = AUDITS / "AUD-006-2026-10-01.json"
SCHEMA = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"
CARD_OUTPUT = ROOT / "output/aud-006-card-output"
SSKR_PUBLIC_SHARE = ROOT / "output/aud-006-sskr-shares.txt"
SSKR_BUILD_OUTPUTS = [
    EVIDENCE / "sskr-wasm-rebuild/sskr-target",
    EVIDENCE / "sskr-wasm-rebuild/toolchain-target",
    EVIDENCE / "sskr-wasm-rebuild/wasm-bindgen-cli",
]
PROCEDURES = {
    "docs/FULL_AUDIT_GUIDE.md": "30fa6a1675892e2a3059bdbd6e97737f2959a74aca98a0a90e4f655ae12854a6",
    "docs/audits/AUDIT_STANDARD.md": "9128a5e243ec5de86b58bde7b84f7d3bf6b9174346c056a34c5425957b27dc1f",
    "docs/audits/AUDIT_TEMPLATE.md": "8122777f8093b04119633459b9b2cc50bc6ca9258bfc6184b52136d3b8172210",
    "docs/audit-report.schema.json": "d47df01252ad6fb11d8cad00b7d9e6dde62b3ee3331c3bfbef9a7b99adda30f7",
}
CHECK_COUNTS = {
    "SEC": 7,
    "FUN": 7,
    "API": 4,
    "BLD": 5,
    "UI": 3,
    "ARC": 3,
    "DOC": 3,
}
PROCEDURE_ROOT = ROOT.parent / "multi-chain-wallet-tools"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strict_json(path: Path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"duplicate JSON key {key!r} in {path}")
            result[key] = value
        return result

    return json.loads(path.read_text(), object_pairs_hook=pairs)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def remove_audit_owned(path: Path) -> dict:
    resolved = path.resolve()
    resolved.relative_to(ROOT)
    result = {"path": path.relative_to(ROOT).as_posix(), "removed": False}
    if not path.exists():
        return result
    if path.is_file():
        result["bytes"] = path.stat().st_size
        path.unlink()
        result["removed"] = True
        return result
    contents = list(path.rglob("*"))
    result["fileCount"] = sum(item.is_file() for item in contents)
    shutil.rmtree(path)
    result["removed"] = True
    return result


EVIDENCE.mkdir(parents=True, exist_ok=True)
started = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
command = ["python3", "docs/audits/AUD-006-harnesses/finalize-evidence.py"]
log_lines = [
    f"Command: {' '.join(command)}",
    f"Working directory: {ROOT}",
    f"Started (UTC): {started}",
]

record = strict_json(REPORT_JSON)
schema = strict_json(SCHEMA)
jsonschema.Draft202012Validator.check_schema(schema)
jsonschema.Draft202012Validator(schema).validate(record)

finding_ids = [item["id"] for item in record["findings"] + record["observations"]]
if len(finding_ids) != len(set(finding_ids)):
    raise ValueError("duplicate finding or observation IDs")

markdown = REPORT_MD.read_text()
markdown_ids = re.findall(
    r"^### (AUD-[0-9]{3,}-(?:SEC|FUN|API|BLD|DOC|UI|ARC)[0-9]{3,})", markdown, re.M
)
if set(finding_ids) != set(markdown_ids):
    raise ValueError(f"Markdown/JSON finding IDs differ: {set(finding_ids) ^ set(markdown_ids)}")

coverage = record["checks"]["coverageLedger"]
expected_checks = {
    f"CHECK-{category}-{number:03d}"
    for category, count in CHECK_COUNTS.items()
    for number in range(1, count + 1)
}
coverage_ids = [item["checkId"] for item in coverage]
if len(coverage_ids) != 32 or set(coverage_ids) != expected_checks:
    raise ValueError(f"coverage ledger mismatch: expected 32 checks, found {len(coverage_ids)}")

for relative, expected in PROCEDURES.items():
    actual = sha256((PROCEDURE_ROOT / relative).read_bytes())
    if actual != expected:
        raise ValueError(f"procedure hash mismatch: {relative}")

for document in (REPORT_MD, AUDITS / "README.md", Path(__file__).with_name("README.md")):
    text = document.read_text()
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        if target.startswith(("https://", "http://", "mailto:", "#")):
            continue
        local = target.split("#", 1)[0]
        if local and not (document.parent / local).resolve().exists():
            raise ValueError(f"broken local link in {document}: {target}")

command_records = sorted(EVIDENCE.glob("*.command.json"))
for path in command_records:
    item = strict_json(path)
    log_path = EVIDENCE / item["log"]
    if not log_path.is_file() or sha256(log_path.read_bytes()) != item["logSha256"]:
        raise ValueError(f"command log hash mismatch: {path.name}")

staged = [
    line
    for line in git("diff", "--cached", "--name-only").splitlines()
    if "docs/audits/AUD-006-evidence/" in line
]
tracked = [
    line
    for line in git("ls-files", "docs/audits/AUD-006-evidence").splitlines()
    if line
]
if staged or tracked:
    raise ValueError(f"evidence tracked or staged: {staged + tracked}")
subprocess.run(
    ["git", "check-ignore", "docs/audits/AUD-006-evidence/SHA256SUMS"],
    cwd=ROOT,
    check=True,
    stdout=subprocess.DEVNULL,
)

snapshot = {
    "auditId": "AUD-006",
    "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "commit": git("rev-parse", "HEAD"),
    "tree": git("rev-parse", "HEAD^{tree}"),
    "branch": git("branch", "--show-current"),
    "workingTree": git("status", "--short").splitlines(),
    "stagedEvidence": staged,
    "trackedEvidence": tracked,
    "evidenceIgnored": True,
    "noProductChanges": all(
        not line or "docs/audits/" in line or line.startswith("?? docs/audits/AUD-006-harnesses/")
        for line in git("status", "--short").splitlines()
    ),
    "vendorFilesUnchanged": all(
        not line.startswith((" M vendor/sskr/", " D vendor/sskr/"))
        for line in git("status", "--short").splitlines()
    ),
}
if not snapshot["noProductChanges"] or not snapshot["vendorFilesUnchanged"]:
    raise ValueError("unexpected non-audit or vendored source changes")

cleanup = [remove_audit_owned(CARD_OUTPUT), remove_audit_owned(SSKR_PUBLIC_SHARE)]
cleanup.extend(remove_audit_owned(path) for path in SSKR_BUILD_OUTPUTS)
write_json(EVIDENCE / "audit-owned-cleanup.json", cleanup)

write_json(EVIDENCE / "snapshot.json", snapshot)
write_json(EVIDENCE / "procedure-hashes.json", PROCEDURES)

environment = subprocess.check_output(["uname", "-a"], cwd=ROOT, text=True).strip()
tool_versions = {
    "node": subprocess.check_output(["node", "--version"], cwd=ROOT, text=True).strip(),
    "pnpm": subprocess.check_output(["pnpm", "--version"], cwd=ROOT, text=True).strip(),
    "rustc": subprocess.check_output(["rustc", "--version"], cwd=ROOT, text=True).strip(),
    "cargo": subprocess.check_output(["cargo", "--version"], cwd=ROOT, text=True).strip(),
    "wasm-bindgen": subprocess.check_output(["wasm-bindgen", "--version"], cwd=ROOT, text=True).strip(),
    "cargo-audit": subprocess.check_output(["cargo", "audit", "--version"], cwd=ROOT, text=True).strip(),
    "docker": subprocess.check_output(["docker", "--version"], cwd=ROOT, text=True).strip(),
    "Python": subprocess.check_output(["python3", "--version"], cwd=ROOT, text=True).strip(),
    "Prettier": subprocess.check_output(["pnpm", "exec", "prettier", "--version"], cwd=ROOT, text=True).strip(),
    "TypeScript": subprocess.check_output(["pnpm", "exec", "tsc", "--version"], cwd=ROOT, text=True).strip(),
    "Vitest": subprocess.check_output(["pnpm", "exec", "vitest", "--version"], cwd=ROOT, text=True).strip(),
    "Poppler": subprocess.check_output(["pdftocairo", "-v"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).splitlines()[0],
}
environment_lines = [environment, f"CARGO_HOME={__import__('os').environ.get('CARGO_HOME', 'unset')}", f"RUSTUP_HOME={__import__('os').environ.get('RUSTUP_HOME', 'unset')}"]
environment_lines.extend(f"{key}: {value}" for key, value in tool_versions.items())
environment_lines.extend(
    [
        "wasm-bindgen container: 0.2.128 (fresh CLI 0.2.129 built from cached sources in audit evidence)",
        "actual system executable: docs/audits/AUD-006-evidence/executable-linux/mnemocode-0.1.0-linux-x64",
    ]
)
(EVIDENCE / "environment.log").write_text("\n".join(environment_lines) + "\n")

validation = {
    "auditId": "AUD-006",
    "status": "passed",
    "schema": "../multi-chain-wallet-tools/docs/audit-report.schema.json",
    "schemaDialect": "https://json-schema.org/draft/2020-12/schema",
    "validator": f"jsonschema {jsonschema.__version__}",
    "duplicateJsonKeys": "none",
    "pairedFindingIds": finding_ids,
    "coverageChecks": len(coverage_ids),
    "relativeLinks": "resolved in report, index and harness README",
    "procedureHashes": "matched",
    "commandLogHashes": len(command_records),
    "evidenceTrackedOrStaged": False,
    "vendorFilesUnchanged": True,
    "validatorOutput": f"PASS schema, {len(finding_ids)} paired finding/observation IDs, {len(coverage_ids)} checks, {len(command_records)} command records",
}
write_json(EVIDENCE / "report-validation.json", validation)

finished = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
log_text = "\n\n".join(
    [
        f"Command: {' '.join(command)}",
        f"Working directory: {ROOT}",
        f"Started (UTC): {started}",
        validation["validatorOutput"],
        f"Completed (UTC): {finished}",
        "Exit code: 0",
        "Signal: none",
    ]
)
(EVIDENCE / "finalize-evidence.log").write_text(log_text + "\n")
finalizer_record = {
    "command": " ".join(command),
    "argv": command,
    "workingDirectory": str(ROOT),
    "startedAt": started,
    "completedAt": finished,
    "exitCode": 0,
    "signal": None,
    "interruptedBy": None,
    "environment": {
        "CARGO_HOME": __import__("os").environ.get("CARGO_HOME"),
        "RUSTUP_HOME": __import__("os").environ.get("RUSTUP_HOME"),
    },
    "log": "finalize-evidence.log",
    "logSha256": sha256((EVIDENCE / "finalize-evidence.log").read_bytes()),
}
write_json(EVIDENCE / "finalize-evidence.command.json", finalizer_record)

files = sorted(path for path in EVIDENCE.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
manifest = "\n".join(
    f"{sha256(path.read_bytes())}  {path.relative_to(EVIDENCE).as_posix()}" for path in files
)
(EVIDENCE / "SHA256SUMS").write_text(manifest + "\n")
for line in manifest.splitlines():
    expected, relative = line.split("  ", 1)
    if sha256((EVIDENCE / relative).read_bytes()) != expected:
        raise ValueError(f"evidence SHA256SUMS mismatch: {relative}")

print(validation["validatorOutput"])
print(f"Indexed {len(files)} local evidence files; no evidence files are tracked or staged.")