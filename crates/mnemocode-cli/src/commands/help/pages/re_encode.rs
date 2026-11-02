//! The help of `mnemocode re-encode`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{
    ASK_SECRETS, CARDS_GROUP, DETAILS_GROUP, INPUT, INPUT_FILE, RESULT_GROUP, RUN_1, RUN_6,
    SHARES_GROUP, WORDS,
};

const OWN_0_2: HelpOption = HelpOption {
    flag: "--qr-file",
    value: Some("PNG"),
    summary: "Read the encoded record from a QR code in a PNG image",
    details: &[
        "The image is read on this computer. It may be up to 16 MiB, 4096 pixels on a side and 8 megapixels, with up to 8 bits per sample. A QR code holds no header, so give --old-mode for a masked record; without it, --ask-secrets asks how it was masked.",
    ],
};
const OWN_0_4: HelpOption = HelpOption {
    flag: "--old-dates",
    value: Some("DATE ..."),
    summary: "Refused material argument; use --old-dates-file or --ask-secrets",
    details: &[],
};
const OWN_0_5: HelpOption = HelpOption {
    flag: "--old-dates-file",
    value: Some("PATH"),
    summary: "Read the old backup's dates from a file or -",
    details: &[
        "The file may be up to 128 bytes.",
        "Dates are separated by whitespace. recover-date also accepts date patterns in this file. Do not combine it with --ask-secrets, which asks for the dates itself.",
        "YYYY-MM-DD is also accepted. The order does not matter: the dates are sorted, oldest first. A year always has four digits, 0001 to 9999, so the year 26 is written 0026.",
        "DD-MM-YYYY, up to one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words. Dates are not written into the encoded record; protect and keep the date file yourself.",
        "Only one material file option may read standard input in one command; use local files for the other sources.",
    ],
};
const OWN_0_6: HelpOption = HelpOption {
    flag: "--old-mode",
    value: Some("MODE"),
    summary: "The mode of the old backup: direct, seedshift, seedshift-legacy or seedshift-legacy-valid",
    details: &[
        "Needed for typed text and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A record file names its own mode.",
    ],
};
const OWN_0_7: HelpOption = HelpOption {
    flag: "--old-format",
    value: Some("FORMAT"),
    summary: "The format of the old backup, 1 to 5 or its name; usually found automatically",
    details: &[
        "MnemoCode picks the format itself when exactly one fits the whole record. Otherwise it asks in the terminal, and a script must pass --old-format. See mnemocode help formats.",
    ],
};
const OWN_0_9: HelpOption = HelpOption {
    flag: "--last-word",
    value: Some("WORD"),
    summary: "Refused material argument; use --last-word-file or --ask-secrets",
    details: &[],
};
const OWN_0_10: HelpOption = HelpOption {
    flag: "--last-word-file",
    value: Some("PATH"),
    summary: "Read the original final word for seedshift-legacy-valid from a file or -",
    details: &[
        "The file may be up to 256 bytes.",
        "The backup gives a phrase for each possible last word; the original one picks it. Not with --ask-secrets, which asks for that word privately.",
    ],
};
const OWN_6_0: HelpOption = HelpOption {
    flag: "--recognised",
    value: None,
    summary: "Answer that you recognise the seed phrase shown, instead of a wallet check",
    details: &[
        "With --ask-secrets the phrase is still shown, and MnemoCode waits for Enter before the new backup. Without --ask-secrets, give it or a wallet option below: a valid checksum confirms nothing.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Make an encoded backup again, with other dates or in another form",
    about: &[
        "Reads a backup that MnemoCode encoded, from text, a file or a QR code, and decodes it as decode does; then encodes its seed phrase again as encode does: with other dates, another mode or in another form, as cards or as Shamir shares. The seed phrase is never typed.",
        "Its BIP39 checksum is no confirmation: with MnemoCode Seedshift every date gives a valid phrase. So the phrase is shown, and re-encoded only once you recognise it or your wallet matches it. With --ask-secrets you either recognise it or its fingerprint, or MnemoCode compares it with an address of your wallet, of Bitcoin or another coin, which confirms it, or with its fingerprint, which only accepts it: a fingerprint is a filter, not proof. On the command line give a wallet option or --recognised.",
        "With --ask-secrets the new backup is asked first, with the questions of Encode in the menu, unless options give it; then the codes, then at once their dates, then the phrase is shown to confirm. A backup of the original Seedshift with a valid last word keeps nothing of the original last word: give it, as you remember it.",
        "With --ask-secrets the old input may also be Shamir shares, in any share form, separated by semicolons or lines, or read from a text file. Restore's questions ask whether Seedshift was used and take its dates before the original seed phrase is shown for confirmation. Too few shares ask for more; the masked phrase is never the phrase to confirm.",
        "For an encoded phrase every code and date is needed: decode and recover-date find what is forgotten. Shamir input uses Restore's repair and date questions. Afterwards the old backup still restores the same wallet.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG>)",
    groups: &[
        HelpGroup {
            heading: "The old backup:",
            options: &[&[
                &ASK_SECRETS,
                &INPUT_FILE,
                &OWN_0_2,
                &INPUT,
                &OWN_0_4,
                &OWN_0_5,
                &OWN_0_6,
                &OWN_0_7,
                &WORDS,
                &OWN_0_9,
                &OWN_0_10,
            ]],
        },
        HelpGroup {
            heading: "The new backup (else --ask-secrets asks for it first):",
            options: &[RUN_6],
        },
        RESULT_GROUP,
        CARDS_GROUP,
        DETAILS_GROUP,
        SHARES_GROUP,
        HelpGroup {
            heading: "Confirmation of the seed phrase of the old backup:",
            options: &[&[&OWN_6_0]],
        },
        HelpGroup {
            heading: "Wallet check that the seed phrase of the old backup must match:",
            options: &[RUN_1],
        },
    ],
    asks: Some(&[
        ("Old backup", "unless --input-file or --qr-file gives it"),
        (
            "Format",
            "when the codes fit several forms, unless --old-format",
        ),
        (
            "Seedshift",
            "whether and which, for codes without a header, unless --old-mode",
        ),
        (
            "Old dates",
            "one line, right after the codes; none in direct mode",
        ),
        (
            "Last word",
            "of the original seed phrase, for seedshift-legacy-valid",
        ),
        (
            "Confirmation",
            "whether you recognise the seed phrase, or the wallet to compare it with, unless --recognised or a wallet option answers it",
        ),
        (
            "New backup",
            "form, Seedshift, shares, where it goes, cards and heirs, unless options of the new backup give it",
        ),
        (
            "New dates",
            "one line, such as 23-09-2026 08-08-1988; none in direct mode",
        ),
        (
            "Backup check",
            "whether to type the new backup again from paper, unless --backup-check",
        ),
    ]),
    examples: &[
        (
            "mnemocode re-encode --ask-secrets --qr-file my-qr.png --old-mode seedshift",
            "Dates, the phrase and the new backup asked on the private screen",
        ),
        (
            "mnemocode re-encode --ask-secrets --input-file shifted.txt --mode seedshift --format 5",
            "A record file masked again with new dates, as colors",
        ),
        (
            "mnemocode re-encode --input-file shifted.txt --old-mode seedshift --old-dates-file old-dates.txt --mode direct --format 3 --master-fingerprint 73c5da0a",
            "The test phrase unmasked as Unicode codes, accepted by its fingerprint (a filter, not proof)",
        ),
        (
            "mnemocode re-encode --ask-secrets --mode seedshift --sskr --threshold 2 --shares 3",
            "A typed backup split into 3 shares, any 2 of which restore it",
        ),
    ],
    notes: Some(&[
        "The original fingerprint of the new backup is that of the old one: it is the same wallet. Note the new encoded fingerprint.",
    ]),
};
