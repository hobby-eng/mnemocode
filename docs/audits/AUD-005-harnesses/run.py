"""Record one audit command, or capture the baseline snapshot, for AUD-005.

Usage from the repository root:
    python3 docs/audits/AUD-005-harnesses/run.py capture
    python3 docs/audits/AUD-005-harnesses/run.py LABEL -- COMMAND [ARGS...]

Every command writes LABEL.log and LABEL.command.json (exact argv, UTC start and
end, exit code, log SHA-256) into the ignored docs/audits/AUD-005-evidence/.
An existing record is never overwritten: a rerun needs a fresh label, so the
original result stays visible next to the rerun.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = ROOT.parent
EVIDENCE = ROOT / "docs/audits/AUD-005-evidence"
PROCEDURE_FILES = [
    "docs/FULL_AUDIT_GUIDE.md",
    "docs/audits/AUDIT_STANDARD.md",
    "docs/audits/AUDIT_TEMPLATE.md",
    "docs/audit-report.schema.json",
]


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_new(name, value):
    path = EVIDENCE / name
    if path.exists():
        raise SystemExit(f"Refusing to overwrite {path}")
    path.write_text(json.dumps(value, indent=2) + "\n")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def source_fingerprint(files):
    lines = "".join(f"{name}\0{digest}\n" for name, digest in sorted(files.items()))
    return hashlib.sha256(lines.encode()).hexdigest()


def capture():
    files = {name: sha256_file(ROOT / name) for name in git("ls-files").splitlines()}
    save_new(
        "snapshot.json",
        {
            "capturedAt": utc_now(),
            "branch": git("branch", "--show-current"),
            "commit": git("rev-parse", "HEAD"),
            "workingTree": git("status", "--short"),
            "files": files,
            "sourceFingerprint": source_fingerprint(files),
        },
    )
    procedures = {
        name: sha256_file(WORKSPACE / "multi-chain-wallet-tools" / name)
        for name in PROCEDURE_FILES
    }
    save_new("procedure-hashes.json", procedures)
    tools = {}
    for name, argv in {
        "node": ["node", "--version"],
        "pnpm": ["pnpm", "--version"],
        "pdftocairo": ["pdftocairo", "-v"],
    }.items():
        result = subprocess.run(argv, capture_output=True, text=True)
        tools[name] = (result.stdout + result.stderr).strip().splitlines()[0]
    (EVIDENCE / "environment.log").write_text(
        f"{utc_now()}\n{platform.platform()}\nPython {sys.version}\n"
        + "".join(f"{k}: {v}\n" for k, v in tools.items())
    )
    print("AUD-005 baseline captured.")


def record(label, command):
    if (EVIDENCE / f"{label}.command.json").exists():
        raise SystemExit(f"Label {label} already recorded; use a fresh label.")
    env = os.environ.copy()
    env["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + env["PATH"]
    log = EVIDENCE / f"{label}.log"
    started = utc_now()
    with log.open("wb") as stream:
        result = subprocess.run(
            command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT
        )
    entry = {
        "label": label,
        "command": command,
        "cwd": str(ROOT),
        "startedAt": started,
        "endedAt": utc_now(),
        "exitCode": result.returncode,
        "logSha256": sha256_file(log),
    }
    save_new(f"{label}.command.json", entry)
    print(json.dumps(entry))
    return result.returncode


if __name__ == "__main__":
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    if sys.argv[1:] == ["capture"]:
        capture()
    else:
        if len(sys.argv) < 4 or sys.argv[2] != "--":
            raise SystemExit(__doc__)
        raise SystemExit(record(sys.argv[1], sys.argv[3:]))
