"""MnemoCode in a pseudo-terminal for scripts/verify-terminal-input.py: the program it starts,
the keys it types, the session that drives it and the screen that reads what it wrote back."""

import codecs
import errno
import os
import queue
import re
import shutil
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "dist" / "mnemocode.js")
# The pseudo-console of Windows starts a program by its full path.
NODE = shutil.which("node") or "node"
# By its full path, so that a check may start it in another folder (Session).
FULL_PATH = str(Path(PROGRAM).resolve())
COMMAND = [NODE, FULL_PATH] if PROGRAM.endswith(".js") else [FULL_PATH]
WINDOWS = sys.platform == "win32"

# The size of the pseudo-terminal: 40 rows of 120 columns, so that no line of the menu wraps.
TERMINAL_ROWS, TERMINAL_COLUMNS = 40, 120
# Bytes written to the pseudo-terminal at a time (Session.type).
TYPING_PIECE = 256
# Seconds that typing waits for the tool to take more input before the check fails.
TYPING_LIMIT = 30
# POSIX PTYs report their closed slave as EIO; readiness can race with a non-blocking read.
PTY_READ_END_OR_RACE = frozenset((errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK))

UP, DOWN, ENTER, CTRL_UP, ESCAPE = "\x1b[A", "\x1b[B", "\r", "\x1b[1;5A", "\x1b"
HOME, END, DELETE = "\x1b[H", "\x1b[F", "\x1b[3~"
BACKSPACE, CTRL_U, CTRL_C, CTRL_D = "\x7f", "\x15", "\x03", "\x04"
ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN = "\x1b[?1049h", "\x1b[?1049l"


@contextmanager
def terminal_size(rows, columns=None):
    """The size of the pseudo-terminals that sessions start with inside it, `columns` unchanged
    unless given: for a check whose result must fit on one screen."""
    global TERMINAL_ROWS, TERMINAL_COLUMNS
    previous = TERMINAL_ROWS, TERMINAL_COLUMNS
    TERMINAL_ROWS, TERMINAL_COLUMNS = rows, TERMINAL_COLUMNS if columns is None else columns
    try:
        yield
    finally:
        TERMINAL_ROWS, TERMINAL_COLUMNS = previous


class Session:
    """MnemoCode started in a pseudo-terminal; `output` collects everything it has written."""

    def __init__(self, arguments=(), folder=None, colour=False, stdout_file=None):
        """Starts MnemoCode with `arguments` in `folder`, or in the current folder; without
        colour (NO_COLOR) unless `colour`, as a terminal shows it by default. With `stdout_file`,
        standard output goes to that file instead of the terminal (POSIX only)."""
        self.output = ""
        # Where the last text waited for ends; the next wait looks only after it.
        self.seen = 0
        self.exit_code = None
        environment = dict(os.environ, TERM="xterm")
        for name in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"):
            environment.pop(name, None)
        if not colour:
            environment["NO_COLOR"] = "1"
        command = [*COMMAND, *arguments]
        if WINDOWS:
            from winpty import PtyProcess

            self.process = PtyProcess.spawn(
                command, cwd=folder, env=environment, dimensions=(TERMINAL_ROWS, TERMINAL_COLUMNS)
            )
            # pywinpty's read waits until the tool writes something, so it is read on a thread of
            # its own: a tool that stops writing then fails the wait that expected more, with the
            # screen so far, instead of holding the check until the CI step's time limit.
            self.chunks = queue.Queue()
            threading.Thread(target=self.read_windows, daemon=True).start()
        else:
            import fcntl
            import pty
            import struct
            import termios

            self.pid, self.fd = pty.fork()
            if self.pid == 0:
                if folder is not None:
                    os.chdir(folder)
                if stdout_file is not None:
                    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
                    os.dup2(os.open(stdout_file, flags, 0o600), 1)
                os.execvpe(command[0], command, environment)
            size = struct.pack("HHHH", TERMINAL_ROWS, TERMINAL_COLUMNS, 0, 0)
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, size)
            # Writes take what the terminal takes and never wait (Session.write_piece).
            os.set_blocking(self.fd, False)
            self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    def read_windows(self):
        """On Windows, passes on what the tool writes, until its pseudo-console closes."""
        while True:
            try:
                self.chunks.put(self.process.read(4096))
            except EOFError:
                return

    def read_some(self, wait=0.05):
        """Adds what the tool has written to `output`, waiting up to `wait` seconds for it."""
        if WINDOWS:
            try:
                self.output += self.chunks.get(timeout=wait)
                while True:
                    self.output += self.chunks.get_nowait()
            except queue.Empty:
                pass
            return
        import select

        ready, _, _ = select.select([self.fd], [], [], wait)
        if ready:
            try:
                self.output += self.decoder.decode(os.read(self.fd, 65536))
            except OSError as error:
                if error.errno not in PTY_READ_END_OR_RACE:
                    raise

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

    def wait_for_any(self, needles, limit=30):
        """Reads until one of `needles` appears after the text last waited for; returns it."""
        end = time.monotonic() + limit
        while time.monotonic() < end:
            found = [(at, n) for n in needles if (at := self.output.find(n, self.seen)) >= 0]
            if found:
                at, needle = min(found)
                self.seen = at + len(needle)
                return needle
            self.read_some()
        raise AssertionError(f"none of {needles!r} appeared in {self.output[self.seen:]!r}")

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
        try:
            if self.alive():
                if WINDOWS:
                    self.process.terminate(force=True)
                else:
                    os.kill(self.pid, 9)
                    os.waitpid(self.pid, 0)
                    self.exit_code = -9
        finally:
            if not WINDOWS and self.fd is not None:
                os.close(self.fd)
                self.fd = None


# A control sequence (ECMA-48 CSI): parameters, then one final byte.
CONTROL_SEQUENCE = re.compile(r"\x1b\[([0-9;?]*)([@-~])")


class Screen:
    """The rows that a terminal `columns` wide shows after `text`, for what the menu draws: text,
    which waits at the right edge before it wraps, carriage return, line feed, and the sequences
    for cursor up, cursor down, cursor right, home and screen erasure; colours and bold, which
    change no cell, are skipped. Rows scroll only when a finite height is supplied. Any other
    escape sequence fails the check."""

    def __init__(self, columns, text, height=None):
        self.columns = columns
        self.height = height
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
        while self.height is not None and len(self.rows) > self.height:
            del self.rows[0]
            self.row -= 1

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
        # Select graphic rendition (colours, bold) changes no cell or position: a check reads text.
        if final == "m":
            return
        count = int(parameters or "1")
        if final == "A":
            self.move(self.row - count, self.column)
        elif final == "B":
            self.move(self.row + count, self.column)
        elif final == "C":
            self.move(self.row, self.column + count)
        elif final == "J" and parameters == "":
            del self.rows[self.row][self.column :]
            del self.rows[self.row + 1 :]
        elif final == "H" and parameters == "":
            self.move(0, 0)
        elif final == "J" and parameters == "2":
            self.rows = [[] for _ in range(self.row + 1)]
        else:
            raise AssertionError(f"unexpected sequence ESC [ {parameters}{final}")


def assert_private_result_visible(session, markers, absent=(), once=()):
    """Checks the current private frame, including erases and scrolling, rather than its history:
    each of `markers` is on it, none of `absent`, and each of `once` exactly once.

    ConPTY redraws its own screen and may omit the raw switch/clear sequences; there the regular
    terminal tests check the output and the platform-neutral screen tests check frame contents.
    """
    if WINDOWS:
        return
    frame = private_frame(session)
    for marker in markers:
        assert marker in frame, f"the current private frame lost {marker!r}"
    for marker in absent:
        assert marker not in frame, f"the current private frame still shows {marker!r}"
    for marker in once:
        count = frame.count(marker)
        assert count == 1, f"the current private frame shows {marker!r} {count} times"


def private_frame(session):
    """The current frame of the private screen, as one line with each run of blanks one space."""
    session.read_some(wait=0.05)
    start = session.output.rfind(ENTER_ALTERNATE_SCREEN)
    assert start >= 0, "the private screen was not opened"
    text = session.output[start + len(ENTER_ALTERNATE_SCREEN) :]
    return " ".join(" ".join(Screen(TERMINAL_COLUMNS, text, TERMINAL_ROWS).lines()).split())


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


def line_starting(session, start):
    """Waits for the line that begins with `start` and returns it whole, on POSIX. The
    pseudo-console of Windows redraws the screen itself and need not pass on the line as written,
    so there only `start` is waited for and returned."""
    end = session.wait_for(start)
    if WINDOWS:
        return start
    return session.output[end - len(start) : session.wait_for("\n")].strip()
