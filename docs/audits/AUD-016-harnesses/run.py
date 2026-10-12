"""AUD-016: share the existing bounded recorder; retain a new audit's evidence separately."""

import importlib.util
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
shared_path = ROOT / "docs/audits/AUD-015-harnesses/run.py"
spec = importlib.util.spec_from_file_location("audit_recorder", shared_path)
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)
recorder.EVIDENCE = ROOT / "docs/audits/AUD-016-evidence"

if __name__ == "__main__":
    mode, label, *command = sys.argv[1:]
    if mode not in {"snapshot", "check"}:
        raise SystemExit("Usage: run.py snapshot LABEL | check LABEL COMMAND [ARGS]")
    actual = f"aud016-{label}"
    result = subprocess.run([sys.executable, str(recorder.RECORDER), mode, actual, *command], cwd=ROOT)
    names = ([f"{actual}-snapshot.json"] if mode == "snapshot"
             else [f"{actual}.log", f"{actual}.command.json"])
    recorder.retain(names)
    raise SystemExit(result.returncode)
