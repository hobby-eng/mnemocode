"""What a command that ran on the private screen leaves on the main
screen, which stays in the scrollback, once that screen is left
(CORE-39): its heading, what was saved and where, and the warnings that
still hold, in the order they were shown, then "Cancelled." when it was
cancelled; never the phrase, its codes, its dates or a fingerprint.
Public test phrase only. Not on Windows, whose pseudo-console redraws
the screen itself and need not pass on the switch to the private screen.
"""
import tempfile
from pathlib import Path

import terminal_session as terminal
from terminal_answers import (
    CANCELLED,
    CLEAR_PROMPT,
    DATES_WITH_MARKS,
    FINGERPRINT,
    FINGERPRINT_FILTER,
    FORGOTTEN_DIGIT,
    HIDDEN_RECORD,
    MASK_DATE,
    MASKED_WORD_NUMBERS,
    SEED_PHRASE,
    TEST_PHRASE,
    WORD_NUMBERS,
    answer_fingerprint,
)

# The lines of the summary, as src/cli/private-screen.ts and the notices
# it keeps write them.
CLOUD = "Dropbox keeps a copy of"
CLOUD_MORE = "More: https://github.com/hobby-eng/mnemocode#cloud-folders"
SAVED = "Saved MnemoCode record:"
CLEARED = "The screen with the result was cleared."
CANCELLED_LINE = "Cancelled."
# Encode without Seedshift into a folder that a cloud service copies,
# which it warns of before the first question; the backup is not
# checked.
ENCODE_TO_CLOUD = (
    *("encode", "--ask-secrets", "--mode", "direct", "--format", "2"),
    *("--output", "Dropbox/record.txt", "--backup-check", "no"),
)


def summary_text(session):
    """What the tool, which has ended, wrote on the main screen after it
    last left the private screen, without control sequences and with
    each run of spaces and line breaks as one space.
    """
    output = terminal.read_to_end(session)
    left = output.rfind(terminal.LEAVE_ALTERNATE_SCREEN)
    assert left >= 0, "the private screen was not left"
    after = output[left + len(terminal.LEAVE_ALTERNATE_SCREEN) :]
    return " ".join(terminal.CONTROL_SEQUENCE.sub("", after).split())


def assert_in_order(text, parts, once):
    """Each of `parts` is in `text` after the one before it, and each of
    `once` only once.
    """
    at = 0
    for part in parts:
        found = text.find(part, at)
        assert (
            found >= 0
        ), f"{part!r} is missing or out of order in the summary: {text!r}"
        at = found + len(part)
    for part in once:
        count = text.count(part)
        assert (
            count == 1
        ), f"the summary holds {part!r} {count} times: {text!r}"


def assert_no_secret(text, secrets):
    """None of `secrets` is in `text`."""
    for secret in secrets:
        assert secret not in text, f"{secret!r} reached the summary: {text!r}"


def check_summary_after_save():
    """Encode saved into a cloud folder: the summary names the command,
    the cloud warning with its link and the saved record, then that the
    result was cleared.
    """
    if terminal.WINDOWS:
        return
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / "Dropbox").mkdir()
        session = terminal.Session(ENCODE_TO_CLOUD, folder=folder)
        try:
            session.wait_for(SEED_PHRASE)
            session.type(TEST_PHRASE + terminal.ENTER)
            session.wait_for(CLEAR_PROMPT)
            session.type(terminal.ENTER)
            assert session.wait_for_exit() == 0
            summary = summary_text(session)
        finally:
            session.close()
    parts = ("MnemoCode · encode", CLOUD, CLOUD_MORE, SAVED, "record.txt")
    assert_in_order(summary, parts, once=(*parts[:-1], CLEARED))
    assert (
        summary.endswith(CLEARED)
    ), f"the summary does not end as cleared: {summary!r}"
    assert CANCELLED_LINE not in summary, summary
    assert_no_secret(summary, (TEST_PHRASE, WORD_NUMBERS, FINGERPRINT))
    print(
        "encode: the summary on the main screen names the saved record and "
        "the cloud warning"
    )


def check_summary_after_cancel():
    """Encode cancelled with Ctrl+C at its first question: the summary
    keeps the cloud warning, and "Cancelled." follows it once, with exit
    code 130; nothing was saved or cleared.
    """
    if terminal.WINDOWS:
        return
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / "Dropbox").mkdir()
        session = terminal.Session(ENCODE_TO_CLOUD, folder=folder)
        try:
            session.wait_for(SEED_PHRASE)
            session.type(terminal.CTRL_C)
            assert session.wait_for_exit() == CANCELLED
            summary = summary_text(session)
        finally:
            session.close()
        assert (
            not (Path(folder) / "Dropbox" / "record.txt").exists()
        ), "a record was saved"
    parts = ("MnemoCode · encode", CLOUD, CLOUD_MORE, CANCELLED_LINE)
    assert_in_order(summary, parts, once=parts)
    assert (
        summary.endswith(CANCELLED_LINE)
    ), f"Cancelled. is not the last line: {summary!r}"
    for absent in (SAVED, CLEARED):
        assert (
            absent not in summary
        ), f"{absent!r} after a cancelled command: {summary!r}"
    print(
        "encode cancelled: the summary keeps the cloud warning, then "
        "Cancelled. once"
    )


def check_summary_of_date_search():
    """Decode finds a forgotten digit of the date by the wallet's
    fingerprint: the summary keeps the warning that a fingerprint is
    only a filter, and none of the codes, the dates, the phrase or the
    fingerprint typed.
    """
    if terminal.WINDOWS:
        return
    session = terminal.Session(
        ("decode", "--ask-secrets", "--mode", "seedshift")
    )
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(MASKED_WORD_NUMBERS + terminal.ENTER)
        session.wait_for(DATES_WITH_MARKS)
        session.type(FORGOTTEN_DIGIT + terminal.ENTER)
        answer_fingerprint(session)
        session.wait_for("found 1 match.")
        session.wait_for(CLEAR_PROMPT)
        session.type(terminal.ENTER)
        assert session.wait_for_exit() == 0
        summary = summary_text(session)
    finally:
        session.close()
    parts = ("MnemoCode · decode", FINGERPRINT_FILTER, CLEARED)
    assert_in_order(summary, parts, once=parts)
    assert (
        summary.endswith(CLEARED)
    ), f"the summary does not end as cleared: {summary!r}"
    secrets = (
        MASKED_WORD_NUMBERS,
        FORGOTTEN_DIGIT,
        MASK_DATE,
        TEST_PHRASE,
        FINGERPRINT,
    )
    assert_no_secret(summary, secrets)
    print(
        "decode by a fingerprint: the summary keeps the filter warning, not "
        "the match"
    )
