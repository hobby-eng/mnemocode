//! The help of `mnemocode sskr-split`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{
    ASK_SECRETS, BACKUP_CHECK, CARD_LAYOUT, CARD_QR_2, CARDS_DIR_2, DATES, DATES_FILE, HEIR_SHEET,
    HEIR_SHEET_SIZE, IMAGE_FORMAT_2, IMAGES_DIR, MNEMONIC, MNEMONIC_FILE, ORIENTATION, PAGE_SIZE,
    QR_DIR, RUN_2, SHARES, TEMPLATE, THRESHOLD,
};

const OWN_0_3: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("MODE"),
    summary: "direct or seedshift; see mnemocode help modes",
    details: &[
        "Without --mode, MnemoCode uses seedshift when --dates-file is given and direct otherwise.",
    ],
};
const OWN_0_8: HelpOption = HelpOption {
    flag: "--format",
    value: Some("FORMAT"),
    summary: "The share format; default ur (see encode --share-format)",
    details: &[],
};
const OWN_0_9: HelpOption = HelpOption {
    flag: "--output",
    value: Some("NEW_FILE"),
    summary: "Save the shares, one per line; never replaces a file",
    details: &[],
};
const OWN_0_10: HelpOption = HelpOption {
    flag: "--pdf",
    value: Some("PATH"),
    summary: "Save all shares in one PDF",
    details: &["A folder of its path that is missing is made."],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "encode --sskr, with --format for the share format",
    about: &[
        "Splits the phrase like encode --sskr, but here --format selects the share format, as --share-format does there.",
    ],
    usage: "[OPTIONS] --threshold <N> --shares <M> (--ask-secrets | --mnemonic-file <PATH>)",
    groups: &[
        HelpGroup {
            heading: "Options:",
            options: &[&[
                &ASK_SECRETS,
                &MNEMONIC_FILE,
                &MNEMONIC,
                &OWN_0_3,
                &DATES,
                &DATES_FILE,
                &THRESHOLD,
                &SHARES,
                &OWN_0_8,
                &OWN_0_9,
                &OWN_0_10,
                &CARDS_DIR_2,
                &QR_DIR,
                &IMAGES_DIR,
                &IMAGE_FORMAT_2,
                &CARD_LAYOUT,
                &TEMPLATE,
                &PAGE_SIZE,
                &ORIENTATION,
                &CARD_QR_2,
                &HEIR_SHEET,
                &HEIR_SHEET_SIZE,
                &BACKUP_CHECK,
            ]],
        },
        HelpGroup {
            heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
            options: &[RUN_2],
        },
    ],
    asks: Some(&[
        ("Phrase", "English BIP39 words"),
        ("Dates", "only with --mode seedshift"),
        (
            "Backup check",
            "whether to type the shares again from paper, unless --backup-check",
        ),
    ]),
    examples: &[(
        "mnemocode sskr-split --ask-secrets --threshold 2 --shares 3 --output ./shares.txt",
        "The same as encode --sskr with these options",
    )],
    notes: None,
};
