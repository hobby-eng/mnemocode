"""AUD-010 cli reviewer: colour rules of the workspace AGENTS.md ("Terminal output") for MnemoCode.

    node docs/audits/AUD-010-harnesses/run-command.mjs cli-color \
        python3 docs/audits/AUD-010-harnesses/cli-color.py

Runs src/mnemocode.ts (tsx loader of this checkout) twice per case: `--help`, which writes to
stdout, and `decode --bogus 1`, whose error goes to stderr. Standard output and standard error are
either a Unix pseudo-terminal or a pipe. The expected colour per case follows AGENTS.md: colour
only on a terminal; NO_COLOR (non-empty) turns it off, CLICOLOR_FORCE turns it on, TERM=dumb and
CLICOLOR=0 turn it off; output to a pipe carries no colour codes. NO_COLOR wins over
CLICOLOR_FORCE, as in anstream, which mhfe (the model) uses. Every SGR code seen must be one of the
sixteen-colour palette of src/cli/terminal.ts STYLE (never 2, "dim"). Exit 1 when a check fails.
"""

import os
import pty
import re
import select
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src" / "mnemocode.ts"
TSX = (ROOT / "node_modules" / "tsx" / "dist" / "loader.mjs").resolve().as_uri()
NODE = shutil.which("node") or "node"
SGR = re.compile(rb"\x1b\[([0-9;]*)m")
ALLOWED_SGR = {b"0", b"1", b"36", b"90", b"1;36", b"1;32", b"1;33", b"1;31"}

failures = []


def run(args, env_extra, stdout_tty, stderr_tty):
    env = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE")}
    env["TERM"] = "xterm-256color"
    env.update(env_extra)
    master, slave = pty.openpty()
    out_target = slave if stdout_tty else subprocess.PIPE
    err_target = slave if stderr_tty else subprocess.PIPE
    process = subprocess.Popen(
        [NODE, "--import", TSX, str(SOURCE), *args],
        stdin=subprocess.DEVNULL, stdout=out_target, stderr=err_target, env=env, cwd=ROOT,
    )
    os.close(slave)
    tty_bytes = b""
    pipe_out = pipe_err = b""
    streams = {}
    if not stdout_tty:
        streams[process.stdout.fileno()] = "out"
    if not stderr_tty:
        streams[process.stderr.fileno()] = "err"
    open_fds = [master, *streams]
    while open_fds:
        ready, _, _ = select.select(open_fds, [], [], 30)
        if not ready:
            break
        for fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                open_fds.remove(fd)
                continue
            if fd == master:
                tty_bytes += data
            elif streams[fd] == "out":
                pipe_out += data
            else:
                pipe_err += data
    process.wait()
    os.close(master)
    out = tty_bytes if stdout_tty else pipe_out
    err = tty_bytes if stderr_tty else pipe_err
    return process.returncode, out, err


def colour_of(data):
    return SGR.search(data) is not None


def check(label, condition, observed):
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}: {observed}")
    if not condition:
        failures.append(label)


CASES = [
    # name, environment, stdout tty, stderr tty, expected colour on stdout, on stderr
    ("tty default", {}, True, True, True, True),
    ("tty NO_COLOR=1", {"NO_COLOR": "1"}, True, True, False, False),
    ("tty NO_COLOR empty (ignored)", {"NO_COLOR": ""}, True, True, True, True),
    ("tty TERM=dumb", {"TERM": "dumb"}, True, True, False, False),
    ("tty CLICOLOR=0", {"CLICOLOR": "0"}, True, True, False, False),
    ("tty TERM=dumb CLICOLOR_FORCE=1", {"TERM": "dumb", "CLICOLOR_FORCE": "1"}, True, True, True, True),
    ("tty NO_COLOR=1 CLICOLOR_FORCE=1", {"NO_COLOR": "1", "CLICOLOR_FORCE": "1"}, True, True, False, False),
    ("pipe default", {}, False, False, False, False),
    ("pipe CLICOLOR_FORCE=1", {"CLICOLOR_FORCE": "1"}, False, False, True, True),
    ("pipe CLICOLOR_FORCE=0", {"CLICOLOR_FORCE": "0"}, False, False, False, False),
    ("pipe NO_COLOR=1 CLICOLOR_FORCE=1", {"NO_COLOR": "1", "CLICOLOR_FORCE": "1"}, False, False, False, False),
    ("stdout pipe, stderr tty", {}, False, True, False, True),
    ("stdout tty, stderr pipe", {}, True, False, True, False),
]


def main():
    for name, env, out_tty, err_tty, want_out, want_err in CASES:
        print(f"{name} (env {env}, stdout {'tty' if out_tty else 'pipe'}, stderr {'tty' if err_tty else 'pipe'})")
        code, out, _ = run(["--help"], env, out_tty, err_tty)
        check("--help exit 0", code == 0, code)
        check(f"--help stdout colour == {want_out}", colour_of(out) == want_out, colour_of(out))
        code, _, err = run(["decode", "--bogus", "1"], env, out_tty, err_tty)
        error_line = next((line for line in re.sub(rb"\x1b\[[0-9;]*m", b"", err).decode().splitlines()
                           if "bogus" in line), "")
        check("error exit 1", code == 1, code)
        check(f"error stderr colour == {want_err}", colour_of(err) == want_err,
              f"{colour_of(err)}; line {error_line!r}")
        prefix = "✗ Error:" if want_err else "mnemocode:"
        check(f"error line starts with {prefix!r}", error_line.startswith(prefix), error_line)
        codes = set(SGR.findall(out)) | set(SGR.findall(err))
        check("only the sixteen-colour palette, no dim", codes <= ALLOWED_SGR,
              sorted(c.decode() for c in codes))
    print(f"\n{len(failures)} failed check(s): {failures}" if failures else "\nAll checks passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
