//! The help topics (MnemoCode TS 0.1.0's `cli/help-pages.ts`).

use super::super::{TopicHelp, TopicSection};

pub(in super::super) const MODES: TopicHelp = TopicHelp {
    summary: "Transformation modes: direct, seedshift and the legacy modes",
    sections: &[
        TopicSection {
            heading: "Modes:",
            paragraphs: None,
            rows: Some(&[
                (
                    "direct",
                    "Writes the phrase in another form without changing it. No dates. Not in formats 1 and 2, which would be the phrase itself.",
                ),
                (
                    "seedshift",
                    "Masks the phrase with dates. The result is always a valid BIP39 phrase, and the same dates give the original back without a search. The default when --dates-file is given.",
                ),
                (
                    "seedshift-legacy",
                    "Works exactly like the original Seedshift program, for records made with it. The result usually fails the BIP39 checksum; MnemoCode shows a valid last word too.",
                ),
                (
                    "seedshift-legacy-valid",
                    "A legacy record whose last word was replaced by a valid one (--legacy-valid-last-word). Decoding lists every possible last word with its fingerprint.",
                ),
            ]),
        },
        TopicSection {
            heading: "How seedshift masks a phrase:",
            paragraphs: Some(&[
                "The phrase is cut into 11-bit pieces, one per word. Each piece is shifted by the year, month and day of the dates, oldest date first, repeated as often as needed, modulo 2048. The data bits of the last word are shifted modulo their range, and a new checksum is calculated.",
                "Every set of dates gives a valid phrase, so wrong dates give a wrong but valid phrase. To check a recovery, keep the fingerprint of the original phrase, or an address or a public key of the wallet.",
            ]),
            rows: None,
        },
        TopicSection {
            heading: "Candidates of a legacy-valid record:",
            paragraphs: None,
            rows: Some(&[
                ("Words", "12   15   18   21   24"),
                ("Candidates", "128  64   32   16   8"),
            ]),
        },
    ],
    examples: Some(&[(
        "mnemocode encode --mode seedshift --ask-secrets --format 1",
        "Enter the phrase and its dates privately",
    )]),
    notes: None,
};

pub(in super::super) const FORMATS: TopicHelp = TopicHelp {
    summary: "The five forms a phrase can be written in (--format)",
    sections: &[TopicSection {
        heading: "Formats:",
        paragraphs: None,
        rows: Some(&[
            ("1  english", "English BIP39 words"),
            (
                "2  indexes",
                "The numbers of the words in the BIP39 list, 1 to 2048, as in Seedshift",
            ),
            (
                "3  unicode",
                "Four-digit Unicode codes of the words of the Traditional Chinese BIP39 list; only the codes are written, spaced or joined",
            ),
            (
                "4  colors-unicode",
                "The color codes of format 5, each written as two four-digit Private Use codes; all five lengths; plain text that needs no special font",
            ),
            (
                "5  colors",
                "Color codes such as #01AB63: 8 to 16 codes for 12 to 24 words, BIP39Colors-compatible for 12 and 24 words; MnemoCode also supports 15, 18 and 21. Separated or joined, in any order, but every code is needed",
            ),
        ]),
    }],
    examples: Some(&[
        (
            "printf '%s\\n' \"$TEST_PHRASE\" | mnemocode encode --mode direct --mnemonic-file - --format 3",
            "The test phrase as Unicode codes",
        ),
        (
            "mnemocode table --word abandon",
            "One word in formats 1 to 3",
        ),
    ]),
    notes: Some(&[
        "Every format is a representation, not encryption. For decode and recover-date the format is found automatically when exactly one fits; otherwise the terminal asks, and a script must pass --format. A record file names its format.",
    ]),
};

pub(in super::super) const CARDS: TopicHelp = TopicHelp {
    summary: "Printing the encoded phrase as cards or material samples",
    sections: &[
        TopicSection {
            heading: "What a card holds:",
            paragraphs: Some(&[
                "In formats 4 and 5 the phrase is a short list of color codes, in format 3 one Unicode code a word. A template places them into a familiar document, such as a print studio proposal with sample business cards. Each card shows one code: a color and its code, such as Ref. 01AB63, or a Unicode code in a color that only decorates it, the same color for the same code. The printed codes are the whole value: decode turns them back into the phrase.",
                "A set ends with a few random codes that belong to nothing: on a sheet at least one, so that every row is full and the cards are as large as the page allows; separate cards end with exactly one, after all real codes. No card says how many cards there are. The QR code holds only the real codes, and the sheet for heirs says how many words the phrase has: decode --words reads only the codes of so many words.",
                "The names, companies and contact details are a decoy that makes the cards look ordinary, invented at random unless given with --card-name and the other details. Like the images, they are not needed for recovery.",
            ]),
            rows: None,
        },
        TopicSection {
            heading: "In the menu:",
            paragraphs: Some(&[
                "After \"Screen and printable cards\", the menu asks about the files: which kind of file, PDF, PNG or JPEG; how the cards are laid out, on A6, A5 or A4 sheets in one PDF or as images of the sheets, or as separate business cards of 90 x 50 mm, one file each in a new folder; for sheets, how they are turned, landscape, portrait or whichever fills the sheet best (at least three rows, the largest cards); and the name of the PDF or of the folder. Then it asks for the design, for sheets whether to add a QR code with the codes of the backup, without the extra cards, and last, for every way of saving, whether to type your own details; Enter on a detail keeps it random. Typed details that do not fit on the cards are refused at once, and the details are asked again with every other answer kept.",
            ]),
            rows: None,
        },
        TopicSection {
            heading: "Page sizes:",
            paragraphs: None,
            rows: Some(&[
                (
                    "a6",
                    "148 x 105 mm: one sheet with the whole collection (the default)",
                ),
                ("a5", "148 x 210 mm: one sheet"),
                ("a4", "210 x 297 mm: one sheet"),
                (
                    "business",
                    "90 x 50 mm: separate numbered cards, one per page or file",
                ),
            ]),
        },
        TopicSection {
            heading: "Separate cards:",
            paragraphs: Some(&[
                "Every card prints one code. Separate cards never carry a QR code. Every real card is needed to recover the phrase, and each reveals part of it; the last card is a decoy and may be left out. This is not Shamir sharing.",
            ]),
            rows: None,
        },
    ],
    examples: Some(&[
        ("mnemocode preview --list", "The installed designs"),
        (
            "mnemocode encode --mode seedshift --ask-secrets --format 5 --template business-it --pdf cards.pdf",
            "A real export; the phrase and the dates are asked on the private screen",
        ),
        ("mnemocode encode --help", "Every card option explained"),
    ]),
    notes: None,
};
