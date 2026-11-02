//! The help of `mnemocode sskr-export`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{
    CARD_LAYOUT, CARD_QR_2, CARDS_DIR_2, DATES, DATES_FILE, IMAGE_FORMAT_2, MAX_CANDIDATES,
    MAX_TRIES, ORIENTATION, PAGE_SIZE, QR_DIR, RUN_1, RUN_2, RUN_9,
};

const OWN_1_0: HelpOption = HelpOption {
    flag: "--format",
    value: Some("FORMAT"),
    summary: "How the shares are shown (see encode --share-format)",
    details: &[
        "Without it, in the form they are written in: a share repaired from elements marked with ? comes back whole, in its own form. Cards are then checked in every form that has them, before the shares are asked.",
    ],
};
const OWN_1_1: HelpOption = HelpOption {
    flag: "--output",
    value: Some("NEW_FILE"),
    summary: "Save the shares, one complete share per line",
    details: &["The file holds all shares. A taken name is numbered, never replaced."],
};
const OWN_1_2: HelpOption = HelpOption {
    flag: "--pdf",
    value: Some("PATH"),
    summary: "Save all shares in one multi-page PDF",
    details: &["A taken name is numbered, as shares-1.pdf, never replaced."],
};
const OWN_1_5: HelpOption = HelpOption {
    flag: "--images-dir",
    value: Some("NEW_FOLDER"),
    summary: "Save the pages of all shares as images in a new folder",
    details: &["Pages are drawn at 300 dpi."],
};
const OWN_1_8: HelpOption = HelpOption {
    flag: "--template",
    value: Some("ID"),
    summary: "The card design; default business-it",
    details: &[],
};
const OWN_3_15: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("seedshift"),
    summary: "The phrase was masked before splitting: check the wallet after the dates",
    details: &[
        "Without it the wallet check compares the phrase that the shares hold, which is the wallet of a standard split.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Print existing Shamir shares as cards",
    about: &[
        "Prints shares made earlier as cards, PDFs, images or a share file. It changes only the presentation and never makes new shares.",
        "Shares with elements typed as ? come back whole, repaired together as by sskr-combine, without the phrase being shown. When more than one set of shares fits, each is shown with the fingerprint of the phrase it holds, and none is saved; a wallet check keeps the right one.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --share-file <PATH> | --share-qr <PNG>)",
    groups: &[
        HelpGroup {
            heading: "The shares:",
            options: &[RUN_9, &[&MAX_TRIES, &MAX_CANDIDATES]],
        },
        HelpGroup {
            heading: "Output:",
            options: &[&[
                &OWN_1_0,
                &OWN_1_1,
                &OWN_1_2,
                &CARDS_DIR_2,
                &QR_DIR,
                &OWN_1_5,
                &IMAGE_FORMAT_2,
                &CARD_LAYOUT,
                &OWN_1_8,
                &PAGE_SIZE,
                &ORIENTATION,
                &CARD_QR_2,
            ]],
        },
        HelpGroup {
            heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
            options: &[RUN_2],
        },
        HelpGroup {
            heading: "Wallet check (one of them keeps only the matching phrases):",
            options: &[RUN_1, &[&OWN_3_15, &DATES, &DATES_FILE]],
        },
    ],
    asks: Some(&[
        (
            "Shares",
            "shares separated by ;, ? for each unreadable element",
        ),
        (
            "Dates",
            "only with --mode seedshift; ? for each forgotten digit",
        ),
        (
            "Wallet",
            "when several sets of shares fit, unless an option gives it; then how many addresses, unless --scan-gap",
        ),
    ]),
    examples: &[
        (
            "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./share-cards --card-layout collection --template business-it",
            "One collection sheet per share",
        ),
        (
            "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./sskr-a6 --page-size a6 --orientation portrait",
            "The same on portrait A6 sheets",
        ),
        (
            "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./share-qr --card-layout qr",
            "One QR document per share",
        ),
    ],
    notes: None,
};
