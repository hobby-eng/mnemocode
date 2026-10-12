"""Capture AUD-012 evidence without changing implementation or historical audit bytes."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-012-evidence"
EVIDENCE.mkdir(exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2) + "\n")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def snapshot(label):
    paths = sorted(set(git("ls-files", "-c", "-o", "--exclude-standard", "-z").decode().split("\0")) - {""})
    source = [[p, sha((ROOT / p).read_bytes()) if (ROOT / p).exists() else "deleted"]
              for p in paths if not p.startswith("docs/audits/")]
    value = {"capturedAt": now(), "head": git("rev-parse", "HEAD").decode().strip(),
             "workingTree": git("status", "--short").decode(), "source": source,
             "sourceFingerprint": sha(json.dumps(source, separators=(",", ":")).encode())}
    save(label + "-snapshot.json", value)
    if label == "baseline":
        save("snapshot.json", value)
        (EVIDENCE / "baseline.diff").write_bytes(git("diff", "HEAD", "--binary"))
        procedure_paths = ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
                           "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]
        save("procedure-hashes.json", {p: sha((ROOT.parent / "multi-chain-wallet-tools" / p).read_bytes())
                                       for p in procedure_paths})
    print(json.dumps({k: value[k] for k in ["capturedAt", "head", "sourceFingerprint"]}))


def record(label, command, input_bytes=None):
    if not command or not re.fullmatch(r"[a-z0-9-]+", label):
        raise SystemExit("Expected a record label and command")
    started = now()
    environment = os.environ.copy()
    environment["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + environment["PATH"]
    result = subprocess.run(command, input=input_bytes, cwd=ROOT, env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (EVIDENCE / (label + ".log")).write_bytes(result.stdout)
    save(label + ".command.json", {"command": command, "cwd": str(ROOT), "startedAt": started,
                                   "endedAt": now(), "exitCode": result.returncode,
                                   "logSha256": sha(result.stdout),
                                   "stdinSha256": sha(input_bytes) if input_bytes is not None else None})
    sys.stdout.buffer.write(result.stdout)
    raise SystemExit(result.returncode)


mode, *args = sys.argv[1:]
if mode == "snapshot":
    snapshot(args[0])
elif mode == "record":
    record(args[0], args[1:])
elif mode == "graph":
    # Reuse the frozen prior resolver, changing only its evidence destination in memory.
    # Its source remains intact; command input hash identifies this bounded adaptation.
    path = ROOT / "docs/audits/AUD-011-harnesses/runtime-graph.mjs"
    source = path.read_text().replace("AUD-011-evidence", "AUD-012-evidence")
    record("runtime-graph", ["node", "--input-type=module"], source.encode())
else:
    raise SystemExit("Expected snapshot, record or graph")
