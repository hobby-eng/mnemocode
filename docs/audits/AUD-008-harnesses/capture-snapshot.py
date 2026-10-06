#!/usr/bin/env python3
"""Capture the AUD-008 product files and procedure hashes without copying a checkout."""

import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
WORKSPACE = ROOT.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def product_files():
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    return {name: digest((ROOT / name).read_bytes()) for name in sorted(names) if name and not name.startswith("docs/audits/") and (ROOT / name).is_file()}


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    target = EVIDENCE / "snapshot.json"
    files = product_files()
    fingerprint = digest("".join(name + "\0" + value + "\n" for name, value in files.items()).encode())
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    if target.exists():
        old = json.loads(target.read_text())
        changed = sorted(name for name in set(old["files"]) | set(files) if old["files"].get(name) != files.get(name))
        result = {"unchanged": not changed and head == old["commit"], "changedFiles": changed, "sourceFingerprint": fingerprint, "commit": head}
        (EVIDENCE / "snapshot-verification.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
        return 0 if result["unchanged"] else 1
    snapshot = {
        "auditId": "AUD-008",
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "commit": head,
        "branch": subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT).decode().strip(),
        "remote": subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=ROOT).decode().strip(),
        "workingTree": "Clean before audit-only harness/evidence creation; tracked audit records excluded from product manifest.",
        "sourceFingerprint": fingerprint,
        "files": files,
    }
    target.write_text(json.dumps(snapshot, indent=2) + "\n")
    procedures = [WORKSPACE / "multi-chain-wallet-tools" / name for name in ("docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md", "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json")]
    procedures.extend([WORKSPACE / "AGENTS.md", ROOT / "AGENTS.md", Path.home() / ".codex/skills/wallet-full-audit/SKILL.md"])
    hashes = {str(path): digest(path.read_bytes()) for path in procedures}
    (EVIDENCE / "procedure-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
    print(json.dumps({"commit": head, "sourceFingerprint": fingerprint, "files": len(files)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
