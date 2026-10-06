#!/usr/bin/env python3
"""Protected real menu PTY, resize, nine Down keys, Enter dispatch to Quit and Escape.

Captured controls use the retained VT model; initial logical output reflows at the new width.
This tests actual CLI bytes, not a physical emulator or every terminal's resize policy.
"""

import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import termios
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
NODE = (str(__import__("pathlib").Path.home()) + "/.local/bin/node")
source = Path(__file__).with_name("remediation-narrow-terminal.py").read_text()
scope = {"re": __import__("re")}
# Reuse the original decoder definition without rerunning or overwriting its old captures.
exec(source[source.index("class Screen:"):source.index("\n\ndef capture(")], scope)
Screen = scope["Screen"]


def capture(before, after, escape):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        os.execvpe(NODE, [NODE, "dist/mnemocode.js"], dict(os.environ, TERM="xterm", NO_COLOR="1"))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, before, 0, 0))
    output = ""
    decoder = codecs.getincrementaldecoder("utf-8")()
    exited = False

    def until(count):
        nonlocal output
        deadline = time.monotonic() + 8
        start = len(output)
        while output.count("Esc quits") < count:
            if time.monotonic() > deadline:
                raise AssertionError("Menu drawing timed out")
            if select.select([fd], [], [], 0.1)[0]:
                output += decoder.decode(os.read(fd, 65536))
        while select.select([fd], [], [], 0.05)[0]:
            output += decoder.decode(os.read(fd, 65536))
        return output[start:]

    try:
        until(1)
        initial = output
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, after, 0, 0))
        screen = Screen(after, 60)
        screen.replay(initial)
        for index in range(9):
            os.write(fd, b"\x1b[B")
            screen.replay(until(index + 2))
            assert screen.text().count("›") == 1, "Stale selection after resized redraw"
        os.write(fd, b"\x1b" if escape else b"\r")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    output += decoder.decode(os.read(fd, 65536))
                except OSError:
                    pass
            finished, status = os.waitpid(pid, os.WNOHANG)
            if finished:
                exited = True
                assert os.waitstatus_to_exitcode(status) == 0
                break
        assert exited, "Menu did not leave after Enter/Escape"
        if not escape:
            assert "Task       Quit" in output, "Enter dispatched the wrong resized selection"
        label = f"fix-resize-{before}-{after}-{'escape' if escape else 'enter'}"
        (EVIDENCE / (label + ".raw.txt")).write_text(output)
        (EVIDENCE / (label + ".screen.txt")).write_text(screen.text() + "\n")
        return {"from": before, "to": after, "exit": "Escape" if escape else "Enter", "markersAfterEveryDown": 1, "exitCode": 0}
    finally:
        if not exited:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        os.close(fd)


results = [capture(before, after, escape) for before, after in [(120, 40), (40, 120), (80, 60)] for escape in [False, True]]
print(json.dumps({"actualProtectedPty": True, "physicalEmulatorCaptured": False, "resizeReplayModel": "Initial logical output reflows at new width", "results": results}))
