#!/usr/bin/env python3
"""Bind the AUD-008 remediation checks to current files, preserving the original audit snapshot."""

import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode().split("\0")
    files = {
        name: digest((ROOT / name).read_bytes())
        for name in sorted(set(names))
        if name and not name.startswith("docs/audits/") and (ROOT / name).is_file()
    }
    fingerprint = digest("".join(name + "\0" + value + "\n" for name, value in files.items()).encode())
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    target = EVIDENCE / "recheck-snapshot.json"
    if target.exists():
        old = json.loads(target.read_text())
        changed = sorted(name for name in set(files) | set(old["files"]) if files.get(name) != old["files"].get(name))
        result = {"unchanged": not changed and head == old["commit"], "changedFiles": changed, "sourceFingerprint": fingerprint, "commit": head}
        (EVIDENCE / "recheck-snapshot-verification.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
        return 0 if result["unchanged"] else 1
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    record = {
        "auditId": "AUD-008",
        "purpose": "Targeted remediation verification; original baseline snapshot unchanged.",
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "commit": head,
        "sourceFingerprint": fingerprint,
        "workingTree": "Owner's uncommitted fixes, including untracked remediation tests; audit records excluded.",
        "files": files,
    }
    target.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"commit": head, "sourceFingerprint": fingerprint, "files": len(files)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
