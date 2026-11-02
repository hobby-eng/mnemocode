//! The help of `mnemocode recover-word`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{ASK_SECRETS, MNEMONIC, RUN_1, RUN_7};

const PATTERN_FILE: HelpOption = HelpOption {
    flag: "--mnemonic-file",
    value: Some("PATH"),
    summary: "Read the phrase from a file; - reads standard input",
    details: &["The file may be up to 32 KiB."],
};
const OWN_0_3: HelpOption = HelpOption {
    flag: "--missing-word",
    value: None,
    summary: "One word is missing, and where is not known",
    details: &[
        "Give the 11, 14, 17, 20 or 23 words you have, in their order; every place and every word is tried.",
    ],
};
const OWN_0_4: HelpOption = HelpOption {
    flag: "--legacy-valid-last-word",
    value: None,
    summary: "List the valid last words of a whole seedshift-legacy phrase",
    details: &[
        "For an old seedshift-legacy phrase whose last word fails the checksum. Give the whole phrase without ?. Every valid last word is listed; the row marked preserved keeps the data bits of the old word, the word legacy encoding suggests. Recover the original wallet phrase from it with the dates.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Find forgotten words of a phrase",
    about: &[
        "Put ? in place of each forgotten word, ab* for a word that starts with ab, or rich|rice for one of a few words. MnemoCode tries every combination, up to 16,777,216, and lists those that pass the checksum test: for one forgotten word about 128 in a 12-word phrase, about 8 in 24 words. With one forgotten word each candidate shows the word, its number in the BIP39 list, the checksum bits and the whole phrase. A file or a pipe gets one row for each candidate, and a recovery check marks the matching rows. On a terminal each candidate is a part of its own: every candidate is shown when the list, one row for each, fits on the screen; a longer list shows only the candidates that match the wallet, and without a wallet or a candidate list says how to narrow it and offers to check them against the wallet or to save them as an encrypted list for the Discovery Scanner, also for words read with --mnemonic-file. More than 2,048 candidates are not shown: save them with --candidates-file, or check them against the wallet.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH>)",
    groups: &[
        HelpGroup {
            heading: "The phrase:",
            options: &[&[&ASK_SECRETS, &PATTERN_FILE, &MNEMONIC, &OWN_0_3, &OWN_0_4]],
        },
        HelpGroup {
            heading: "Recovery checks (one of them finds the wallet among the candidates):",
            options: &[RUN_1],
        },
        HelpGroup {
            heading: "Candidate list for the Discovery Scanner (docs/CANDIDATES.md):",
            options: &[RUN_7],
        },
    ],
    asks: Some(&[
        ("Phrase", "with ? in place of each forgotten word"),
        (
            "Wallet",
            "to check the candidates, after the search, unless an option gives it; then how many addresses, unless --scan-gap",
        ),
        (
            "Candidate list",
            "where it goes and how it is encrypted, after a search whose candidates do not fit, unless --candidates-file gives one",
        ),
        (
            "List passphrase",
            "twice, for a candidate list, unless an option chooses how the list is protected",
        ),
    ]),
    examples: &[
        (
            "mnemocode recover-word --ask-secrets",
            "The phrase with ? on the private screen",
        ),
        (
            "mnemocode recover-word --mnemonic-file words-with-marks.txt",
            "Every word that passes the checksum",
        ),
        (
            "mnemocode recover-word --ask-secrets --master-fingerprint 73c5da0a",
            "Mark the candidate with this fingerprint",
        ),
        (
            "mnemocode recover-word --ask-secrets --missing-word",
            "A word missing at an unknown place",
        ),
        (
            "mnemocode recover-word --ask-secrets --candidates-file ./candidates.age --candidates-key age1…",
            "Every candidate, encrypted for the Discovery Scanner",
        ),
        (
            "mnemocode recover-word --legacy-valid-last-word --ask-secrets",
            "Valid last words for a stored legacy phrase",
        ),
    ],
    notes: None,
};
