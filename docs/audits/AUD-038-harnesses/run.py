"""Run one Linux release check with retained source and memory records.

Reuses AUD-026's process accounting rather than a second memory monitor.
The caller takes the workspace heavy-check lock; evidence stays local.
"""
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MONITOR = ROOT / "docs/audits/AUD-026-harnesses/audit.py"
SPEC = importlib.util.spec_from_file_location("aud038_monitor", MONITOR)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
GATE.EVIDENCE = ROOT / "docs/audits/AUD-038-evidence"
GATE.EVIDENCE.mkdir(exist_ok=True)
GATE.RSS_BUDGET = 3 * 1024**3
GATE.HEAP_MIB = 384
GATE.TIMEOUT = 1800
TEMP = GATE.EVIDENCE / "t"
TEMP.mkdir(exist_ok=True)
os.environ["TMPDIR"] = str(TEMP)


def run(label, command):
    """Keep a monitor stop distinct from a successful child exit."""
    code = GATE.check(label, command)
    receipt = GATE.EVIDENCE / f"{label}.command.json"
    record = json.loads(receipt.read_text())
    status = 125 if record["stopReason"] else code
    wrapper = Path(__file__).read_bytes()
    record["wrapperSha256"] = hashlib.sha256(wrapper).hexdigest()
    record["wrapperExitCode"] = status
    receipt.write_text(json.dumps(record, indent=2) + "\n")
    return status


if __name__ == "__main__":
    label, *command = sys.argv[1:]
    if not label or not command or not all(
        character.isalnum() or character == "-" for character in label
    ):
        raise SystemExit("Use run.py LABEL COMMAND [ARGUMENTS].")
    raise SystemExit(run(label, command))
