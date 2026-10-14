"""Runs one audit check and keeps its evidence: <label>.log and <label>.command.json (the exact
command, UTC start and end, exit code, log SHA-256 and the source fingerprint before and after).
Run from the MnemoCode repository root:

    python3 <this file> <evidence folder> <label> <command> [arguments...]

It exits with the command's exit code.
"""
import datetime, hashlib, json, os, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from snapshot import snapshot

folder, label, command = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
folder.mkdir(parents=True, exist_ok=True)
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
before = snapshot()["sourceFingerprint"]
start = now()
with open(folder / f"{label}.log", "wb") as log:
    result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"})
end = now()
after = snapshot()["sourceFingerprint"]
digest = hashlib.sha256((folder / f"{label}.log").read_bytes()).hexdigest()
(folder / f"{label}.command.json").write_text(json.dumps({
    "label": label, "command": command, "startUtc": start, "endUtc": end, "exitCode": result.returncode,
    "logSha256": digest, "sourceBefore": before, "sourceAfter": after}, indent=1) + "\n")
print(f"{label}: exit {result.returncode}, log {digest[:16]}…, source {'unchanged' if before == after else 'CHANGED'}")
sys.exit(result.returncode)
