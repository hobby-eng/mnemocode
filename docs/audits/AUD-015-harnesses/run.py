"""Reuse AUD-014's frozen memory guard and retain identical command evidence for AUD-015."""

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
RECORDER = ROOT / "docs/audits/AUD-014-harnesses/audit.py"
SHARED_EVIDENCE = ROOT / "docs/audits/AUD-014-evidence"
EVIDENCE = ROOT / "docs/audits/AUD-015-evidence"


def retain(names):
    """Import original bytes without modifying either an existing record or its timestamps."""
    EVIDENCE.mkdir(exist_ok=True)
    for name in names:
        source = SHARED_EVIDENCE / name
        if source.is_file():
            with (EVIDENCE / name).open("xb") as output:
                output.write(source.read_bytes())


if __name__ == "__main__":
    mode, label, *command = sys.argv[1:]
    if mode == "collect" and label == "review-remediation" and not command:
        retain(path.name for path in sorted(SHARED_EVIDENCE.glob(f"{label}-*")) if path.is_file())
    elif mode in {"snapshot", "check"}:
        actual_label = f"aud015-{label}"
        result = subprocess.run([sys.executable, str(RECORDER), mode, actual_label, *command], cwd=ROOT)
        names = ([f"{actual_label}-snapshot.json"] if mode == "snapshot"
                 else [f"{actual_label}.log", f"{actual_label}.command.json"])
        retain(names)
        raise SystemExit(result.returncode)
    else:
        raise SystemExit("Usage: run.py snapshot LABEL | check LABEL COMMAND [ARGS]")
