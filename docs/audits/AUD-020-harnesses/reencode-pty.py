"""Run only the two new re-encode recipes with public data, without PDF generation."""

import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/verify-terminal-input.py"

if __name__ == "__main__":
    sys.argv = [str(SCRIPT)]
    spec = importlib.util.spec_from_file_location("mnemocode_terminal_probe", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.check_re_encode_menu()
    module.check_re_encode_recognised()
    print("Focused re-encode PTY checks: 2 passed")
