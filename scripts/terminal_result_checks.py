"""Finite private result navigation on the real terminal, using public
fixtures only.
"""
import errno
import os
import re
from pathlib import Path
import tempfile

import terminal_session as terminal
from terminal_answers import (
    CANCELLED,
    CLEAR_PROMPT,
    FINGERPRINT,
    MASK_DATE,
    TEST_PHRASE,
    TEST_WORDS,
)

NAVIGATION = "Home/End"
# Seconds given to an Enter typed once too often to answer the question
# under the pages, which it must not.
STRAY_KEY_SECONDS = 0.5
# The page and the pages a private result shows in its keys.
PAGE_OF = re.compile(r"Page (\d+)/(\d+)")
PAGE_DOWN = "\x1b[6~"
PAGE_UP = "\x1b[5~"
VT220_HOME, VT220_END = "\x1b[1~", "\x1b[4~"
# The sizes, rows and columns, that the result checks run at: a common
# terminal of 80 columns by 24 rows, and a narrow window of 32 by 12,
# where a result must still fit or page.
FULL_SCREEN = (24, 80)
NARROW_SCREEN = (12, 32)
# A taller terminal, 80 by 30, where the eight candidates of recover-word
# fit as one row each but not as parts of their own.
CANDIDATE_SCREEN = (30, 80)


def assert_closed_descriptor(descriptor):
    """Confirms a closed PTY descriptor; an unrelated OS failure must
    not count as closure.
    """
    try:
        os.fstat(descriptor)
    except OSError as error:
        if error.errno != errno.EBADF:
            raise
    else:
        raise AssertionError("The closed PTY descriptor is still open")


def pages_from_here(session):
    """Every page of a private result from the current one to the last,
    read with PageDown; the current frame of each.
    """
    frames = [terminal.private_frame(session)]
    while (page := PAGE_OF.search(frames[-1])) and page[1] != page[2]:
        session.type(PAGE_DOWN)
        session.wait_for(NAVIGATION)
        frames.append(terminal.private_frame(session))
    return frames


def navigate(session, first, wanted):
    """Reads every page, each of `wanted` on one of them, then goes back
    to the first page with Home and to the last with End, as xterm sends
    them and as a VT220 or tmux does (AUD-037-UI005).
    """
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
        page = PAGE_OF.search(terminal.private_frame(session))
        assert page and page[1] == page[2], "End did not reach the last page"


def check_private_result_pages():
    """Shares and missing-code candidates remain revisitable in finite
    and narrow frames.
    """
    for size in (FULL_SCREEN, NARROW_SCREEN):
        with terminal.terminal_size(*size):
            check_private_share_pages()
        height, width = size
        print(
            "private share pages: Home/End and PageUp/PageDown at "
            f"{width}x{height}"
        )
    with terminal.terminal_size(*FULL_SCREEN):
        check_private_candidate_pages()
    print(
        "private candidate pages: revisitable, Ctrl+C exits 130, PTY "
        "closed twice safely"
    )


def check_private_share_pages():
    """The 16 shares of a set, each on a page of its own result, at the
    size of the pseudo-terminal.
    """
    session = terminal.Session((
        "encode", "--sskr", "--ask-secrets", "--mode", "direct",
        "--threshold", "16", "--shares", "16",
        "--share-format", "words", "--backup-check", "no",
    ))
    try:
        session.wait_for("Seed phrase (English BIP39 words):")
        session.type(TEST_PHRASE + terminal.ENTER)
        titles = [f"SSKR share {number} of 16" for number in range(1, 17)]
        # The result is a page of its own, under its heading (CORE-39).
        navigate(session, "MnemoCode · SSKR export", titles)
        session.type(terminal.ENTER)
        session.wait_for(CLEAR_PROMPT)
        # The end of the result stays, its last line the fingerprints'
        # note, without the keys of the pages (AUD-037-UI004).
        end = ("They do not reveal the phrase.",)
        gone = ("Page ", NAVIGATION)
        terminal.assert_private_result_visible(session, end, absent=gone)
        session.type(terminal.ENTER)
        assert session.wait_for_exit() == 0
        terminal.assert_kept_private(
            session, (TEST_PHRASE, "SSKR share 1 of 16")
        )
    finally:
        session.close()


def check_private_candidate_pages():
    """The candidates of a forgotten code, revisitable on their pages
    until Ctrl+C, and a pseudo-terminal that closes twice safely.
    """
    prefix = "mnemocode-public-candidates-"
    with tempfile.TemporaryDirectory(prefix=prefix) as folder:
        path = Path(folder) / "public-codes.txt"
        path.write_text("abandon " * 23 + "?", encoding="utf-8")
        session = terminal.Session((
            "decode", "--ask-secrets", "--mode", "direct",
            "--format", "english", "--input-kind", "codes",
            "--list-candidates", "--words", "24",
            "--input-file", str(path),
        ))
        try:
            navigate(
                session,
                "Code 24 cannot be read",
                ("Candidate 1", "Candidate 8"),
            )
            session.type(terminal.CTRL_C)
            assert session.wait_for_exit() == CANCELLED
            terminal.assert_kept_private(
                session, ("Candidate 1", "abandon abandon")
            )
        finally:
            descriptor = session.fd if not terminal.WINDOWS else None
            session.close()
            session.close()
        if descriptor is not None:
            assert_closed_descriptor(descriptor)


def check_share_pages():
    """Every share of a set is on the screen beside the lines around it
    or on a page: the export heading, its notices and the fingerprints,
    with colour, the default on a terminal, at 80x24 and at 32x12, and
    without, and with a complete backup or an original copy beside the
    shares, before the backup question and after its answer
    (AUD-037-UI002, UI004).
    """
    sets = (("2", "3", "words", "direct"), ("3", "3", "words", "direct"))
    sizes = (FULL_SCREEN, NARROW_SCREEN)
    runs = [
        *((size, True, case, ()) for size in sizes for case in sets),
        (NARROW_SCREEN, True, ("2", "3", "ur", "direct"), ()),
        (
            FULL_SCREEN,
            True,
            ("2", "3", "unicode", "seedshift"),
            ("--format", "english"),
        ),
        (
            FULL_SCREEN,
            True,
            ("2", "3", "words", "direct"),
            ("--show-original", "words"),
        ),
        *((FULL_SCREEN, False, case, ()) for case in sets),
    ]
    for size, colour, case, options in runs:
        threshold, count, form, mode = case
        arguments = (
            *("encode", "--sskr", "--ask-secrets", "--mode", mode),
            *("--threshold", threshold),
            *("--shares", count, "--share-format", form, *options),
        )
        # The screen is read at the size that the session started with.
        with terminal.terminal_size(*size):
            session = terminal.Session(arguments, colour=colour)
            try:
                read_share_set(session, mode, count, colour)
            finally:
                session.close()
    print(
        "share sets: every share on the screen or on a page, at 80x24 and "
        "32x12"
    )


def read_share_set(session, mode, count, colour):
    """Encodes the test phrase in `session` and checks what the backup
    question is drawn under. Each question is found by its first word:
    with colour, it is bold apart from the rest.
    """
    session.wait_for("Seed phrase")
    session.type(TEST_PHRASE + terminal.ENTER)
    if mode == "seedshift":
        session.wait_for("Dates")
        session.type(MASK_DATE + terminal.ENTER)
    shown = ""
    question = "Check the backup now?"
    if session.wait_for_any((NAVIGATION, question)) == NAVIGATION:
        if colour:
            assert (
                "\x1b[90mPage 1/" in session.output
            ), "the keys of the pages are not grey"
        shown = " ".join(pages_from_here(session))
        # A second Enter typed with the one that ends the pages answers
        # nothing.
        session.type(terminal.ENTER + terminal.ENTER)
        session.wait_for(question)
        session.read_some(wait=STRAY_KEY_SECONDS)
        terminal.assert_private_result_visible(session, ("Enter selects",))
    shown += " " + terminal.private_frame(session)
    numbers = range(1, int(count) + 1)
    titles = (f"share {number} of {count}" for number in numbers)
    # The heading of the export, which a terminal shows with colour or
    # without (AUD-037-UI006), and the wallet's fingerprint.
    wanted = ["SSKR export", FINGERPRINT, *titles]
    for marker in wanted:
        assert (
            marker in shown
        ), f"{marker!r} was neither on the screen nor on a page"
    session.type("2")
    session.wait_for(CLEAR_PROMPT)
    # The prompt's start: at 32 columns its last character wraps onto a
    # row of its own.
    shown = ("Press Enter to clear",)
    terminal.assert_private_result_visible(
        session, shown, absent=("Page ", NAVIGATION)
    )
    session.type(terminal.ENTER)
    assert session.wait_for_exit() == 0


def check_word_result_under_question():
    """recover-word asks what comes next under its result, which stays
    on the screen with every warning it gave (CORE-39): when no
    candidate matched the wallet, and when the candidates are too many
    to show, at 80x24.
    """
    cases = (
        (
            ("--master-fingerprint", "00000000"),
            " ".join([*TEST_WORDS[:-1], "a*"]),
            ("Matched 0 of 8 candidates", "only 32 bits"),
        ),
        (
            (),
            " ".join([*TEST_WORDS[:-2], "a*", "a*"]),
            ("do not fit on this screen", "does not prove the wallet"),
        ),
    )
    with terminal.terminal_size(*FULL_SCREEN):
        for options, words, warnings in cases:
            check_word_result(options, words, warnings)
    print(
        "recover-word: What now? under the result and every warning, "
        "at 80x24"
    )


def check_word_result(options, words, warnings):
    """recover-word with `options` and the marked `words`: its result
    and `warnings` under its question What now?, at the size of the
    pseudo-terminal.
    """
    session = terminal.Session(("recover-word", "--ask-secrets", *options))
    try:
        session.wait_for("? for each forgotten word:")
        session.type(words + terminal.ENTER)
        session.wait_for("What now?")
        shown = ("MnemoCode · Missing word recovery", *warnings)
        terminal.assert_private_result_visible(
            session, (*shown, "What now?")
        )
        session.type(terminal.CTRL_C)
        assert session.wait_for_exit() == CANCELLED
        terminal.assert_kept_private(session, (words,))
    finally:
        session.close()


def check_word_candidate_pages():
    """recover-word shows a short list of candidates whole, each a part
    of its own, by pages where the parts are taller than the screen: the
    eight candidates of a last word that starts with a, at 80x30, where
    they fit as one row each. The wallet check is offered only for a
    longer list (check_word_result_under_question).
    """
    words = " ".join([*TEST_WORDS[:-1], "a*"])
    with terminal.terminal_size(*CANDIDATE_SCREEN):
        session = terminal.Session(("recover-word", "--ask-secrets"))
        try:
            session.wait_for("? for each forgotten word:")
            session.type(words + terminal.ENTER)
            titles = [f"Candidate {number}" for number in range(1, 9)]
            navigate(session, "Missing word recovery", titles)
            session.type(terminal.ENTER)
            session.wait_for(CLEAR_PROMPT)
            shown = ("does not prove the wallet",)
            gone = ("Page ", NAVIGATION, "do not fit", "What now?")
            terminal.assert_private_result_visible(session, shown, absent=gone)
            session.type(terminal.ENTER)
            assert session.wait_for_exit() == 0
            terminal.assert_kept_private(session, (words, "Candidate 1"))
        finally:
            session.close()
    print("recover-word: eight candidates read by pages at 80x30")
