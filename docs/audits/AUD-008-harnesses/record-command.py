#!/usr/bin/env python3
"""Record a bounded AUD-008 command, its combined log, and an exact execution ledger."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--cwd", default=str(ROOT))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not args.label.replace("-", "").replace("_", "").isalnum():
        parser.error("Supply a command and a simple unique evidence label.")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    log = EVIDENCE / (args.label + ".log")
    ledger = EVIDENCE / (args.label + ".command.json")
    if log.exists() or ledger.exists():
        parser.error("Evidence already exists; choose another label to preserve the original run.")
    record = {
        "argv": command,
        "command": shlex.join(command),
        "cwd": str(Path(args.cwd).resolve()),
        "startedAt": now(),
        "timeoutSeconds": args.timeout,
        "environment": {key: os.environ[key] for key in ("PATH", "CARGO_HOME", "RUSTUP_HOME", "TZ") if key in os.environ},
        "exitCode": None,
    }
    ledger.write_text(json.dumps(record, indent=2) + "\n")
    with log.open("wb") as output:
        try:
            result = subprocess.run(command, cwd=args.cwd, stdout=output, stderr=subprocess.STDOUT, timeout=args.timeout)
            record["exitCode"] = result.returncode
        except subprocess.TimeoutExpired:
            record["exitCode"] = 124
            record["timedOut"] = True
        except OSError as error:
            output.write((str(error) + "\n").encode())
            record["exitCode"] = 127
    data = log.read_bytes()
    record["finishedAt"] = now()
    record["logSha256"] = hashlib.sha256(data).hexdigest()
    record["logBytes"] = len(data)
    ledger.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({key: record[key] for key in ("command", "exitCode", "logSha256", "logBytes")}))
    print(data[-10000:].decode(errors="replace"))
    return record["exitCode"]


if __name__ == "__main__":
    sys.exit(main())
