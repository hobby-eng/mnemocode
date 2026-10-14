"""Sequential pre-release checks using the retained workspace memory guard."""

from pathlib import Path
import os
import runpy
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-021-evidence"


def recorder():
    namespace = runpy.run_path(str(ROOT / "docs/audits/AUD-017-harnesses/run.py"))
    guard = namespace["recorder"]()
    settings = guard.check.__globals__
    settings["EVIDENCE"] = EVIDENCE
    # Release files run sequentially and may take longer than a targeted regression.
    settings["TIMEOUT_SECONDS"] = int(os.environ.get("AUD021_TIMEOUT_SECONDS", "900"))
    if not 1 <= settings["TIMEOUT_SECONDS"] <= 900:
        raise ValueError("Audit deadline must be between 1 and 900 seconds")
    EVIDENCE.mkdir(exist_ok=True)
    return guard


if __name__ == "__main__":
    operation, label, *command = sys.argv[1:]
    if not label or not all(c.isalnum() or c == "-" for c in label):
        raise SystemExit("Choose a fresh alphanumeric/hyphen label")
    guard = recorder()
    if operation == "snapshot":
        guard.snapshot(label)
    elif operation == "check" and command:
        raise SystemExit(guard.check(label, command))
    else:
        raise SystemExit("Usage: run.py snapshot LABEL | check LABEL COMMAND [ARGS]")
