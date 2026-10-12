"""AUD-014: only bounded real-PTY cases that never draw cards or create PDFs."""

import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
source = ROOT / "scripts/verify-terminal-input.py"
# Import the repository's existing assertions instead of copying its terminal implementation.
sys.argv = [str(source)]
spec = importlib.util.spec_from_file_location("mnemocode_terminal_checks", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for name in ["check_decode_menu", "check_back_from_entry", "check_cursor_editing",
             "check_menu_ctrl_c"]:
    getattr(module, name)()
print("AUD-014: four PTY cases passed; no card questions or PDF-producing commands run")
