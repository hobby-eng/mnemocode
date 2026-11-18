//! The help of `mnemocode stitch`.

use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::{
    ASK_SECRETS, DATES, DATES_FILE, HEIR_SHEET, HEIR_SHEET_SIZE, MNEMONIC, MNEMONIC_FILE, QR,
    QR_HIDDEN, QR_TEXT, SHARES, SHOW_MASKED_WORDS, SHOW_ORIGINAL, THRESHOLD,
};

const MODE: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("NAME"),
    summary: "seedshift (default), seedshift-legacy or direct",
    details: &[
        "seedshift masks the phrase with the dates, as Encode does; Decode asks for them. direct hides the phrase itself, for one protected some other way: anyone who knows MnemoCode reads it from the legend.",
        "seedshift-legacy is the Original Seedshift, with the last word Encode writes: Decode asks for the same dates and for the last word that was named to remember.",
    ],
};
const PICTURE: HelpOption = HelpOption {
    flag: "--picture",
    value: Some("PATH"),
    summary: "The picture of the pattern: a PNG, JPEG or WebP file, such as a photograph",
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
const FABRIC: HelpOption = HelpOption {
    flag: "--fabric",
    value: Some("FABRIC"),
    summary: "Aida's stitches an inch, 6 to 28, or linen-N, linen of N threads an inch stitched over one, N from 20 to 40; 14 (Aida 14) unless given",
    details: &[
        "The cover gives the finished size on it and the floss key the skeins: 200 stitches across make 36.3 cm on Aida 14 and 18.1 cm on linen-28, which is stitched with one strand. The menu offers Aida 11, 14, 16 or 18 and linen 28 over one thread, then paper sizes from A6 to A2, and works out the stitches.",
    ],
};
const PDF: HelpOption = HelpOption {
    flag: "--pdf",
    value: Some("PATH"),
    summary: "Save the pattern: a cover, the floss key and the chart in colour",
    details: &[
        "A folder of its path that is missing is made. Without --pdf the legend is shown, and saved where --output or --qr says.",
    ],
};
const OUTPUT: HelpOption = HelpOption {
    flag: "--output",
    value: Some("PATH"),
    summary: "Also save the legend as Decode reads it back, one line of text",
    details: &["With --shares, every share's legend line, one to a line."],
};
const PDF_DIR: HelpOption = HelpOption {
    flag: "--pdf-dir",
    value: Some("NEW_FOLDER"),
    summary: "With --shares, save one pattern a share in a new folder",
    details: &[
        "Files are share-1-pattern.pdf, share-2-pattern.pdf and so on, all from the same picture, so that they look alike. The folder holds every share: keep the patterns apart. A taken folder name is numbered, never replaced.",
    ],
};
const LEGEND_QR_DIR: HelpOption = HelpOption {
    flag: "--qr-dir",
    value: Some("NEW_FOLDER"),
    summary: "With --shares, save each share's legend line as a PNG QR image in a new folder",
    details: &[
        "Files are share-1-qr.png, share-2-qr.png and so on; sskr-combine --share-qr reads them. --qr-hidden and --qr-text apply to each.",
    ],
};

pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Hide a phrase in the legend of a cross-stitch pattern",
    about: &[
        "Masks an English BIP39 phrase with dates, as seedshift mode does, unless --mode direct, and hides it in the legend of a cross-stitch pattern made from a picture: the symbol of each thread and the last digits of its count of stitches (SeedStitch). The pattern is an ordinary chart in DMC threads; nothing on it names MnemoCode.",
        "Decode reads the legend back without the picture: type its rows as each symbol's number, a colon and the stitches, from the top, then say whether Seedshift was used, and which, and give the dates: the legend does not say. A pattern too small for the phrase otherwise uses the rows' order too, and each row names its DMC number between them, as 15:407:38. Decode also reads the pattern's PDF itself, which keeps the legend line where no viewer shows it: decode --input-file pattern.pdf.",
        "With --threshold and --shares the phrase is split into Shamir shares (SSKR), as sskr-split splits it, and each share is hidden in a pattern of its own, all made from the same picture. sskr-combine restores the phrase from any threshold of them: their PDFs, their legend lines or their QR images. A share holds 5 bytes more than the phrase, so its pattern needs a few more threads.",
    ],
    usage: "(--configure --ask-secrets | --picture <PATH> [--pdf <PATH> | --threshold <N> --shares <M> [--pdf-dir <NEW_FOLDER>]] [OPTIONS] (--ask-secrets | --mnemonic-file <PATH>))",
    groups: &[
        HelpGroup {
            heading: "The phrase and the dates:",
            options: &[&[
                &ASK_SECRETS,
                &super::options::CONFIGURE,
                &MODE,
                &MNEMONIC_FILE,
                &MNEMONIC,
                &DATES,
                &DATES_FILE,
            ]],
        },
        HelpGroup {
            heading: "The pattern:",
            options: &[&[&PICTURE, &STITCHES_ACROSS, &FABRIC, &PDF]],
        },
        HelpGroup {
            heading: "Shamir shares, a pattern each (see mnemocode help sskr-combine to restore):",
            options: &[&[&THRESHOLD, &SHARES, &PDF_DIR, &LEGEND_QR_DIR]],
        },
        HelpGroup {
            heading: "What else is saved and shown, as for every new backup:",
            options: &[&[
                &OUTPUT,
                &QR,
                &QR_HIDDEN,
                &QR_TEXT,
                &SHOW_ORIGINAL,
                &SHOW_MASKED_WORDS,
                &HEIR_SHEET,
                &HEIR_SHEET_SIZE,
            ]],
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
            "mnemocode stitch --ask-secrets --picture cat.jpg --threshold 2 --shares 3 --pdf-dir cat-patterns",
            "Three patterns, any two of which restore the phrase",
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
