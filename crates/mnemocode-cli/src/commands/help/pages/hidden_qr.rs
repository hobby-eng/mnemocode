//! Help for wrapping an existing backup record in a QR.
use super::super::{CommandHelp, HelpGroup, HelpOption};
use super::options::QR_TEXT;
const QR: HelpOption = HelpOption {
    flag: "--qr",
    value: Some("PATH"),
    summary: "Save the QR with hidden data as a verified PNG",
    details: &["qr-hide always uses hidden records; no --qr-hidden flag is needed."],
};
const INPUT: HelpOption = HelpOption {
    flag: "--input-file",
    value: Some("PATH"),
    summary: "Exact UTF-8 backup codes, share or SeedStitch legend, up to 4096 bytes",
    details: &[
        "The record is stored exactly as read. Protect it with Seedshift or MHFE before wrapping it.",
    ],
};
pub(in super::super) const PAGE: CommandHelp = CommandHelp {
    summary: "Save an existing record in hidden QR filler bytes",
    about: &[
        "An ordinary scanner sees only the chosen public text. MnemoCode extracts the exact hidden record, protected by the QR error correction and a format check. Raw-byte tools can detect it; this is not encryption.",
    ],
    usage: "--input-file PATH --qr PATH [--qr-text TEXT]",
    groups: &[HelpGroup {
        heading: "Files and visible text:",
        options: &[&[&INPUT, &QR, &QR_TEXT]],
    }],
    asks: None,
    examples: &[(
        "mnemocode qr-hide --input-file record.txt --qr backup.png --qr-text 'Material samples'",
        "Save a protected record with a public note",
    )],
    notes: Some(&[
        "Do not upload a real backup QR to online decoding services. Re-creating a QR from the visible text removes its hidden record.",
    ]),
};

const QR_FILE: HelpOption = HelpOption {
    flag: "--qr-file",
    value: Some("PATH"),
    summary: "PNG containing a hidden record",
    details: &[],
};
const OUTPUT: HelpOption = HelpOption {
    flag: "--output",
    value: Some("PATH"),
    summary: "Private file for the exact extracted UTF-8 record",
    details: &[],
};
pub(in super::super) const OPEN: CommandHelp = CommandHelp {
    summary: "Extract an exact hidden record from a QR PNG",
    about: &[
        "Refuses a plain QR or an invalid hidden-record check. The output file contains the record without encryption.",
    ],
    usage: "--qr-file PATH --output PATH",
    groups: &[HelpGroup {
        heading: "Files:",
        options: &[&[&QR_FILE, &OUTPUT]],
    }],
    asks: None,
    examples: &[(
        "mnemocode qr-open --qr-file backup.png --output record.txt",
        "Extract the original codes",
    )],
    notes: None,
};
