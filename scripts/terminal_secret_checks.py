"""The checks of scripts/verify-terminal-input.py for Re-encode and for
answers asked again in Decode and Restore.
"""

import tempfile
import subprocess
import time
from pathlib import Path

from terminal_session import (
    COMMAND,
    CTRL_C,
    CTRL_D,
    ENTER,
    ESCAPE,
    EXIT_LIMIT,
    Session,
    WAIT_LIMIT,
    WINDOWS,
    assert_kept_private,
    assert_private_result_visible,
    line_starting,
    terminal_size,
)
from terminal_answers import (
    ASKED_AGAIN,
    CANCELLED,
    CARD_NAME,
    CLEAR_PROMPT,
    DATES_WITH_MARKS,
    DECODE_ENTRY,
    FINGERPRINT_FILTER,
    FINGERPRINT_MATCHED,
    FINGERPRINT,
    FIRST_SHARE,
    FORGOTTEN_DIGIT,
    HIDDEN_RECORD,
    JOINED_UNICODE,
    LAST_WORD,
    LAST_WORD_FORGOTTEN,
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
    WORD_NUMBERS,
    answer_fingerprint,
)

# Rows that hold an encoded result with its shares, headings and
# fingerprints on one screen.
ROWS_FOR_A_SPLIT = 100


def check_candidate_passphrase_roles():
    """Both separate encryption-passphrase screens identify their secret
    and its role.
    """
    expected = (
        "candidate list",
        "encryption passphrase",
        "not the BIP39 passphrase",
    )

    def role_visible(session, since=0):
        if WINDOWS:
            session.read_some()
            text = " ".join(session.output[since:].split())
            return all(marker in text for marker in expected)
        try:
            assert_private_result_visible(session, expected)
        except AssertionError:
            return False
        return True

    prefix = "mnemocode-public-passphrase-role-"
    with tempfile.TemporaryDirectory(prefix=prefix) as folder:
        path = Path(folder) / "candidates.age"
        session = Session(
            ("recover-word", "--ask-secrets", "--candidates-file", str(path))
        )
        try:
            session.wait_for(
                "Seed phrase or text file path, ? for each forgotten word:"
            )
            session.type(LAST_WORD_FORGOTTEN + ENTER)
            session.wait_for("list")
            first = role_visible(session)
            start = len(session.output)
            session.type("public synthetic cipher phrase" + ENTER)
            end = time.monotonic() + WAIT_LIMIT
            while time.monotonic() < end:
                shown = session.output[start:]
                repeat = shown.find("The same passphrase again:")
                if repeat < 0:
                    repeat = shown.find(
                        "Repeat the candidate list encryption passphrase"
                    )
                if repeat >= 0:
                    repeat_start = start + repeat
                    break
                session.read_some()
            else:
                raise AssertionError(
                    "The repeat-passphrase screen did not appear"
                )
            second = role_visible(session, repeat_start)
            assert first and second, (
                "Secret/role identity missing on consecutive screens: "
                f"first={first}, second={second}"
            )
            session.type(CTRL_C)
            assert session.wait_for_exit() == CANCELLED
            assert (
                not path.exists()
            ), "Cancelling the repeat prompt wrote a candidate file"
            assert_kept_private(session, ("public synthetic cipher phrase",))
        finally:
            session.close()
    print(
        "candidate-list passphrase: identity/role on both screens, "
        "private cancellation, no save"
    )


def check_marked_codes_result():
    """Marked codes stay live through the later redisplay of the
    recovered phrase.
    """
    session = Session((
        "decode", "--ask-secrets", "--mode", "direct", "--format", "indexes",
        "--encoded-fingerprint", FINGERPRINT,
    ))
    marked = " ".join(["1"] * 11 + ["?"])
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(marked + ENTER)
        session.wait_for("Code 12 found:")
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        # ConPTY redraws the screen and need not emit each line exactly
        # as the program wrote it.
        if not WINDOWS:
            assert session.output.count("Code 12 found:") == 2, (
                "the correction was not redisplayed")
        session.type(ENTER)
        assert session.wait_for_exit() == 0
        assert_kept_private(session, (marked, TEST_PHRASE))
    finally:
        session.close()
    print(
        "marked codes: correction redisplayed with the phrase before the "
        "owner is disposed"
    )


def check_encode_result_visible():
    """A screen-only backup stays visible while its optional check is
    offered and declined, on a terminal tall enough for the result with
    its headings, which a shorter one shows by pages.
    """
    with terminal_size(ROWS_FOR_A_SPLIT):
        for mode in ("direct", "seedshift"):
            check_encode_result_visible_in(mode)


def check_encode_result_visible_in(mode):
    """check_encode_result_visible for `mode`, without and with shares.
    """
    for shares in (False, True):
        arguments = ["encode", "--ask-secrets", "--mode", mode]
        if shares:
            arguments += ["--sskr", "--threshold", "2", "--shares", "3"]
        if shares and mode == "direct":
            arguments += ["--show-original", "words"]
        else:
            arguments += ["--format", "2"]
        session = Session(arguments=arguments)
        try:
            session.wait_for("Seed phrase (English BIP39 words):")
            session.type(TEST_PHRASE + ENTER)
            if mode == "seedshift":
                session.wait_for("Dates (")
                session.type(MASK_DATE + ENTER)
            session.wait_for("Check the backup now?")
            session.wait_for("Esc skips the check")
            seedshift = mode == "seedshift"
            codes = MASKED_WORD_NUMBERS if seedshift else WORD_NUMBERS
            markers = [TEST_PHRASE if shares and not seedshift else codes]
            if not shares or seedshift:
                markers += ["SAVE THIS BACKUP", "End of backup."]
            if shares:
                markers += ["SAVE THIS SHARE", "End of share."]
                markers += [
                    f"SSKR share {number} of 3" for number in (1, 2, 3)
                ]
            # The result is a step of its own (CORE-39): the secret
            # prompts are cleared away.
            prompts = ["Seed phrase (English BIP39 words):", "Dates ("]
            if shares and not seedshift:
                prompts.append(WORD_NUMBERS)
            assert_private_result_visible(session, markers, absent=prompts)
            session.type("2")
            session.wait_for(CLEAR_PROMPT)
            assert_private_result_visible(session, markers)
            session.type(ENTER)
            assert session.wait_for_exit() == 0
            assert_kept_private(session, (TEST_PHRASE, MASK_DATE, codes))
        finally:
            session.close()
        print(
            f"encode {mode}, shares={shares}: result visible before and "
            "after declining check"
        )


def check_phrase_display_choices():
    """Optional original and masked words remain visible on the private
    result, then disappear, on a terminal tall enough for the result
    with its headings.
    """
    with terminal_size(ROWS_FOR_A_SPLIT):
        check_phrase_display_choices_on_screen()


def check_phrase_display_choices_on_screen():
    """check_phrase_display_choices on the terminal it is run on."""
    masked = (
        "wool abuse actual wool abuse actual wool abuse actual wool abuse "
        "congress"
    )
    original_codes = (
        "#000064 #1EAB91 #3D0964 #5BB491 #7A1264 #98BD91 #B71B64 #D5C694"
    )
    for copy in (None, "words"):
        arguments = [
            "encode", "--ask-secrets", "--mode", "seedshift", "--format", "5",
            "--show-masked-words",
        ]
        if copy is not None:
            arguments += [
                "--sskr", "--threshold", "2", "--shares", "3",
                "--share-format", "colors", "--show-original", copy,
            ]
        session = Session(arguments=arguments)
        try:
            session.wait_for("Seed phrase (English BIP39 words):")
            session.type(TEST_PHRASE + ENTER)
            session.wait_for("Dates (")
            session.type(MASK_DATE + ENTER)
            session.wait_for("Check the backup now?")
            session.wait_for("Esc skips the check")
            markers = [masked]
            if copy == "words":
                markers.append(TEST_PHRASE)
            assert_private_result_visible(session, markers)
            assert original_codes not in session.output
            session.type("2")
            session.wait_for(CLEAR_PROMPT)
            assert_private_result_visible(session, markers)
            session.type(ENTER)
            assert session.wait_for_exit() == 0
            assert_kept_private(session, [TEST_PHRASE, MASK_DATE, *markers])
        finally:
            session.close()
        print(
            f"encode original={copy}: requested original and Seedshift "
            "words stay private"
        )


def at_re_encode_confirmation(session):
    """Chooses Re-encode in the menu shown and types the old backup, as
    Decode asks for it: typed, every code read, MnemoCode Seedshift;
    then its dates, up to the question whether the phrase shown is the
    one to re-encode.
    """
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
    assert_private_result_visible(session, (TEST_PHRASE,))


def check_re_encode_menu():
    """Re-encode in the menu: the old backup and its dates, the phrase
    confirmed by the wallet, then the new backup asked under the lines
    of the confirmation.
    """
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        # The old backup, then the phrase, re-encoded once the wallet
        # confirms it.
        at_re_encode_confirmation(session)
        session.type("2")
        answer_fingerprint(session)
        # A fingerprint is only a filter: its warning comes with the
        # match (AUD-020-SEC001).
        session.wait_for(FINGERPRINT_FILTER)
        session.wait_for(FINGERPRINT_MATCHED)
        # Only then the new backup, with Encode's questions, under the
        # lines of the confirmation: Unicode codes without Seedshift, on
        # the screen.
        session.wait_for("New backup")
        session.wait_for(FINGERPRINT_FILTER)
        session.wait_for(FINGERPRINT_MATCHED)
        session.wait_for("Which form should the seed phrase take?")
        # On the screen itself, not only written before the question
        # cleared it (AUD-037-UI001), and the warning once, not also as
        # a warning retained apart.
        kept = (
            "New backup",
            "The fingerprint matches: the seed phrase is accepted",
        )
        once = (FINGERPRINT_FILTER,)
        assert_private_result_visible(session, kept, once=once)
        # Unicode codes, form 3.
        session.type("3")
        session.wait_for("Use Seedshift?")
        assert_private_result_visible(session, kept, once=once)
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
        output = session.output
        assert "Error" not in output and "mnemocode:" not in output, output
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type("q")
        session.wait_for_exit()
        assert_kept_private(
            session,
            (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS, JOINED_UNICODE),
        )
    finally:
        session.close()
    print(
        "re-encode in the menu: codes, dates, the phrase confirmed, then "
        "the new backup asked"
    )


# A company name that each answer takes (up to 100 characters) and that
# does not fit on share cards of the IT design: the cards are drawn once
# the details are typed, and the details are asked again (AUD-022-UI001,
# CORE-42).
LONG_COMPANY = (
    "Northern Atlantic Consolidated Engineering and Logistics Holdings"
)
CARD_REFUSAL = "Company is too long to fit legibly on the card"


def check_re_encode_answer_refused():
    """Re-encode in the menu: card details that the cards cannot print
    are asked again under the confirmed phrase, every other answer kept.
    """
    # The phrase confirmed by the wallet, whose notice has a warning of
    # its own, and the PDF of the cards in a folder that a cloud service
    # copies.
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / "Dropbox").mkdir()
        session = Session(folder=folder)
        try:
            session.wait_for(MENU_SHOWN)
            at_re_encode_confirmation(session)
            session.type("2")
            answer_fingerprint(session)
            session.wait_for(FINGERPRINT_MATCHED)
            answer_refused_cards(session)
            # The refusal, then the details asked again under the
            # confirmed phrase, every other answer kept. The refusal
            # stays on the screen of the question asked again, the
            # wallet warning once, and the refused answers warn of no
            # cloud folder.
            session.wait_for(CARD_REFUSAL)
            session.wait_for("Type your own details for the cards?")
            kept = dict(
                once=(FINGERPRINT_FILTER,),
                absent=("Dropbox keeps a copy of",),
            )
            assert_private_result_visible(session, (CARD_REFUSAL,), **kept)
            # Ctrl+C cancels the command, and the menu comes back.
            session.type(CTRL_C)
            session.wait_for(MENU_SHOWN)
            assert "mnemocode:" not in session.output, session.output
            session.type("q")
            session.wait_for_exit()
            assert_kept_private(
                session, (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS)
            )
        finally:
            session.close()
    print(
        "re-encode in the menu: details that the cards cannot print are "
        "asked again under the confirmed phrase"
    )


def answer_refused_cards(session):
    """Answers the new backup as shares in colors on A6 sheets of the IT
    design, in Dropbox, with a company name too long for the cards,
    which are drawn once the details are typed.
    """
    for question, key in (
        ("Which form should the seed phrase take?", "5"),
        ("Use Seedshift?", "2"),
        ("Split it into Shamir shares?", "2"),
        ("Where should the shares go?", "3"),
        ("Which kind of file?", "1"),
        ("How should the cards be laid out?", "1"),
        ("How should the sheets be turned?", "1"),
        (
            "PDF file name (Enter: mnemocode-share-cards.pdf):",
            "Dropbox/cards.pdf" + ENTER,
        ),
        ("Which card design?", "2"),
        (
            "Add a QR code with the codes of the backup, without the extra "
            "cards?",
            "2",
        ),
        ("Type your own details for the cards?", "2"),
        ("Name, in Latin letters (Enter: random):", CARD_NAME + ENTER),
    ):
        session.wait_for(question)
        session.type(key)
    for detail in SHEET_DETAILS:
        session.wait_for(f"{detail} (Enter: random):")
        session.type((LONG_COMPANY if detail == "Company" else "") + ENTER)


def check_re_encode_recognised():
    """re-encode --recognised: the phrase is shown, and Enter makes the
    new backup.
    """
    # Typed as a command: --recognised answers the confirmation once the
    # phrase was read.
    session = Session((
        "re-encode", "--ask-secrets", "--recognised", "--mode", "direct",
        "--format", "3",
    ))
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + ENTER)
        # Without a header the codes do not say how they were made:
        # MnemoCode Seedshift.
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
        assert_kept_private(
            session,
            (TEST_PHRASE, MASK_DATE, MASKED_WORD_NUMBERS, JOINED_UNICODE),
        )
    finally:
        session.close()
    print(
        "re-encode --recognised: the phrase shown, Enter makes the new "
        "backup"
    )


def check_re_encode_marked_shares():
    """Repair marked shares, unmask them and confirm the original before
    any new backup; Escape at confirmation writes nothing.
    """
    body = THIRD_SHARE.removeprefix(SHARE_PREFIX)
    # Two unreadable bytes of the public masked-phrase fixture.
    pairs = [body[at:at + 2] for at in range(0, len(body), 2)]
    pairs[10] = pairs[14] = "?"
    marked = SHARE_PREFIX + "".join(pairs)
    for accept in (False, True):
        session = Session((
            "re-encode", "--ask-secrets", "--mode", "direct",
            "--format", "3", "--backup-check", "no",
        ))
        try:
            session.wait_for(HIDDEN_RECORD)
            assert_private_result_visible(session, (
                "Shamir shares are accepted too; separate them with ;.",
                "Use ? for each missing or unreadable share code or digit.",
            ))
            session.type(f"{FIRST_SHARE};{marked}" + ENTER)
            session.wait_for("Was Seedshift used before it was split?")
            session.type("2")
            session.wait_for(DATES_WITH_MARKS)
            session.type(MASK_DATE + ENTER)
            session.wait_for("Is this the seed phrase to re-encode?")
            assert_private_result_visible(session, (TEST_PHRASE,))
            assert JOINED_UNICODE not in session.output
            session.type("1" if accept else ESCAPE)
            if accept:
                session.wait_for(JOINED_UNICODE)
                session.wait_for(CLEAR_PROMPT)
                session.type(ENTER)
            code = session.wait_for_exit()
            assert code == (0 if accept else CANCELLED)
            if not accept:
                assert JOINED_UNICODE not in session.output
            assert_kept_private(session, (
                TEST_PHRASE, MASK_DATE, JOINED_UNICODE,
                FIRST_SHARE.removeprefix(SHARE_PREFIX),
                marked.removeprefix(SHARE_PREFIX),
            ))
        finally:
            session.close()
    print("re-encode: share repair, unmasking, original confirmation and cancel")


def check_re_encode_last_word_after_wrong_date():
    """Re-encode of a backup with a valid last word: after a wrong date
    the dates are typed again, and the codes are kept.
    """
    # Typed as a command, the new backup given by its options: Unicode
    # codes without Seedshift.
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
        # The wrong date gave other phrases: the dates are typed again,
        # the codes kept.
        session.wait_for("No seed phrase of this backup ends with that word")
        asked = session.wait_for("What now?")
        session.type("2")
        session.wait_for("Dates (")
        retyped = session.output[asked : session.seen]
        assert HIDDEN_RECORD not in retyped, "codes asked again"
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
        assert (
            code == 0
        ), f"re-encode after the dates typed again gave exit code {code}"
        assert_kept_private(
            session,
            (
                TEST_PHRASE, MASK_DATE, NEXT_DAY, LEGACY_VALID_WORD_NUMBERS,
                JOINED_UNICODE,
            ),
        )
    finally:
        session.close()
    print(
        "re-encode with the last word: after a wrong date the dates are "
        "typed again, codes kept"
    )


def check_decode_dates_asked_again():
    """Decode in the menu: an empty answer and a mistyped date are asked
    again, the codes kept, and a date with ? is found.
    """
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
        # One line names the date by its place, without repeating it;
        # then only the dates are asked again, and the codes are kept.
        warning = line_starting(session, "Date 1: ")
        assert (
            MISTYPED_DATE not in warning
        ), f"the warning {warning!r} repeats the date"
        warned = session.seen
        session.wait_for(DATES_WITH_MARKS)
        retyped = session.output[warned : session.seen]
        assert HIDDEN_RECORD not in retyped, "codes asked again"
        session.type(FORGOTTEN_DIGIT + ENTER)
        answer_fingerprint(session)
        session.wait_for("found 1 match.")
        session.wait_for(MASK_DATE)
        session.wait_for(CLEAR_PROMPT)
        # The match's phrase is wrapped at its spaces (CORE-36): it is
        # read whole on the screen.
        assert_private_result_visible(session, (TEST_PHRASE,))
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after decoding gave exit code {code}"
        typed = (MASKED_WORD_NUMBERS, MISTYPED_DATE, FORGOTTEN_DIGIT)
        assert_kept_private(session, (*typed, MASK_DATE, TEST_PHRASE))
    finally:
        session.close()
    print(
        "decode in the menu: an empty answer and a mistyped date asked "
        "again, a ? date found"
    )


def holds_piece_of_share(text, share):
    """Whether `text` holds SHARE_PIECE letters in a row of the
    bytewords of `share`.
    """
    bytewords = share.removeprefix(SHARE_PREFIX)
    starts = range(len(bytewords) - SHARE_PIECE + 1)
    pieces = (bytewords[at : at + SHARE_PIECE] for at in starts)
    return any(piece in text for piece in pieces)


def check_restore_share_asked_again():
    """Restore in the menu: Ctrl+D and a share that cannot be read are
    asked again, only that share typed again, and a date with ? found.
    """
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(RESTORE_ENTRY)
        session.wait_for("Was Seedshift used before it was split?")
        session.type("2")
        session.wait_for(SHARES)
        # Ctrl+D on an empty line, which ends the input of a shell,
        # answers nothing here.
        session.type(CTRL_D)
        session.wait_for(ASKED_AGAIN)
        session.wait_for(SHARES)
        # Two shares pasted as two lines are one answer; the second one
        # cannot be read.
        session.type(FIRST_SHARE + ENTER + MISTYPED_SHARE + ENTER)
        warning = line_starting(session, "Share 2 cannot be read")
        assert not holds_piece_of_share(
            warning, MISTYPED_SHARE
        ), f"{warning!r} repeats the share"
        # Only that share is typed again: the first one is kept.
        session.wait_for("Type share 2 again")
        session.type("2")
        retyped = session.wait_for("Share 2 again, or its text file path:")
        session.type(THIRD_SHARE + ENTER)
        session.wait_for(DATES_WITH_MARKS)
        again = session.output[retyped : session.seen]
        assert SHARES not in again, "all shares asked again"
        session.type(FORGOTTEN_DIGIT + ENTER)
        answer_fingerprint(session)
        session.wait_for("found 1 match.")
        # Among the facts of the restored phrase, as a terminal shows
        # them (AUD-037-UI006).
        session.wait_for(f"Dates      {MASK_DATE}")
        session.wait_for(TEST_PHRASE)
        session.wait_for(CLEAR_PROMPT)
        session.type(ENTER)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after restoring gave exit code {code}"
        shares = (FIRST_SHARE, MISTYPED_SHARE, THIRD_SHARE)
        bytewords = (share.removeprefix(SHARE_PREFIX) for share in shares)
        assert_kept_private(
            session, (*bytewords, FORGOTTEN_DIGIT, MASK_DATE, TEST_PHRASE)
        )
    finally:
        session.close()
    print(
        "restore in the menu: Ctrl+D and an unreadable share asked again, "
        "a ? date found"
    )


def check_decode_share_lines():
    """Decode and Re-encode keep every pasted or filed share, ask its
    dates and use the original phrase; only Re-encode confirms it.
    """
    text = f"{FIRST_SHARE}\n{THIRD_SHARE}\n"
    prefix = "mnemocode-share-lines-"
    with tempfile.TemporaryDirectory(prefix=prefix) as folder:
        path = Path(folder) / "shares.txt"
        path.write_text(text, encoding="utf-8")
        for command, source in (
            (command, source)
            for command in ("decode", "re-encode")
            for source in ("file", "paste")
        ):
            arguments = [command, "--ask-secrets"]
            if command == "decode":
                arguments += ["--mode", "seedshift"]
            else:
                arguments += [
                    "--mode", "direct", "--format", "3",
                    "--backup-check", "no",
                ]
            if source == "file":
                arguments += ["--input-file", str(path)]
            session = Session(arguments=arguments)
            try:
                if source == "paste":
                    session.wait_for(HIDDEN_RECORD)
                    session.type(text.rstrip("\n").replace("\n", ";\n") + ENTER)
                if command == "re-encode":
                    session.wait_for(
                        "Was Seedshift used before it was split?"
                    )
                    session.type("2")
                session.wait_for(DATES_WITH_MARKS)
                more = "More shares or text file path ("
                assert more not in session.output, "A share line was lost"
                session.type(MASK_DATE + ENTER)
                session.wait_for(TEST_PHRASE)
                if command == "re-encode":
                    session.wait_for("Is this the seed phrase to re-encode?")
                    assert_private_result_visible(session, (TEST_PHRASE,))
                    session.type("1")
                    session.wait_for(JOINED_UNICODE)
                session.wait_for(CLEAR_PROMPT)
                session.type(ENTER)
                assert session.wait_for_exit() == 0
                assert_kept_private(
                    session, (FIRST_SHARE, THIRD_SHARE, MASK_DATE, TEST_PHRASE)
                )
            finally:
                session.close()
            print(
                f"{command} {source}: every share kept, dates restore the "
                "original phrase before confirmation or output"
            )


def check_file_or_text_input():
    """Private prompts read MnemoCode share exports and MNC1 records, or
    raw recovery words.
    """
    cases = (
        (
            "shares",
            ["sskr-combine", "--ask-secrets", "--mode", "seedshift"],
            SHARES,
            None,
        ),
        ("record", ["decode", "--ask-secrets"], HIDDEN_RECORD, None),
        (
            "words",
            ["recover-word", "--ask-secrets"],
            "Seed phrase or text file path, ? for each forgotten word:",
            TEST_PHRASE.removesuffix("about") + "abo*\n",
        ),
    )
    with tempfile.TemporaryDirectory(prefix="mnemocode-file-input-") as folder:
        words = Path(folder) / "public-mnemonic.txt"
        dates = Path(folder) / "public-dates.txt"
        words.write_text(TEST_PHRASE, encoding="utf-8")
        dates.write_text(MASK_DATE, encoding="utf-8")
        for kind, arguments, prompt, text in cases:
            path = Path(folder) / f"public {kind}.txt"
            if text is None:
                options = [
                    "encode", "--mnemonic-file", str(words),
                    "--mode", "seedshift", "--dates-file", str(dates),
                    "--format", "indexes", "--output", str(path),
                ]
                if kind == "shares":
                    options += [
                        "--sskr", "--threshold", "2", "--shares", "3",
                        "--share-format", "colors-unicode",
                    ]
                subprocess.run(
                    [*COMMAND, *options],
                    check=True,
                    capture_output=True,
                    timeout=EXIT_LIMIT,
                )
                if kind == "shares":
                    lines = path.read_text(encoding="utf-8").splitlines()
                    assert (
                        len(lines) == 3
                    ), "the share export must hold three lines"
                    # As when the owner keeps member 1 and member 3 and
                    # removes the middle line.
                    kept = f"{lines[0]}\n{lines[2]}\n"
                    path.write_text(kept, encoding="utf-8")
            else:
                path.write_text(text, encoding="utf-8")
            session = Session(arguments=arguments)
            try:
                session.wait_for(prompt)
                session.type(f'"{path}"' + ENTER)
                if kind != "words":
                    session.wait_for(DATES_WITH_MARKS)
                    session.type(MASK_DATE + ENTER)
                    session.wait_for(TEST_PHRASE)
                session.wait_for(CLEAR_PROMPT)
                if kind == "words":
                    # A candidate's phrase is wrapped at its spaces
                    # (CORE-36): it is read whole on the screen.
                    assert_private_result_visible(session, (TEST_PHRASE,))
                session.type(ENTER)
                assert session.wait_for_exit() == 0
                assert_kept_private(
                    session, (TEST_PHRASE, FIRST_SHARE, THIRD_SHARE, MASK_DATE)
                )
            finally:
                session.close()
            print(
                f"private {kind} prompt: exported text file accepted without "
                "a source menu"
            )
