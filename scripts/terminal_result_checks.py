"""Finite private result navigation on the real terminal, using public fixtures only."""
import errno
import os
import re
from pathlib import Path
import tempfile

import terminal_session as terminal
from terminal_answers import CANCELLED, CLEAR_PROMPT, FINGERPRINT, MASK_DATE, TEST_PHRASE

NAVIGATION = "Home/End"
PAGE_DOWN = "\x1b[6~"
PAGE_UP = "\x1b[5~"
VT220_HOME, VT220_END = "\x1b[1~", "\x1b[4~"


def assert_closed_descriptor(descriptor):
    """Confirms a closed PTY descriptor; an unrelated OS failure must not count as closure."""
    try:
        os.fstat(descriptor)
    except OSError as error:
        if error.errno != errno.EBADF:
            raise
    else:
        raise AssertionError("The closed PTY descriptor is still open")


def pages_from_here(session):
    """Every page of a private result from the current one to the last, read with PageDown; the
    current frame of each."""
    frames = [terminal.private_frame(session)]
    while (page := re.search(r"Page (\d+)/(\d+)", frames[-1])) and page[1] != page[2]:
        session.type(PAGE_DOWN)
        session.wait_for(NAVIGATION)
        frames.append(terminal.private_frame(session))
    return frames


def navigate(session, first, wanted):
    """Reads every page, each of `wanted` on one of them, then goes back to the first page with
    Home and to the last with End, as xterm sends them and as a VT220 or tmux does
    (AUD-037-UI005)."""
    session.wait_for(NAVIGATION)
    terminal.assert_private_result_visible(session, (first,))
    shown = " ".join(pages_from_here(session))
    for marker in wanted:
        assert marker in shown, f"{marker!r} is on no page"
    for home, end in ((terminal.HOME, terminal.END), (VT220_HOME, VT220_END)):
        session.type(home)
        session.wait_for(NAVIGATION)
        terminal.assert_private_result_visible(session, (first,))
        session.type(end)
        session.wait_for(NAVIGATION)
        page = re.search(r"Page (\d+)/(\d+)", terminal.private_frame(session))
        assert page and page[1] == page[2], "End did not reach the last page"


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
                titles = [f"SSKR share {number} of 16" for number in range(1, 17)]
                navigate(session, "MnemoCode · encode", titles)
                session.type(terminal.ENTER)
                session.wait_for(CLEAR_PROMPT)
                # The end of the result stays, its last line the fingerprints' note, without the
                # keys of the pages (AUD-037-UI004).
                end = ("They do not reveal the phrase.",)
                gone = ("Page ", NAVIGATION)
                terminal.assert_private_result_visible(session, end, absent=gone)
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
                navigate(session, "Code 24 cannot be read", ("Candidate 1", "Candidate 8"))
                session.type(terminal.CTRL_C)
                assert session.wait_for_exit() == CANCELLED
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


def check_share_pages():
    """Every share of a set is on the screen beside the lines around it or on a page: the export
    heading, its notices and the fingerprints, with colour, the default on a terminal, at 80x24
    and at 32x12, and without, and with a complete backup or an original copy beside the shares,
    before the backup question and after its answer (AUD-037-UI002, UI004)."""
    previous = terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS
    sets = (("2", "3", "words", "direct"), ("3", "3", "words", "direct"))
    runs = [
        *((size, True, case, ()) for size in ((24, 80), (12, 32)) for case in sets),
        *(((12, 32), True, case, ()) for case in (("2", "3", "ur", "direct"),)),
        ((24, 80), True, ("2", "3", "unicode", "seedshift"), ("--format", "english")),
        ((24, 80), True, ("2", "3", "words", "direct"), ("--show-original", "words")),
        *(((24, 80), False, case, ()) for case in sets),
    ]
    try:
        for (height, width), colour, (threshold, count, form, mode), options in runs:
            terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = height, width
            arguments = (
                *("encode", "--sskr", "--ask-secrets", "--mode", mode, "--threshold", threshold),
                *("--shares", count, "--share-format", form, *options),
            )
            session = terminal.Session(arguments, colour=colour)
            try:
                read_share_set(session, mode, count, colour)
            finally:
                session.close()
        print("share sets: every share on the screen or on a page, at 80x24 and 32x12")
    finally:
        terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = previous


def read_share_set(session, mode, count, colour):
    """Encodes the test phrase in `session` and checks what the backup question is drawn under.
    Each question is found by its first word: with colour, it is bold apart from the rest."""
    session.wait_for("Seed phrase")
    session.type(TEST_PHRASE + terminal.ENTER)
    if mode == "seedshift":
        session.wait_for("Dates")
        session.type(MASK_DATE + terminal.ENTER)
    shown = ""
    if session.wait_for_any((NAVIGATION, "Check the backup now?")) == NAVIGATION:
        if colour:
            assert "\x1b[90mPage 1/" in session.output, "the keys of the pages are not grey"
        shown = " ".join(pages_from_here(session))
        # A second Enter typed with the one that ends the pages answers nothing.
        session.type(terminal.ENTER + terminal.ENTER)
        session.wait_for("Check the backup now?")
        session.read_some(wait=0.5)
        terminal.assert_private_result_visible(session, ("Enter selects",))
    shown += " " + terminal.private_frame(session)
    titles = (f"share {number} of {count}" for number in range(1, int(count) + 1))
    # The heading of the export, or without colour its plain line, and the wallet's fingerprint.
    wanted = ["SSKR export" if colour else "shares required", FINGERPRINT, *titles]
    for marker in wanted:
        assert marker in shown, f"{marker!r} was neither on the screen nor on a page"
    session.type("2")
    session.wait_for(CLEAR_PROMPT)
    # The prompt's start: at 32 columns its last character wraps onto a row of its own.
    shown = ("Press Enter to clear",)
    terminal.assert_private_result_visible(session, shown, absent=("Page ", NAVIGATION))
    session.type(terminal.ENTER)
    assert session.wait_for_exit() == 0
