//! The help of `mnemocode recover-date`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{FORMAT_2, MAX_CANDIDATES, RUN_1, RUN_7, RUN_8, WORDS};

const OWN_0_4: HelpOption = HelpOption {
    flag: "--dates",
    value: Some("PATTERN ..."),
    summary: "Refused material argument; put patterns in --dates-file or use --ask-secrets",
    details: &[],
};
const OWN_0_5: HelpOption = HelpOption {
    flag: "--dates-file",
    value: Some("PATH"),
    summary: "Read dates with ? for forgotten digits from a file or -",
    details: &[
        "The file may be up to 4 KiB.",
        "?3-09-2026 tries days ending in 3, 0?-09-2026 days 1 to 9, 05|15-09-2026 day 5 or 15, 15-?-2025 the 15th of every month, ?-?-2026 every date in 2026, a lone ? every supported date. One to three dates may be incomplete; two identical patterns are tried once.",
    ],
};
const OWN_0_6: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("MODE"),
    summary: "seedshift, seedshift-legacy or seedshift-legacy-valid",
    details: &[
        "Needed for typed text, terminal output and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A file saved with --output names its mode; a --mode that contradicts it stops the command, and with --ask-secrets MnemoCode offers to read the record as it says or to give it again. See mnemocode help modes.",
    ],
};
const OWN_2_1: HelpOption = HelpOption {
    flag: "--max-results",
    value: Some("N"),
    summary: "Most candidates shown; default 100",
    details: &[],
};
const OWN_2_2: HelpOption = HelpOption {
    flag: "--progress-every",
    value: Some("N"),
    summary: "Report progress after every N attempts; default 1000",
    details: &[],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Find a forgotten digit of a date",
    about: &[
        "Tries every date that fits one to three incomplete dates, where each forgotten digit is written as ?, and lists the candidates that pass a recovery check. Every check is local and offline.",
        "In the seedshift and seedshift-legacy-valid modes every date gives a valid phrase, so a recovery check is required; with --ask-secrets it is asked for after the dates when no option gives it. In seedshift-legacy mode the BIP39 checksum can be used instead, a weak filter of 4 to 8 bits.",
        "With --ask-secrets the encoded fingerprint of the codes is shown once they are read, before the dates, as decode shows it, so that a code typed wrongly shows before a long search.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --dates-file <PATH>) [<RECOVERY CHECK>]",
    groups: &[
        HelpGroup {
            heading: "The record and the dates:",
            options: &[RUN_8, &[&OWN_0_4, &OWN_0_5, &OWN_0_6, &FORMAT_2, &WORDS]],
        },
        HelpGroup {
            heading: "Recovery checks (one of them finds the wallet among the candidates):",
            options: &[RUN_1],
        },
        HelpGroup {
            heading: "Search limits:",
            options: &[&[&MAX_CANDIDATES, &OWN_2_1, &OWN_2_2]],
        },
        HelpGroup {
            heading: "Candidate list for the Discovery Scanner (docs/CANDIDATES.md):",
            options: &[RUN_7],
        },
    ],
    asks: Some(&[
        (
            "Encoded record",
            "unless --input-file or --qr-file gives it",
        ),
        (
            "Seedshift",
            "which, for codes without a header, unless --mode",
        ),
        ("Dates", "one line, with ? in place of each forgotten digit"),
        (
            "Wallet",
            "when the mode needs it and no option gives it; then how many addresses, unless --scan-gap",
        ),
        (
            "List passphrase",
            "twice, for a candidate list, unless an option chooses how the list is protected",
        ),
    ]),
    examples: &[
        (
            "mnemocode recover-date --mode seedshift --ask-secrets --format 1 --master-fingerprint 73c5da0a",
            "Record and date patterns on the private screen",
        ),
        (
            "mnemocode recover-date --mode seedshift --input-file shifted.txt --dates-file date-patterns.txt --master-fingerprint 73c5da0a",
            "Find the forgotten day with the fingerprint",
        ),
        (
            "mnemocode recover-date --mode seedshift --input-file shifted.txt --dates-file date-patterns.txt --coin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
            "The same with the first native SegWit receiving address, m/84'/0'/0'/0/0",
        ),
    ],
    notes: Some(&[
        "Quote the patterns, as in \"??-09-2026\" or \"05|15-09-2026\", so that the shell neither expands ? nor reads | as a pipe.",
    ]),
};
