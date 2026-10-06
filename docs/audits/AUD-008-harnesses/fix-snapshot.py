#!/usr/bin/env python3
"""Capture or verify the authorized four-fix snapshot without replacing earlier phases."""

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
    target = EVIDENCE / "fix-snapshot.json"
    if target.exists():
        old = json.loads(target.read_text())
        changed = sorted(name for name in set(files) | set(old["files"]) if files.get(name) != old["files"].get(name))
        # A signed remediation commit advances HEAD without changing the reviewed product bytes.
        related = subprocess.run(["git", "merge-base", "--is-ancestor", old["commit"], head], cwd=ROOT).returncode == 0
        result = {"unchanged": not changed and related, "changedFiles": changed, "sourceFingerprint": fingerprint, "commit": head, "reviewedBaseCommit": old["commit"], "reviewedBaseIsAncestor": related}
        verification_name = "fix-snapshot-verification.json" if head == old["commit"] else "commit-binding-snapshot-verification.json"
        (EVIDENCE / verification_name).write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
        return 0 if result["unchanged"] else 1
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    record = {
        "auditId": "AUD-008",
        "purpose": "Authorized remediation of FUN001, UI001, UI002 and BLD001; earlier snapshots preserved.",
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "commit": head,
        "sourceFingerprint": fingerprint,
        "workingTree": "Owner fixes plus authorized coordinator fixes and regression tests; audit records excluded.",
        "files": files,
    }
    target.write_text(json.dumps(record, indent=2) + "\n")
    dist = {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in sorted((ROOT / "dist").rglob("*")) if p.is_file()}
    (EVIDENCE / "fix-dist-manifest.json").write_text(json.dumps(dist, indent=2) + "\n")
    print(json.dumps({"commit": head, "sourceFingerprint": fingerprint, "files": len(files), "distFiles": len(dist)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
