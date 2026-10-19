"""What a step of the private screen shows beside its question, on the real terminal: the encoded
fingerprint before the dates are typed, and why a question is asked (AUD-037-UI001). Each check
reads the current frame, not the history of what was written. Public fixtures only."""
import terminal_session as terminal
from terminal_answers import FIRST_SHARE, MASKED_WORD_NUMBERS, THIRD_SHARE

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
        assert session.wait_for_exit() == 130
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
