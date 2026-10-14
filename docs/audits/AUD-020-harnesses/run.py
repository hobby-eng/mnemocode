"""Reuse the frozen sequential guard, with this audit's own local evidence."""

from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-020-evidence"


def recorder():
    namespace = runpy.run_path(str(ROOT / "docs/audits/AUD-017-harnesses/run.py"))
    guard = namespace["recorder"]()
    guard.check.__globals__["EVIDENCE"] = EVIDENCE
    EVIDENCE.mkdir(exist_ok=True)
    return guard


if __name__ == "__main__":
    label, *command = sys.argv[1:]
    if not command or not label or not all(c.isalnum() or c == "-" for c in label):
        raise SystemExit("Usage: run.py FRESH-LABEL COMMAND [ARGS]")
    raise SystemExit(recorder().check(label, command))
