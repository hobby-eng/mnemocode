"""Checks the start menu and the secret input of MnemoCode in a pseudo-terminal.

    python3 scripts/verify-terminal-input.py [dist/mnemocode.js or an executable]

On Linux and macOS it uses a Unix pseudo-terminal; on Windows a pseudo-console (ConPTY) through
the pywinpty package, pinned with its hashes in scripts/verify-terminal-input-requirements.txt.
The default program is dist/mnemocode.js, run with node; build it first (pnpm build). Only the
public BIP39 test phrase "abandon ... about", its word numbers "1 1 ... 4", its fingerprint
73c5da0a, and that phrase masked with the README's date and its Shamir shares are used.

It checks that
- without arguments the menu appears; Down, Up and Enter or a digit choose, Ctrl+Up's 5 chooses
  nothing, and Escape alone, which every keyboard layout has, or q goes back and quits;
- Escape at a typed question of an entry goes back to the menu and leaves the screen as it was
  before the entry was chosen;
- the card questions of Encode in colors: how the cards are saved, a QR code on the sheets only,
  and the person's own details, a wrong one asked again and Enter keeping one random, each answer
  in the command that the menu runs and nothing else;
- Decode, with the word numbers typed at its prompt, recovers the test phrase on the terminal's
  alternate screen, the private screen: what is typed there is shown, and the screen is left and
  cleared after Enter;
- Backspace and Ctrl+U edit the answer, and Home, End and Delete edit it at the cursor;
- Ctrl+C stops a long date search and leaves the private screen;
- an answer longer than 4095 bytes arrives whole, where a terminal's line mode on Linux would cut
  it;
- a seed phrase pasted one word per line is one answer (Encode with dates), and the backup typed
  again with its date passes the check that Encode offers;
- Decode asks again after an empty answer and after a mistyped date, keeping the codes, and finds
  a date with ? by the fingerprint of the test phrase;
- Restore from Shamir shares asks again after Ctrl+D on an empty line, takes two shares pasted
  as two lines as one answer, asks again only for the share that cannot be read, and finds a date
  with ? by the fingerprint;
- nothing typed or shown in Decode, Encode or Restore that is secret reaches the main screen,
  which stays in the scrollback;
- Ctrl+C at a prompt for a secret leaves the private screen; in the menu it cancels that command
  and the menu comes back, a typed command ends with exit code 130;
- Escape or q in the menu ends it with exit code 0, and Ctrl+C there with 130.
"""

import codecs
import os
from pathlib import Path
import re
import shlex
import shutil
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "dist" / "mnemocode.js")
# The pseudo-console of Windows starts a program by its full path.
NODE = shutil.which("node") or "node"
# By its full path, so that a check may start it in another folder (Session).
FULL_PATH = str(Path(PROGRAM).resolve())
COMMAND = [NODE, FULL_PATH] if PROGRAM.endswith(".js") else [FULL_PATH]
WINDOWS = sys.platform == "win32"

TEST_PHRASE = " ".join(["abandon"] * 11 + ["about"])
# The test phrase as word numbers (format 2), and the same with a wrong last number.
WORD_NUMBERS = " ".join(["1"] * 11 + ["4"])
WRONG_LAST = " ".join(["1"] * 11 + ["5"])
# The public date of the README examples, and the test phrase masked with it as word numbers.
MASK_DATE = "23-09-2026"
MASKED_WORD_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377"
# The same date with a forgotten last digit of the year, and with a two-digit year.
FORGOTTEN_DIGIT = "23-09-202?"
MISTYPED_DATE = "23-09-26"
# The BIP32 master fingerprint of the test phrase without a BIP39 passphrase.
FINGERPRINT = "73c5da0a"
# Shares 1 and 3 of a 2-of-3 split of the masked test phrase, made with
#   mnemocode encode --sskr --mode seedshift --mnemonic "abandon ... about" \
#     --dates 23-09-2026 --threshold 2 --shares 3
# and share 3 with one byteword changed (pa to ae), so that its checksum fails.
FIRST_SHARE = "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh"
THIRD_SHARE = "ur:sskr/gomuttaeadaojytnhyvtpaqdmobwreoyykutjtkofedicanladwm"
MISTYPED_SHARE = "ur:sskr/gomuttaeadaojytnhyvtaeqdmobwreoyykutjtkofedicanladwm"
# The start of every share as text, a Uniform Resource of type sskr, before its bytewords.
SHARE_PREFIX = "ur:sskr/"
# Four bytewords in a row: the minimal bytewords of a share spell each byte with two letters. A
# warning that holds this much of a share repeats part of it.
SHARE_PIECE = 8
# Longer than the 4095 bytes after which the line mode of a Linux terminal cuts a line.
LONG_PADDING = " " * 5000
# Exit code when the person cancels with Ctrl+C (src/cli/private-screen.ts).
CANCELLED = 130

# The size of the pseudo-terminal: 40 rows of 120 columns, so that no line of the menu wraps.
TERMINAL_ROWS, TERMINAL_COLUMNS = 40, 120
# Bytes written to the pseudo-terminal at a time (Session.type).
TYPING_PIECE = 256
# Seconds that typing waits for the tool to take more input before the check fails.
TYPING_LIMIT = 30
# Seconds from Ctrl+C during a date search to the end of the tool: the search stops at its next
# turn, 50 ms later (src/cli/recover-date-command.ts); the rest is room for a slow hosted runner.
SEARCH_STOP_LIMIT = 10

UP, DOWN, ENTER, CTRL_UP, ESCAPE = "\x1b[A", "\x1b[B", "\r", "\x1b[1;5A", "\x1b"
HOME, END, DELETE = "\x1b[H", "\x1b[F", "\x1b[3~"
BACKSPACE, CTRL_U, CTRL_C, CTRL_D = "\x7f", "\x15", "\x03", "\x04"
ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN = "\x1b[?1049h", "\x1b[?1049l"

MENU_SHOWN = "Esc quits"
ENCODE_ENTRY, DECODE_ENTRY, RESTORE_ENTRY = "1", "2", "4"
HIDDEN_RECORD = "Encoded seed phrase or record: "
# The questions below are looked for without the space after them: the pseudo-console of Windows
# need not draw a space at the end of a line before something follows it.
SEED_PHRASE = "Seed phrase (English BIP39 words):"
SHARES = "Shamir shares (separate shares with ;, ? for each unreadable code or digit):"
# The end of the question for dates that may hold ? (src/cli/date-search.ts, datesQuestion).
DATES_WITH_MARKS = "? for what is forgotten, separated by spaces):"
CLEAR_PROMPT = "Press Enter to clear this screen."
# The line after an empty answer to a question for a secret (src/cli/ask.ts, askSecretUntil).
ASKED_AGAIN = ", or press Ctrl+C to stop."
# A name for the cards with a digit, which the menu refuses (Latin letters only), and one that it
# takes.
WRONG_CARD_NAME, CARD_NAME = "Jane 2", "Jane Example"
# The details that the cards of a sheet may show after the name, each kept random with Enter.
SHEET_DETAILS = (
    "Role",
    "Company",
    "Email",
    "Phone",
    "Website",
    "Location",
    "Studio name",
    "Slogan",
    "Subtitle",
    "Footer",
)


class Session:
    """MnemoCode started in a pseudo-terminal; `output` collects everything it has written."""

    def __init__(self, arguments=(), folder=None):
        """Starts MnemoCode with `arguments` in `folder`, or in the current folder."""
        self.output = ""
        # Where the last text waited for ends; the next wait looks only after it.
        self.seen = 0
        self.exit_code = None
        environment = dict(os.environ, NO_COLOR="1", TERM="xterm")
        environment.pop("CLICOLOR_FORCE", None)
        command = [*COMMAND, *arguments]
        if WINDOWS:
            from winpty import PtyProcess

            self.process = PtyProcess.spawn(
                command, cwd=folder, env=environment, dimensions=(TERMINAL_ROWS, TERMINAL_COLUMNS)
            )
        else:
            import fcntl
            import pty
            import struct
            import termios

            self.pid, self.fd = pty.fork()
            if self.pid == 0:
                if folder is not None:
                    os.chdir(folder)
                os.execvpe(command[0], command, environment)
            size = struct.pack("HHHH", TERMINAL_ROWS, TERMINAL_COLUMNS, 0, 0)
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, size)
            # Writes take what the terminal takes and never wait (Session.write_piece).
            os.set_blocking(self.fd, False)
            self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    def read_some(self, wait=0.05):
        """Adds what the tool has written to `output`, waiting up to `wait` seconds on POSIX."""
        if WINDOWS:
            try:
                self.output += self.process.read(4096)
            except EOFError:
                pass
            return
        import select

        ready, _, _ = select.select([self.fd], [], [], wait)
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
        # on its private screen, and a macOS pseudo-terminal buffers about 1 KiB each way, so a
        # long answer written at once would block both sides, each waiting for the other to read.
        data = text.encode()
        for start in range(0, len(data), TYPING_PIECE):
            self.write_piece(data[start : start + TYPING_PIECE])

    def write_piece(self, piece):
        """Writes `piece` to the non-blocking terminal. While its input queue is full, waits until
        the tool takes some or writes something, which is read: neither side waits forever. A
        tool that takes nothing for TYPING_LIMIT seconds fails the check."""
        import select

        end = time.monotonic() + TYPING_LIMIT
        while piece:
            try:
                written = os.write(self.fd, piece)
            except BlockingIOError:
                written = 0
            if written > 0:
                piece = piece[written:]
                end = time.monotonic() + TYPING_LIMIT
            elif time.monotonic() > end:
                raise AssertionError(f"the tool took no input for {TYPING_LIMIT} s")
            else:
                select.select([self.fd], [self.fd], [], 0.05)
            self.read_some(wait=0)

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


# A control sequence (ECMA-48 CSI): parameters, then one final byte.
CONTROL_SEQUENCE = re.compile(r"\x1b\[([0-9;?]*)([@-~])")


class Screen:
    """The rows that a terminal `columns` wide shows after `text`, for what the menu draws: text,
    which waits at the right edge before it wraps, carriage return, line feed, and the sequences
    for cursor up, cursor right and erase to the end of the screen. Rows never scroll away. Any
    other escape sequence fails the check."""

    def __init__(self, columns, text):
        self.columns = columns
        self.rows = [[]]
        self.row = self.column = 0
        # Whether the cursor waits on the last column, where the next character wraps first.
        self.waiting = False
        index = 0
        while index < len(text):
            if text[index] == "\x1b":
                match = CONTROL_SEQUENCE.match(text, index)
                assert match, f"unexpected escape sequence {text[index:index + 8]!r}"
                self.control(*match.groups())
                index = match.end()
                continue
            if text[index] == "\r":
                self.move(self.row, 0)
            elif text[index] == "\n":
                self.move(self.row + 1, self.column)
            else:
                self.put(text[index])
            index += 1

    def lines(self):
        return ["".join(cells).rstrip() for cells in self.rows]

    def move(self, row, column):
        self.row = max(0, row)
        self.column = min(self.columns - 1, column)
        self.waiting = False
        while len(self.rows) <= self.row:
            self.rows.append([])

    def put(self, character):
        if self.waiting:
            self.move(self.row + 1, 0)
        cells = self.rows[self.row]
        cells.extend(" " * (self.column + 1 - len(cells)))
        cells[self.column] = character
        if self.column == self.columns - 1:
            self.waiting = True
        else:
            self.column += 1

    def control(self, parameters, final):
        count = int(parameters or "1")
        if final == "A":
            self.move(self.row - count, self.column)
        elif final == "C":
            self.move(self.row, self.column + count)
        elif final == "J" and parameters == "":
            del self.rows[self.row][self.column :]
            del self.rows[self.row + 1 :]
        else:
            raise AssertionError(f"unexpected sequence ESC [ {parameters}{final}")


def read_to_end(session):
    """Reads what the tool, which has ended, wrote until nothing more comes; returns it all."""
    while True:
        before = len(session.output)
        session.read_some(wait=0.2)
        if len(session.output) == before:
            return session.output


def screen_at_exit(session):
    """The screen once the tool has ended and everything it wrote has been read."""
    return Screen(TERMINAL_COLUMNS, read_to_end(session)).lines()


def main_screen_text(output):
    """What `output` writes outside the private screen, without control sequences and with each
    run of spaces and line breaks as one space, so that a secret split over lines is found too.
    Every visit of the private screen must have ended."""
    parts = []
    start = 0
    while True:
        enter = output.find(ENTER_ALTERNATE_SCREEN, start)
        if enter < 0:
            parts.append(output[start:])
            break
        parts.append(output[start:enter])
        leave = output.find(LEAVE_ALTERNATE_SCREEN, enter)
        assert leave >= 0, "the private screen was not left"
        start = leave + len(LEAVE_ALTERNATE_SCREEN)
    return " ".join(CONTROL_SEQUENCE.sub("", "".join(parts)).split())


def assert_kept_private(session, secrets):
    """Fails if one of `secrets` reached the main screen, which stays in the scrollback, after the
    tool has ended. Only on POSIX: the pseudo-console of Windows redraws the screen itself and
    need not pass on the switch to the private screen."""
    if WINDOWS:
        return
    shown = main_screen_text(read_to_end(session))
    for secret in secrets:
        assert secret not in shown, f"{secret!r} reached the main screen"


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
        assert_kept_private(session, (WRONG_LAST, WORD_NUMBERS, TEST_PHRASE))
    finally:
        session.close()
    print("decode in the menu: answer shown and edited on the private screen, Esc exits with 0")


def check_back_from_entry():
    # Quitting at once shows the screen that going back from an entry must leave.
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        assert session.wait_for_exit() == 0, "Escape in the menu did not end it with 0"
        untouched = None if WINDOWS else screen_at_exit(session)
    finally:
        session.close()
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        # Look up, a word: a typed question, left with Escape after a few letters.
        session.type("7")
        session.wait_for("What do you want to look up?")
        session.type("1")
        session.wait_for("Word: ")
        session.type("aband" + ESCAPE)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after going back gave exit code {code}"
        # The pseudo-console redraws the screen itself: its output is not what the tool wrote.
        if not WINDOWS:
            shown = screen_at_exit(session)
            assert shown == untouched, f"going back left {shown!r} instead of {untouched!r}"
    finally:
        session.close()
    print("Escape at a question of an entry: back to the menu, the screen as before the entry")


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
        assert_kept_private(session, (WORD_NUMBERS, TEST_PHRASE))
    finally:
        session.close()
    print(f"an answer of {len(LONG_PADDING) + len(WORD_NUMBERS)} bytes arrived whole")


def check_lines_pasted_as_one_answer():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(ENCODE_ENTRY)
        session.wait_for("Which form should the seed phrase take?")
        session.type("1")
        # Word numbers are always masked: the menu asks only which Seedshift.
        session.wait_for("Which Seedshift?")
        session.type("1")
        session.wait_for("Split it into Shamir shares?")
        session.type("1")
        session.wait_for("Where should the result go?")
        session.type("1")
        session.wait_for("Instructions for your heirs?")
        session.type("1")
        session.wait_for(SEED_PHRASE)
        # The phrase pasted one word per line, as copied from a list: one answer, so that the
        # next question, for the dates, waits for its own.
        session.type(ENTER.join(TEST_PHRASE.split()) + ENTER)
        session.wait_for("Dates (")
        session.type(MASK_DATE + ENTER)
        # The check of the backup: typed again from paper, with the date, it restores the phrase.
        session.wait_for("Check the backup now?")
        session.type("1")
        session.wait_for("Your backup, as written down:")
        session.type(MASKED_WORD_NUMBERS + ENTER)
        session.wait_for("Dates (")
        session.type(MASK_DATE + ENTER)
        session.wait_for("The backup restores this seed phrase.")
        session.wait_for(CLEAR_PROMPT)
        assert "Error" not in session.output and "mnemocode:" not in session.output, session.output
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type("q")
        session.wait_for_exit()
        assert_kept_private(session, (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS))
    finally:
        session.close()
    print("encode in the menu: a phrase pasted one word per line is one answer, backup checked")


def line_starting(session, start):
    """Waits for the line that begins with `start` and returns it whole, on POSIX. The
    pseudo-console of Windows redraws the screen itself and need not pass on the line as written,
    so there only `start` is waited for and returned."""
    end = session.wait_for(start)
    if WINDOWS:
        return start
    return session.output[end - len(start) : session.wait_for("\n")].strip()


def answer_fingerprint(session):
    """Tells the wallet by the fingerprint of the test phrase, as the date search asks for it."""
    session.wait_for("How can MnemoCode recognise the wallet?")
    session.type("1")
    session.wait_for("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):")
    session.type(FINGERPRINT + ENTER)


def check_decode_dates_asked_again():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(DECODE_ENTRY)
        session.wait_for("Where is the encoded seed phrase?")
        session.type("1")
        session.wait_for("Was Seedshift used when it was encoded?")
        # MnemoCode Seedshift, after No.
        session.type("2")
        session.wait_for(HIDDEN_RECORD)
        session.type(ENTER)
        session.wait_for(ASKED_AGAIN)
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + ENTER)
        session.wait_for(DATES_WITH_MARKS)
        session.type(MISTYPED_DATE + ENTER)
        # One line names the date by its place, without repeating it; then only the dates are
        # asked again, and the codes are kept.
        warning = line_starting(session, "Date 1: ")
        assert MISTYPED_DATE not in warning, f"the warning {warning!r} repeats the date"
        warned = session.seen
        session.wait_for(DATES_WITH_MARKS)
        assert HIDDEN_RECORD not in session.output[warned : session.seen], "codes asked again"
        session.type(FORGOTTEN_DIGIT + ENTER)
        answer_fingerprint(session)
        session.wait_for("found 1 match.")
        session.wait_for(MASK_DATE)
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after decoding gave exit code {code}"
        typed = (MASKED_WORD_NUMBERS, MISTYPED_DATE, FORGOTTEN_DIGIT)
        assert_kept_private(session, (*typed, MASK_DATE, TEST_PHRASE))
    finally:
        session.close()
    print("decode in the menu: an empty answer and a mistyped date asked again, a ? date found")


def holds_piece_of_share(text, share):
    """Whether `text` holds SHARE_PIECE letters in a row of the bytewords of `share`."""
    bytewords = share.removeprefix(SHARE_PREFIX)
    pieces = (bytewords[at : at + SHARE_PIECE] for at in range(len(bytewords) - SHARE_PIECE + 1))
    return any(piece in text for piece in pieces)


def check_restore_share_asked_again():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(RESTORE_ENTRY)
        session.wait_for("Was Seedshift used before it was split?")
        session.type("2")
        session.wait_for(SHARES)
        # Ctrl+D on an empty line, which ends the input of a shell, answers nothing here.
        session.type(CTRL_D)
        session.wait_for(ASKED_AGAIN)
        session.wait_for(SHARES)
        # Two shares pasted as two lines are one answer; the second one cannot be read.
        session.type(FIRST_SHARE + ENTER + MISTYPED_SHARE + ENTER)
        warning = line_starting(session, "Share 2 cannot be read")
        assert not holds_piece_of_share(warning, MISTYPED_SHARE), f"{warning!r} repeats the share"
        # Only that share is typed again: the first one is kept.
        session.wait_for("Type share 2 again")
        session.type("2")
        retyped = session.wait_for("Share 2 again:")
        session.type(THIRD_SHARE + ENTER)
        session.wait_for(DATES_WITH_MARKS)
        assert SHARES not in session.output[retyped : session.seen], "all shares asked again"
        session.type(FORGOTTEN_DIGIT + ENTER)
        answer_fingerprint(session)
        session.wait_for("found 1 match.")
        session.wait_for(f"(dates {MASK_DATE})")
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after restoring gave exit code {code}"
        shares = (FIRST_SHARE, MISTYPED_SHARE, THIRD_SHARE)
        bytewords = (share.removeprefix(SHARE_PREFIX) for share in shares)
        assert_kept_private(session, (*bytewords, FORGOTTEN_DIGIT, MASK_DATE, TEST_PHRASE))
    finally:
        session.close()
    print("restore in the menu: Ctrl+D and an unreadable share asked again, a ? date found")


def at_card_saving(session):
    """Chooses Encode in the menu shown, in colors, neither masked nor split, as cards of the first
    design, up to the question how the cards are saved. Returns the name of that design, which
    the list shows after it, on POSIX."""
    session.type(ENCODE_ENTRY)
    session.wait_for("Which form should the seed phrase take?")
    session.type("3")
    session.wait_for("Use Seedshift?")
    session.type("2")
    session.wait_for("Split it into Shamir shares?")
    session.type("1")
    session.wait_for("Where should the result go?")
    # Also as printable cards, which only a form in colors offers.
    session.type("4")
    session.wait_for("Which card design?")
    design = line_starting(session, "› 1  ").split()[-1]
    session.type("1")
    session.wait_for("How should the cards be saved?")
    return design


def shown_command(session):
    """Answers No to the sheet for heirs and returns the words of the command that the menu shows
    and runs, on POSIX; the pseudo-console of Windows may wrap it, and there None is returned. The
    command is then cancelled at its first question, so that it saves nothing, and the menu comes
    back."""
    session.wait_for("Instructions for your heirs?")
    session.type("1")
    session.wait_for("The same as:")
    line = line_starting(session, "mnemocode ")
    session.wait_for(SEED_PHRASE)
    session.type(CTRL_C)
    session.wait_for(MENU_SHOWN)
    return None if WINDOWS else shlex.split(line)


def check_card_questions():
    # In an empty folder, where the file and folder names that the menu offers are free. A Windows
    # process that has just ended may still hold the folder; its removal then passes over it.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
        session = Session(folder=folder)
        try:
            session.wait_for(MENU_SHOWN)
            design = at_card_saving(session)
            # One PDF of A6 sheets, under the name offered.
            session.type("1")
            session.wait_for("PDF file name (Enter: mnemocode-cards.pdf):")
            session.type(ENTER)
            session.wait_for("Add a QR code with all the codes of the sheet?")
            session.type("1")
            session.wait_for("Type your own details for the cards?")
            session.type("2")
            session.wait_for("Name, in Latin letters (Enter: random):")
            session.type(WRONG_CARD_NAME + ENTER)
            # One line says why, and the same detail is asked again.
            session.wait_for("Card name must use Latin letters only")
            session.wait_for("Name, in Latin letters (Enter: random):")
            session.type(CARD_NAME + ENTER)
            for detail in SHEET_DETAILS:
                session.wait_for(f"{detail} (Enter: random):")
                session.type(ENTER)
            command = shown_command(session)
            # Colors are format 5, with the design chosen. A6 is the page size that the commands
            # take when none is given, so none is named; nor is a detail left random with Enter.
            cards = ["mnemocode", "encode", "--ask-secrets", "--format", "5", "--mode", "direct"]
            cards += ["--template", design]
            sheets = [*cards, "--pdf", "mnemocode-cards.pdf", "--card-qr", "--card-name", CARD_NAME]
            if not WINDOWS:
                assert command == sheets, f"the menu ran {command!r}"

            # Separate business cards, PDF files in a new folder: no QR code is asked for.
            at_card_saving(session)
            asked = session.seen
            session.type("3")
            session.wait_for("Which kind of file for each card?")
            session.type("1")
            session.wait_for("Name of the new folder (Enter: mnemocode-cards):")
            session.type(ENTER)
            session.wait_for("Type your own details for the cards?")
            assert "Add a QR code" not in session.output[asked:], "separate cards got a QR code"
            session.type("1")
            command = shown_command(session)
            separate = [*cards, "--cards-dir", "mnemocode-cards"]
            if not WINDOWS:
                assert command == separate, f"the menu ran {command!r}"
            session.type(ESCAPE)
            code = session.wait_for_exit()
            assert code == 0, f"Escape after the card questions gave exit code {code}"
        finally:
            session.close()
    print("card questions in the menu: saving, a QR code on sheets only, details asked again")


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


def check_date_search_ctrl_c():
    # A date search of hours must stop at Ctrl+C and leave the private screen (AUD-008-API001).
    session = Session((
        "recover-date", "--mode", "seedshift", "--format", "english", "--input", TEST_PHRASE,
        "--date", "01-01-????", "--master-fingerprint", "deadbeef",
        "--max-candidates", "10000", "--progress-every", "1",
    ))
    try:
        session.wait_for("Checked 1/9999 date combinations")
        session.type(CTRL_C)
        code = session.wait_for_exit(limit=SEARCH_STOP_LIMIT)
        assert code == CANCELLED, f"Ctrl+C during the date search gave exit code {code}"
        if not WINDOWS:
            assert LEAVE_ALTERNATE_SCREEN in session.output, "the private screen was not left"
    finally:
        session.close()
    print(f"Ctrl+C during a date search: the private screen left, exit code {CANCELLED}")


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
    check_back_from_entry()
    check_card_questions()
    check_menu_ctrl_c()
    check_long_line()
    check_cursor_editing()
    check_lines_pasted_as_one_answer()
    check_decode_dates_asked_again()
    check_restore_share_asked_again()
    check_ctrl_c()
    check_date_search_ctrl_c()
    print("terminal input checks passed")


if __name__ == "__main__":
    main()
