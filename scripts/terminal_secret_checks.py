"""The checks of scripts/verify-terminal-input.py for Re-encode and for answers asked again in
Decode and Restore."""

from terminal_session import CTRL_D, ENTER, ESCAPE, Session, assert_kept_private, line_starting
from terminal_answers import (
    ASKED_AGAIN,
    CARD_NAME,
    CLEAR_PROMPT,
    DATES_WITH_MARKS,
    DECODE_ENTRY,
    FINGERPRINT_FILTER,
    FIRST_SHARE,
    FORGOTTEN_DIGIT,
    HIDDEN_RECORD,
    JOINED_UNICODE,
    LAST_WORD,
    LEGACY_VALID_WORD_NUMBERS,
    MASKED_WORD_NUMBERS,
    MASK_DATE,
    MENU_SHOWN,
    MISTYPED_DATE,
    MISTYPED_SHARE,
    NEXT_DAY,
    RESTORE_ENTRY,
    RE_ENCODE_ENTRY,
    SHARES,
    SHARE_PIECE,
    SHARE_PREFIX,
    SHEET_DETAILS,
    TEST_PHRASE,
    THIRD_SHARE,
    answer_fingerprint,
)


def at_re_encode_confirmation(session):
    """Chooses Re-encode in the menu shown and types the old backup, as Decode asks for it: typed,
    every code read, MnemoCode Seedshift; then its dates, up to the question whether the phrase
    shown is the one to re-encode."""
    session.type(RE_ENCODE_ENTRY)
    session.wait_for("Where is the encoded seed phrase?")
    session.type("1")
    session.wait_for("How many words does the seed phrase have?")
    session.type("1")
    session.wait_for("Was Seedshift used when it was encoded?")
    session.type("2")
    session.wait_for(HIDDEN_RECORD)
    session.type(MASKED_WORD_NUMBERS + ENTER)
    session.wait_for("Dates (")
    session.type(MASK_DATE + ENTER)
    session.wait_for(TEST_PHRASE)
    session.wait_for("Is this the seed phrase to re-encode?")


def check_re_encode_menu():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        # The old backup, then the phrase, re-encoded once the wallet confirms it.
        at_re_encode_confirmation(session)
        session.type("2")
        answer_fingerprint(session)
        # A fingerprint is only a filter: its warning comes with the match (AUD-020-SEC001).
        session.wait_for(FINGERPRINT_FILTER)
        session.wait_for("The fingerprint matches: the seed phrase is accepted, not proven.")
        # Only then the new backup, with Encode's questions, under the lines of the confirmation:
        # Unicode codes without Seedshift, on the screen.
        session.wait_for("New backup")
        session.wait_for(FINGERPRINT_FILTER)
        session.wait_for("The fingerprint matches: the seed phrase is accepted, not proven.")
        session.wait_for("Which form should the seed phrase take?")
        session.type("2")
        session.wait_for("Use Seedshift?")
        session.type("2")
        session.wait_for("Split it into Shamir shares?")
        session.type("1")
        session.wait_for("Where should the result go?")
        session.type("1")
        session.wait_for("Instructions for your heirs?")
        session.type("1")
        session.wait_for(JOINED_UNICODE)
        session.wait_for("Check the backup now?")
        session.type("2")
        session.wait_for("The old backup still restores the same wallet")
        session.wait_for(CLEAR_PROMPT)
        assert "Error" not in session.output and "mnemocode:" not in session.output, session.output
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type("q")
        session.wait_for_exit()
        assert_kept_private(session, (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS, JOINED_UNICODE))
    finally:
        session.close()
    print("re-encode in the menu: codes, dates, the phrase confirmed, then the new backup asked")


# A company name that each answer takes (up to 100 characters) and that does not fit on share
# cards of the IT design, which Encode refuses once every answer is given (AUD-022-UI001).
LONG_COMPANY = "Northern Atlantic Consolidated Engineering and Logistics Holdings"


def check_re_encode_answer_refused():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        at_re_encode_confirmation(session)
        session.type("1")
        # Shares in colors on A6 sheets of the IT design, with the long company name.
        session.wait_for("Which form should the seed phrase take?")
        session.type("3")
        session.wait_for("Use Seedshift?")
        session.type("2")
        session.wait_for("Split it into Shamir shares?")
        session.type("2")
        session.wait_for("Where should the shares go?")
        session.type("3")
        session.wait_for("Which kind of file?")
        session.type("1")
        session.wait_for("How should the cards be laid out?")
        session.type("1")
        session.wait_for("How should the sheets be turned?")
        session.type("1")
        session.wait_for("PDF file name (Enter: mnemocode-share-cards.pdf):")
        session.type(ENTER)
        session.wait_for("Which card design?")
        session.type("2")
        session.wait_for("Add a QR code with the codes of the backup, without the extra cards?")
        session.type("2")
        session.wait_for("Type your own details for the cards?")
        session.type("2")
        session.wait_for("Name, in Latin letters (Enter: random):")
        session.type(CARD_NAME + ENTER)
        for detail in SHEET_DETAILS:
            session.wait_for(f"{detail} (Enter: random):")
            session.type((LONG_COMPANY if detail == "Company" else "") + ENTER)
        session.wait_for("Also show the whole seed phrase?")
        session.type("1")
        session.wait_for("Instructions for your heirs?")
        session.type("1")
        # The refusal, then the same questions under the confirmed phrase: nothing is typed again.
        session.wait_for("You recognised the seed phrase: it is confirmed.")
        session.wait_for("Company is too long to fit legibly on the card")
        session.wait_for("Which form should the seed phrase take?")
        # Escape at the first question goes back to the phrase, and Stop to the menu.
        session.type(ESCAPE)
        session.wait_for("Is this the seed phrase to re-encode?")
        session.type("5")
        session.wait_for(MENU_SHOWN)
        assert "mnemocode:" not in session.output, session.output
        session.type("q")
        session.wait_for_exit()
        assert_kept_private(session, (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS))
    finally:
        session.close()
    print("re-encode in the menu: a refused new backup is asked again under the confirmed phrase")


def check_re_encode_recognised():
    # Typed as a command: --recognised answers the confirmation once the phrase was read.
    session = Session(
        ("re-encode", "--ask-secrets", "--recognised", "--mode", "direct", "--format", "3")
    )
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + ENTER)
        # Without a header the codes do not say how they were made: MnemoCode Seedshift.
        session.wait_for("Was Seedshift used when it was encoded?")
        session.type("2")
        session.wait_for("Dates (")
        session.type(MASK_DATE + ENTER)
        session.wait_for(TEST_PHRASE)
        session.wait_for("Press Enter to make the new backup (Esc stops).")
        session.type(ENTER)
        session.wait_for(JOINED_UNICODE)
        session.wait_for("Check the backup now?")
        session.type("2")
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        code = session.wait_for_exit()
        assert code == 0, f"re-encode --recognised gave exit code {code}"
        assert_kept_private(session, (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS, JOINED_UNICODE))
    finally:
        session.close()
    print("re-encode --recognised: the phrase shown, Enter makes the new backup")


def check_re_encode_last_word_after_wrong_date():
    # Typed as a command, the new backup given by its options: Unicode codes without Seedshift.
    session = Session(
        (
            "re-encode",
            "--ask-secrets",
            "--old-mode",
            "seedshift-legacy-valid",
            "--mode",
            "direct",
            "--format",
            "3",
        )
    )
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(LEGACY_VALID_WORD_NUMBERS + ENTER)
        session.wait_for("Dates (")
        session.type(NEXT_DAY + ENTER)
        session.wait_for("Last word of the original seed phrase:")
        session.type(LAST_WORD + ENTER)
        # The wrong date gave other phrases: the dates are typed again, the codes kept.
        session.wait_for("No seed phrase of this backup ends with that word")
        asked = session.wait_for("What now?")
        session.type("2")
        session.wait_for("Dates (")
        assert HIDDEN_RECORD not in session.output[asked : session.seen], "codes asked again"
        session.type(MASK_DATE + ENTER)
        session.wait_for("Last word of the original seed phrase:")
        session.type(LAST_WORD + ENTER)
        session.wait_for(TEST_PHRASE)
        session.wait_for("Is this the seed phrase to re-encode?")
        session.type("1")
        session.wait_for(JOINED_UNICODE)
        session.wait_for("Check the backup now?")
        session.type("2")
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        code = session.wait_for_exit()
        assert code == 0, f"re-encode after the dates typed again gave exit code {code}"
        assert_kept_private(
            session, (TEST_PHRASE, MASK_DATE, NEXT_DAY, LEGACY_VALID_WORD_NUMBERS, JOINED_UNICODE)
        )
    finally:
        session.close()
    print("re-encode with the last word: after a wrong date the dates are typed again, codes kept")


def check_decode_dates_asked_again():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(DECODE_ENTRY)
        session.wait_for("Where is the encoded seed phrase?")
        session.type("1")
        session.wait_for("How many words does the seed phrase have?")
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
