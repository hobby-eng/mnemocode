"""The public test data that scripts/verify-terminal-input.py types, the
prompts it waits for, and the steps that several of its checks share.
Only the BIP39 test phrase "abandon ... about", its forms, its
fingerprint and its masked forms and shares appear here.
"""

from terminal_session import CTRL_UP, DOWN, ENTER, UP

TEST_PHRASE = " ".join(["abandon"] * 11 + ["about"])
# Its words, which the marked forms of the checks change.
TEST_WORDS = TEST_PHRASE.split(" ")
# The test phrase with its last word forgotten, marked ?, and with only
# its first letter known, marked a*: eight words of the list keep the
# checksum.
LAST_WORD_FORGOTTEN = " ".join([*TEST_WORDS[:-1], "?"])
LAST_WORD_STARTS_WITH_A = " ".join([*TEST_WORDS[:-1], "a*"])
# The test phrase as word numbers (format 2), and the same with a wrong
# last number.
WORD_NUMBERS = " ".join(["1"] * 11 + ["4"])
WRONG_LAST = " ".join(["1"] * 11 + ["5"])
# The public date of the README examples, and the test phrase masked
# with it as word numbers.
MASK_DATE = "23-09-2026"
MASKED_WORD_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377"
# The test phrase masked with the same date by the Original Seedshift
# with a valid last word, which keeps nothing of its last word, made
# with
#   mnemocode encode --mode seedshift-legacy \
#     --legacy-valid-last-word --mnemonic-file public-mnemonic.txt \
#     --dates-file public-dates.txt --format 2
# With the date one day later, no phrase that it gives ends with that
# last word.
LEGACY_VALID_WORD_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 23"
LAST_WORD = "about"
NEXT_DAY = "24-09-2026"
# The same date with a forgotten last digit of the year, and with a
# two-digit year.
FORGOTTEN_DIGIT = "23-09-202?"
MISTYPED_DATE = "23-09-26"
# The BIP32 master fingerprint of the test phrase without a BIP39
# passphrase.
FINGERPRINT = "73c5da0a"
# Shares 1 and 3 of a 2-of-3 split of the masked test phrase, made with
#   mnemocode encode --sskr --mode seedshift \
#     --mnemonic-file public-mnemonic.txt \
#     --dates-file public-dates.txt --threshold 2 --shares 3
# and share 3 with one byteword changed (pa to ae), so that its checksum
# fails.
FIRST_SHARE = "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh"
THIRD_SHARE = "ur:sskr/gomuttaeadaojytnhyvtpaqdmobwreoyykutjtkofedicanladwm"
MISTYPED_SHARE = "ur:sskr/gomuttaeadaojytnhyvtaeqdmobwreoyykutjtkofedicanladwm"
# The test phrase in Unicode codes without Seedshift (7684 is abandon,
# 5728 about), the third code unread.
MARKED_UNICODE = " ".join(["7684"] * 2 + ["?"] + ["7684"] * 8 + ["5728"])
# The start of every share as text, a Uniform Resource of type sskr,
# before its bytewords.
SHARE_PREFIX = "ur:sskr/"
# Four bytewords in a row: the minimal bytewords of a share spell each
# byte with two letters. A warning that holds this much of a share
# repeats part of it.
SHARE_PIECE = 8
# Longer than the 4095 bytes after which the line mode of a Linux
# terminal cuts a line.
LONG_PADDING = " " * 5000
# Exit code when the person cancels with Ctrl+C
# (src/cli/private-screen.ts).
CANCELLED = 130

# Seconds from Ctrl+C during a date search to the end of the tool: the
# search stops at its next turn, 50 ms later
# (src/cli/recover-date-command.ts); the rest is room for a slow hosted
# runner.
SEARCH_STOP_LIMIT = 10

MENU_SHOWN = "Esc quits"
# The entries of the menu, by the digits that choose them
# (src/cli/menu-entries.ts).
ENCODE_ENTRY, RE_ENCODE_ENTRY, DECODE_ENTRY, RESTORE_ENTRY = "1", "2", "3", "5"
RECOVER_ENTRY, TABLE_ENTRY = "6", "8"
# The test phrase without Seedshift as Unicode codes, written joined.
JOINED_UNICODE = "7684" * 11 + "5728"
HIDDEN_RECORD = "Encoded seed phrase, record or text file path: "
# The warning that comes with a fingerprint's match
# (FINGERPRINT_WARNING, src/core/wallet-check.ts).
FINGERPRINT_FILTER = (
    "A master fingerprint is only 32 bits and is a filter, not proof of "
    "recovery."
)
# Re-encode's line once a fingerprint matched
# (ReEncoding.confirmationLine, src/core/re-encoding.ts).
FINGERPRINT_MATCHED = (
    "The fingerprint matches: the seed phrase is accepted, not proven."
)
# The questions below are looked for without the space after them: the
# pseudo-console of Windows need not draw a space at the end of a line
# before something follows it.
SEED_PHRASE = "Seed phrase (English BIP39 words):"
SHARES = (
    "Shamir shares or text file path"
    " (separate shares with ;, ? for each unreadable code or digit):"
)
# The end of the question for dates that may hold ?
# (src/cli/date-search.ts, datesQuestion).
DATES_WITH_MARKS = "? for what is forgotten, separated by spaces):"
CLEAR_PROMPT = "Press Enter to clear this screen."
# The line after an empty answer to a question for a secret
# (src/cli/ask.ts, askSecretUntil).
ASKED_AGAIN = ", or press Ctrl+C to stop."
# A name for the cards with a digit, which the menu refuses (Latin
# letters only), and one that it takes.
WRONG_CARD_NAME, CARD_NAME = "Jane 2", "Jane Example"
# The details that the cards of a sheet may show after the name, each
# kept random with Enter.
SHEET_DETAILS = (
    "Role",
    "Company",
    "Email",
    "Phone",
    "Website",
    "Location",
    "Studio name",
    "Slogan",
    "Subtitle",
    "Footer",
)


def at_hidden_record_prompt(session):
    """Chooses Decode with the arrow keys, typed input and no dates, up
    to the hidden prompt.
    """
    session.wait_for(MENU_SHOWN)
    # Ctrl+Up must not count as the digit 5; Down, Up, Down, Down, Enter
    # end on entry 3, Decode.
    session.type(CTRL_UP + DOWN + UP + DOWN + DOWN + ENTER)
    session.wait_for("Where is the encoded seed phrase?")
    session.type("1")
    # All the codes typed: no decoys to leave out.
    session.wait_for("How many words does the seed phrase have?")
    session.type("1")
    session.wait_for("Was Seedshift used when it was encoded?")
    session.type("1")
    return session.wait_for(HIDDEN_RECORD)


def answer_fingerprint(session):
    """Tells the wallet by the fingerprint of the test phrase, as the
    date search asks for it.
    """
    session.wait_for("How can MnemoCode recognise the wallet?")
    session.type("1")
    session.wait_for(
        "Original fingerprint of the wallet, such as 73c5da0a "
        "(not the encoded one; They do not reveal the phrase.):"
    )
    session.type(FINGERPRINT + ENTER)
