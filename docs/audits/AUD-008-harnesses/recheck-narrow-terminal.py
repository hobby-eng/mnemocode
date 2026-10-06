#!/usr/bin/env python3
"""Rerun the retained static-width PTY probe with new evidence filenames."""

import hashlib
from pathlib import Path

source = Path(__file__).with_name("remediation-narrow-terminal.py")
text = source.read_text()
print("Original static-width harness SHA-256:", hashlib.sha256(source.read_bytes()).hexdigest())
assert "remediation-menu-" in text and "remediation-narrow-terminal-results.json" in text
text = text.replace("remediation-menu-", "recheck-menu-")
text = text.replace("remediation-narrow-terminal-results.json", "recheck-narrow-terminal-results.json")
exec(compile(text, str(source), "exec"), {"__file__": str(source), "__name__": "__main__"})
