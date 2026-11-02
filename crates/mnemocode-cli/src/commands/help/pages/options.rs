//! The options that several help pages name (MnemoCode TS 0.1.0's `cli/help-options.ts`).

use super::super::{HelpGroup, HelpOption};

pub(super) const ASK_SECRETS: HelpOption = HelpOption {
    flag: "--ask-secrets",
    value: None,
    summary: "Ask for the secrets on a private screen",
    details: &[
        "The secrets are typed on the terminal's alternate screen, a private screen that shows what you type and then the result. When you press Enter after the result, it is cleared and the terminal returns to where it was, so that no secret stays in the scrollback: only a summary stays, of what was saved and where and of the warnings. This works on Linux, macOS and Windows alike.",
        "Each answer is checked as soon as it is given: one that cannot be used is explained in one line and asked again, and the answers before it are kept. While a secret is typed, Escape cancels the action and returns to the menu when started there; at a visible value, such as a fingerprint, an address or a file name, it goes back to the question before and drops what was typed there; in a list of choices it does what the key hint says. Ctrl+C stops the command.",
        "Standard input and standard error must be the terminal; without them, or in a terminal that says TERM=dumb, the command stops at once. Output sent to a file goes there as before.",
        "Raw phrase, record, share, date and final-word arguments are refused, including public fixtures. Use the private screen or the corresponding file/stdin option.",
    ],
};

pub(super) const MNEMONIC_FILE: HelpOption = HelpOption {
    flag: "--mnemonic-file",
    value: Some("PATH"),
    summary: "Read the phrase from a file; - reads standard input",
    details: &["The file may be up to 256 bytes."],
};

pub(super) const MNEMONIC: HelpOption = HelpOption {
    flag: "--mnemonic",
    value: Some("TEXT"),
    summary: "Refused material argument; use --mnemonic-file or --ask-secrets",
    details: &[],
};

pub(super) const MODE: HelpOption = HelpOption {
    flag: "--mode",
    value: Some("MODE"),
    summary: "direct, seedshift or seedshift-legacy; see mnemocode help modes",
    details: &[
        "Without --mode, MnemoCode uses seedshift when --dates-file is given and direct otherwise.",
    ],
};

pub(super) const DATES: HelpOption = HelpOption {
    flag: "--dates",
    value: Some("DATE ..."),
    summary: "Refused material argument; use --dates-file or --ask-secrets",
    details: &[],
};

pub(super) const DATES_FILE: HelpOption = HelpOption {
    flag: "--dates-file",
    value: Some("PATH"),
    summary: "Read dates from a local UTF-8 file; - reads standard input",
    details: &[
        "The file may be up to 128 bytes.",
        "Dates are separated by whitespace. recover-date also accepts date patterns in this file. Do not combine it with --ask-secrets, which asks for the dates itself.",
        "YYYY-MM-DD is also accepted. The order does not matter: the dates are sorted, oldest first. A year always has four digits, 0001 to 9999, so the year 26 is written 0026.",
        "DD-MM-YYYY, up to one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words. Dates are not written into the encoded record; protect and keep the date file yourself.",
        "Only one material file option may read standard input in one command; use local files for the other sources.",
    ],
};

pub(super) const FORMAT: HelpOption = HelpOption {
    flag: "--format",
    value: Some("FORMAT"),
    summary: "The form of the result, 1 to 5 or its name; default 1 (english)",
    details: &[
        "1 english words, 2 indexes, 3 unicode codes, 4 colors-unicode, 5 colors. Formats 1 and 2 need a Seedshift (--mode seedshift with its dates): unmasked, they are the seed phrase itself. Cards need 3, 4 or 5. See mnemocode help formats. With --sskr and Seedshift, --format alone shows the complete masked backup beside the shares. The original phrase is shown only as English words, with --show-original words.",
    ],
};

pub(super) const LEGACY_VALID_LAST_WORD: HelpOption = HelpOption {
    flag: "--legacy-valid-last-word",
    value: None,
    summary: "In seedshift-legacy mode, end with a last word that passes the checksum",
    details: &[
        "A legacy result usually fails the BIP39 checksum. With this option only the checksum bits of the last word are calculated again, as with the same option of the original Seedshift; the record becomes seedshift-legacy-valid. Its decoding lists every possible last word.",
    ],
};

pub(super) const OUTPUT: HelpOption = HelpOption {
    flag: "--output",
    value: Some("PATH"),
    summary: "Also save a versioned MNC1 record file",
    details: &[
        "The record starts with MNC1:<mode>:<format>:, so decode needs only the file and the dates. Dates are never stored. A taken name is numbered, as record-1.txt, never replaced.",
    ],
};

pub(super) const CARDS: HelpOption = HelpOption {
    flag: "--cards",
    value: None,
    summary: "Show the color codes as colored cards in the terminal (formats 4 and 5)",
    details: &[],
};

pub(super) const QR: HelpOption = HelpOption {
    flag: "--qr",
    value: Some("PATH"),
    summary: "Save the result as a QR code in a PNG file",
    details: &[
        "The QR code holds only the encoded data in the selected format: no header, mode, dates or fingerprints. decode --qr-file reads it back.",
    ],
};

pub(super) const HEIR_SHEET: HelpOption = HelpOption {
    flag: "--heir-sheet",
    value: Some("PATH"),
    summary: "Also save one sheet that tells heirs how to restore the backup",
    details: &[
        "A PDF of one sheet to print on both sides. The front says what the backup looks like, how many shares restore it and how many dates it needs, and leaves the rest of its room for a hint written by hand; the back gives the steps in the menu and the basics for someone new to wallets. It holds no secret: no codes, no dates, no fingerprint and no places. Not with --legacy-valid-last-word. See Instructions for heirs in the README.",
    ],
};

pub(super) const HEIR_SHEET_SIZE: HelpOption = HelpOption {
    flag: "--heir-sheet-size",
    value: Some("a5|a6"),
    summary: "The size of that sheet; default a5",
    details: &[
        "a5 is the size of a notebook, 148 x 210 mm, with larger print; a6 is the size of a postcard and of the cards, 105 x 148 mm, with small print.",
    ],
};

pub(super) const BACKUP_CHECK: HelpOption = HelpOption {
    flag: "--backup-check",
    value: Some("yes|no"),
    summary: "Answer whether to check the written-down backup on the private screen",
    details: &[
        "After the result, the private screen offers to type the backup again from what you wrote down, with the dates, and says whether it restores the same phrase. yes starts that check at once; no leaves it out. Without the option it is asked. It needs a terminal, where the private screen shows.",
    ],
};

pub(super) const SHOW_MASKED_WORDS: HelpOption = HelpOption {
    flag: "--show-masked-words",
    value: None,
    summary: "Also show the English words after Seedshift, beside the codes or shares",
    details: &[
        "The original dates are still needed. In the english format the same words are already shown once.",
    ],
};

pub(super) const SHOW_ORIGINAL: HelpOption = HelpOption {
    flag: "--show-original",
    value: Some("words"),
    summary: "Also show the original seed phrase as English words for visual checking",
    details: &[
        "Shown only on the screen, never as codes or added to encoded files, QR images or share files. Keep the original words apart from the backup.",
    ],
};

pub(super) const TEMPLATE: HelpOption = HelpOption {
    flag: "--template",
    value: Some("ID"),
    summary: "The card design, by name or number; mnemocode preview --list lists them",
    details: &[],
};

pub(super) const PDF: HelpOption = HelpOption {
    flag: "--pdf",
    value: Some("PATH"),
    summary: "Save the cards as one PDF",
    details: &["A folder of its path that is missing is made."],
};

pub(super) const CARDS_DIR: HelpOption = HelpOption {
    flag: "--cards-dir",
    value: Some("NEW_FOLDER"),
    summary: "Save one file per card in a new folder",
    details: &[
        "Files are named after the number of their card alone, such as 01.pdf, never after its code; each holds only its own code. Use it with --page-size business or without a page size. A taken name is numbered, as cards-1, never replaced; the folder is created only when every card is ready.",
    ],
};

pub(super) const IMAGES_DIR: HelpOption = HelpOption {
    flag: "--images-dir",
    value: Some("NEW_FOLDER"),
    summary: "Save the pages as images in a new folder",
    details: &["Pages are drawn at 300 dpi."],
};

pub(super) const IMAGE_FORMAT: HelpOption = HelpOption {
    flag: "--image-format",
    value: Some("png|jpg"),
    summary: "Image format for page images and separate cards when requested",
    details: &[
        "--images-dir defaults to PNG. --cards-dir defaults to one PDF per card; --image-format selects images instead. jpeg is accepted for jpg. PNG keeps text and QR codes sharp; JPEG uses quality 90. The rounded corners of a separate card are transparent in PNG and white in JPEG.",
    ],
};

pub(super) const PAGE_SIZE: HelpOption = HelpOption {
    flag: "--page-size",
    value: Some("a6|a5|a4|business"),
    summary: "a6 (default), a5 or a4 for one sheet, business for separate cards",
    details: &[
        "a6 is 148 x 105 mm, a5 148 x 210 mm and a4 210 x 297 mm: the whole collection on one sheet, scaled to the page, a design proposal that cannot be cut into cards. business gives real 90 x 50 mm cards, numbered, one per page or file. Print at 100% / actual size.",
    ],
};

pub(super) const ORIENTATION: HelpOption = HelpOption {
    flag: "--orientation",
    value: Some("portrait|landscape"),
    summary: "Page orientation; works with every page size",
    details: &[],
};

pub(super) const CARD_QR: HelpOption = HelpOption {
    flag: "--card-qr",
    value: None,
    summary: "Add one QR code with the whole encoded phrase to a collection sheet",
    details: &[
        "Off by default. The QR code holds only the encoded data in the selected format: no header, mode, dates, names or fingerprints. Separate cards never carry a QR code.",
        "encode and the commands of shares also save the QR code as a PNG image where the sheets go: beside the PDF (cards.pdf gives cards-qr.png), or in their folder; one image per share for Shamir shares. Decode reads it back with --qr-file, Restore with --share-qr. With encode alone, --qr names the image instead. preview only draws it.",
    ],
};

pub(super) const TITLE: HelpOption = HelpOption {
    flag: "--title",
    value: Some("TEXT"),
    summary: "Collection title; default the studio name",
    details: &[],
};

pub(super) const CARD_NAME: HelpOption = HelpOption {
    flag: "--card-name",
    value: Some("TEXT"),
    summary: "Name on the cards, in Latin letters; invented if omitted",
    details: &[
        "Spaces, apostrophes and hyphens are allowed. Material sheets print it as the recipient.",
    ],
};

pub(super) const CARD_ROLE: HelpOption = HelpOption {
    flag: "--card-role",
    value: Some("TEXT"),
    summary: "Role on the cards; a role that suits the company if omitted",
    details: &[],
};

pub(super) const CARD_COMPANY: HelpOption = HelpOption {
    flag: "--card-company",
    value: Some("TEXT"),
    summary: "Employer printed on the business cards",
    details: &[],
};

pub(super) const CARD_EMAIL: HelpOption = HelpOption {
    flag: "--card-email",
    value: Some("TEXT"),
    summary: "Email; default contact@ at the invented company domain",
    details: &[],
};

pub(super) const CARD_PHONE: HelpOption = HelpOption {
    flag: "--card-phone",
    value: Some("TEXT"),
    summary: "Phone number, for designs with contact fields",
    details: &[],
};

pub(super) const CARD_WEBSITE: HelpOption = HelpOption {
    flag: "--card-website",
    value: Some("TEXT"),
    summary: "Website; default the invented company domain",
    details: &[],
};

pub(super) const CARD_LOCATION: HelpOption = HelpOption {
    flag: "--card-location",
    value: Some("TEXT"),
    summary: "Location; default International",
    details: &[],
};

pub(super) const STUDIO_NAME: HelpOption = HelpOption {
    flag: "--studio-name",
    value: Some("TEXT"),
    summary: "Design studio named on a collection sheet",
    details: &["Separate from the employer printed on the business cards."],
};

pub(super) const CARD_SLOGAN: HelpOption = HelpOption {
    flag: "--card-slogan",
    value: Some("TEXT"),
    summary: "Slogan on the sheet; - hides it",
    details: &[],
};

pub(super) const CARD_SUBTITLE: HelpOption = HelpOption {
    flag: "--card-subtitle",
    value: Some("TEXT"),
    summary: "Subtitle on the sheet; - hides it",
    details: &[],
};

pub(super) const CARD_FOOTER: HelpOption = HelpOption {
    flag: "--card-footer",
    value: Some("TEXT"),
    summary: "Footer on the sheet; - hides it",
    details: &[],
};

pub(super) const CARD_REFERENCE_LABEL: HelpOption = HelpOption {
    flag: "--card-reference-label",
    value: Some("TEXT"),
    summary: "Label before each printed code; default Ref.; - hides it",
    details: &[],
};

pub(super) const SSKR: HelpOption = HelpOption {
    flag: "--sskr",
    value: None,
    summary: "Split the result into Shamir shares (SSKR) as the last step",
    details: &[
        "The shares use the Blockchain Commons SSKR format. Fewer shares than --threshold cannot restore the phrase, but each share still shows the set identifier, the thresholds and the length of the phrase; keep every share private. A BIP39 passphrase, the mode and the dates are not stored in the shares. The legacy modes cannot be used with shares.",
        "The card options then print the shares as sskr-split does: each file or folder in --cards-dir holds one share, and --card-qr gives each collection sheet a QR code of its own share.",
    ],
};

pub(super) const THRESHOLD: HelpOption = HelpOption {
    flag: "--threshold",
    value: Some("N"),
    summary: "Shares needed to restore the phrase, at least 2",
    details: &[],
};

pub(super) const SHARES: HelpOption = HelpOption {
    flag: "--shares",
    value: Some("M"),
    summary: "Shares to make, N to 16",
    details: &[],
};

pub(super) const QR_DIR: HelpOption = HelpOption {
    flag: "--qr-dir",
    value: Some("NEW_FOLDER"),
    summary: "Save each complete share as a separate PNG QR image",
    details: &[
        "Works with every share format without cards. Files are share-1-qr.png, share-2-qr.png and so on; sskr-combine --share-qr reads them. The folder contains all shares: separate them for storage. A taken folder name is numbered, never replaced.",
    ],
};

pub(super) const SHARE_FORMAT: HelpOption = HelpOption {
    flag: "--share-format",
    value: Some("FORMAT"),
    summary: "How the shares are shown: ur, words, indexes, unicode, colors, colors-unicode",
    details: &[
        "ur (the default) is the standard short form, ur:sskr/...; words writes the same share in standard Bytewords, one English word per byte. Other SSKR programs read both. indexes, unicode, colors and colors-unicode write a share with the signs of --format 2, 3, 5 and 4, so that it looks like that form; sskr-combine then shows the restored backup in that form again. Only MnemoCode reads these. A saved text file holds the shares in the same form.",
    ],
};

pub(super) const CARD_LAYOUT: HelpOption = HelpOption {
    flag: "--card-layout",
    value: Some("qr|collection|individual"),
    summary: "How each share is printed; follows the page size if omitted",
    details: &[
        "qr: one document with a QR code per share, in any page size. collection: one sheet per share (a6, a5 or a4); --card-qr adds a QR code. individual: numbered business cards without a QR code. Every real card of one share is needed, in numbered order, to rebuild that share; its last card is a decoy and may be left out.",
        "Cards print shares written in colors or in Unicode codes, one code to a card, with a few decoys after them: a share in colors as its colors, a share in Unicode codes as its codes on cards whose colors only decorate them. Shares in word numbers, Bytewords or ur:sskr have no cards.",
    ],
};

pub(super) const INPUT_FILE: HelpOption = HelpOption {
    flag: "--input-file",
    value: Some("PATH"),
    summary: "Read the encoded record from a file; - reads standard input",
    details: &[
        "The file may be up to 64 KiB.",
        "Any of the five formats, with or without an MNC1 header. A file saved with encode --output names its mode and format, so only the dates are needed with it.",
    ],
};

pub(super) const QR_FILE: HelpOption = HelpOption {
    flag: "--qr-file",
    value: Some("PNG"),
    summary: "Read the encoded record from a QR code in a PNG image",
    details: &[
        "The image is read on this computer. It may be up to 16 MiB, 4096 pixels on a side and 2 megapixels, with up to 8 bits per sample. A QR code holds no header, so give --mode for a masked record; without it, --ask-secrets asks how it was masked.",
    ],
};

pub(super) const INPUT: HelpOption = HelpOption {
    flag: "--input",
    value: Some("TEXT"),
    summary: "Refused material argument; use --input-file, --qr-file or --ask-secrets",
    details: &[],
};

pub(super) const FORMAT_2: HelpOption = HelpOption {
    flag: "--format",
    value: Some("FORMAT"),
    summary: "The record format, 1 to 5 or its name; usually found automatically",
    details: &[
        "MnemoCode picks the format itself when exactly one fits the whole record. Otherwise it asks in the terminal, and a script must pass --format. See mnemocode help formats.",
    ],
};

pub(super) const WORDS: HelpOption = HelpOption {
    flag: "--words",
    value: Some("12|15|18|21|24"),
    summary: "The words of the seed phrase: read only the codes of so many words",
    details: &[
        "Printed cards end with a few random codes that belong to nothing. The sheet for heirs states the number of words; with it, only the codes of so many words from the start are read, and the cards after them may be typed or left out. In colors, 12 words are 8 codes and 24 words 16.",
    ],
};

pub(super) const MASTER_FINGERPRINT: HelpOption = HelpOption {
    flag: "--master-fingerprint",
    value: Some("HEX"),
    summary: "The BIP32 master fingerprint, eight hexadecimal digits",
    details: &[
        "The fingerprint of the wallet itself: with Seedshift, of the phrase before the shift, which encode shows as the original fingerprint, not the encoded one.",
        "It has only 32 bits, so it is a filter and not a proof.",
    ],
};

pub(super) const BITCOIN_ADDRESS: HelpOption = HelpOption {
    flag: "--bitcoin-address",
    value: Some("ADDRESS"),
    summary: "A Bitcoin address of the wallet, one of the --scan-gap from the selected place",
    details: &[],
};

pub(super) const COIN_ADDRESS: HelpOption = HelpOption {
    flag: "--coin-address",
    value: Some("ADDRESS"),
    summary: "An address of another coin, one of the --scan-gap from the place, with --coin",
    details: &[
        "Single-key receiving addresses of the coins of mhfe, on their standard paths: Bitcoin Cash, Cosmos, Dash (also Platform), Dogecoin, Ethereum and EVM networks, Ethereum Classic, Injective, Litecoin, Tron, XRP and Zcash (transparent). The address tells its type and network.",
    ],
};

pub(super) const COIN: HelpOption = HelpOption {
    flag: "--coin",
    value: Some("ID"),
    summary: "The coin of --coin-address, such as ethereum, litecoin or bitcoin-cash",
    details: &[],
};

pub(super) const MASTER_XPUB: HelpOption = HelpOption {
    flag: "--master-xpub",
    value: Some("XPUB"),
    summary: "The master extended public key",
    details: &[
        "Standard and SLIP-132 forms are accepted: xpub, ypub, zpub, Ypub, Zpub; on testnet tpub, upub, vpub, Upub, Vpub.",
    ],
};

pub(super) const ACCOUNT_XPUB: HelpOption = HelpOption {
    flag: "--account-xpub",
    value: Some("XPUB"),
    summary: "The extended public key of the selected account",
    details: &["The same forms as --master-xpub are accepted."],
};

pub(super) const COMPRESSED_PUBLIC_KEY: HelpOption = HelpOption {
    flag: "--compressed-public-key",
    value: Some("HEX"),
    summary: "A 33-byte compressed public key, one of the --scan-gap from the selected place",
    details: &[],
};

pub(super) const WIF_FILE: HelpOption = HelpOption {
    flag: "--wif-file",
    value: Some("PATH"),
    summary: "A private key in WIF form, read from a protected local file",
    details: &[
        "The file may be up to 64 bytes.",
        "A WIF can spend the funds. Never put it in a shell command or an issue report.",
    ],
};

pub(super) const BIP39_PASSPHRASE_FILE: HelpOption = HelpOption {
    flag: "--bip39-passphrase-file",
    value: Some("PATH"),
    summary: "The BIP39 passphrase of the wallet, if it has one; the file is secret",
    details: &["The file may be up to 4 KiB."],
};

pub(super) const NETWORK: HelpOption = HelpOption {
    flag: "--network",
    value: Some("mainnet|testnet"),
    summary: "Network of the address or key; default mainnet",
    details: &[],
};

pub(super) const BITCOIN_PROFILE: HelpOption = HelpOption {
    flag: "--bitcoin-profile",
    value: Some("NAME"),
    summary: "auto (default), or a comma-separated list of address types",
    details: &[
        "The types are legacy (BIP44), nested-segwit (BIP49), native-segwit (BIP84) and taproot (BIP86), such as native-segwit,taproot, each named once. auto tries all four at the selected place.",
    ],
};

pub(super) const ACCOUNT: HelpOption = HelpOption {
    flag: "--account",
    value: Some("N"),
    summary: "Account number; default 0",
    details: &[],
};

pub(super) const BRANCH: HelpOption = HelpOption {
    flag: "--branch",
    value: Some("N"),
    summary: "0 for receiving, 1 for change; default 0",
    details: &[],
};

pub(super) const INDEX: HelpOption = HelpOption {
    flag: "--index",
    value: Some("N"),
    summary: "The first address number compared; default 0",
    details: &[],
};

pub(super) const SCAN_GAP: HelpOption = HelpOption {
    flag: "--scan-gap",
    value: Some("N"),
    summary: "Scan N addresses from --index on; default 20",
    details: &[
        "For an address, a compressed public key or a WIF whose place is not known exactly: the first 20 are the addresses a wallet hands out before it waits for one of them to be used. Up to 1000; each one adds a derivation to every phrase a search tries. With --ask-secrets and no wallet option, it also sets how many addresses an address typed on the screen is compared with, and that number is then not asked.",
    ],
};

pub(super) const MAX_CANDIDATES: HelpOption = HelpOption {
    flag: "--max-candidates",
    value: Some("N"),
    summary: "Most combinations a search of dates tries without asking",
    details: &[
        "Without it, a search that takes up to 12 hours on this computer starts at once; a longer one is asked for on the private screen and needs this option elsewhere. The number of attempts, and the time with a wallet check, are shown before the search starts. Up to 2,147,483,648; every supported date is 3,652,059 attempts.",
    ],
};

pub(super) const CANDIDATES_FILE: HelpOption = HelpOption {
    flag: "--candidates-file",
    value: Some("NEW_FILE"),
    summary: "Save the candidates as a list: record N is candidate N",
    details: &[
        "The Discovery Scanner of the multi-chain wallet tools imports it and checks every candidate online. With a wallet check, recover-word saves every candidate and marks the matches on the screen; recover-date and sskr-combine save only the matching ones. A taken name is numbered, never replaced.",
    ],
};

pub(super) const CANDIDATES_KEY: HelpOption = HelpOption {
    flag: "--candidates-key",
    value: Some("AGE1_KEY"),
    summary: "Encrypt the list to the one-time key the Scanner shows, age1…",
    details: &[],
};

pub(super) const CANDIDATES_KEY_FILE: HelpOption = HelpOption {
    flag: "--candidates-key-file",
    value: Some("PATH"),
    summary: "The same key, read from a text file",
    details: &["The file may be up to 4 KiB."],
};

pub(super) const CANDIDATES_PASSPHRASE_FILE: HelpOption = HelpOption {
    flag: "--candidates-passphrase-file",
    value: Some("PATH"),
    summary: "Encrypt the list with a passphrase of 12 characters or more, read from a file",
    details: &[
        "The file may be up to 4 KiB.",
        "With --ask-secrets and no option that chooses how the list is protected, the passphrase is asked twice on the private screen.",
    ],
};

pub(super) const PLAINTEXT_CANDIDATES: HelpOption = HelpOption {
    flag: "--plaintext-candidates",
    value: None,
    summary: "Save the list without encryption; it then holds the seed phrases in the open",
    details: &[],
};

pub(super) const SHARE: HelpOption = HelpOption {
    flag: "--share",
    value: Some("TEXT"),
    summary: "Refused material argument; use --share-file, --share-qr or --ask-secrets",
    details: &[],
};

pub(super) const SHARE_FILE: HelpOption = HelpOption {
    flag: "--share-file",
    value: Some("PATH"),
    summary: "A file of shares, one per line or with ; between them; may be repeated",
    details: &[
        "Each file may be up to 64 KiB.",
        "Use - to read standard input once. ur:sskr/..., Bytewords, word numbers, Unicode codes, colors or colors as Unicode codes are detected automatically; ? marks an unreadable element.",
    ],
};

pub(super) const SHARE_QR: HelpOption = HelpOption {
    flag: "--share-qr",
    value: Some("PNG"),
    summary: "A QR code of one share in a PNG image; may be repeated",
    details: &["A PDF cannot be read; save the QR code as a PNG image first."],
};

pub(super) const ASK_SECRETS_2: HelpOption = HelpOption {
    flag: "--ask-secrets",
    value: None,
    summary: "Type the shares on the private screen, separated by ;",
    details: &[
        "The secrets are typed on the terminal's alternate screen, a private screen that shows what you type and then the result. When you press Enter after the result, it is cleared and the terminal returns to where it was, so that no secret stays in the scrollback: only a summary stays, of what was saved and where and of the warnings. This works on Linux, macOS and Windows alike.",
        "Each answer is checked as soon as it is given: one that cannot be used is explained in one line and asked again, and the answers before it are kept. While a secret is typed, Escape cancels the action and returns to the menu when started there; at a visible value, such as a fingerprint, an address or a file name, it goes back to the question before and drops what was typed there; in a list of choices it does what the key hint says. Ctrl+C stops the command.",
        "Standard input and standard error must be the terminal; without them, or in a terminal that says TERM=dumb, the command stops at once. Output sent to a file goes there as before.",
        "Raw phrase, record, share, date and final-word arguments are refused, including public fixtures. Use the private screen or the corresponding file/stdin option.",
    ],
};

pub(super) const MAX_TRIES: HelpOption = HelpOption {
    flag: "--max-tries",
    value: Some("N"),
    summary: "Combinations a share repair may try without asking",
    details: &[
        "Without it, a search that takes up to 12 hours on this computer starts at once. The number a repair needs, and its time, are shown before it starts; on the private screen a longer search is asked for instead.",
    ],
};

pub(super) const CARDS_DIR_2: HelpOption = HelpOption {
    flag: "--cards-dir",
    value: Some("NEW_FOLDER"),
    summary: "Save each share as its own file or folder in a new folder",
    details: &[
        "Each file or folder holds one share: keep them in different places. A taken name is numbered, never replaced.",
    ],
};

pub(super) const IMAGE_FORMAT_2: HelpOption = HelpOption {
    flag: "--image-format",
    value: Some("png|jpg"),
    summary: "Image format for page images and separate cards when requested",
    details: &[
        "--images-dir defaults to PNG. --cards-dir defaults to PDF: one file per share sheet, or, with --card-layout individual, one per card in the folder of each share; --image-format selects images instead. jpeg is accepted for jpg. PNG keeps text and QR codes sharp; JPEG uses quality 90. The rounded corners of a separate card are transparent in PNG and white in JPEG.",
    ],
};

pub(super) const CARD_QR_2: HelpOption = HelpOption {
    flag: "--card-qr",
    value: None,
    summary: "Add a QR code of its own share to each collection sheet",
    details: &[
        "Each QR code holds only its own share: word numbers, Unicode codes or colors, according to the chosen form.",
    ],
};

pub(super) const RUN_1: &[&HelpOption] = &[
    &MASTER_FINGERPRINT,
    &BITCOIN_ADDRESS,
    &COIN_ADDRESS,
    &COIN,
    &MASTER_XPUB,
    &ACCOUNT_XPUB,
    &COMPRESSED_PUBLIC_KEY,
    &WIF_FILE,
    &BIP39_PASSPHRASE_FILE,
    &NETWORK,
    &BITCOIN_PROFILE,
    &ACCOUNT,
    &BRANCH,
    &INDEX,
    &SCAN_GAP,
];

pub(super) const RUN_2: &[&HelpOption] = &[
    &CARD_NAME,
    &CARD_ROLE,
    &CARD_COMPANY,
    &CARD_EMAIL,
    &CARD_PHONE,
    &CARD_WEBSITE,
    &CARD_LOCATION,
    &STUDIO_NAME,
    &CARD_SLOGAN,
    &CARD_SUBTITLE,
    &CARD_FOOTER,
    &CARD_REFERENCE_LABEL,
];

pub(super) const RUN_3: &[&HelpOption] = &[
    &TEMPLATE,
    &PDF,
    &CARDS_DIR,
    &IMAGES_DIR,
    &IMAGE_FORMAT,
    &PAGE_SIZE,
    &ORIENTATION,
    &CARD_QR,
    &TITLE,
];

pub(super) const RUN_4: &[&HelpOption] = &[
    &OUTPUT,
    &CARDS,
    &QR,
    &HEIR_SHEET,
    &HEIR_SHEET_SIZE,
    &BACKUP_CHECK,
    &SHOW_MASKED_WORDS,
    &SHOW_ORIGINAL,
];

pub(super) const RUN_5: &[&HelpOption] = &[
    &SSKR,
    &THRESHOLD,
    &SHARES,
    &QR_DIR,
    &SHARE_FORMAT,
    &CARD_LAYOUT,
];

pub(super) const RUN_6: &[&HelpOption] =
    &[&MODE, &DATES, &DATES_FILE, &FORMAT, &LEGACY_VALID_LAST_WORD];

pub(super) const RUN_7: &[&HelpOption] = &[
    &CANDIDATES_FILE,
    &CANDIDATES_KEY,
    &CANDIDATES_KEY_FILE,
    &CANDIDATES_PASSPHRASE_FILE,
    &PLAINTEXT_CANDIDATES,
];

pub(super) const RUN_8: &[&HelpOption] = &[&ASK_SECRETS, &INPUT_FILE, &QR_FILE, &INPUT];

pub(super) const RUN_9: &[&HelpOption] = &[&SHARE, &SHARE_FILE, &SHARE_QR, &ASK_SECRETS_2];

/// A group of the pages that make a backup.
pub(super) const RESULT_GROUP: HelpGroup = HelpGroup {
    heading: "Where the result goes (it always appears in the terminal):",
    options: &[RUN_4],
};

/// A group of the pages that make a backup.
pub(super) const CARDS_GROUP: HelpGroup = HelpGroup {
    heading: "Cards (formats 3, 4 or 5):",
    options: &[RUN_3],
};

/// A group of the pages that make a backup.
pub(super) const DETAILS_GROUP: HelpGroup = HelpGroup {
    heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
    options: &[RUN_2],
};

/// A group of the pages that make a backup.
pub(super) const SHARES_GROUP: HelpGroup = HelpGroup {
    heading: "Shamir shares (see mnemocode help sskr-combine to restore):",
    options: &[RUN_5],
};
