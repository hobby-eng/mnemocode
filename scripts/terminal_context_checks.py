"""What a step of the private screen shows beside its question, on the real terminal: the encoded
fingerprint before the dates are typed, and why a question is asked (AUD-037-UI001). Each check
reads the current frame, not the history of what was written. Public fixtures only."""
import tempfile
from pathlib import Path

import terminal_session as terminal
from terminal_answers import (
    CANCELLED,
    DECODE_ENTRY,
    FIRST_SHARE,
    HIDDEN_RECORD,
    MASK_DATE,
    MASKED_WORD_NUMBERS,
    MENU_SHOWN,
    MISTYPED_DATE,
    RESTORE_ENTRY,
    SEED_PHRASE,
    SHARES,
    TEST_PHRASE,
    THIRD_SHARE,
)

# The encoded fingerprint of the test phrase masked with the README's date, as Encode shows it,
# and the sentence that comes with every fingerprint; its label differs with colour.
ENCODED_FINGERPRINT = "0d05289e"
FINGERPRINT_NOTE = "They do not reveal the phrase."


def frame_shows_at(arguments, prompt, answer, question, markers, colour):
    """Runs `arguments`, answers `prompt` with `answer` and checks the frame of `question`."""
    session = terminal.Session(arguments, colour=colour)
    try:
        session.wait_for(prompt)
        session.type(answer + terminal.ENTER)
        session.wait_for(question)
        terminal.assert_private_result_visible(session, markers)
        session.type(terminal.CTRL_C)
        assert session.wait_for_exit() == CANCELLED
    finally:
        session.close()


def check_fingerprint_before_dates():
    """Decode, recover-date and sskr-combine keep the encoded fingerprint on the Dates screen."""
    markers = (ENCODED_FINGERPRINT, FINGERPRINT_NOTE)
    shares = f"{FIRST_SHARE}; {THIRD_SHARE}"
    codes = "Encoded seed phrase"
    cases = (
        # Each question is found by its first word, Dates: with colour, it is bold apart from the
        # rest of the question.
        (("decode", "--ask-secrets", "--mode", "seedshift"), codes, MASKED_WORD_NUMBERS),
        (("recover-date", "--ask-secrets", "--mode", "seedshift"), codes, MASKED_WORD_NUMBERS),
        (("sskr-combine", "--ask-secrets", "--mode", "seedshift"), "Shamir shares", shares),
    )
    for colour in (False, True):
        for arguments, prompt, answer in cases:
            frame_shows_at(arguments, prompt, answer, "Dates", markers, colour)
    print("encoded fingerprint on the Dates screen: decode, recover-date, sskr-combine")


def check_fingerprint_before_dates_in_menu():
    """The menu's Decode and Restore keep the encoded fingerprint on the Dates screen too."""
    shares = f"{FIRST_SHARE}; {THIRD_SHARE}"
    cases = (
        (
            DECODE_ENTRY,
            (
                ("Where is the encoded seed phrase?", "1"),
                ("How many words does the seed phrase have?", "1"),
                ("Was Seedshift used when it was encoded?", "2"),
            ),
            HIDDEN_RECORD,
            MASKED_WORD_NUMBERS,
        ),
        (RESTORE_ENTRY, (("Was Seedshift used before it was split?", "2"),), SHARES, shares),
    )
    for entry, steps, prompt, answer in cases:
        session = terminal.Session()
        try:
            session.wait_for(MENU_SHOWN)
            session.type(entry)
            for question, key in steps:
                session.wait_for(question)
                session.type(key)
            session.wait_for(prompt)
            session.type(answer + terminal.ENTER)
            session.wait_for("Dates")
            markers = (ENCODED_FINGERPRINT, FINGERPRINT_NOTE)
            terminal.assert_private_result_visible(session, markers)
            session.type(terminal.CTRL_C)
            session.wait_for(MENU_SHOWN)
            session.type("q")
            session.wait_for_exit()
        finally:
            session.close()
    print("encoded fingerprint on the Dates screen: the menu's Decode and Restore")


def check_question_reason_kept():
    """Decode keeps the reason of its Seedshift question on that question's screen."""
    frame_shows_at(
        ("decode", "--ask-secrets"),
        "Encoded seed phrase",
        MASKED_WORD_NUMBERS,
        "Was Seedshift used when it was encoded?",
        ("no MNC1 record header",),
        colour=False,
    )
    print("question reason on its screen: codes without a record header")


def check_context_ends_at_escape():
    """Escape at the Seedshift question asks for the codes again without what was kept for them:
    their format and why the question was asked describe codes not typed yet."""
    session = terminal.Session(("decode", "--ask-secrets"))
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + terminal.ENTER)
        session.wait_for("Was Seedshift used when it was encoded?")
        session.type(terminal.ESCAPE)
        session.wait_for(HIDDEN_RECORD)
        absent = ("Detected input format", "no MNC1 record header")
        terminal.assert_private_result_visible(session, (HIDDEN_RECORD.strip(),), absent=absent)
        session.type(terminal.CTRL_C)
        assert session.wait_for_exit() == CANCELLED
    finally:
        session.close()
    print("question context left with Escape: the codes asked again without it")


def check_new_backup_heading_on_screen():
    """Re-encode's "New backup" heading is drawn on the private screen with each question, also
    when standard output goes to a file, which never gets it (POSIX only)."""
    if terminal.WINDOWS:
        return
    with tempfile.TemporaryDirectory() as folder:
        written = Path(folder) / "stdout.txt"
        arguments = ("re-encode", "--ask-secrets", "--recognised")
        session = terminal.Session(arguments, stdout_file=written)
        try:
            session.wait_for(HIDDEN_RECORD)
            session.type(MASKED_WORD_NUMBERS + terminal.ENTER)
            session.wait_for("Was Seedshift used when it was encoded?")
            session.type("2")
            session.wait_for("Dates (")
            session.type(MASK_DATE + terminal.ENTER)
            session.wait_for("Press Enter to make the new backup (Esc stops).")
            session.type(terminal.ENTER)
            session.wait_for("Which form should the seed phrase take?")
            terminal.assert_private_result_visible(session, ("New backup",))
            # Unicode codes, form 3.
            session.type("3")
            session.wait_for("Use Seedshift?")
            terminal.assert_private_result_visible(session, ("New backup",))
            session.type(terminal.CTRL_C)
            assert session.wait_for_exit() == CANCELLED
        finally:
            session.close()
        assert "New backup" not in written.read_text(), "the heading went to standard output"
    print("re-encode: the New backup heading on the private screen, not in standard output")


def check_cloud_link_kept():
    """A cloud warning given with the options stays with its link, once, on every step screen."""
    cloud = "Dropbox keeps a copy of"
    more = "More: https://github.com/hobby-eng/mnemocode#cloud-folders"
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / "Dropbox").mkdir()
        arguments = (
            *("encode", "--ask-secrets", "--mode", "seedshift", "--format", "2"),
            *("--output", "Dropbox/record.txt", "--backup-check", "no"),
        )
        session = terminal.Session(arguments, folder=folder)
        try:
            session.wait_for(SEED_PHRASE)
            terminal.assert_private_result_visible(session, (), once=(cloud, more))
            session.type(TEST_PHRASE + terminal.ENTER)
            session.wait_for("Dates (")
            terminal.assert_private_result_visible(session, (), once=(cloud, more))
            session.type(MISTYPED_DATE + terminal.ENTER)
            session.wait_for("Dates (")
            terminal.assert_private_result_visible(session, (), once=(cloud, more))
            session.type(terminal.CTRL_C)
            assert session.wait_for_exit() == CANCELLED
        finally:
            session.close()
    print("cloud warning given with the options: kept with its link on every step screen")
