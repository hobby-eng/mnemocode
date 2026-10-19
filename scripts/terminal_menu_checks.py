"""The checks of scripts/verify-terminal-input.py for the menu, typed answers and their editing,
the card questions of Encode and Ctrl+C."""

import shlex
import tempfile
from pathlib import Path

from terminal_session import (
    BACKSPACE,
    CTRL_C,
    CTRL_U,
    DELETE,
    END,
    ENTER,
    ENTER_ALTERNATE_SCREEN,
    ESCAPE,
    HOME,
    LEAVE_ALTERNATE_SCREEN,
    Session,
    WINDOWS,
    assert_kept_private,
    line_starting,
    screen_at_exit,
)
from terminal_answers import (
    CANCELLED,
    CARD_NAME,
    CLEAR_PROMPT,
    ENCODE_ENTRY,
    HIDDEN_RECORD,
    LONG_PADDING,
    MARKED_UNICODE,
    MASKED_WORD_NUMBERS,
    MASK_DATE,
    MENU_SHOWN,
    RECOVER_ENTRY,
    RESTORE_ENTRY,
    SEARCH_STOP_LIMIT,
    SEED_PHRASE,
    SHARES,
    SHEET_DETAILS,
    TABLE_ENTRY,
    TEST_PHRASE,
    WORD_NUMBERS,
    WRONG_CARD_NAME,
    WRONG_LAST,
    at_hidden_record_prompt,
)


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
        session.type(TABLE_ENTRY)
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


def check_word_hints():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(TABLE_ENTRY)
        session.wait_for("What do you want to look up?")
        session.type("1")
        session.wait_for("Word: ")
        # Two letters list the words that begin with them, below the line (src/cli/typed-hints.ts).
        session.type("ab")
        session.wait_for("abstract")
        # Tab completes "abou" to the one word left, and Enter looks it up. A Tab that more keys
        # follow at once is part of a paste, where it separates as a space does: Enter waits.
        session.type("ou")
        session.wait_for("ou")
        session.type("\t")
        session.wait_for("t ")
        session.type(ENTER)
        session.wait_for("english:     about")
        session.wait_for("unicode hex: 5728")
        session.wait_for("Press Enter for another lookup")
        session.type(ESCAPE)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after the lookup gave exit code {code}"
        # The pseudo-console redraws the screen itself: its output is not what the tool wrote.
        if not WINDOWS:
            shown = screen_at_exit(session)
            assert not any("absurd" in line for line in shown), f"a hint stayed in {shown!r}"
    finally:
        session.close()
    print("word hints in the menu: words below the line, Tab completes, gone after Enter")


def check_lookup_repeat():
    """Enter repeats the same lookup kind; Escape returns to the menu instead of quitting."""
    for choice, question, first, second, first_word, second_word in (
        ("1", "Word: ", "abandon", "about", "abandon", "about"),
        ("2", "Word number: ", "55", "56", "almost", "alone"),
        ("3", "Unicode code: ", "591A", "7684", "almost", "abandon"),
    ):
        session = Session()
        try:
            session.wait_for(MENU_SHOWN)
            session.type(TABLE_ENTRY)
            session.wait_for("What do you want to look up?")
            session.type(choice)
            session.wait_for(question)
            session.type(first + ENTER)
            session.wait_for(f"english:     {first_word}")
            session.wait_for("Press Enter for another lookup")
            session.type(ENTER)
            session.wait_for(question)
            session.type(second + ENTER)
            session.wait_for(f"english:     {second_word}")
            session.wait_for("Press Enter for another lookup")
            session.type(ESCAPE)
            session.wait_for(MENU_SHOWN)
            session.type(ESCAPE)
            assert session.wait_for_exit() == 0
        finally:
            session.close()
    print("word/number/Unicode lookups repeat at Enter and return to the menu at Escape")


def check_table_exports():
    """The actual menu saves every full dictionary and its bundled standalone recovery guide."""
    with tempfile.TemporaryDirectory(prefix="mnemocode-dictionaries-") as folder:
        for choice, name, header in (
            ("1", "english", "index\tenglish"),
            ("2", "chinese", "index\tchinese"),
            ("3", "unicode", "index\tchinese\tunicode_hex"),
            ("4", "mapping", "index\tenglish\tchinese\tunicode_hex"),
            ("5", "guide", "# MnemoCode: recovery without MnemoCode"),
            ("6", "set", None),
        ):
            path = Path(folder) / f"public {name}.txt"
            session = Session(folder=folder)
            try:
                session.wait_for(MENU_SHOWN)
                session.type(TABLE_ENTRY)
                session.wait_for("What do you want to look up?")
                session.type("5")
                session.wait_for("What should be exported?")
                session.type(choice)
                session.wait_for("Name of the new folder" if name == "set" else "Text file name")
                session.type(str(path) + ENTER)
                session.wait_for("Saved ")
                session.wait_for("Press Enter to return to the menu")
                session.type(ESCAPE)
                assert session.wait_for_exit() == 0
            finally:
                session.close()
            if name == "set":
                assert sorted(child.name for child in path.iterdir()) == [
                    "bip39-chinese.txt", "bip39-english.txt", "bip39-mapping.txt",
                    "bip39-unicode.txt", "manual-recovery.md",
                ]
                mapping = path.joinpath("bip39-mapping.txt").read_text(encoding="utf-8")
                assert mapping.splitlines()[-1].startswith("2048\tzoo\t")
                guide = path.joinpath("manual-recovery.md").read_text(encoding="utf-8")
                assert "t = (u - s_last) mod M" in guide
                continue
            text = path.read_text(encoding="utf-8")
            assert text.splitlines()[0] == header
            if name == "guide":
                assert "t = (u - s_last) mod M" in text
                assert "```python" in text
            else:
                lines = text.splitlines()
                assert len(lines) == 2049
                assert lines[1].startswith("1\t")
                assert lines[-1].startswith("2048\t")
    print("menu export: all four complete numbered dictionaries and standalone guide")


def check_share_word_hints():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(RESTORE_ENTRY)
        session.wait_for("Was Seedshift used before it was split?")
        session.type("1")
        session.wait_for(SHARES)
        # Bytewords are hinted as their reader takes them: apart, or four letters at a time.
        session.type("tu")
        session.wait_for("tuna")
        session.type("na ac")
        session.wait_for("acid")
        session.type("idtunadr")
        session.wait_for("draw")
        # Ctrl+C at a question of an entry goes back to the menu.
        session.type(CTRL_C)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after the shares gave exit code {code}"
    finally:
        session.close()
    print("Bytewords hints in the menu: words below a share, also run together")


def check_marked_codes_entry():
    session = Session()
    try:
        session.wait_for(MENU_SHOWN)
        session.type(RECOVER_ENTRY)
        session.wait_for("What is forgotten?")
        session.type("2")
        session.wait_for("How many words does the seed phrase have?")
        session.type("1")
        session.wait_for("Was Seedshift used when it was encoded?")
        session.type("1")
        session.wait_for(HIDDEN_RECORD)
        session.type(MARKED_UNICODE + ENTER)
        session.wait_for("Code 3 cannot be read")
        session.type(CTRL_C)
        session.wait_for(MENU_SHOWN)
        session.type(ESCAPE)
        code = session.wait_for_exit()
        assert code == 0, f"Escape after the codes gave exit code {code}"
    finally:
        session.close()
    print("recover entry: a code of an encoded seed phrase, typed with ?, is searched by decode")


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
        # Each form is chosen by its place in the list, its --format number: 2 for word numbers.
        session.type("2")
        # Word numbers are always masked: the menu asks only which Seedshift.
        session.wait_for("Which Seedshift?")
        session.type("1")
        session.wait_for("Split it into Shamir shares?")
        session.type("1")
        session.wait_for("Where should the result go?")
        session.type("1")
        session.wait_for("Also show the Seedshift phrase as English words?")
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


def at_card_files(session):
    """Chooses Encode in the menu shown, in colors, neither masked nor split, as printable cards,
    up to the first question of how they are saved: the kind of file, then their layout."""
    session.type(ENCODE_ENTRY)
    session.wait_for("Which form should the seed phrase take?")
    # Each form is chosen by its place in the list, its --format number: 5 for colors.
    session.type("5")
    session.wait_for("Use Seedshift?")
    session.type("2")
    session.wait_for("Split it into Shamir shares?")
    session.type("1")
    session.wait_for("Where should the result go?")
    # Also as printable cards, which only a form in colors offers.
    session.type("4")
    session.wait_for("Which kind of file?")


def first_design(session):
    """Chooses the first card design, asked once the files are named, and returns its name, which
    the list shows after it, on POSIX."""
    session.wait_for("Which card design?")
    design = line_starting(session, "› 1  ").split()[-1]
    session.type("1")
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
            at_card_files(session)
            # One PDF of A6 sheets, under the name offered, then the design.
            session.type("1")
            session.wait_for("How should the cards be laid out?")
            session.type("1")
            # Landscape, the first answer, which names its orientation in the command.
            session.wait_for("How should the sheets be turned?")
            session.type("1")
            session.wait_for("PDF file name (Enter: mnemocode-cards.pdf):")
            session.type(ENTER)
            design = first_design(session)
            session.wait_for("Add a QR code with the codes of the backup, without the extra cards?")
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
            sheets = [*cards, "--pdf", "mnemocode-cards.pdf", "--orientation", "landscape"]
            sheets += ["--card-qr", "--card-name", CARD_NAME]
            if not WINDOWS:
                assert command == sheets, f"the menu ran {command!r}"

            # Separate business cards, PDF files in a new folder: no QR code is asked for.
            at_card_files(session)
            asked = session.seen
            session.type("1")
            session.wait_for("How should the cards be laid out?")
            # A6, A5, A4, then separate business cards.
            session.type("4")
            session.wait_for("Name of the new folder (Enter: mnemocode-cards):")
            session.type(ENTER)
            assert first_design(session) == design or WINDOWS, "another first design"
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
    with tempfile.TemporaryDirectory(prefix="mnemocode-public-date-stop-") as folder:
        words = Path(folder) / "public-record.txt"
        dates = Path(folder) / "public-patterns.txt"
        words.write_text(TEST_PHRASE, encoding="utf-8")
        dates.write_text("01-01-????", encoding="utf-8")
        session = Session((
            "recover-date", "--mode", "seedshift", "--format", "english",
            "--input-file", str(words), "--dates-file", str(dates),
            "--master-fingerprint", "deadbeef",
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
