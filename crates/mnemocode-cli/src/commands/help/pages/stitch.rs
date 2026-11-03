//! The help of `mnemocode stitch`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{ASK_SECRETS, DATES, DATES_FILE, MNEMONIC, MNEMONIC_FILE};

const PICTURE: HelpOption = HelpOption {
    flag: "--picture",
    value: Some("PATH"),
    summary: "The picture of the pattern: a PNG or JPEG file, such as a photograph",
    details: &[
        "A photograph or a painting with smooth shades works best; a flat picture of a few colours cannot hold a phrase. The file may be up to 40 MiB and 60 megapixels, and the pattern at most 800 stitches high. At a terminal, a picture that cannot be used is asked again.",
    ],
};
const STITCHES_ACROSS: HelpOption = HelpOption {
    flag: "--stitches-across",
    value: Some("N"),
    summary: "The width of the pattern in stitches, 40 to 500; 200 unless given",
    details: &[],
};
const PDF: HelpOption = HelpOption {
    flag: "--pdf",
    value: Some("PATH"),
    summary: "Save the pattern: cover, legend and chart pages",
    details: &["A folder of its path that is missing is made."],
};
const OUTPUT: HelpOption = HelpOption {
    flag: "--output",
    value: Some("PATH"),
    summary: "Also save the legend as Decode reads it back, one line of text",
    details: &[],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Hide a phrase in the legend of a cross-stitch pattern",
    about: &[
        "Masks an English BIP39 phrase with dates, as seedshift mode does, and hides the masked phrase in the legend of a cross-stitch pattern made from a picture: the symbol of each thread and the last digits of its count of stitches (SeedStitch). The pattern is an ordinary chart in DMC threads; nothing on it names MnemoCode.",
        "Decode reads the legend back without the picture: type its rows as each symbol's number, a colon and the stitches, from the top, then give the dates.",
    ],
    usage: "--picture <PATH> --pdf <PATH> [OPTIONS] (--ask-secrets | --mnemonic-file <PATH>)",
    groups: &[
        HelpGroup {
            heading: "The phrase and the dates:",
            options: &[&[&ASK_SECRETS, &MNEMONIC_FILE, &MNEMONIC, &DATES, &DATES_FILE]],
        },
        HelpGroup {
            heading: "The pattern:",
            options: &[&[&PICTURE, &STITCHES_ACROSS, &PDF, &OUTPUT]],
        },
    ],
    asks: Some(&[
        ("Phrase", "English BIP39 words"),
        ("Dates", "one line, such as 23-09-2026 08-08-1988"),
    ]),
    examples: &[
        (
            "mnemocode stitch --ask-secrets --picture cat.jpg --pdf cat-pattern.pdf",
            "A pattern of 200 stitches across",
        ),
        (
            "mnemocode decode --ask-secrets",
            "Type the legend's rows, such as 28:1725 25:2163, then the dates",
        ),
    ],
    notes: Some(&[
        "The symbols are numbered 1 to 70 as docs/SEEDSTITCH.md lists them. One row typed wrong is found and corrected; Decode says which.",
    ]),
};
