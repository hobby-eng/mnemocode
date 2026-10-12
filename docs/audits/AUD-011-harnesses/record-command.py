"""Record one audit command and propagate its exit status; run from the repository root."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

name, *command = sys.argv[1:]
if not re.fullmatch(r"[a-z0-9-]+", name) or not command:
    raise SystemExit("Usage: python3 record-command.py NAME COMMAND [ARG ...]")
evidence = Path("docs/audits/AUD-011-evidence")
evidence.mkdir(parents=True, exist_ok=True)
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
start = now()
result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
log = evidence / (name + ".log")
log.write_bytes(result.stdout)
record = {"command": command, "cwd": str(Path.cwd()), "startedAt": start,
          "endedAt": now(), "exitCode": result.returncode,
          "logSha256": hashlib.sha256(result.stdout).hexdigest()}
(evidence / (name + ".command.json")).write_text(json.dumps(record, indent=2) + "\n")
sys.stdout.buffer.write(result.stdout)
print(json.dumps(record))
raise SystemExit(result.returncode)
