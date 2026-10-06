"""Checks the start menu and the secret input of MnemoCode in a pseudo-terminal.

    python3 scripts/verify-terminal-input.py [dist/mnemocode.js or an executable]

On Linux and macOS it uses a Unix pseudo-terminal; on Windows a pseudo-console (ConPTY) through
the pywinpty package, pinned with its hashes in scripts/verify-terminal-input-requirements.txt.
The default program is dist/mnemocode.js, run with node; build it first (pnpm build). Only the
public BIP39 test phrase "abandon ... about" and its word numbers "1 1 ... 4" are used.

It checks that
- without arguments the menu appears; Down, Up and Enter or a digit choose, Ctrl+Up's 5 chooses
  nothing, and Escape alone, which every keyboard layout has, or q goes back and quits;
- Decode, with the word numbers typed at its prompt, recovers the test phrase on the terminal's
  alternate screen, the private screen: what is typed there is shown, and the screen is left and
  cleared after Enter;
- Backspace and Ctrl+U edit the answer, and Home, End and Delete edit it at the cursor;
- an answer longer than 4095 bytes arrives whole, where a terminal's line mode on Linux would cut
  it;
- two answers pasted at once answer two questions (Encode with dates), and the backup typed
  again with its date passes the check that Encode offers;
- Ctrl+C at a prompt for a secret leaves the private screen; in the menu it cancels that command
  and the menu comes back, a typed command ends with exit code 130;
- Escape or q in the menu ends it with exit code 0, and Ctrl+C there with 130.
"""

import codecs
import os
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "dist" / "mnemocode.js")
# The pseudo-console of Windows starts a program by its full path.
NODE = shutil.which("node") or "node"
COMMAND = [NODE, PROGRAM] if PROGRAM.endswith(".js") else [str(Path(PROGRAM).resolve())]
WINDOWS = sys.platform == "win32"

TEST_PHRASE = " ".join(["abandon"] * 11 + ["about"])
# The test phrase as word numbers (format 2), and the same with a wrong last number.
WORD_NUMBERS = " ".join(["1"] * 11 + ["4"])
WRONG_LAST = " ".join(["1"] * 11 + ["5"])
# The public date of the README examples, and the test phrase masked with it as word numbers.
MASK_DATE = "23-09-2026"
MASKED_WORD_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377"
# Longer than the 4095 bytes after which the line mode of a Linux terminal cuts a line.
LONG_PADDING = " " * 5000
# Exit code when the person cancels with Ctrl+C (src/cli/private-screen.ts).
CANCELLED = 130

# Bytes written to the pseudo-terminal at a time (Session.type).
TYPING_PIECE = 256

UP, DOWN, ENTER, CTRL_UP, ESCAPE = "\x1b[A", "\x1b[B", "\r", "\x1b[1;5A", "\x1b"
HOME, END, DELETE = "\x1b[H", "\x1b[F", "\x1b[3~"
BACKSPACE, CTRL_U, CTRL_C = "\x7f", "\x15", "\x03"
ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN = "\x1b[?1049h", "\x1b[?1049l"

MENU_SHOWN = "Esc quits"
ENCODE_ENTRY = "1"
HIDDEN_RECORD = "Encoded seed phrase or record: "
CLEAR_PROMPT = "Press Enter to clear this screen."


class Session:
    """MnemoCode started in a pseudo-terminal; `output` collects everything it has written."""

    def __init__(self, arguments=()):
        self.output = ""
        # Where the last text waited for ends; the next wait looks only after it.
        self.seen = 0
        self.exit_code = None
        environment = dict(os.environ, NO_COLOR="1", TERM="xterm")
        environment.pop("CLICOLOR_FORCE", None)
        command = [*COMMAND, *arguments]
        if WINDOWS:
            from winpty import PtyProcess

            self.process = PtyProcess.spawn(command, env=environment, dimensions=(40, 120))
        else:
            import fcntl
            import pty
            import struct
            import termios

            self.pid, self.fd = pty.fork()
            if self.pid == 0:
                os.execvpe(command[0], command, environment)
            # 40 rows of 120 columns, so that no line of the menu wraps.
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
            self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    def read_some(self):
        if WINDOWS:
            try:
                self.output += self.process.read(4096)
            except EOFError:
                pass
            return
        import select

        ready, _, _ = select.select([self.fd], [], [], 0.05)
        if ready:
            try:
                self.output += self.decoder.decode(os.read(self.fd, 65536))
            except OSError:
                pass

    def wait_for(self, needle, limit=30):
        """Reads until `needle` appears after the text last waited for; returns where it ends."""
        start = self.seen
        end = time.monotonic() + limit
        while time.monotonic() < end:
            at = self.output.find(needle, start)
            if at >= 0:
                self.seen = at + len(needle)
                return self.seen
            self.read_some()
            if not WINDOWS:
                time.sleep(0.01)
        raise AssertionError(f"{needle!r} did not appear in {self.output[start:]!r}")

    def type(self, text):
        if WINDOWS:
            self.process.write(text)
            return
        # Typed in small pieces, reading the output between them: the tool shows what is typed
        # on its private screen, and a macOS pseudo-terminal buffers so little that a long answer
        # written at once would block both sides, each waiting for the other to read.
        data = text.encode()
        for start in range(0, len(data), TYPING_PIECE):
            os.write(self.fd, data[start : start + TYPING_PIECE])
            self.read_some()

    def alive(self):
        if WINDOWS:
            return self.process.isalive()
        if self.exit_code is not None:
            return False
        pid, status = os.waitpid(self.pid, os.WNOHANG)
        if pid == 0:
            return True
        self.exit_code = os.waitstatus_to_exitcode(status)
        return False

    def wait_for_exit(self, limit=20):
        end = time.monotonic() + limit
        while self.alive() and time.monotonic() < end:
            self.read_some()
        assert not self.alive(), "the tool did not end"
        if WINDOWS:
            return self.process.exitstatus
        return self.exit_code

    def close(self):
        if self.alive():
            if WINDOWS:
                self.process.terminate(force=True)
            else:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)


def at_hidden_record_prompt(session):
    """Chooses Decode with the arrow keys, typed input and no dates, up to the hidden prompt."""
    session.wait_for(MENU_SHOWN)
    # Ctrl+Up must not count as the digit 5; Down, Up, Down, Enter end on entry 2, Decode.
    session.type(CTRL_UP + DOWN + UP + DOWN + ENTER)
    session.wait_for("Where is the encoded seed phrase?")
    session.type("1")
    session.wait_for("Was Seedshift used when it was encoded?")
    session.type("1")
    return session.wait_for(HIDDEN_RECORD)


def check_decode_menu():
    session = Session()
    try:
        prompt_end = at_hidden_record_prompt(session)
        # Typed, deleted with Ctrl+U, retyped with a wrong last number fixed by Backspace.
        session.type("xyz" + CTRL_U + WRONG_LAST + BACKSPACE + "4" + ENTER)
        session.wait_for(TEST_PHRASE)
        # On the private screen the answer is shown as it is typed, so that it can be checked.
        assert WRONG_LAST in session.output[prompt_end:], "the typed answer was not shown"
        if not WINDOWS:
            # The pseudo-console redraws the screen itself and need not pass these sequences on.
            before_prompt = session.output[: prompt_end - len(HIDDEN_RECORD)]
            assert ENTER_ALTERNATE_SCREEN in before_prompt, "no alternate screen for the result"
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        session.wait_for("The screen with the result was cleared.")
        if not WINDOWS:
            assert LEAVE_ALTERNATE_SCREEN in session.output[prompt_end:], "the screen was not left"
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape gave exit code {code}"
    finally:
        session.close()
    print("decode in the menu: answer shown and edited on the private screen, Esc exits with 0")


def check_cursor_editing():
    session = Session(("decode", "--ask-secrets", "--mode", "direct"))
    try:
        session.wait_for(HIDDEN_RECORD)
        # A wrong first number, put right at the start of the line: Home, Delete, the right one.
        session.type("9" + WORD_NUMBERS[1:] + HOME + DELETE + "1" + END + ENTER)
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        code = session.wait_for_exit()
        assert code == 0, f"the edited answer gave exit code {code}"
    finally:
        session.close()
    print("an answer edited at the cursor with Home, Delete and End")


def check_long_line():
    session = Session()
    try:
        at_hidden_record_prompt(session)
        session.type(LONG_PADDING + WORD_NUMBERS + ENTER)
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type("q")
        session.wait_for_exit()
    finally:
        session.close()
    print(f"an answer of {len(LONG_PADDING) + len(WORD_NUMBERS)} bytes arrived whole")


def check_answers_pasted_together():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(ENCODE_ENTRY)
        session.wait_for("Which form should the seed phrase take?")
        session.type("1")
        session.wait_for("Use Seedshift?")
        session.type("1")
        session.wait_for("Which Seedshift?")
        session.type("1")
        session.wait_for("Split it into Shamir shares?")
        session.type("1")
        session.wait_for("Where should the result go?")
        session.type("1")
        session.wait_for("Instructions for your heirs?")
        session.type("1")
        session.wait_for("Seed phrase")
        # The phrase and the date in one paste: the second line answers the second question.
        session.type(TEST_PHRASE + ENTER + MASK_DATE + ENTER)
        session.wait_for("Dates")
        # The check of the backup: typed again from paper, with the date, it restores the phrase.
        session.wait_for("Check the backup now?")
        session.type("1")
        session.wait_for("Your backup, as written down:")
        session.type(MASKED_WORD_NUMBERS + ENTER)
        session.wait_for("Dates")
        session.type(MASK_DATE + ENTER)
        session.wait_for("The backup restores this seed phrase.")
        session.wait_for(CLEAR_PROMPT)
        assert "Error" not in session.output and "mnemocode:" not in session.output, session.output
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type("q")
        session.wait_for_exit()
    finally:
        session.close()
    print("encode in the menu: phrase and dates pasted together, then the backup checked")


def check_ctrl_c():
    # In the menu, Ctrl+C at a prompt cancels that command alone: the menu comes back.
    session = Session()
    try:
        prompt_end = at_hidden_record_prompt(session)
        session.type("abc" + CTRL_C)
        session.wait_for(MENU_SHOWN)
        if not WINDOWS:
            assert LEAVE_ALTERNATE_SCREEN in session.output[prompt_end:], "the screen was not left"
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after a cancelled command gave exit code {code}"
    finally:
        session.close()
    # A typed command ends at Ctrl+C with exit code 130.
    session = Session(("decode", "--ask-secrets", "--mode", "direct"))
    try:
        prompt_end = session.wait_for(HIDDEN_RECORD)
        session.type("abc" + CTRL_C)
        code = session.wait_for_exit()
        assert code == CANCELLED, f"Ctrl+C gave exit code {code}"
        if not WINDOWS:
            assert LEAVE_ALTERNATE_SCREEN in session.output[prompt_end:], "the screen was not left"
    finally:
        session.close()
    print(f"Ctrl+C at a prompt: back to the menu there, exit code {CANCELLED} for a typed command")


def check_menu_ctrl_c():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(CTRL_C)
        code = session.wait_for_exit()
        assert code == CANCELLED, f"Ctrl+C in the menu gave exit code {code}"
    finally:
        session.close()
    print(f"Ctrl+C in the menu: exit code {CANCELLED}")


def main():
    # Each result is written at once, so that a CI log shows how far the checks came.
    sys.stdout.reconfigure(line_buffering=True)
    check_decode_menu()
    check_menu_ctrl_c()
    check_long_line()
    check_cursor_editing()
    check_answers_pasted_together()
    check_ctrl_c()
    print("terminal input checks passed")


if __name__ == "__main__":
    main()
