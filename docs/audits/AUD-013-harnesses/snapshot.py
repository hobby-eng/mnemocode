"""Record source hashes without copying a checkout or changing prior snapshots."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-013-evidence"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*arguments):
    return subprocess.check_output(["git", *arguments], cwd=ROOT)


label = sys.argv[1]
if not re.fullmatch(r"[a-z0-9-]+", label):
    raise SystemExit("Expected a lowercase snapshot label")
paths = sorted(set(git("ls-files", "-c", "-o", "--exclude-standard", "-z").decode().split("\0")) - {""})
source = [[path, digest((ROOT / path).read_bytes()) if (ROOT / path).exists() else "deleted"]
          for path in paths if not path.startswith("docs/audits/")]
value = {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
         "head": git("rev-parse", "HEAD").decode().strip(),
         "workingTree": git("status", "--short").decode(), "source": source,
         "sourceFingerprint": digest(json.dumps(source, separators=(",", ":")).encode())}
EVIDENCE.mkdir(exist_ok=True)
target = EVIDENCE / (label + "-snapshot.json")
with target.open("x") as output:
    output.write(json.dumps(value, indent=2) + "\n")
print(json.dumps({key: value[key] for key in ["capturedAt", "head", "sourceFingerprint"]}))
