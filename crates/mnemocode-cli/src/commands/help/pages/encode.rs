//! The help of `mnemocode encode`.

use super::super::{CommandHelp, HelpGroup};
use super::options::{
    ASK_SECRETS, CARDS_GROUP, DETAILS_GROUP, MNEMONIC, MNEMONIC_FILE, RESULT_GROUP, RUN_6,
    SHARES_GROUP,
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Write a phrase in another form, masked with dates if given",
    about: &[
        "Writes an English BIP39 phrase as words, numbers, Unicode codes or colors, after masking it with dates in seedshift mode. It can show the result in the terminal, save it as a record file or a QR code, print it as cards, or split it into Shamir shares. After encoding it prints the fingerprint of the original phrase and of the masked phrase.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH>)",
    groups: &[
        HelpGroup {
            heading: "The phrase and the transformation:",
            options: &[&[&ASK_SECRETS, &MNEMONIC_FILE, &MNEMONIC], RUN_6],
        },
        RESULT_GROUP,
        CARDS_GROUP,
        DETAILS_GROUP,
        SHARES_GROUP,
    ],
    asks: Some(&[
        ("Phrase", "English BIP39 words"),
        (
            "Dates",
            "one line, such as 23-09-2026 08-08-1988; none in direct mode",
        ),
        (
            "Backup check",
            "whether to type the backup again from paper, unless --backup-check",
        ),
    ]),
    examples: &[
        (
            "mnemocode encode --mode seedshift --ask-secrets --format 3",
            "A real phrase, dates asked for, as Unicode",
        ),
        (
            "printf '%s\\n' \"$TEST_PHRASE\" | mnemocode encode --mode direct --mnemonic-file - --format 5 --cards",
            "The test phrase as colors, shown as cards in the terminal",
        ),
        (
            "mnemocode encode --mode seedshift --ask-secrets --format 1",
            "Mask the phrase with dates, both typed on the private screen",
        ),
        (
            "mnemocode encode --mnemonic-file phrase.txt --dates-file dates.txt --format 5 --output shifted.txt",
            "Use protected local files and save the record; Decode also needs the dates",
        ),
        (
            "mnemocode encode --mode seedshift-legacy --ask-secrets --format 1",
            "Use the original Seedshift mode with private inputs",
        ),
        (
            "mnemocode encode --mode seedshift --ask-secrets --format 5 --template business-it --page-size a4 --pdf cards.pdf",
            "Print the masked phrase as business-card samples on an A4 sheet",
        ),
        (
            "mnemocode encode --ask-secrets --format 5 --template business-it --cards-dir ./my-cards --image-format png",
            "One PNG image per card, in a new folder",
        ),
        (
            "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --output ./shares.txt",
            "Split the phrase into 3 shares, any 2 of which restore it",
        ),
        (
            "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --share-format colors --cards-dir ./share-cards --card-layout qr",
            "Each share as its own QR document",
        ),
        (
            "mnemocode encode --sskr --ask-secrets --threshold 3 --shares 5 --share-format words --heir-sheet heirs.pdf --heir-sheet-size a6",
            "5 shares in words, any 3 restore it, and an A6 sheet for heirs",
        ),
    ],
    notes: Some(&[
        "Fingerprints are calculated for an empty BIP39 passphrase. A legacy result is a valid phrase only by chance; when it is not, only the original fingerprint is shown.",
        "Note the encoded fingerprint too: decode, recover-date and sskr-combine show it again on the private screen once the codes or shares are read, before the dates, so that a code written or typed wrongly shows before the dates are typed.",
        "Individual cards are not Shamir sharing: every real card is needed, and each reveals a part of the encoded phrase; the decoy cards after them, one on separate cards, are not needed.",
    ]),
};
