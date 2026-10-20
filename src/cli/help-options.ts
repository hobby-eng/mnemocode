// The options of the help pages, which several commands share, and the values that their texts
// name. help-pages.ts and help-share-pages.ts put them on the pages of the commands.

import { HARD_MAX_COMBINATIONS } from "../core/date-search.js";
import {
  MAX_ADDRESS_COUNT,
  BITCOIN_NETWORKS,
  COMPRESSED_KEY_BYTES,
  extendedPublicKeyPrefixes,
  bitcoinProfilePurpose,
  bitcoinProfiles,
} from "../core/wallet-evidence.js";
import { MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import { limitName } from "../core/byte-units.js";
import {
  MAX_PNG_BYTES,
  MAX_PNG_DIMENSION,
  MAX_PNG_PIXELS,
  MAX_PNG_SAMPLE_BITS,
  MEGAPIXEL,
} from "../core/png-admission.js";
import { ENCODED_FORMATS, type EncodedFormat, MASKING_MODES } from "../core/types.js";
import {
  COLOR_FORMAT_NUMBERS,
  formatLegend,
  formatNumber,
  CARD_FORMAT_NUMBERS,
  FORMAT_NUMBER_RANGE,
} from "./format-numbers.js";
import { WORD_NUMBERS, BIP39_WORD_COUNTS, WORD_COUNTS_TEXT } from "../core/bip39-sizes.js";
import { listInWords } from "../core/places.js";
import { zeroEntropyPhrase } from "../core/english-words.js";
import {
  maximumDates,
  datePatternCandidateCount,
  parseDatePattern,
  WHOLE_DATE,
} from "../core/dates.js";
import { IMAGE_FORMATS, IMAGE_DPI, JPEG_QUALITY } from "../export/document-formats.js";
import { CARD_PAGE_SIZES, CARD_ORIENTATIONS, pageSizeLabel } from "../export/card-settings.js";
import { SSKR_CARD_LAYOUTS } from "../export/sskr-content.js";
import { counting } from "../core/search-plan.js";
import { Masking } from "../core/masking.js";
import { QUESTION_HOURS } from "../core/search-turns.js";
import { numberWord } from "../core/prose.js";
import { MIN_THRESHOLD, MAX_SHARES } from "../sskr/split.js";
import { DEFAULT_ADDRESS_COUNT } from "../core/address-scan.js";
import { MIN_LIST_PASSPHRASE_LENGTH } from "../core/candidate-encryption.js";
import { COLOR_COUNTS_TEXT, RGB_REFERENCE_COUNTS } from "../core/colors.js";
import { SHARE_SEPARATOR } from "../sskr/share-input.js";
import {
  heirSheetSizeLabel,
  HEIR_SHEET_SIZES,
  DEFAULT_HEIR_SHEET_SIZE,
} from "../export/heir-sheet.js";
import { defined } from "../core/defined.js";
import { ORIGINAL_COPY_FORMS } from "./encode-report.js";
import { type HelpGroup, type HelpOption, type HelpRow } from "./help-types.js";

/** The dates of a lone ?, every supported date: the attempts of one such date. */
const EVERY_DATE_COMBINATIONS = datePatternCandidateCount(parseDatePattern(WHOLE_DATE));

/** The candidates of a seedshift-legacy-valid record of `words` words: its every last word. */
export function legacyValidCandidates(words: number): number {
  return Masking.of("seedshift-legacy-valid").checksPerCombination(words);
}

/** The modes that encode writes, and those that mask with dates, from the modes' own rules. */
const ENCODE_MODES = MASKING_MODES.filter((mode) => Masking.of(mode).encodable);
export const MASKED_MODES = MASKING_MODES.filter((mode) => Masking.of(mode).masked);

/** The width of a column of the table of candidates. */
export const TABLE_COLUMN = 5;
/** Each form as the line of --format names it, after its number. */
const FORMAT_LEGEND_NAMES: Readonly<Record<EncodedFormat, string>> = {
  english: "english words",
  indexes: "indexes",
  unicode: "unicode codes",
  "colors-unicode": "colors-unicode",
  colors: "colors",
};

/** What each form is, in the topic of the formats. */
export const FORMAT_DESCRIPTIONS: Readonly<Record<EncodedFormat, string>> = {
  english: "English BIP39 words",
  indexes: `The numbers of the words in the BIP39 list, ${WORD_NUMBERS}, as in Seedshift`,
  unicode:
    "Four-digit Unicode codes of the words of the Traditional Chinese BIP39 list; only the codes are written, spaced or joined",
  "colors-unicode": `The color codes of format ${formatNumber("colors")}, each written as two four-digit Private Use codes; all five lengths; plain text that needs no special font`,
  colors: `Color codes such as #01AB63: ${COLOR_COUNTS_TEXT} codes for ${BIP39_WORD_COUNTS[0]} to ${defined(BIP39_WORD_COUNTS.at(-1))} words, BIP39Colors-compatible for 12 and 24 words; MnemoCode also supports 15, 18 and 21. Separated or joined, in any order, but every code is needed`,
};

/** The public BIP39 test phrase of the examples, set once above them as a shell variable. */
export const TEST_PHRASE = zeroEntropyPhrase(BIP39_WORD_COUNTS[0]);
export const TEST_PHRASE_VARIABLE = '"$TEST_PHRASE"';
/** The BIP32 master fingerprint of TEST_PHRASE with an empty passphrase. */
export const TEST_FINGERPRINT = "73c5da0a";

// Options that several commands share.

export const askSecrets: HelpOption = {
  flag: "--ask-secrets",
  summary: "Ask for the secrets on a private screen",
  details: [
    "The secrets are typed on the terminal's alternate screen, a private screen that shows what you type and then the result. When you press Enter after the result, it is cleared and the terminal returns to where it was, so that nothing stays in the scrollback. This works on Linux, macOS and Windows alike.",
    "Each answer is checked as soon as it is given: one that cannot be used is explained in one line and asked again, and the answers before it are kept. While a secret is typed, Escape does nothing, so that a slip loses nothing; at a visible value, such as a fingerprint, an address or a file name, it goes back to the question before and drops what was typed there; in a list of choices it does what the key hint says. Ctrl+C stops the command.",
    "Standard input must be the terminal; without one, or in a terminal that says TERM=dumb, the command stops at once. Output sent to a file goes there as before.",
    "Raw phrase, record, share, date and final-word arguments are refused, including public fixtures. Use the private screen or the corresponding file/stdin option.",
  ],
};

export const mnemonicText: HelpOption = {
  flag: "--mnemonic",
  value: "TEXT",
  summary: "Refused material argument; use --mnemonic-file or --ask-secrets",
};

export const mnemonicFile: HelpOption = {
  flag: "--mnemonic-file",
  value: "PATH",
  summary: "Read the phrase from a file; - reads standard input",
  details: [`Text input may be up to ${limitName(MAX_TEXT_INPUT_BYTES)}.`],
};

export const dates: HelpOption = {
  flag: "--dates",
  value: "DATE ...",
  summary: "Refused material argument; use --dates-file or --ask-secrets",
};

export const datesFile: HelpOption = {
  flag: "--dates-file",
  value: "PATH",
  summary: "Read dates from a local UTF-8 file; - reads standard input",
  details: [
    "Dates are separated by whitespace. recover-date also accepts date patterns in this file. Do not combine it with --ask-secrets, which asks for the dates itself.",
    "YYYY-MM-DD is also accepted. The order does not matter: the dates are sorted, oldest first. A year always has four digits, 0001 to 9999, so the year 26 is written 0026.",
    `DD-MM-YYYY, up to one date for every three words: ${listInWords(BIP39_WORD_COUNTS.map(maximumDates), "or")} dates for ${WORD_COUNTS_TEXT} words. Dates are not written into the encoded record; protect and keep the date file yourself.`,
    "Only one material file option may read standard input in one command; use local files for the other sources.",
  ],
};

/** Re-encode's original final word: the raw form is recognized only to explain its refusal. */
export const lastWordInputs: readonly HelpOption[] = [
  {
    flag: "--last-word",
    value: "WORD",
    summary: "Refused material argument; use --last-word-file or --ask-secrets",
  },
  {
    flag: "--last-word-file",
    value: "PATH",
    summary: "Read the original final word for seedshift-legacy-valid from a file or -",
    details: [
      "The backup gives a phrase for each possible last word; the original one picks it. Not with --ask-secrets, which asks for that word privately.",
    ],
  },
];

export const encodedText: HelpOption = {
  flag: "--input",
  value: "TEXT",
  summary: "Refused material argument; use --input-file, --qr-file or --ask-secrets",
};

export const encodedFile: HelpOption = {
  flag: "--input-file",
  value: "PATH",
  summary: "Read the encoded record from a file; - reads standard input",
  details: [
    `Any of the ${numberWord(ENCODED_FORMATS.length)} formats, with or without an MNC1 header. A file saved with encode --output names its mode and format, so only the dates are needed with it.`,
  ],
};

/** The QR input of a record whose mode the option `modeFlag` gives (--old-mode in re-encode). */
export function encodedQrOf(modeFlag: string): HelpOption {
  return {
    flag: "--qr-file",
    value: "PNG",
    summary: "Read the encoded record from a QR code in a PNG image",
    details: [
      `The image is read on this computer. It may be up to ${limitName(MAX_PNG_BYTES)}, ${MAX_PNG_DIMENSION} pixels on a side and ${MAX_PNG_PIXELS / MEGAPIXEL} megapixels, with up to ${MAX_PNG_SAMPLE_BITS} bits per sample. A QR code holds no header, so give ${modeFlag} for a masked record; without it, --ask-secrets asks how it was masked.`,
    ],
  };
}
export const encodedQr = encodedQrOf("--mode");

export const decodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: listInWords(MASKING_MODES, "or"),
  details: [
    "Needed for typed text, terminal output and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A file saved with --output names its mode; a --mode that contradicts it stops the command, and with --ask-secrets MnemoCode offers to read the record as it says or to give it again. See mnemocode help modes.",
  ],
};

/** The format of a record, given by the option `flag` (--old-format in re-encode). */
export function recordFormatOf(flag: string, summary: string): HelpOption {
  return {
    flag,
    value: "FORMAT",
    summary,
    details: [
      `MnemoCode picks the format itself when exactly one fits the whole record. Otherwise it asks in the terminal, and a script must pass ${flag}. See mnemocode help formats.`,
    ],
  };
}
export const decodeFormat = recordFormatOf(
  "--format",
  `The record format, ${FORMAT_NUMBER_RANGE} or its name; usually found automatically`,
);

export const phraseWords: HelpOption = {
  flag: "--words",
  value: BIP39_WORD_COUNTS.join("|"),
  summary: "The words of the seed phrase: read only the codes of so many words",
  details: [
    `Printed cards end with a few random codes that belong to nothing. The sheet for heirs states the number of words; with it, only the codes of so many words from the start are read, and the cards after them may be typed or left out. In colors, ${BIP39_WORD_COUNTS[0]} words are ${RGB_REFERENCE_COUNTS[0]} codes and ${defined(BIP39_WORD_COUNTS.at(-1))} words ${defined(RGB_REFERENCE_COUNTS.at(-1))}.`,
  ],
};

export const maxCandidates: HelpOption = {
  flag: "--max-candidates",
  value: "N",
  summary: "Most combinations a search of dates tries without asking",
  details: [
    `Without it, a search that takes up to ${QUESTION_HOURS} hours on this computer starts at once; a longer one is asked for on the private screen and needs this option elsewhere. The number of attempts, and the time with a wallet check, are shown before the search starts. Up to ${counting(HARD_MAX_COMBINATIONS)}; every supported date is ${counting(EVERY_DATE_COMBINATIONS)} attempts.`,
  ],
};

export const backupCheck: HelpOption = {
  flag: "--backup-check",
  value: "yes|no",
  summary: "Answer whether to check the written-down backup on the private screen",
  details: [
    "After the result, --ask-secrets offers to type the backup again from what you wrote down, with the dates, and says whether it restores the same phrase. yes starts that check at once; no leaves it out. Without the option it is asked.",
  ],
};

export const legacyValidLastWord: HelpOption = {
  flag: "--legacy-valid-last-word",
  summary: "In seedshift-legacy mode, end with a last word that passes the checksum",
};

export const template: HelpOption = {
  flag: "--template",
  value: "ID",
  summary: "The card design, by name or number; mnemocode preview --list lists them",
};

export const title: HelpOption = {
  flag: "--title",
  value: "TEXT",
  summary: "Collection title; default the studio name",
};
export const pdf: HelpOption = {
  flag: "--pdf",
  value: "PATH",
  summary: "Save the cards as one PDF",
  details: ["The file is written into a folder that already exists."],
};

export const cardsDir: HelpOption = {
  flag: "--cards-dir",
  value: "NEW_FOLDER",
  summary: "Save one file per card in a new folder",
  details: [
    "Files are named after their number and the code they print, such as 01-ABCDEF.pdf, or 01-7684.pdf in Unicode codes; each holds only its own code. Use it with --page-size business or without a page size. The folder must not exist yet: it is created only when every card is ready.",
  ],
};

export const imagesDir: HelpOption = {
  flag: "--images-dir",
  value: "NEW_FOLDER",
  summary: "Save the pages as images in a new folder",
  details: [
    `Needs the Poppler program pdftocairo; PDF files do not. Pages are drawn at ${IMAGE_DPI} dpi. If pdftocairo is missing, MnemoCode says so before it asks for a secret.`,
  ],
};

export const imageFormat: HelpOption = {
  flag: "--image-format",
  value: IMAGE_FORMATS.join("|"),
  summary: "Image format for page images and separate cards when requested",
  details: [
    `--images-dir defaults to PNG. --cards-dir defaults to one PDF per card; --image-format selects images instead. jpeg is accepted for jpg. PNG keeps text and QR codes sharp; JPEG uses quality ${JPEG_QUALITY}. The rounded corners of a separate card are transparent in PNG and white in JPEG.`,
  ],
};

export const pageSize: HelpOption = {
  flag: "--page-size",
  value: CARD_PAGE_SIZES.join("|"),
  summary: "a6 (default), a5 or a4 for one sheet, business for separate cards",
  details: [
    `a6 is ${pageSizeLabel("a6")}, a5 ${pageSizeLabel("a5")} and a4 ${pageSizeLabel("a4")}: the whole collection on one sheet, scaled to the page, a design proposal that cannot be cut into cards. business gives real ${pageSizeLabel("business")} cards, numbered, one per page or file. Print at 100% / actual size.`,
  ],
};

export const orientation: HelpOption = {
  flag: "--orientation",
  value: CARD_ORIENTATIONS.join("|"),
  summary: "Page orientation; works with every page size",
};

export const cardQr: HelpOption = {
  flag: "--card-qr",
  summary: "Add one QR code with the whole encoded phrase to a collection sheet",
  details: [
    "Off by default. The QR code holds only the encoded data in the selected format: no header, mode, dates, names or fingerprints. Separate cards never carry a QR code.",
    "encode and the commands of shares also save the QR code as a PNG image where the sheets go: beside the PDF (cards.pdf gives cards-qr.png), or in their folder; one image per share for Shamir shares. Decode reads it back with --qr-file, Restore with --share-qr. With encode alone, --qr names the image instead. preview only draws it.",
  ],
};

const identityOptions: readonly HelpOption[] = [
  {
    flag: "--card-name",
    value: "TEXT",
    summary: "Name on the cards, in Latin letters; invented if omitted",
    details: [
      "Spaces, apostrophes and hyphens are allowed. Material sheets print it as the recipient.",
    ],
  },
  {
    flag: "--card-role",
    value: "TEXT",
    summary: "Role on the cards; a role that suits the company if omitted",
  },
  {
    flag: "--card-company",
    value: "TEXT",
    summary: "Employer printed on the business cards",
  },
  {
    flag: "--card-email",
    value: "TEXT",
    summary: "Email; default contact@ at the invented company domain",
  },
  {
    flag: "--card-phone",
    value: "TEXT",
    summary: "Phone number, for designs with contact fields",
  },
  {
    flag: "--card-website",
    value: "TEXT",
    summary: "Website; default the invented company domain",
  },
  {
    flag: "--card-location",
    value: "TEXT",
    summary: "Location; default International",
  },
  {
    flag: "--studio-name",
    value: "TEXT",
    summary: "Design studio named on a collection sheet",
    details: ["Separate from the employer printed on the business cards."],
  },
  { flag: "--card-slogan", value: "TEXT", summary: "Slogan on the sheet; - hides it" },
  { flag: "--card-subtitle", value: "TEXT", summary: "Subtitle on the sheet; - hides it" },
  { flag: "--card-footer", value: "TEXT", summary: "Footer on the sheet; - hides it" },
  {
    flag: "--card-reference-label",
    value: "TEXT",
    summary: "Label before each printed code; default Ref.; - hides it",
  },
];

export const identityGroup: HelpGroup = {
  heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
  options: identityOptions,
};

export const cardLayout: HelpOption = {
  flag: "--card-layout",
  value: SSKR_CARD_LAYOUTS.join("|"),
  summary: "How each share is printed; follows the page size if omitted",
  details: [
    "qr: one document with a QR code per share, in any page size. collection: one sheet per share (a6, a5 or a4); --card-qr adds a QR code. individual: numbered business cards without a QR code; every card of a share is needed to rebuild that share.",
    "Cards print shares written in colors or in Unicode codes, one code to a card, with a few decoys after them: a share in colors as its colors, a share in Unicode codes as its codes on cards whose colors only decorate them. Shares in word numbers, Bytewords or ur:sskr have no cards.",
  ],
};

export const threshold: HelpOption = {
  flag: "--threshold",
  value: "N",
  summary: `Shares needed to restore the phrase, at least ${MIN_THRESHOLD}`,
};

export const shares: HelpOption = {
  flag: "--shares",
  value: "M",
  summary: `Shares to make, N to ${MAX_SHARES}`,
};

export const evidenceGroup: HelpGroup = {
  heading: "Recovery checks (one of them finds the wallet among the candidates):",
  options: [
    {
      flag: "--master-fingerprint",
      value: "HEX",
      summary: "The BIP32 master fingerprint, eight hexadecimal digits",
      details: [
        "The fingerprint of the wallet itself: with Seedshift, of the phrase before the shift, which encode shows as the original fingerprint, not the encoded one.",
        "It has only 32 bits, so it is a filter and not a proof.",
      ],
    },
    {
      flag: "--bitcoin-address",
      value: "ADDRESS",
      summary: "A Bitcoin address of the wallet, one of the --scan-gap from the selected place",
    },
    {
      flag: "--coin-address",
      value: "ADDRESS",
      summary: "An address of another coin, one of the --scan-gap from the place, with --coin",
      details: [
        "Single-key receiving addresses of the coins of mhfe, on their standard paths: Bitcoin Cash, Cosmos, Dash (also Platform), Dogecoin, Ethereum and EVM networks, Ethereum Classic, Injective, Litecoin, Tron, XRP and Zcash (transparent). The address tells its type and network.",
      ],
    },
    {
      flag: "--coin",
      value: "ID",
      summary: "The coin of --coin-address, such as ethereum, litecoin or bitcoin-cash",
    },
    {
      flag: "--master-xpub",
      value: "XPUB",
      summary: "The master extended public key",
      details: [
        `Standard and SLIP-132 forms are accepted: ${extendedPublicKeyPrefixes("mainnet").join(", ")}; on testnet ${extendedPublicKeyPrefixes("testnet").join(", ")}.`,
      ],
    },
    {
      flag: "--account-xpub",
      value: "XPUB",
      summary: "The extended public key of the selected account",
      details: ["The same forms as --master-xpub are accepted."],
    },
    {
      flag: "--compressed-public-key",
      value: "HEX",
      summary: `A ${COMPRESSED_KEY_BYTES}-byte compressed public key, one of the --scan-gap from the selected place`,
    },
    {
      flag: "--wif-file",
      value: "PATH",
      summary: "A private key in WIF form, read from a protected local file",
      details: ["A WIF can spend the funds. Never put it in a shell command or an issue report."],
    },
    {
      flag: "--bip39-passphrase-file",
      value: "PATH",
      summary: "The BIP39 passphrase of the wallet, if it has one; the file is secret",
    },
    {
      flag: "--network",
      value: BITCOIN_NETWORKS.join("|"),
      summary: "Network of the address or key; default mainnet",
    },
    {
      flag: "--bitcoin-profile",
      value: "NAME",
      summary: "auto (default), or a comma-separated list of address types",
      details: [
        `The types are ${listInWords(bitcoinProfiles.map((profile) => `${profile} (BIP${bitcoinProfilePurpose(profile)})`))}, such as native-segwit,taproot. auto tries all ${numberWord(bitcoinProfiles.length)} at the selected place.`,
      ],
    },
    { flag: "--account", value: "N", summary: "Account number; default 0" },
    { flag: "--branch", value: "N", summary: "0 for receiving, 1 for change; default 0" },
    { flag: "--index", value: "N", summary: "The first address number compared; default 0" },
    {
      flag: "--scan-gap",
      value: "N",
      summary: `Scan N addresses from --index on; default ${DEFAULT_ADDRESS_COUNT}`,
      details: [
        `For an address, a compressed public key or a WIF whose place is not known exactly: the first 20 are the addresses a wallet hands out before it waits for one of them to be used. Up to ${MAX_ADDRESS_COUNT}; each one adds a derivation to every phrase a search tries. With --ask-secrets and no wallet option, it also sets how many addresses an address typed on the screen is compared with, and that number is then not asked.`,
      ],
    },
  ],
};

export const maxTries: HelpOption = {
  flag: "--max-tries",
  value: "N",
  summary: "Combinations a share repair may try without asking",
  details: [
    `Without it, a search that takes up to ${QUESTION_HOURS} hours on this computer starts at once. The number a repair needs, and its time, are shown before it starts; on the private screen a longer search is asked for instead.`,
  ],
};

/**
 * The question for a candidate list's passphrase, as each recovery command's help lists it. The
 * rule of when it is asked is protectionOf's (candidates-file.ts): only when no option chose the
 * list's protection, a key, a passphrase file or none.
 */
export const LIST_PASSPHRASE_ASK: HelpRow = [
  "List passphrase",
  "twice, for a candidate list, unless an option chooses how the list is protected",
];

export const candidateListGroup: HelpGroup = {
  heading: "Candidate list for the Discovery Scanner (docs/CANDIDATES.md):",
  options: [
    {
      flag: "--candidates-file",
      value: "NEW_FILE",
      summary: "Save the candidates as a list: record N is candidate N",
      details: [
        "The Discovery Scanner of the multi-chain wallet tools imports it and checks every candidate online. With a wallet check, recover-word saves every candidate and marks the matches on the screen; recover-date and sskr-combine save only the matching ones. A taken name is numbered, never replaced.",
      ],
    },
    {
      flag: "--candidates-key",
      value: "AGE1_KEY",
      summary: "Encrypt the list to the one-time key the Scanner shows, age1…",
    },
    {
      flag: "--candidates-key-file",
      value: "PATH",
      summary: "The same key, read from a text file",
    },
    {
      flag: "--candidates-passphrase-file",
      value: "PATH",
      summary: `Encrypt the list with a passphrase of ${MIN_LIST_PASSPHRASE_LENGTH} characters or more, read from a file`,
      details: [
        "With --ask-secrets and no option that chooses how the list is protected, the passphrase is asked twice on the private screen.",
      ],
    },
    {
      flag: "--plaintext-candidates",
      summary: "Save the list without encryption; it then holds the seed phrases in the open",
    },
  ],
};

export const shareWalletCheck: HelpGroup = {
  ...evidenceGroup,
  heading: "Wallet check (one of them keeps only the matching phrases):",
};

export const shareInputs: readonly HelpOption[] = [
  {
    flag: "--share",
    value: "TEXT",
    summary: "Refused material argument; use --share-file, --share-qr or --ask-secrets",
  },
  {
    flag: "--share-file",
    value: "PATH",
    summary: `A file of shares, one per line or with ${SHARE_SEPARATOR} between them; may be repeated`,
    details: [
      "Use - to read standard input once. ur:sskr/..., Bytewords, word numbers, Unicode codes, colors or colors as Unicode codes are detected automatically; ? marks an unreadable element.",
    ],
  },
  {
    flag: "--share-qr",
    value: "PNG",
    summary: "A QR code of one share in a PNG image; may be repeated",
    details: ["A PDF cannot be read; save the QR code as a PNG image first."],
  },
  {
    ...askSecrets,
    summary: `Type the shares on the private screen, separated by ${SHARE_SEPARATOR}`,
  },
];

export const heirSheet: HelpOption = {
  flag: "--heir-sheet",
  value: "PATH",
  summary: "Also save one sheet that tells heirs how to restore the backup",
  details: [
    "A PDF of one sheet to print on both sides. The front says what the backup looks like, how many shares restore it and how many dates it needs, and leaves the rest of its room for a hint written by hand; the back gives the steps in the menu and the basics for someone new to wallets. It holds no secret: no codes, no dates, no fingerprint and no places. Not with --legacy-valid-last-word. See Instructions for heirs in the README.",
  ],
};

export const heirSheetSize: HelpOption = {
  flag: "--heir-sheet-size",
  value: HEIR_SHEET_SIZES.join("|"),
  summary: `The size of that sheet; default ${DEFAULT_HEIR_SHEET_SIZE}`,
  details: [
    `a5 is the size of a notebook, ${heirSheetSizeLabel("a5")}, with larger print; a6 is the size of a postcard and of the cards, ${heirSheetSizeLabel("a6")}, with small print.`,
  ],
};

// The options of Encode's new backup, which re-encode takes too.

export const encodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: `${listInWords(ENCODE_MODES, "or")}; see mnemocode help modes`,
  details: [
    "Without --mode, MnemoCode uses seedshift when --dates-file is given and direct otherwise.",
  ],
};

export const encodeFormat: HelpOption = {
  flag: "--format",
  value: "FORMAT",
  summary: `The form of the result, ${FORMAT_NUMBER_RANGE} or its name; default ${formatNumber("english")} (english)`,
  details: [
    `${formatLegend(FORMAT_LEGEND_NAMES)}. Cards need ${CARD_FORMAT_NUMBERS}. See mnemocode help formats. With --sskr, --format alone shows the complete encoded backup beside the shares; --show-original instead shows the original wallet phrase in the requested forms.`,
  ],
};

export const encodeLegacyValidLastWord: HelpOption = {
  ...legacyValidLastWord,
  details: [
    "A legacy result usually fails the BIP39 checksum. With this option only the checksum bits of the last word are calculated again, as with the same option of the original Seedshift; the record becomes seedshift-legacy-valid. Its decoding lists every possible last word.",
  ],
};

/** Where Encode's result goes, its cards and its shares: re-encode's new backup too. */
export const encodeOutputGroups: readonly HelpGroup[] = [
  {
    heading: "Where the result goes (it always appears in the terminal):",
    options: [
      {
        flag: "--output",
        value: "PATH",
        summary: "Also save a versioned MNC1 record file",
        details: [
          "The record starts with MNC1:<mode>:<format>:, so decode needs only the file and the dates. Dates are never stored. A taken name is numbered, as record-1.txt, never replaced.",
        ],
      },
      {
        flag: "--cards",
        summary: `Show the color codes as colored cards in the terminal (formats ${COLOR_FORMAT_NUMBERS})`,
      },
      {
        flag: "--qr",
        value: "PATH",
        summary: "Save the result as a QR code in a PNG file",
        details: [
          "The QR code holds only the encoded data in the selected format: no header, mode, dates or fingerprints. decode --qr-file reads it back.",
        ],
      },
      heirSheet,
      heirSheetSize,
      backupCheck,
      {
        flag: "--show-masked-words",
        summary: "Also show the English words after Seedshift, beside the codes or shares",
        details: [
          "The original dates are still needed. In the english format the same words are already shown once.",
        ],
      },
    ],
  },
  {
    heading: `Cards (formats ${CARD_FORMAT_NUMBERS}):`,
    options: [
      template,
      pdf,
      cardsDir,
      imagesDir,
      imageFormat,
      pageSize,
      orientation,
      cardQr,
      title,
    ],
  },
  identityGroup,
  {
    heading: "Shamir shares (see mnemocode help sskr-combine to restore):",
    options: [
      {
        flag: "--sskr",
        summary: "Split the result into Shamir shares (SSKR) as the last step",
        details: [
          "The shares use the Blockchain Commons SSKR format. Fewer shares than --threshold cannot restore the phrase, but each share still shows the set identifier, the thresholds and the length of the phrase; keep every share private. A BIP39 passphrase, the mode and the dates are not stored in the shares. The legacy modes cannot be used with shares.",
        ],
      },
      threshold,
      shares,
      {
        flag: "--show-original",
        value: ORIGINAL_COPY_FORMS.join("|"),
        summary: "Also show the original seed phrase before Seedshift; --sskr only",
        details: [
          "words shows English words; codes uses --format; both shows both. This copy needs no shares or dates. It is shown only, never added to exported share files.",
        ],
      },
      {
        flag: "--share-format",
        value: "FORMAT",
        summary: "How the shares are shown: ur, words, indexes, unicode, colors, colors-unicode",
        details: [
          `ur (the default) is the standard short form, ur:sskr/...; words writes the same share in standard Bytewords, one English word per byte. Other SSKR programs read both. indexes, unicode, colors and colors-unicode write a share with the signs of --format ${formatNumber("indexes")}, ${formatNumber("unicode")}, ${formatNumber("colors")} and ${formatNumber("colors-unicode")}, so that it looks like that form; sskr-combine then shows the restored backup in that form again. Only MnemoCode reads these. A saved text file holds the shares in the same form.`,
        ],
      },
      cardLayout,
    ],
  },
];
