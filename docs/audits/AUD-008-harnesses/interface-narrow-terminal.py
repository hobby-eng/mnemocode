#!/usr/bin/env python3
"""AUD-008: replay real menu output with wrapping at 40 and 120 terminal columns."""
import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import termios
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
NODE = (str(__import__("pathlib").Path.home()) + "/.local/bin/node")


class Screen:
    """Minimal VT replay of the controls MnemoCode emits; models delayed line wrap."""
    def __init__(self, columns, rows=40):
        self.columns, self.rows = columns, rows
        self.cells = [[" "] * columns for _ in range(rows)]
        self.x = self.y = 0

    def down(self):
        self.y += 1
        if self.y >= self.rows:
            self.cells.pop(0)
            self.cells.append([" "] * self.columns)
            self.y = self.rows - 1

    def replay(self, text):
        for token in re.findall(r"\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]", text):
            if token.startswith("\x1b["):
                final, parameter = token[-1], token[2:-1]
                if final == "m":
                    continue
                if final == "A":
                    self.y = max(0, self.y - int(parameter or "1"))
                elif final == "J":
                    if parameter == "2":
                        self.cells = [[" "] * self.columns for _ in range(self.rows)]
                    else:
                        self.cells[self.y][min(self.x, self.columns):] = [" "] * max(0, self.columns - self.x)
                        for row in range(self.y + 1, self.rows):
                            self.cells[row] = [" "] * self.columns
                elif final in ("H", "f"):
                    parts = [int(part or "1") for part in parameter.split(";")]
                    self.y = max(0, parts[0] - 1)
                    self.x = max(0, (parts[1] if len(parts) > 1 else 1) - 1)
                else:
                    raise AssertionError(f"Unsupported replay control {token!r}")
            elif token == "\r":
                self.x = 0
            elif token == "\n":
                self.down()
            elif ord(token) >= 32:
                if self.x >= self.columns:
                    self.x = 0
                    self.down()
                self.cells[self.y][self.x] = token
                self.x += 1

    def text(self):
        return "\n".join("".join(row).rstrip() for row in self.cells)


def capture(columns):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        environment = dict(os.environ, NO_COLOR="1", TERM="xterm")
        environment.pop("CLICOLOR_FORCE", None)
        os.execvpe(NODE, [NODE, "dist/mnemocode.js"], environment)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, columns, 0, 0))
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    output = ""

    def until(hints):
        nonlocal output
        deadline = time.monotonic() + 15
        while output.count("Esc quits") < hints:
            if time.monotonic() >= deadline:
                raise AssertionError("Menu did not finish drawing")
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                output += decoder.decode(os.read(fd, 65536))
        # One whole write can still be queued after the matching hint.
        while select.select([fd], [], [], 0.1)[0]:
            output += decoder.decode(os.read(fd, 65536))

    try:
        until(1)
        first = output
        os.write(fd, b"\x1b[B")
        until(2)
        os.write(fd, b"\x1b[B")
        until(3)
        screen = Screen(columns)
        screen.replay(output)
        before = Screen(columns)
        before.replay(first)
        (EVIDENCE / f"interface-menu-{columns}.raw.txt").write_text(output)
        (EVIDENCE / f"interface-menu-{columns}.screen.txt").write_text(screen.text() + "\n")
        return {
            "columns": columns,
            "initialVisibleSelectionMarkers": before.text().count("›"),
            "visibleSelectionMarkersAfterTwoDownKeys": screen.text().count("›"),
            "screen": f"interface-menu-{columns}.screen.txt",
        }
    finally:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        os.close(fd)


results = [capture(120), capture(40)]
assert results[0]["visibleSelectionMarkersAfterTwoDownKeys"] == 1
assert results[1]["visibleSelectionMarkersAfterTwoDownKeys"] > 1
(EVIDENCE / "interface-narrow-terminal-results.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
raise SystemExit(1)
