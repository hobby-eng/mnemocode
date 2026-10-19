"""Finite private result navigation on the real terminal, using public fixtures only."""
import errno
import os
from pathlib import Path
import tempfile

import terminal_session as terminal
from terminal_answers import TEST_PHRASE, CLEAR_PROMPT

NAVIGATION = "Home/End"
PAGE_DOWN = "\x1b[6~"
PAGE_UP = "\x1b[5~"


def assert_closed_descriptor(descriptor):
    """Confirms a closed PTY descriptor; an unrelated OS failure must not count as closure."""
    try:
        os.fstat(descriptor)
    except OSError as error:
        if error.errno != errno.EBADF:
            raise
    else:
        raise AssertionError("The closed PTY descriptor is still open")


def navigate(session, first):
    """Visit the last page, return to the first, then try both page directions."""
    session.wait_for(NAVIGATION)
    terminal.assert_private_result_visible(session, (first,))
    session.type(terminal.END)
    session.wait_for(NAVIGATION)
    session.type(terminal.HOME)
    session.wait_for(NAVIGATION)
    terminal.assert_private_result_visible(session, (first,))
    session.type(PAGE_DOWN)
    session.wait_for(NAVIGATION)
    session.type(PAGE_UP)
    session.wait_for(NAVIGATION)
    terminal.assert_private_result_visible(session, (first,))


def check_private_result_pages():
    """Shares and missing-code candidates remain revisitable in finite and narrow frames."""
    previous = terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS
    try:
        for height, width in ((24, 80), (12, 32)):
            terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = height, width
            session = terminal.Session((
                "encode", "--sskr", "--ask-secrets", "--mode", "direct",
                "--threshold", "16", "--shares", "16", "--share-format", "words",
                "--backup-check", "no",
            ))
            try:
                session.wait_for("Seed phrase (English BIP39 words):")
                session.type(TEST_PHRASE + terminal.ENTER)
                navigate(session, "SSKR share 1 of 16")
                session.type(terminal.ENTER)
                session.wait_for(CLEAR_PROMPT)
                session.type(terminal.ENTER)
                assert session.wait_for_exit() == 0
                terminal.assert_kept_private(session, (TEST_PHRASE, "SSKR share 1 of 16"))
            finally:
                session.close()
            print(f"private share pages: Home/End and PageUp/PageDown at {width}x{height}")

        terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = 24, 80
        with tempfile.TemporaryDirectory(prefix="mnemocode-public-candidates-") as folder:
            path = Path(folder) / "public-codes.txt"
            path.write_text("abandon " * 23 + "?", encoding="utf-8")
            session = terminal.Session((
                "decode", "--ask-secrets", "--mode", "direct", "--format", "english",
                "--input-kind", "codes", "--list-candidates", "--words", "24",
                "--input-file", str(path),
            ))
            try:
                navigate(session, "Candidate 1")
                session.type(terminal.CTRL_C)
                assert session.wait_for_exit() == 130
                terminal.assert_kept_private(session, ("Candidate 1", "abandon abandon"))
            finally:
                descriptor = session.fd if not terminal.WINDOWS else None
                session.close()
                session.close()
            if descriptor is not None:
                assert_closed_descriptor(descriptor)
        print("private candidate pages: revisitable, Ctrl+C exits 130, PTY closed twice safely")
    finally:
        terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = previous
