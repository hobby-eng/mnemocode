"""AUD-022-SEC001: interactive re-encode with standard output sent to a file.

Public data only: the README's masked test phrase (MnemoCode Seedshift of "abandon x11 about" with
23-09-2026). Standard input and standard error are a pseudo-terminal, standard output a file, as
`mnemocode re-encode --ask-secrets ... > new-backup.txt` runs. It stops at the confirmation
question with Escape (Stop), so nothing is re-encoded. Run from the repository root after
`pnpm build`:

    python3 docs/audits/AUD-022-harnesses/reencode-stdout.py

Exit 0 when the confirmation is asked, the phrase is on the private screen and not in the file;
exit 1 otherwise. Temporary files are removed. Linux and macOS only (a Unix pseudo-terminal).
"""

import os
import pty
import select
import subprocess
import sys
import tempfile
import time

MASKED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress"
PHRASE = " ".join(["abandon"] * 11 + ["about"])


def main():
    folder = tempfile.mkdtemp(prefix="mnemocode-aud022-")
    record = os.path.join(folder, "old.txt")
    out = os.path.join(folder, "stdout.txt")
    with open(record, "w", encoding="utf-8") as handle:
        handle.write(MASKED + "\n")
    master, slave = pty.openpty()
    os.set_blocking(master, False)
    env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
    with open(out, "wb") as stdout:
        child = subprocess.Popen(
            ["node", "dist/mnemocode.js", "re-encode", "--ask-secrets", "--input-file", record, "--old-mode", "seedshift"],
            stdin=slave, stdout=stdout, stderr=slave, env=env, start_new_session=True,
        )
    os.close(slave)
    screen = b""

    def read_until(text, seconds=60):
        nonlocal screen
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try:
                    screen += os.read(master, 65536)
                except OSError:
                    break
            if text.encode() in screen:
                return True
        return False

    try:
        if not read_until("separated by spaces"):
            raise SystemExit("no dates question")
        os.write(master, b"23-09-2026\r")
        asked = read_until("seed phrase to re-encode")
        # The phrase is shown numbered on the screen: its words, not one line of them.
        on_screen = screen.count(b"abandon") >= 11
        os.write(master, b"\x1b")
        child.wait(timeout=60)
    finally:
        if child.poll() is None:
            child.kill()
        os.close(master)
    with open(out, "rb") as handle:
        written = handle.read().decode("utf-8", "replace")
    for name in (record, out):
        os.remove(name)
    os.rmdir(folder)
    results = {"confirmation asked": asked, "phrase on the private screen": on_screen, "phrase absent from the file": PHRASE not in written and "abandon" not in written}
    for name, value in results.items():
        print(f"{'PASS' if value else 'FAIL'} {name}")
    sys.exit(0 if all(results.values()) else 1)


main()
