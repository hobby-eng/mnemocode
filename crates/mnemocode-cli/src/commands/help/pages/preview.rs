//! The help of `mnemocode preview`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{
    CARD_QR, CARDS_DIR, IMAGE_FORMAT, IMAGES_DIR, ORIENTATION, PAGE_SIZE, PDF, RUN_2, TITLE,
};

const OWN_0_0: HelpOption = HelpOption {
    flag: "--list",
    value: None,
    summary: "List the installed designs with their numbers",
    details: &[],
};
const OWN_0_1: HelpOption = HelpOption {
    flag: "--template",
    value: Some("ID"),
    summary: "The design to draw, by name or number",
    details: &[],
};
const OWN_0_2: HelpOption = HelpOption {
    flag: "--all",
    value: None,
    summary: "Draw every design",
    details: &["Not with --cards-dir: a card folder holds one design."],
};
const OWN_0_3: HelpOption = HelpOption {
    flag: "--words",
    value: Some("12|15|18|21|24"),
    summary: "Length of the sample phrase; default 12",
    details: &[],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Print card designs with a random sample phrase",
    about: &[
        "Draws a template exactly as encode does, with a sample phrase drawn at random for each run and masked with public dates, never with a secret you typed. Use it to choose a design and check the details printed on it.",
    ],
    usage: "(--list | --template <ID> | --all) [OPTIONS]",
    groups: &[
        HelpGroup {
            heading: "Options:",
            options: &[&[
                &OWN_0_0,
                &OWN_0_1,
                &OWN_0_2,
                &OWN_0_3,
                &PDF,
                &CARDS_DIR,
                &IMAGES_DIR,
                &IMAGE_FORMAT,
                &PAGE_SIZE,
                &ORIENTATION,
                &CARD_QR,
                &TITLE,
            ]],
        },
        HelpGroup {
            heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
            options: &[RUN_2],
        },
    ],
    asks: None,
    examples: &[
        ("mnemocode preview --list", "List the designs"),
        (
            "mnemocode preview --all --pdf all-previews.pdf",
            "Every design in one PDF",
        ),
        (
            "mnemocode preview --all --words 24 --page-size a4 --pdf print-previews.pdf",
            "Every design with a 24-word phrase on A4",
        ),
        (
            "mnemocode preview --template business-it --card-name \"Alex Morgan\" --card-email \"alex@example.com\" --page-size a6 --pdf my-preview.pdf",
            "One design with your own details",
        ),
        (
            "mnemocode preview --template business-it --words 24 --page-size business --pdf business-cards.pdf",
            "Real 90 x 50 mm cards, one per page",
        ),
        (
            "mnemocode preview --template business-it --words 24 --cards-dir ./sample-cards",
            "One file per card",
        ),
        (
            "mnemocode preview --all --images-dir ./preview-images --image-format jpg",
            "Every design as JPEG images",
        ),
    ],
    notes: None,
};
