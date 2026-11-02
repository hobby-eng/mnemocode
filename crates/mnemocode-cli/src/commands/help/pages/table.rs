//! The help of `mnemocode table`.

use super::super::{CommandHelp, HelpGroup, HelpOption};

const OWN_0_0: HelpOption = HelpOption {
    flag: "--word",
    value: Some("WORD"),
    summary: "An English BIP39 word",
    details: &[],
};
const OWN_0_1: HelpOption = HelpOption {
    flag: "--index",
    value: Some("N"),
    summary: "A word number, 1 to 2048",
    details: &[],
};
const OWN_0_2: HelpOption = HelpOption {
    flag: "--unicode",
    value: Some("HEX"),
    summary: "A four-digit Unicode code, such as 5BF6",
    details: &[],
};
const OWN_0_3: HelpOption = HelpOption {
    flag: "--all",
    value: None,
    summary: "The whole table: number, word and code, tab-separated for a script",
    details: &[],
};
const OWN_0_4: HelpOption = HelpOption {
    flag: "--recovery-guide",
    value: None,
    summary: "Standalone English instructions for manual recovery",
    details: &[],
};
const OWN_0_5: HelpOption = HelpOption {
    flag: "--word-lists-dir",
    value: Some("PATH"),
    summary: "Full set in a new folder: numbered lists, full mapping and guide",
    details: &[],
};
const OWN_1_0: HelpOption = HelpOption {
    flag: "--table-format",
    value: Some("NAME"),
    summary: "With --all: english, chinese (Traditional), unicode or mapping; numbered from 1, its columns lined up with spaces",
    details: &[],
};
const OWN_1_1: HelpOption = HelpOption {
    flag: "--output",
    value: Some("PATH"),
    summary: "Save the full word list or recovery guide as a UTF-8 text file",
    details: &[],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Look up a word, its number or its Unicode code",
    about: &[
        "Prints the row of the BIP39 table that links an English word, its number from 1 to 2048 and the four-digit Unicode code of format 3, or the whole table.",
    ],
    usage: "(--word <WORD> | --index <N> | --unicode <HEX> | --all | --recovery-guide | --word-lists-dir <PATH>) [--table-format <NAME>] [--output <PATH>]",
    groups: &[
        HelpGroup {
            heading: "Options (exactly one):",
            options: &[&[&OWN_0_0, &OWN_0_1, &OWN_0_2, &OWN_0_3, &OWN_0_4, &OWN_0_5]],
        },
        HelpGroup {
            heading: "Export:",
            options: &[&[&OWN_1_0, &OWN_1_1]],
        },
    ],
    asks: None,
    examples: &[
        ("mnemocode table --word abandon", "The row of abandon"),
        ("mnemocode table --index 1", "The first word"),
        ("mnemocode table --unicode 5BF6", "The word with this code"),
        ("mnemocode table --all", "All 2,048 rows"),
        (
            "mnemocode table --all --table-format mapping --output bip39-mapping.txt",
            "Save the complete English/Chinese/Unicode mapping",
        ),
        (
            "mnemocode table --recovery-guide --output manual-recovery.md",
            "Save the printable English recovery guide",
        ),
        (
            "mnemocode table --word-lists-dir ./recovery-pack",
            "Save all dictionaries and the guide in one folder",
        ),
    ],
    notes: None,
};
