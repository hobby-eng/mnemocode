"""The step that an answer under a result leads to, on the real terminal
(CORE-39): the dates or the codes typed again, or a search with another
wallet, start a screen of their own, under the command's title, and the
old result is no longer on it. The questions asked under a result, What
now? and the wallet asked with it, keep the result in view. Each check
reads the current frame, not the history of what was written. Public
fixtures only.
"""
import terminal_session as terminal
from terminal_answers import (
    CLEAR_PROMPT,
    FIRST_SHARE,
    FINGERPRINT,
    FORGOTTEN_DIGIT,
    HIDDEN_RECORD,
    JOINED_UNICODE,
    MASK_DATE,
    MASKED_WORD_NUMBERS,
    NEXT_DAY,
    SEED_PHRASE,
    TEST_PHRASE,
    THIRD_SHARE,
    WORD_NUMBERS,
)

# A wallet that no phrase of the fixtures gives: every search with it
# ends with What now? under its result.
NO_WALLET = "00000000"
# The test phrase masked with the README's date by the Original
# Seedshift, which keeps no checksum, as English words, made with
#   mnemocode encode --mode seedshift-legacy \
#     --mnemonic-file public-mnemonic.txt \
#     --dates-file public-dates.txt --format 1
# NEXT_DAY gives a phrase whose checksum fails. As an exact legacy
# phrase, recover-word --legacy-valid-last-word gives 128 replacements
# of its last word, too many for one screen.
LEGACY_WORDS = (
    "wool abuse actual wool abuse actual wool abuse actual wool abuse addict"
)
# The question under a result after a search or a phrase that cannot be
# the right one (src/cli/ask.ts).
WHAT_NOW = "What now?"
# The start of the question for dates that may hold ?: recover-date's,
# and Decode's and Re-encode's (src/cli/date-search.ts).
RECOVERY_DATES = "Dates with ? for what is forgotten"
DATES = "Dates ("
# The headings of the results that the checks leave.
DATE_RESULT = "MnemoCode · Date recovery"
DECODE_RESULT = "MnemoCode · Recovered result"
WORD_RESULT = "MnemoCode · Missing word recovery"
CONFIRMATION = "Is this the seed phrase to re-encode?"
# A tall frame holds the complete split and the optional whole backup
# together, so this check observes the repeated result without paging.
REPEATED_SPLIT_ROWS = 80


def assert_step_screen(session, command, gone):
    """The current frame is a step screen of `command`: its title is on
    it, and none of `gone`, what the result before it showed.
    """
    terminal.assert_private_result_visible(
        session, (f"MnemoCode · {command}",), absent=(*gone, WHAT_NOW)
    )


def end_at_clear_prompt(session):
    """Waits for the prompt that clears the private screen, presses
    Enter and checks that the command ended well.
    """
    session.wait_for(CLEAR_PROMPT)
    session.type(terminal.ENTER)
    code = session.wait_for_exit()
    assert code == 0, f"the command ended with exit code {code}"


def check_steps_after_result():
    """Runs every check of this module in turn."""
    check_recover_date_steps()
    check_decode_dates_again()
    check_re_encode_dates_again()
    check_legacy_replacements_page()
    check_share_result_again()


def check_share_result_again():
    """A wrong written quorum leads back to the whole split result,
    with its optional original words and fingerprints on the fresh
    screen.
    """
    with terminal.terminal_size(REPEATED_SPLIT_ROWS, 120):
        session = terminal.Session((
            "encode", "--sskr", "--ask-secrets", "--mode", "direct",
            "--show-original", "words", "--threshold", "2", "--shares", "3",
        ))
        try:
            session.wait_for(SEED_PHRASE)
            session.type(TEST_PHRASE + terminal.ENTER)
            session.wait_for("Check the backup now?")
            session.type("1")
            session.wait_for("2 shares as written down")
            # These published fixtures hold the masked phrase, not the
            # direct original phrase that this command split.
            session.type(FIRST_SHARE + ";" + THIRD_SHARE + terminal.ENTER)
            session.wait_for(WHAT_NOW)
            session.type("2")
            session.wait_for("Original seed phrase")
            session.wait_for("Check the backup now?")
            terminal.assert_private_result_visible(session, (
                "MnemoCode · SSKR export", "MnemoCode · Original seed phrase",
                TEST_PHRASE, "SSKR share 1 of 3", "SSKR share 3 of 3",
                "Original fingerprint " + FINGERPRINT,
                "Encoded fingerprint " + FINGERPRINT,
            ), absent=(WORD_NUMBERS,))
            session.type("2")
            end_at_clear_prompt(session)
            terminal.assert_kept_private(
                session, (TEST_PHRASE, WORD_NUMBERS, FIRST_SHARE, THIRD_SHARE)
            )
        finally:
            session.close()
    print(
        "SSKR: showing the result again restores its original words "
        "and fingerprints"
    )


def check_recover_date_steps():
    """recover-date with a wallet that matches nothing: Change the dates
    asks for them on a screen of their own; Change the wallet asks for
    the wallet under the result, and the search with it starts a screen
    of its own, whose result is the only one on it.
    """
    session = terminal.Session((
        "recover-date", "--ask-secrets", "--mode", "seedshift",
        "--master-fingerprint", NO_WALLET,
    ))
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + terminal.ENTER)
        session.wait_for(RECOVERY_DATES)
        session.type(FORGOTTEN_DIGIT + terminal.ENTER)
        session.wait_for(WHAT_NOW)
        terminal.assert_private_result_visible(session, (DATE_RESULT,))
        # Change the dates.
        session.type("1")
        session.wait_for(RECOVERY_DATES)
        assert_step_screen(session, "recover-date", (DATE_RESULT,))
        session.type(FORGOTTEN_DIGIT + terminal.ENTER)
        session.wait_for(WHAT_NOW)
        # Change the wallet: asked under the result, by its fingerprint.
        session.type("2")
        session.wait_for("How can MnemoCode recognise the wallet?")
        terminal.assert_private_result_visible(session, (DATE_RESULT,))
        session.type("1")
        session.wait_for("Original fingerprint of the wallet")
        session.type(FINGERPRINT + terminal.ENTER)
        session.wait_for("found 1 match.")
        session.wait_for(CLEAR_PROMPT)
        terminal.assert_private_result_visible(
            session,
            ("Recovery search contains", MASK_DATE),
            absent=("None of the", WHAT_NOW),
            once=(DATE_RESULT,),
        )
        session.type(terminal.ENTER)
        code = session.wait_for_exit()
        assert code == 0, f"recover-date ended with exit code {code}"
        typed = (MASKED_WORD_NUMBERS, FORGOTTEN_DIGIT)
        terminal.assert_kept_private(session, (*typed, TEST_PHRASE))
    finally:
        session.close()
    print(
        "recover-date: the dates typed again and the search with another "
        "wallet on screens of their own"
    )


def check_decode_dates_again():
    """Decode of the Original Seedshift with a wrong date: its phrase
    fails its checksum, and the dates typed again have a screen of their
    own.
    """
    session = terminal.Session(
        ("decode", "--ask-secrets", "--mode", "seedshift-legacy")
    )
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(LEGACY_WORDS + terminal.ENTER)
        session.wait_for(DATES)
        session.type(NEXT_DAY + terminal.ENTER)
        session.wait_for(WHAT_NOW)
        terminal.assert_private_result_visible(session, (DECODE_RESULT,))
        # Type the dates again.
        session.type("1")
        session.wait_for(DATES)
        assert_step_screen(session, "decode", (DECODE_RESULT,))
        session.type(MASK_DATE + terminal.ENTER)
        session.wait_for(DECODE_RESULT)
        end_at_clear_prompt(session)
        typed = (LEGACY_WORDS, NEXT_DAY, MASK_DATE)
        terminal.assert_kept_private(session, (*typed, TEST_PHRASE))
    finally:
        session.close()
    print("decode: the dates typed again on a screen of their own")


def check_re_encode_dates_again():
    """Re-encode of a backup made with a wrong date: the phrase shown is
    not the one, and the dates typed again have a screen of their own,
    without that phrase.
    """
    # The new backup given by its options: Unicode codes without
    # Seedshift.
    session = terminal.Session((
        "re-encode", "--ask-secrets", "--old-mode", "seedshift",
        "--mode", "direct", "--format", "3",
    ))
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + terminal.ENTER)
        session.wait_for(DATES)
        session.type(NEXT_DAY + terminal.ENTER)
        session.wait_for(CONFIRMATION)
        terminal.assert_private_result_visible(session, (DECODE_RESULT,))
        # Type the dates again.
        session.type("3")
        session.wait_for(DATES)
        assert_step_screen(session, "re-encode", (DECODE_RESULT, CONFIRMATION))
        session.type(MASK_DATE + terminal.ENTER)
        session.wait_for(TEST_PHRASE)
        session.wait_for(CONFIRMATION)
        session.type("1")
        session.wait_for(JOINED_UNICODE)
        session.wait_for("Check the backup now?")
        session.type("2")
        end_at_clear_prompt(session)
        typed = (MASKED_WORD_NUMBERS, NEXT_DAY, MASK_DATE)
        terminal.assert_kept_private(
            session, (*typed, TEST_PHRASE, JOINED_UNICODE)
        )
    finally:
        session.close()
    print("re-encode: the dates typed again on a screen of their own")


def check_legacy_replacements_page():
    """recover-word --legacy-valid-last-word shows its replacements on a
    screen of their own, without the phrase typed above them, and asks
    What now? under them.
    """
    session = terminal.Session((
        "recover-word", "--legacy-valid-last-word", "--ask-secrets",
        "--master-fingerprint", NO_WALLET,
    ))
    try:
        session.wait_for("Exact legacy Seedshift phrase")
        session.type(LEGACY_WORDS + terminal.ENTER)
        session.wait_for(WHAT_NOW)
        terminal.assert_private_result_visible(
            session,
            ("MnemoCode · recover-word", WORD_RESULT, WHAT_NOW),
            absent=("Exact legacy Seedshift phrase", LEGACY_WORDS),
        )
        # Done.
        session.type("3")
        end_at_clear_prompt(session)
        terminal.assert_kept_private(session, (LEGACY_WORDS,))
    finally:
        session.close()
    print(
        "recover-word: the legacy replacements on a screen of their own, "
        "without the phrase typed"
    )
