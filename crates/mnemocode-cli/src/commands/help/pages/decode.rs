//! The help of `mnemocode decode`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{DATES, DATES_FILE, FORMAT_2, RUN_1, RUN_8, WORDS};

const OWN_0_6: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("MODE"),
    summary: "direct, seedshift, seedshift-legacy or seedshift-legacy-valid",
    details: &[
        "Needed for typed text, terminal output and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A file saved with --output names its mode; a --mode that contradicts it stops the command, and with --ask-secrets MnemoCode offers to read the record as it says or to give it again. See mnemocode help modes.",
    ],
};
const OWN_1_0: HelpOption = HelpOption {
    flag: "--input-kind",
    value: Some("codes|share"),
    summary: "What a text that may be a Shamir share is read as",
    details: &[
        "share restores the seed phrase from shares, the text kept as the first share; codes reads it as the encoded seed phrase. Without it, a text that is surely a share goes to the restore at once, and MnemoCode asks only when the text may be either.",
    ],
};
const OWN_1_1: HelpOption = HelpOption {
    flag: "--encoded-fingerprint",
    value: Some("HEX"),
    summary: "Tell codes marked with ? by the encoded fingerprint that encode showed",
    details: &[
        "No dates are needed for it. Only for codes that keep a BIP39 checksum: those of MnemoCode Seedshift, and those without Seedshift, whose encoded fingerprint is the wallet's own; not those of the Original Seedshift.",
    ],
};
const OWN_1_2: HelpOption = HelpOption {
    flag: "--list-candidates",
    value: None,
    summary: "List the candidates instead of telling them by the wallet",
    details: &[
        "For codes marked with ? where they are few, and for dates with ? in seedshift-legacy mode, whose checksum sorts out most dates.",
    ],
};
const OWN_1_3: HelpOption = HelpOption {
    flag: "--max-candidates",
    value: Some("N"),
    summary: "Most combinations a search of codes marked with ? or of dates tries without asking",
    details: &[
        "Codes are counted with every date combination they are tried with. Without it, a search that takes up to 12 hours on this computer starts at once, and a longer one is asked for. The number of combinations and their time are shown before the search starts.",
    ],
};
const OWN_1_4: HelpOption = HelpOption {
    flag: "--max-results",
    value: Some("N"),
    summary: "Most date matches shown; default 100",
    details: &[],
};
const OWN_1_5: HelpOption = HelpOption {
    flag: "--max-tries",
    value: Some("N"),
    summary: "Combinations a share repair may try without asking, after a share typed here",
    details: &[
        "Without it, a search that takes up to 12 hours on this computer starts at once. The number a repair needs, and its time, are shown before it starts; on the private screen a longer search is asked for instead.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Turn an encoded record back into the phrase",
    about: &[
        "Reads a record in any of the five formats, from text, a file or a QR code, and prints the phrase with its fingerprint. A masked record needs the same dates. A seedshift-legacy-valid record gives every possible last word, each with its fingerprint: 128 candidates for 12 words, 8 for 24.",
        "With --ask-secrets the record is checked before the dates are asked for. Codes without an MNC1 header do not say how they were made: without --mode, MnemoCode asks whether Seedshift was used, and which. Where the codes of a masked record form a valid BIP39 phrase, their encoded fingerprint is shown before the dates, to compare with the one encode showed.",
        "A date may then hold ? for each forgotten digit, as in recover-date: the dates are searched, and the matches listed as recover-date lists them. Before the search the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for. It is needed where every date gives a valid phrase, as in seedshift mode; with seedshift-legacy, whose checksum sorts out most dates, it may be left out.",
        "On the private screen the codes may hold ? where one cannot be read: a word number, a word, a Unicode code or a whole color, narrowed by a few letters (ab*), words joined by |, or a ? for one digit. The right codes are told by the encoded fingerprint that encode showed, by the wallet with the dates, which may hold ? too, or by a list where they are few. A Shamir share typed in place of the codes, or read from a QR code, leads to the restore from shares, the share kept as the first; after a share from a QR code the next can be read from another.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG>)",
    groups: &[
        HelpGroup {
            heading: "Options:",
            options: &[RUN_8, &[&DATES, &DATES_FILE, &OWN_0_6, &FORMAT_2, &WORDS]],
        },
        HelpGroup {
            heading: "Answers for the private screen (--ask-secrets), where dates or codes hold ?:",
            options: &[&[&OWN_1_0, &OWN_1_1, &OWN_1_2, &OWN_1_3, &OWN_1_4, &OWN_1_5]],
        },
        HelpGroup {
            heading: "Wallet check (for dates, codes with ?, and shares typed here):",
            options: &[RUN_1],
        },
    ],
    asks: Some(&[
        (
            "Encoded record",
            "unless --input-file or --qr-file gives it; ? for a code not read",
        ),
        (
            "Share or codes",
            "for a text that may be a Shamir share, unless --input-kind",
        ),
        (
            "Format",
            "when the codes fit several forms, unless --format",
        ),
        (
            "Seedshift",
            "whether and which, for codes without a header, unless --mode",
        ),
        (
            "Dates",
            "one line, ? for what is forgotten; none in direct mode",
        ),
        (
            "Codes with ?",
            "how to tell them, unless an option answers it",
        ),
        (
            "Wallet",
            "for dates or codes with ?, unless an option gives it; then how many addresses, unless --scan-gap",
        ),
        (
            "Search",
            "one longer than 12 hours, unless --max-candidates or --max-tries allows it",
        ),
    ]),
    examples: &[
        (
            "mnemocode decode --ask-secrets",
            "Record and dates on the private screen",
        ),
        (
            "mnemocode decode --ask-secrets --input-file shifted.txt",
            "Only the dates on the private screen, ? for a forgotten digit",
        ),
        (
            "mnemocode decode --input-file shifted.txt --dates-file dates.txt",
            "A record file names its mode and format; only the dates are needed",
        ),
        (
            "mnemocode decode --mode seedshift --ask-secrets",
            "Type the Seedshift backup and its dates privately",
        ),
        (
            "mnemocode decode --mode seedshift --qr-file my-qr.png --dates-file dates.txt",
            "Read a QR code saved by encode --qr",
        ),
        (
            "mnemocode decode --mode seedshift-legacy --ask-secrets --format 3",
            "Type a legacy Unicode-code backup and its dates privately",
        ),
    ],
    notes: Some(&[
        "Compare the fingerprint, or better an address or a public key of the wallet, to pick the right candidate of a legacy-valid record. The right dates always give back the original phrase; wrong dates give a wrong but valid phrase.",
    ]),
};
