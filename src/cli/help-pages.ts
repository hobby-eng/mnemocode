// The text of `mnemocode --help`, of `mnemocode <command> --help` and of the help topics.
// usage.ts lays it out. Every option a command accepts (command-options.ts) appears in its page,
// and a test checks that.

import {
  HARD_MAX_COMBINATIONS,
  MAX_SHOWN_MATCHES,
  MAX_INCOMPLETE_DATES,
} from "../core/date-search.js";
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
import type { CommandName } from "./command-options.js";
import { MAX_PNG_BYTES, MAX_PNG_DIMENSION } from "../core/png-admission.js";
import { ENCODED_FORMATS, type EncodedFormat, MASKING_MODES } from "../core/types.js";
import {
  COLOR_FORMAT_NUMBERS,
  formatLegend,
  formatNumber,
  CARD_FORMAT_NUMBERS,
  FORMAT_NUMBER_RANGE,
} from "./format-numbers.js";
import {
  WORD_NUMBERS,
  BIP39_WORD_COUNTS,
  WORD_COUNTS_TEXT,
  WORD_COUNTS_LESS_ONE_TEXT,
  BIP39_DICTIONARY_SIZE,
  checksumBits,
} from "../core/bip39-sizes.js";
import { listInWords } from "../core/places.js";
import { zeroEntropyPhrase } from "../core/english-words.js";
import {
  maximumDates,
  datePatternCandidateCount,
  parseDatePattern,
  WHOLE_DATE,
} from "../core/dates.js";
import { DEFAULT_SAMPLE_WORDS } from "../export/card-preview.js";
import { IMAGE_FORMATS, IMAGE_DPI, JPEG_QUALITY } from "../export/document-formats.js";
import {
  CARD_PAGE_SIZES,
  CARD_ORIENTATIONS,
  pageSizeLabel,
  SEPARATE_CARD_SIZE,
  SHEET_QR_HOLDS,
  SHEET_SIZES_TEXT,
} from "../export/card-settings.js";
import { SHEET_PLAN_TEXT } from "../export/collection-sheet.js";
import { SSKR_CARD_LAYOUTS } from "../export/sskr-content.js";
import { PROGRESS_EVERY } from "./date-search.js";
import { counting } from "../core/search-plan.js";
import { MAX_SEARCH_COMBINATIONS, MAX_SHOWN_CANDIDATES } from "../core/candidates.js";
import { Masking } from "../core/masking.js";
import { QUESTION_HOURS } from "../core/search-turns.js";
import { numberWord } from "../core/prose.js";
import { MIN_THRESHOLD, MAX_SHARES } from "../sskr/split.js";
import { DEFAULT_ADDRESS_COUNT } from "../core/address-scan.js";
import { MIN_LIST_PASSPHRASE_LENGTH } from "../core/candidate-encryption.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../sskr/joint-repair.js";
import { COLOR_COUNTS_TEXT, RGB_REFERENCE_COUNTS } from "../core/colors.js";
import { COINS } from "../core/coins.js";
import { SHARE_SEPARATOR } from "../sskr/share-input.js";
import {
  heirSheetSizeLabel,
  HEIR_SHEET_SIZES,
  DEFAULT_HEIR_SHEET_SIZE,
} from "../export/heir-sheet.js";
import { defined } from "../core/defined.js";

/** The dates of a lone ?, every supported date: the attempts of one such date. */
const EVERY_DATE_COMBINATIONS = datePatternCandidateCount(parseDatePattern(WHOLE_DATE));

/** The candidates of a seedshift-legacy-valid record of `words` words: its every last word. */
function legacyValidCandidates(words: number): number {
  return Masking.of("seedshift-legacy-valid").checksPerCombination(words);
}

/** The modes that encode writes, and those that mask with dates, from the modes' own rules. */
const ENCODE_MODES = MASKING_MODES.filter((mode) => Masking.of(mode).encodable);
const MASKED_MODES = MASKING_MODES.filter((mode) => Masking.of(mode).masked);

/** The width of a column of the table of candidates. */
const TABLE_COLUMN = 5;
/** Each form as the line of --format names it, after its number. */
const FORMAT_LEGEND_NAMES: Readonly<Record<EncodedFormat, string>> = {
  english: "english words",
  indexes: "indexes",
  unicode: "unicode codes",
  "colors-unicode": "colors-unicode",
  colors: "colors",
};

/** What each form is, in the topic of the formats. */
const FORMAT_DESCRIPTIONS: Readonly<Record<EncodedFormat, string>> = {
  english: "English BIP39 words",
  indexes: `The numbers of the words in the BIP39 list, ${WORD_NUMBERS}, as in Seedshift`,
  unicode:
    "Four-digit Unicode codes of the words of the Traditional Chinese BIP39 list; only the codes are written, spaced or joined",
  "colors-unicode": `The color codes of format ${formatNumber("colors")}, each written as two four-digit Private Use codes; all five lengths; plain text that needs no special font`,
  colors: `Color codes such as #01AB63: ${COLOR_COUNTS_TEXT} codes for ${BIP39_WORD_COUNTS[0]} to ${defined(BIP39_WORD_COUNTS.at(-1))} words, BIP39Colors-compatible for 12 and 24 words; MnemoCode also supports 15, 18 and 21. Separated or joined, in any order, but every code is needed`,
};

export interface HelpOption {
  /** The option as typed, such as "--mode". */
  flag: string;
  /** Its value, such as "MODE"; none for an on-or-off option. */
  value?: string;
  /** One line for `-h`; also the first paragraph of `--help`. */
  summary: string;
  /** Further paragraphs for `--help`. */
  details?: readonly string[];
}

export interface HelpGroup {
  heading: string;
  options: readonly HelpOption[];
}

export type HelpRow = readonly [string, string];

export interface CommandHelp {
  summary: string;
  /** Paragraphs under the summary in `--help`. */
  about: readonly string[];
  /** What follows "mnemocode <command> " in the usage line. */
  usage: string;
  groups: readonly HelpGroup[];
  /** What the prompts of --ask-secrets ask for, in `--help`. */
  asks?: readonly HelpRow[];
  examples: readonly HelpRow[];
  /** Closing paragraphs of `--help`. */
  notes?: readonly string[];
}

export interface TopicSection {
  heading: string;
  paragraphs?: readonly string[];
  rows?: readonly HelpRow[];
}

export interface TopicHelp {
  summary: string;
  sections: readonly TopicSection[];
  examples?: readonly HelpRow[];
}

/** The public BIP39 test phrase of the examples, set once above them as a shell variable. */
export const TEST_PHRASE = zeroEntropyPhrase(BIP39_WORD_COUNTS[0]);
export const TEST_PHRASE_VARIABLE = '"$TEST_PHRASE"';
/** TEST_PHRASE masked with the date 23-09-2026 in seedshift mode. */
const SHIFTED_TEST_PHRASE =
  "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
/** The BIP32 master fingerprint of TEST_PHRASE with an empty passphrase. */
const TEST_FINGERPRINT = "73c5da0a";

// Options that several commands share.

const askSecrets: HelpOption = {
  flag: "--ask-secrets",
  summary: "Ask for the secrets on a private screen instead of the command line",
  details: [
    "The secrets are typed on the terminal's alternate screen, a private screen that shows what you type and then the result. When you press Enter after the result, it is cleared and the terminal returns to where it was, so that nothing stays in the scrollback. This works on Linux, macOS and Windows alike.",
    "Each answer is checked as soon as it is given: one that cannot be used is explained in one line and asked again, and the answers before it are kept. While an answer is typed, Escape does nothing, so that a slip loses nothing; in a list of choices it does what the key hint says. Ctrl+C stops the command.",
    "Standard input must be the terminal; without one, or in a terminal that says TERM=dumb, the command stops at once. Output sent to a file goes there as before.",
    "Use it for every real secret: text typed in a command can stay in the shell history and is visible in the list of running programs.",
  ],
};

const mnemonicText: HelpOption = {
  flag: "--mnemonic",
  value: "TEXT",
  summary: "The phrase as text; only for public test phrases",
  details: [
    "English BIP39 words separated by spaces. A real phrase typed here can stay in the shell history; use --ask-secrets or --mnemonic-file instead.",
  ],
};

const mnemonicFile: HelpOption = {
  flag: "--mnemonic-file",
  value: "PATH",
  summary: "Read the phrase from a file; - reads standard input",
  details: [`Text input may be up to ${limitName(MAX_TEXT_INPUT_BYTES)}.`],
};

const dates: HelpOption = {
  flag: "--dates",
  value: "DATE ...",
  summary: "One or more dates, DD-MM-YYYY, separated by spaces",
  details: [
    "YYYY-MM-DD is also accepted. The order does not matter: the dates are sorted, oldest first. A year always has four digits, 0001 to 9999, so the year 26 is written 0026.",
    `Up to one date for every three words: ${listInWords(BIP39_WORD_COUNTS.map(maximumDates), "or")} dates for ${WORD_COUNTS_TEXT} words. Dates are never stored; keep them yourself.`,
  ],
};

const encodedText: HelpOption = {
  flag: "--input",
  value: "TEXT",
  summary: "The encoded record as text",
  details: [
    `Any of the ${numberWord(ENCODED_FORMATS.length)} formats, with or without an MNC1 header.`,
  ],
};

const encodedFile: HelpOption = {
  flag: "--input-file",
  value: "PATH",
  summary: "Read the encoded record from a file; - reads standard input",
  details: [
    "A file saved with encode --output names its mode and format, so only the dates are needed with it.",
  ],
};

/** The QR input of a record whose mode the option `modeFlag` gives (--old-mode in re-encode). */
function encodedQrOf(modeFlag: string): HelpOption {
  return {
    flag: "--qr-file",
    value: "PNG",
    summary: "Read the encoded record from a QR code in a PNG image",
    details: [
      `The image is read on this computer. It may be up to ${limitName(MAX_PNG_BYTES)} and ${MAX_PNG_DIMENSION} pixels on a side. A QR code holds no header, so give ${modeFlag} for a masked record; without it, --ask-secrets asks how it was masked.`,
    ],
  };
}
const encodedQr = encodedQrOf("--mode");

const decodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: listInWords(MASKING_MODES, "or"),
  details: [
    "Needed for typed text, terminal output and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A file saved with --output names its mode; a --mode that contradicts it stops the command, and with --ask-secrets MnemoCode offers to read the record as it says or to give it again. See mnemocode help modes.",
  ],
};

/** The format of a record, given by the option `flag` (--old-format in re-encode). */
function recordFormatOf(flag: string, summary: string): HelpOption {
  return {
    flag,
    value: "FORMAT",
    summary,
    details: [
      `MnemoCode picks the format itself when exactly one fits the whole record. Otherwise it asks in the terminal, and a script must pass ${flag}. See mnemocode help formats.`,
    ],
  };
}
const decodeFormat = recordFormatOf(
  "--format",
  `The record format, ${FORMAT_NUMBER_RANGE} or its name; usually found automatically`,
);

const phraseWords: HelpOption = {
  flag: "--words",
  value: BIP39_WORD_COUNTS.join("|"),
  summary: "The words of the seed phrase: read only the codes of so many words",
  details: [
    `Printed cards end with a few random codes that belong to nothing. The sheet for heirs states the number of words; with it, only the codes of so many words from the start are read, and the cards after them may be typed or left out. In colors, ${BIP39_WORD_COUNTS[0]} words are ${RGB_REFERENCE_COUNTS[0]} codes and ${defined(BIP39_WORD_COUNTS.at(-1))} words ${defined(RGB_REFERENCE_COUNTS.at(-1))}.`,
  ],
};

const maxCandidates: HelpOption = {
  flag: "--max-candidates",
  value: "N",
  summary: "Most combinations a search of dates tries without asking",
  details: [
    `Without it, a search that takes up to ${QUESTION_HOURS} hours on this computer starts at once; a longer one is asked for on the private screen and needs this option elsewhere. The number of attempts, and the time with a wallet check, are shown before the search starts. Up to ${counting(HARD_MAX_COMBINATIONS)}; every supported date is ${counting(EVERY_DATE_COMBINATIONS)} attempts.`,
  ],
};

const backupCheck: HelpOption = {
  flag: "--backup-check",
  value: "yes|no",
  summary: "Answer whether to check the written-down backup on the private screen",
  details: [
    "After the result, --ask-secrets offers to type the backup again from what you wrote down, with the dates, and says whether it restores the same phrase. yes starts that check at once; no leaves it out. Without the option it is asked.",
  ],
};

const legacyValidLastWord: HelpOption = {
  flag: "--legacy-valid-last-word",
  summary: "In seedshift-legacy mode, end with a last word that passes the checksum",
};

const template: HelpOption = {
  flag: "--template",
  value: "ID",
  summary: "The card design, by name or number; mnemocode preview --list lists them",
};

const title: HelpOption = {
  flag: "--title",
  value: "TEXT",
  summary: "Collection title; default the studio name",
};
const pdf: HelpOption = {
  flag: "--pdf",
  value: "PATH",
  summary: "Save the cards as one PDF",
  details: ["The file is written into a folder that already exists."],
};

const cardsDir: HelpOption = {
  flag: "--cards-dir",
  value: "NEW_FOLDER",
  summary: "Save one file per card in a new folder",
  details: [
    "Files are named after their number and the code they print, such as 01-ABCDEF.pdf, or 01-7684.pdf in Unicode codes; each holds only its own code. Use it with --page-size business or without a page size. The folder must not exist yet: it is created only when every card is ready.",
  ],
};

const imagesDir: HelpOption = {
  flag: "--images-dir",
  value: "NEW_FOLDER",
  summary: "Save the pages as images in a new folder",
  details: [
    `Needs the Poppler program pdftocairo; PDF files do not. Pages are drawn at ${IMAGE_DPI} dpi. If pdftocairo is missing, MnemoCode says so before it asks for a secret.`,
  ],
};

const imageFormat: HelpOption = {
  flag: "--image-format",
  value: IMAGE_FORMATS.join("|"),
  summary: "Image format for --images-dir and --cards-dir; default png",
  details: [
    `jpeg is accepted for jpg. PNG keeps text and QR codes sharp; JPEG uses quality ${JPEG_QUALITY}. The rounded corners of a separate card are transparent in PNG and white in JPEG.`,
  ],
};

const pageSize: HelpOption = {
  flag: "--page-size",
  value: CARD_PAGE_SIZES.join("|"),
  summary: "a6 (default), a5 or a4 for one sheet, business for separate cards",
  details: [
    `a6 is ${pageSizeLabel("a6")}, a5 ${pageSizeLabel("a5")} and a4 ${pageSizeLabel("a4")}: the whole collection on one sheet, scaled to the page, a design proposal that cannot be cut into cards. business gives real ${pageSizeLabel("business")} cards, numbered, one per page or file. Print at 100% / actual size.`,
  ],
};

const orientation: HelpOption = {
  flag: "--orientation",
  value: CARD_ORIENTATIONS.join("|"),
  summary: "Page orientation; works with every page size",
};

const cardQr: HelpOption = {
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

const identityGroup: HelpGroup = {
  heading: "Details on the cards (a decoy, random unless given; not needed for recovery):",
  options: identityOptions,
};

const cardLayout: HelpOption = {
  flag: "--card-layout",
  value: SSKR_CARD_LAYOUTS.join("|"),
  summary: "How each share is printed; follows the page size if omitted",
  details: [
    "qr: one document with a QR code per share, in any page size. collection: one sheet per share (a6, a5 or a4); --card-qr adds a QR code. individual: numbered business cards without a QR code; every card of a share is needed to rebuild that share.",
    "Cards print shares written in colors or in Unicode codes, one code to a card, with a few decoys after them: a share in colors as its colors, a share in Unicode codes as its codes on cards whose colors only decorate them. Shares in word numbers, Bytewords or ur:sskr have no cards.",
  ],
};

const threshold: HelpOption = {
  flag: "--threshold",
  value: "N",
  summary: `Shares needed to restore the phrase, at least ${MIN_THRESHOLD}`,
};

const shares: HelpOption = {
  flag: "--shares",
  value: "M",
  summary: `Shares to make, N to ${MAX_SHARES}`,
};

const evidenceGroup: HelpGroup = {
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

const maxTries: HelpOption = {
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
const LIST_PASSPHRASE_ASK: HelpRow = [
  "List passphrase",
  "twice, for a candidate list, unless an option chooses how the list is protected",
];

const candidateListGroup: HelpGroup = {
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

const shareWalletCheck: HelpGroup = {
  ...evidenceGroup,
  heading: "Wallet check (one of them keeps only the matching phrases):",
};

const shareInputs: readonly HelpOption[] = [
  {
    flag: "--share",
    value: "TEXT",
    summary: "One share as text, ? for each unreadable element; repeat for each share",
    details: [
      "ur:sskr/..., Bytewords, word numbers, Unicode codes, colors or colors as Unicode codes; the form is found automatically.",
    ],
  },
  {
    flag: "--share-file",
    value: "PATH",
    summary: `A file of shares, one per line or with ${SHARE_SEPARATOR} between them; may be repeated`,
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

const heirSheet: HelpOption = {
  flag: "--heir-sheet",
  value: "PATH",
  summary: "Also save one sheet that tells heirs how to restore the backup",
  details: [
    "A PDF of one sheet to print on both sides. The front says what the backup looks like, how many shares restore it and how many dates it needs, and leaves the rest of its room for a hint written by hand; the back gives the steps in the menu and the basics for someone new to wallets. It holds no secret: no codes, no dates, no fingerprint and no places. Not with --legacy-valid-last-word. See Instructions for heirs in the README.",
  ],
};

const heirSheetSize: HelpOption = {
  flag: "--heir-sheet-size",
  value: HEIR_SHEET_SIZES.join("|"),
  summary: `The size of that sheet; default ${DEFAULT_HEIR_SHEET_SIZE}`,
  details: [
    `a5 is the size of a notebook, ${heirSheetSizeLabel("a5")}, with larger print; a6 is the size of a postcard and of the cards, ${heirSheetSizeLabel("a6")}, with small print.`,
  ],
};

// The options of Encode's new backup, which re-encode takes too.

const encodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: `${listInWords(ENCODE_MODES, "or")}; see mnemocode help modes`,
  details: ["Without --mode, MnemoCode uses seedshift when --dates is given and direct otherwise."],
};

const encodeFormat: HelpOption = {
  flag: "--format",
  value: "FORMAT",
  summary: `The form of the result, ${FORMAT_NUMBER_RANGE} or its name; default ${formatNumber("english")} (english)`,
  details: [
    `${formatLegend(FORMAT_LEGEND_NAMES)}. Cards need ${CARD_FORMAT_NUMBERS}. See mnemocode help formats. With --sskr the whole phrase is shown beside the shares only when --format is given.`,
  ],
};

const encodeLegacyValidLastWord: HelpOption = {
  ...legacyValidLastWord,
  details: [
    "A legacy result usually fails the BIP39 checksum. With this option only the checksum bits of the last word are calculated again, as with the same option of the original Seedshift; the record becomes seedshift-legacy-valid. Its decoding lists every possible last word.",
  ],
};

/** Where Encode's result goes, its cards and its shares: re-encode's new backup too. */
const encodeOutputGroups: readonly HelpGroup[] = [
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
          "The shares use the Blockchain Commons SSKR format. Fewer shares than --threshold reveal nothing about the phrase. A BIP39 passphrase, the mode and the dates are not stored in the shares. The legacy modes cannot be used with shares.",
        ],
      },
      threshold,
      shares,
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

export const commandHelp: Readonly<Record<CommandName, CommandHelp>> = {
  encode: {
    summary: "Write a phrase in another form, masked with dates if given",
    about: [
      "Writes an English BIP39 phrase as words, numbers, Unicode codes or colors, after masking it with dates in seedshift mode. It can show the result in the terminal, save it as a record file or a QR code, print it as cards, or split it into Shamir shares. After encoding it prints the fingerprint of the original phrase and of the masked phrase.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH> | --mnemonic <TEXT>)",
    groups: [
      {
        heading: "The phrase and the transformation:",
        options: [
          askSecrets,
          mnemonicFile,
          mnemonicText,
          encodeMode,
          dates,
          encodeFormat,
          encodeLegacyValidLastWord,
        ],
      },
      ...encodeOutputGroups,
    ],
    asks: [
      ["Phrase", "English BIP39 words"],
      ["Dates", "one line, such as 23-09-2026 08-08-1988; none in direct mode"],
      ["Backup check", "whether to type the backup again from paper, unless --backup-check"],
    ],
    examples: [
      ["mnemocode encode --ask-secrets --format 3", "A real phrase, dates asked for, as Unicode"],
      [
        `mnemocode encode --mode direct --mnemonic ${TEST_PHRASE_VARIABLE} --format 5 --cards`,
        "The test phrase as colors, shown as cards in the terminal",
      ],
      [
        `mnemocode encode --mnemonic ${TEST_PHRASE_VARIABLE} --dates 23-09-2026 --format 1`,
        `Masked with one date: ${SHIFTED_TEST_PHRASE}`,
      ],
      [
        `mnemocode encode --mnemonic ${TEST_PHRASE_VARIABLE} --dates 23-09-2026 --format 5 --output shifted.txt`,
        "Also save the record; decode needs only the file and the date",
      ],
      [
        `mnemocode encode --mode seedshift-legacy --mnemonic ${TEST_PHRASE_VARIABLE} --dates 23-09-2026 --format 1`,
        "The same record as the original Seedshift program",
      ],
      [
        "mnemocode encode --mode seedshift --ask-secrets --format 5 --template business-it --page-size a4 --pdf cards.pdf",
        "Print the masked phrase as business-card samples on an A4 sheet",
      ],
      [
        "mnemocode encode --ask-secrets --format 5 --template business-it --cards-dir ./my-cards --image-format png",
        "One PNG image per card, in a new folder",
      ],
      [
        "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --output ./shares.txt",
        "Split the phrase into 3 shares, any 2 of which restore it",
      ],
      [
        "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --share-format colors --cards-dir ./share-cards --card-layout qr",
        "Each share as its own QR document",
      ],
      [
        "mnemocode encode --sskr --ask-secrets --threshold 3 --shares 5 --share-format words --heir-sheet heirs.pdf --heir-sheet-size a6",
        "5 shares in words, any 3 restore it, and an A6 sheet for heirs",
      ],
    ],
    notes: [
      "Fingerprints are calculated for an empty BIP39 passphrase. They do not reveal the phrase. A legacy result is a valid phrase only by chance; when it is not, only the original fingerprint is shown.",
      "Note the encoded fingerprint too: decode, recover-date and sskr-combine show it again on the private screen once the codes or shares are read, before the dates, so that a code written or typed wrongly shows before the dates are typed.",
      "Individual cards are not Shamir sharing: every card is needed, and each reveals a part of the encoded phrase.",
    ],
  },

  decode: {
    summary: "Turn an encoded record back into the phrase",
    about: [
      `Reads a record in any of the ${numberWord(ENCODED_FORMATS.length)} formats, from text, a file or a QR code, and prints the phrase with its fingerprint. A masked record needs the same dates. A seedshift-legacy-valid record gives every possible last word, each with its fingerprint: ${legacyValidCandidates(BIP39_WORD_COUNTS[0])} candidates for ${BIP39_WORD_COUNTS[0]} words, ${legacyValidCandidates(defined(BIP39_WORD_COUNTS.at(-1)))} for ${defined(BIP39_WORD_COUNTS.at(-1))}.`,
      "With --ask-secrets the record is checked before the dates are asked for. Codes without an MNC1 header do not say how they were made: without --mode, MnemoCode asks whether Seedshift was used, and which. Where the codes of a masked record form a valid BIP39 phrase, their encoded fingerprint is shown before the dates, to compare with the one encode showed.",
      "A date may then hold ? for each forgotten digit, as in recover-date: the dates are searched, and the matches listed as recover-date lists them. Before the search the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for. It is needed where every date gives a valid phrase, as in seedshift mode; with seedshift-legacy, whose checksum sorts out most dates, it may be left out.",
      "On the private screen the codes may hold ? where one cannot be read: a word number, a word, a Unicode code or a whole color, narrowed by a few letters (ab*), words joined by |, or a ? for one digit. The right codes are told by the encoded fingerprint that encode showed, by the wallet with the dates, which may hold ? too, or by a list where they are few. A Shamir share typed in place of the codes, or read from a QR code, leads to the restore from shares, the share kept as the first; after a share from a QR code the next can be read from another.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG> | --input <TEXT>)",
    groups: [
      {
        heading: "Options:",
        options: [
          askSecrets,
          encodedFile,
          encodedQr,
          encodedText,
          dates,
          decodeMode,
          decodeFormat,
          phraseWords,
        ],
      },
      {
        heading: "Answers for the private screen (--ask-secrets), where dates or codes hold ?:",
        options: [
          {
            flag: "--input-kind",
            value: "codes|share",
            summary: "What a text that may be a Shamir share is read as",
            details: [
              "share restores the seed phrase from shares, the text kept as the first share; codes reads it as the encoded seed phrase. Without it, a text that is surely a share goes to the restore at once, and MnemoCode asks only when the text may be either.",
            ],
          },
          {
            flag: "--encoded-fingerprint",
            value: "HEX",
            summary: "Tell codes marked with ? by the encoded fingerprint that encode showed",
            details: [
              "No dates are needed for it. Only for codes that keep a BIP39 checksum: those of MnemoCode Seedshift, and those without Seedshift, whose encoded fingerprint is the wallet's own; not those of the Original Seedshift.",
            ],
          },
          {
            flag: "--list-candidates",
            summary: "List the candidates instead of telling them by the wallet",
            details: [
              "For codes marked with ? where they are few, and for dates with ? in seedshift-legacy mode, whose checksum sorts out most dates.",
            ],
          },
          {
            ...maxCandidates,
            summary:
              "Most combinations a search of codes marked with ? or of dates tries without asking",
            details: [
              `Codes are counted with every date combination they are tried with. Without it, a search that takes up to ${QUESTION_HOURS} hours on this computer starts at once, and a longer one is asked for. The number of combinations and their time are shown before the search starts.`,
            ],
          },
          {
            flag: "--max-results",
            value: "N",
            summary: `Most date matches shown; default ${MAX_SHOWN_MATCHES}`,
          },
          {
            ...maxTries,
            summary: "Combinations a share repair may try without asking, after a share typed here",
          },
        ],
      },
      {
        ...evidenceGroup,
        heading:
          "Wallet check, for dates or codes with ?, and for the shares when a share is typed here:",
      },
    ],
    asks: [
      ["Encoded record", "unless --input-file or --qr-file gives it; ? for a code not read"],
      ["Share or codes", "for a text that may be a Shamir share, unless --input-kind"],
      ["Format", "when the codes fit several forms, unless --format"],
      ["Seedshift", "whether and which, for codes without a header, unless --mode"],
      ["Dates", "one line, ? for what is forgotten; none in direct mode"],
      ["Codes with ?", "how to tell them, unless an option answers it"],
      [
        "Wallet",
        "for dates or codes with ?, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
      [
        "Search",
        `one longer than ${QUESTION_HOURS} hours, unless --max-candidates or --max-tries allows it`,
      ],
    ],
    examples: [
      ["mnemocode decode --ask-secrets", "Record and dates on the private screen"],
      [
        "mnemocode decode --ask-secrets --input-file shifted.txt",
        "Only the dates on the private screen, ? for a forgotten digit",
      ],
      [
        "mnemocode decode --input-file shifted.txt --dates 23-09-2026",
        "A record file names its mode and format; only the dates are needed",
      ],
      [
        `mnemocode decode --mode seedshift --input "${SHIFTED_TEST_PHRASE}" --dates 23-09-2026`,
        `Typed text: give the mode; the fingerprint is ${TEST_FINGERPRINT}`,
      ],
      [
        "mnemocode decode --mode seedshift --qr-file my-qr.png --dates 23-09-2026",
        "Read a QR code saved by encode --qr",
      ],
      [
        'mnemocode decode --mode seedshift-legacy --input "8F44901950118F44901950118F44901950118F4490194F5C" --format 3 --dates 23-09-2026',
        "A legacy record of Unicode codes typed by hand",
      ],
    ],
    notes: [
      "Compare the fingerprint, or better an address or a public key of the wallet, to pick the right candidate of a legacy-valid record. The right dates always give back the original phrase; wrong dates give a wrong but valid phrase.",
    ],
  },

  "re-encode": {
    summary: "Make an encoded backup again, with other dates or in another form",
    about: [
      "Reads a backup that MnemoCode encoded, from text, a file or a QR code, and decodes it as decode does; then encodes its seed phrase again as encode does: with other dates, another mode or in another form, as cards or as Shamir shares. The seed phrase is never typed.",
      "Its BIP39 checksum is no confirmation: with MnemoCode Seedshift every date gives a valid phrase. So the phrase is shown, and re-encoded only once you recognise it or your wallet matches it. With --ask-secrets you either recognise it or its fingerprint, or MnemoCode compares it with an address of your wallet, of Bitcoin or another coin, which confirms it, or with its fingerprint, which only accepts it: a fingerprint is a filter, not proof. On the command line give a wallet option or --recognised.",
      "With --ask-secrets the codes are asked first, then at once their dates, then the phrase is shown to confirm; only then, unless options give it, the new backup is asked, with the questions of Encode in the menu. A backup of the original Seedshift with a valid last word keeps nothing of the original last word: give it, as you remember it.",
      "Every code and date of the old backup is needed: decode and recover-date find what is forgotten. Afterwards the old backup still restores the same wallet.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG> | --input <TEXT>)",
    groups: [
      {
        heading: "The old backup:",
        options: [
          askSecrets,
          encodedFile,
          encodedQrOf("--old-mode"),
          encodedText,
          { ...dates, flag: "--old-dates", summary: "The dates of the old backup, DD-MM-YYYY" },
          {
            flag: "--old-mode",
            value: "MODE",
            summary: `The mode of the old backup: ${listInWords(MASKING_MODES, "or")}`,
            details: [
              "Needed for typed text and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A record file names its own mode.",
            ],
          },
          recordFormatOf(
            "--old-format",
            `The format of the old backup, ${FORMAT_NUMBER_RANGE} or its name; usually found automatically`,
          ),
          phraseWords,
          {
            flag: "--last-word",
            value: "WORD",
            summary: "The last word of the original seed phrase, for seedshift-legacy-valid",
            details: [
              "Its backup gives a phrase for each possible last word; the original one picks it. With --ask-secrets it is asked on the private screen instead.",
            ],
          },
        ],
      },
      {
        heading:
          "The new backup (without these, --ask-secrets asks it once the phrase is confirmed):",
        options: [encodeMode, dates, encodeFormat, encodeLegacyValidLastWord],
      },
      ...encodeOutputGroups,
      {
        heading: "Confirmation of the seed phrase of the old backup:",
        options: [
          {
            flag: "--recognised",
            summary: "Answer that you recognise the seed phrase shown, instead of a wallet check",
            details: [
              "With --ask-secrets the phrase is still shown, and MnemoCode waits for Enter before the new backup. Without --ask-secrets, give it or a wallet option below: a valid checksum confirms nothing.",
            ],
          },
        ],
      },
      {
        ...evidenceGroup,
        heading: "Wallet check that the seed phrase of the old backup must match:",
      },
    ],
    asks: [
      ["Old backup", "unless --input-file or --qr-file gives it"],
      ["Format", "when the codes fit several forms, unless --old-format"],
      ["Seedshift", "whether and which, for codes without a header, unless --old-mode"],
      ["Old dates", "one line, right after the codes; none in direct mode"],
      ["Last word", "of the original seed phrase, for seedshift-legacy-valid"],
      [
        "Confirmation",
        "whether you recognise the seed phrase, or the wallet to compare it with, unless --recognised or a wallet option answers it",
      ],
      [
        "New backup",
        "form, Seedshift, shares, where it goes, cards and heirs, unless options of the new backup give it",
      ],
      ["New dates", "one line, such as 23-09-2026 08-08-1988; none in direct mode"],
      ["Backup check", "whether to type the new backup again from paper, unless --backup-check"],
    ],
    examples: [
      [
        "mnemocode re-encode --ask-secrets --qr-file my-qr.png --old-mode seedshift",
        "Dates, the phrase and the new backup asked on the private screen",
      ],
      [
        "mnemocode re-encode --ask-secrets --input-file shifted.txt --mode seedshift --format 5",
        "A record file masked again with new dates, as colors",
      ],
      [
        `mnemocode re-encode --input "${SHIFTED_TEST_PHRASE}" --old-mode seedshift --old-dates 23-09-2026 --mode direct --format 3 --master-fingerprint ${TEST_FINGERPRINT}`,
        "The test phrase unmasked as Unicode codes, accepted by its fingerprint (a filter, not proof)",
      ],
      [
        "mnemocode re-encode --ask-secrets --mode seedshift --sskr --threshold 2 --shares 3",
        "A typed backup split into 3 shares, any 2 of which restore it",
      ],
    ],
    notes: [
      "The original fingerprint of the new backup is that of the old one: it is the same wallet. Note the new encoded fingerprint.",
    ],
  },

  "recover-date": {
    summary: "Find a forgotten digit of a date",
    about: [
      `Tries every date that fits one to ${numberWord(MAX_INCOMPLETE_DATES)} incomplete dates, where each forgotten digit is written as ?, and lists the candidates that pass a recovery check. Every check is local and offline.`,
      `In the seedshift and seedshift-legacy-valid modes every date gives a valid phrase, so a recovery check is required; with --ask-secrets it is asked for after the dates when no option gives it. In seedshift-legacy mode the BIP39 checksum can be used instead, a weak filter of ${checksumBits(BIP39_WORD_COUNTS[0])} to ${checksumBits(defined(BIP39_WORD_COUNTS.at(-1)))} bits.`,
      "With --ask-secrets the encoded fingerprint of the codes is shown once they are read, before the dates, as decode shows it, so that a code typed wrongly shows before a long search.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --dates <PATTERN ...>) [<RECOVERY CHECK>]",
    groups: [
      {
        heading: "The record and the dates:",
        options: [
          askSecrets,
          encodedFile,
          encodedQr,
          encodedText,
          {
            ...dates,
            value: "PATTERN ...",
            summary: "The dates, with ? for what is forgotten, such as ?-09-2026",
            details: [
              "?3-09-2026 tries days ending in 3, 0?-09-2026 days 1 to 9, 05|15-09-2026 day 5 or 15, 15-?-2025 the 15th of every month, ?-?-2026 every date in 2026, a lone ? every supported date. One to three dates may be incomplete; two identical patterns are tried once.",
            ],
          },
          { ...decodeMode, summary: listInWords(MASKED_MODES, "or") },
          decodeFormat,
          phraseWords,
        ],
      },
      evidenceGroup,
      {
        heading: "Search limits:",
        options: [
          maxCandidates,
          {
            flag: "--max-results",
            value: "N",
            summary: `Most candidates shown; default ${MAX_SHOWN_MATCHES}`,
          },
          {
            flag: "--progress-every",
            value: "N",
            summary: `Report progress after every N attempts; default ${PROGRESS_EVERY}`,
          },
        ],
      },
      candidateListGroup,
    ],
    asks: [
      ["Encoded record", "unless --input-file or --qr-file gives it"],
      ["Seedshift", "which, for codes without a header, unless --mode"],
      ["Dates", "one line, with ? in place of each forgotten digit"],
      [
        "Wallet",
        "when the mode needs it and no option gives it; then how many addresses, unless --scan-gap",
      ],
      LIST_PASSPHRASE_ASK,
    ],
    examples: [
      [
        `mnemocode recover-date --mode seedshift --ask-secrets --format 1 --master-fingerprint ${TEST_FINGERPRINT}`,
        "Record and date patterns on the private screen",
      ],
      [
        `mnemocode recover-date --mode seedshift --input "${SHIFTED_TEST_PHRASE}" --format 1 --dates "??-09-2026" --master-fingerprint ${TEST_FINGERPRINT}`,
        "Find the forgotten day with the fingerprint",
      ],
      [
        `mnemocode recover-date --mode seedshift --input "${SHIFTED_TEST_PHRASE}" --format 1 --dates "??-09-2026" --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu --bitcoin-profile native-segwit`,
        "The same with the first native SegWit receiving address, m/84'/0'/0'/0/0",
      ],
    ],
    notes: [
      'Quote the patterns, as in "??-09-2026" or "05|15-09-2026", so that the shell neither expands ? nor reads | as a pipe.',
    ],
  },

  "recover-word": {
    summary: "Find forgotten words of a phrase",
    about: [
      `Put ? in place of each forgotten word, ab* for a word that starts with ab, or rich|rice for one of a few words. MnemoCode tries every combination, up to ${counting(MAX_SEARCH_COMBINATIONS)}, and lists those that pass the checksum test: for one forgotten word about 128 in a 12-word phrase, about 8 in 24 words. With one forgotten word each row shows the word, its number in the BIP39 list, the checksum bits and the whole phrase. A recovery check marks the matching rows; the other candidates are still shown. More than ${counting(MAX_SHOWN_CANDIDATES)} candidates are not shown: save them with --candidates-file, or check them against the wallet.`,
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH> | --mnemonic <TEXT>)",
    groups: [
      {
        heading: "The phrase:",
        options: [
          askSecrets,
          mnemonicFile,
          { ...mnemonicText, summary: "The phrase with ? in place of each forgotten word" },
          {
            flag: "--missing-word",
            summary: "One word is missing, and where is not known",
            details: [
              `Give the ${WORD_COUNTS_LESS_ONE_TEXT} words you have, in their order; every place and every word is tried.`,
            ],
          },
          {
            ...legacyValidLastWord,
            summary: "List the valid last words of a whole seedshift-legacy phrase",
            details: [
              "For an old seedshift-legacy phrase whose last word fails the checksum. Give the whole phrase without ?. Every valid last word is listed; the row marked preserved keeps the data bits of the old word, the word legacy encoding suggests. Recover the original wallet phrase from it with the dates.",
            ],
          },
        ],
      },
      evidenceGroup,
      candidateListGroup,
    ],
    asks: [
      ["Phrase", "with ? in place of each forgotten word"],
      [
        "Wallet",
        "to check the candidates, after the search, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
      LIST_PASSPHRASE_ASK,
    ],
    examples: [
      ["mnemocode recover-word --ask-secrets", "The phrase with ? on the private screen"],
      [
        `mnemocode recover-word --mnemonic "${TEST_PHRASE.replace(/about$/u, "?")}"`,
        "Every word that passes the checksum",
      ],
      [
        `mnemocode recover-word --ask-secrets --master-fingerprint ${TEST_FINGERPRINT}`,
        "Mark the candidate with this fingerprint",
      ],
      ["mnemocode recover-word --ask-secrets --missing-word", "A word missing at an unknown place"],
      [
        "mnemocode recover-word --ask-secrets --candidates-file ./candidates.age --candidates-key age1…",
        "Every candidate, encrypted for the Discovery Scanner",
      ],
      [
        "mnemocode recover-word --legacy-valid-last-word --ask-secrets",
        "Valid last words for a stored legacy phrase",
      ],
    ],
  },

  "sskr-combine": {
    summary: "Restore a phrase from Shamir shares",
    about: [
      "Needs at least the threshold number of shares, in any of the share forms, which may be mixed. Type each element that cannot be read as ?: the shares are then repaired together, and every phrase that passes the hash stored in the shares is listed with its fingerprint. Shares of different sets, two different shares with the same member number and too few shares are refused; a share given twice is used once.",
      "With --ask-secrets each share is read as soon as the answer is given: a share that cannot be read is named and typed again alone, and a result that cannot be used offers what to change. Where nothing tells which of two shares is wrong, such as two that are the same member of the set but differ, both are named and you choose which to change or leave out.",
      "On the private screen with --mode seedshift, complete shares show the encoded fingerprint of the masked phrase they hold before the dates are asked for, to compare with the one the split showed. A date may then hold ? for each forgotten digit, also together with ? in the shares: the dates are searched as recover-date searches them, after the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for, and the work, share combinations times date combinations, is shown first.",
    ],
    usage:
      "[OPTIONS] (--ask-secrets | --share <TEXT> ... | --share-file <PATH> | --share-qr <PNG>)",
    groups: [
      {
        heading: "Options:",
        options: [
          ...shareInputs,
          {
            flag: "--mode",
            value: "MODE",
            summary: "seedshift when the phrase was masked before splitting",
            details: [
              "The mode and the dates are not stored in the shares; give the same ones as for the split.",
            ],
          },
          dates,
          maxTries,
          maxCandidates,
        ],
      },
      shareWalletCheck,
      candidateListGroup,
    ],
    asks: [
      ["Shares", `shares separated by ${SHARE_SEPARATOR}, ? for each unreadable element`],
      ["Dates", "only with --mode seedshift; ? for each forgotten digit"],
      [
        "Wallet",
        "for dates with ?, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
      LIST_PASSPHRASE_ASK,
    ],
    examples: [
      ["mnemocode sskr-combine --ask-secrets", "Shares on the private screen"],
      [
        "mnemocode sskr-combine --ask-secrets --mode seedshift",
        "Shares and dates on the private screen, ? for a forgotten digit",
      ],
      [
        'mnemocode sskr-combine --share "ur:sskr/FIRST_COMPLETE_SHARE" --share "ur:sskr/SECOND_COMPLETE_SHARE"',
        "Two shares typed as text",
      ],
      ["mnemocode sskr-combine --share-file ./selected-shares.txt", "Shares from a file"],
      [
        "mnemocode sskr-combine --share-qr ./first.png --share-qr ./second.png",
        "Shares from QR images",
      ],
      [
        "mnemocode sskr-combine --share-file ./shares.txt --mode seedshift --dates 23-09-2026",
        "Shares of a phrase masked before splitting",
      ],
    ],
    notes: [
      "Individual cards of one share must all be present, in numbered order, to rebuild that share.",
      `Replace each unreadable element with ? at its place, on any of the shares, up to ${MAX_JOINT_MARKED_ELEMENTS} on one share. In a color, the Unicode code of a word or a Color Unicode code written apart, a ? may also stand for one digit, such as #B5?0??, 4E?0 or E1?A, and the digits read are used; in codes run together a ? stands for a whole code, and the other forms take a ? only for a whole element. The shares are solved together: their checksums, the data they share and every share beyond the threshold settle most marks without trying anything, and the hash stored with the secret decides the rest. How many combinations are left, how long they take and what would help is shown first. More than one answer is listed, never chosen.`,
      `A share file holds shares one per line or separated by ${SHARE_SEPARATOR}. A share that a narrow column wrapped over lines is joined again, as when it is pasted.`,
    ],
  },

  "sskr-export": {
    summary: "Print existing Shamir shares as cards",
    about: [
      "Prints shares made earlier as cards, PDFs, images or a share file. It changes only the presentation and never makes new shares.",
      "Shares with elements typed as ? come back whole, repaired together as by sskr-combine, without the phrase being shown. When more than one set of shares fits, each is shown with the fingerprint of the phrase it holds, and none is saved; a wallet check keeps the right one.",
    ],
    usage:
      "[OPTIONS] (--ask-secrets | --share <TEXT> ... | --share-file <PATH> | --share-qr <PNG>)",
    groups: [
      { heading: "The shares:", options: [...shareInputs, maxTries, maxCandidates] },
      {
        heading: "Output:",
        options: [
          {
            flag: "--format",
            value: "FORMAT",
            summary: "How the shares are shown (see encode --share-format)",
            details: [
              "Without it, in the form they are written in: a share repaired from elements marked with ? comes back whole, in its own form.",
            ],
          },
          {
            flag: "--output",
            value: "NEW_FILE",
            summary: "Save the shares, one complete share per line",
            details: ["The file holds all shares. A taken name is numbered, never replaced."],
          },
          {
            ...pdf,
            summary: "Save all shares in one multi-page PDF",
            details: ["A taken name is numbered, as shares-1.pdf, never replaced."],
          },
          {
            ...cardsDir,
            summary: "Save each share as its own file or folder in a new folder",
            details: ["Each file or folder holds one share: keep them in different places."],
          },
          { ...imagesDir, summary: "Save the pages of all shares as images in a new folder" },
          imageFormat,
          cardLayout,
          { ...template, summary: "The card design; default business-it" },
          pageSize,
          orientation,
          {
            ...cardQr,
            summary: "Add a QR code of its own share to each collection sheet",
            details: [
              "Each QR code holds only its own share: word numbers, Unicode codes or colors, according to the chosen form.",
            ],
          },
        ],
      },
      identityGroup,
      {
        ...shareWalletCheck,
        options: [
          ...shareWalletCheck.options,
          {
            flag: "--mode",
            value: "seedshift",
            summary: "The phrase was masked before splitting: check the wallet after the dates",
            details: [
              "Without it the wallet check compares the phrase that the shares hold, which is the wallet of a standard split.",
            ],
          },
          dates,
        ],
      },
    ],
    asks: [
      ["Shares", `shares separated by ${SHARE_SEPARATOR}, ? for each unreadable element`],
      ["Dates", "only with --mode seedshift; ? for each forgotten digit"],
      [
        "Wallet",
        "when several sets of shares fit, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
    ],
    examples: [
      [
        "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./share-cards --card-layout collection --template business-it",
        "One collection sheet per share",
      ],
      [
        "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./sskr-a6 --page-size a6 --orientation portrait",
        "The same on portrait A6 sheets",
      ],
      [
        "mnemocode sskr-export --share-file ./shares.txt --format colors --cards-dir ./share-qr --card-layout qr",
        "One QR document per share",
      ],
    ],
  },

  "sskr-split": {
    summary: "Older name for encode --sskr",
    about: [
      "Kept for compatibility. It splits the phrase like encode --sskr, but here --format selects the share format. Prefer mnemocode encode --sskr.",
    ],
    usage: "[OPTIONS] --threshold <N> --shares <M> (--ask-secrets | --mnemonic-file <PATH>)",
    groups: [
      {
        heading: "Options:",
        options: [
          askSecrets,
          mnemonicFile,
          mnemonicText,
          { flag: "--mode", value: "MODE", summary: "direct (default) or seedshift" },
          dates,
          threshold,
          shares,
          {
            flag: "--format",
            value: "FORMAT",
            summary: "The share format; default ur (see encode --share-format)",
          },
          {
            flag: "--output",
            value: "NEW_FILE",
            summary: "Save the shares, one per line; never replaces a file",
          },
          { ...pdf, summary: "Save all shares in one PDF" },
          { ...cardsDir, summary: "Save each share as its own file or folder" },
          imagesDir,
          imageFormat,
          cardLayout,
          template,
          pageSize,
          orientation,
          cardQr,
          heirSheet,
          heirSheetSize,
          backupCheck,
        ],
      },
      identityGroup,
    ],
    asks: [
      ["Phrase", "English BIP39 words"],
      ["Dates", "only with --mode seedshift"],
      ["Backup check", "whether to type the shares again from paper, unless --backup-check"],
    ],
    examples: [
      [
        "mnemocode sskr-split --ask-secrets --threshold 2 --shares 3 --output ./shares.txt",
        "The same as encode --sskr with these options",
      ],
    ],
  },

  preview: {
    summary: "Print card designs with a public test phrase",
    about: [
      "Draws a template exactly as encode does, with a public test phrase and test dates, never with a real secret. Use it to choose a design and check the details printed on it.",
    ],
    usage: "(--list | --template <ID> | --all) [OPTIONS]",
    groups: [
      {
        heading: "Options:",
        options: [
          { flag: "--list", summary: "List the installed designs with their numbers" },
          { ...template, summary: "The design to draw, by name or number" },
          {
            flag: "--all",
            summary: "Draw every design",
            details: ["Not with --cards-dir: a card folder holds one design."],
          },
          {
            flag: "--words",
            value: BIP39_WORD_COUNTS.join("|"),
            summary: `Length of the test phrase; default ${DEFAULT_SAMPLE_WORDS}`,
          },
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
    ],
    examples: [
      ["mnemocode preview --list", "List the designs"],
      ["mnemocode preview --all --pdf all-previews.pdf", "Every design in one PDF"],
      [
        "mnemocode preview --all --words 24 --page-size a4 --pdf print-previews.pdf",
        "Every design with a 24-word phrase on A4",
      ],
      [
        'mnemocode preview --template business-it --card-name "Alex Morgan" --card-email "alex@example.com" --page-size a6 --pdf my-preview.pdf',
        "One design with your own details",
      ],
      [
        "mnemocode preview --template business-it --words 24 --page-size business --pdf business-cards.pdf",
        `Real ${pageSizeLabel("business")} cards, one per page`,
      ],
      [
        "mnemocode preview --template business-it --words 24 --cards-dir ./sample-cards",
        "One file per card",
      ],
      [
        "mnemocode preview --all --images-dir ./preview-images --image-format jpg",
        "Every design as JPEG images",
      ],
    ],
  },

  table: {
    summary: "Look up a word, its number or its Unicode code",
    about: [
      `Prints the row of the BIP39 table that links an English word, its number from ${WORD_NUMBERS} and the four-digit Unicode code of format ${formatNumber("unicode")}, or the whole table.`,
    ],
    usage: "(--word <WORD> | --index <N> | --unicode <HEX> | --all)",
    groups: [
      {
        heading: "Options (exactly one):",
        options: [
          { flag: "--word", value: "WORD", summary: "An English BIP39 word" },
          { flag: "--index", value: "N", summary: `A word number, ${WORD_NUMBERS}` },
          { flag: "--unicode", value: "HEX", summary: "A four-digit Unicode code, such as 5BF6" },
          { flag: "--all", summary: "The whole table: number, word and code, tab-separated" },
        ],
      },
    ],
    examples: [
      ["mnemocode table --word abandon", "The row of abandon"],
      ["mnemocode table --index 1", "The first word"],
      ["mnemocode table --unicode 5BF6", "The word with this code"],
      ["mnemocode table --all", `All ${counting(BIP39_DICTIONARY_SIZE)} rows`],
    ],
  },

  "self-test": {
    // As the menu and mhfe name it.
    summary: "Run the self-test",
    about: [
      "Checks every phrase length, format and mode, the sorting of dates, the public test vectors, the 24 English BIP39 seed vectors, the date and word searches with a wallet, encrypted candidate lists, the check of a written backup, marked Shamir shares repaired together and with dates, every coin address vector, the sheet for heirs, share cards, the colors and decoys of card sets, QR images beside a sheet and card export with every kind of artwork and font. The check of each feature is also given a case it must refuse. Run it before using a newly built or copied installation.",
      `A smaller core self-test runs before every command that processes data, in less than half a second: it checks both BIP39 word lists and fixed test phrases in every mode, and compares each feature with known answers: the BIP39 seed and fingerprint, dates with ? and |, codes and shares marked with ?, the word search, the candidate list, the check of a written backup, wallet evidence and the addresses of the ${numberWord(COINS.length)} coins, the sheet for heirs and share cards. A failure stops the command before any input is read.`,
    ],
    usage: "",
    groups: [],
    examples: [["mnemocode self-test", "Run every check and print the result of each group"]],
  },
};

export const topicHelp: Readonly<Record<string, TopicHelp>> = {
  modes: {
    summary: "Transformation modes: direct, seedshift and the legacy modes",
    sections: [
      {
        heading: "Modes:",
        rows: [
          ["direct", "Writes the phrase in another form without changing it. No dates."],
          [
            "seedshift",
            "Masks the phrase with dates. The result is always a valid BIP39 phrase, and the same dates give the original back without a search. The default when --dates is given.",
          ],
          [
            "seedshift-legacy",
            "Works exactly like the original Seedshift program, for records made with it. The result usually fails the BIP39 checksum; MnemoCode shows a valid last word too.",
          ],
          [
            "seedshift-legacy-valid",
            "A legacy record whose last word was replaced by a valid one (--legacy-valid-last-word). Decoding lists every possible last word with its fingerprint.",
          ],
        ],
      },
      {
        heading: "How seedshift masks a phrase:",
        paragraphs: [
          "The phrase is cut into 11-bit pieces, one per word. Each piece is shifted by the year, month and day of the dates, oldest date first, repeated as often as needed, modulo 2048. The data bits of the last word are shifted modulo their range, and a new checksum is calculated.",
          "Every set of dates gives a valid phrase, so wrong dates give a wrong but valid phrase. To check a recovery, keep the fingerprint of the original phrase, or an address or a public key of the wallet.",
        ],
      },
      {
        heading: "Candidates of a legacy-valid record:",
        rows: [
          [
            "Words",
            BIP39_WORD_COUNTS.map((count) => String(count).padEnd(TABLE_COLUMN))
              .join("")
              .trimEnd(),
          ],
          [
            "Candidates",
            BIP39_WORD_COUNTS.map((count) =>
              String(legacyValidCandidates(count)).padEnd(TABLE_COLUMN),
            )
              .join("")
              .trimEnd(),
          ],
        ],
      },
    ],
    examples: [
      [
        `mnemocode encode --mode seedshift --mnemonic ${TEST_PHRASE_VARIABLE} --dates 23-09-2026 --format 1`,
        `Gives ${SHIFTED_TEST_PHRASE}`,
      ],
    ],
  },

  formats: {
    summary: `The ${numberWord(ENCODED_FORMATS.length)} forms a phrase can be written in (--format)`,
    sections: [
      {
        heading: "Formats:",
        rows: ENCODED_FORMATS.map((format) => [
          `${formatNumber(format)}  ${format}`,
          FORMAT_DESCRIPTIONS[format],
        ]),
      },
      {
        heading: "Notes:",
        paragraphs: [
          "Every format is a representation, not encryption. For decode and recover-date the format is found automatically when exactly one fits; otherwise the terminal asks, and a script must pass --format. A record file names its format.",
        ],
      },
    ],
    examples: [
      [
        `mnemocode encode --mode direct --mnemonic ${TEST_PHRASE_VARIABLE} --format 3`,
        "The test phrase as Unicode codes",
      ],
      [
        "mnemocode table --word abandon",
        `One word in formats ${formatNumber("english")} to ${formatNumber("unicode")}`,
      ],
    ],
  },

  cards: {
    summary: "Printing the encoded phrase as cards or material samples",
    sections: [
      {
        heading: "What a card holds:",
        paragraphs: [
          `In formats ${COLOR_FORMAT_NUMBERS} the phrase is a short list of color codes, in format ${formatNumber("unicode")} one Unicode code a word. A template places them into a familiar document, such as a print studio proposal with sample business cards. Each card shows one code: a color and its code, such as Ref. 01AB63, or a Unicode code in a color that only decorates it, the same color for the same code. The printed codes are the whole value: decode turns them back into the phrase.`,
          "A set ends with a few random codes that belong to nothing, at least one, so that every row of a sheet is full and the cards are as large as the page allows; separate cards end with as many. No card says how many cards there are. The QR code holds only the real codes, and the sheet for heirs says how many words the phrase has: decode --words reads only the codes of so many words.",
          "The names, companies and contact details are a decoy that makes the cards look ordinary, invented at random unless given with --card-name and the other details. Like the photographs, they are not needed for recovery.",
        ],
      },
      {
        heading: "In the menu:",
        paragraphs: [
          `After "Also as printable cards", the menu asks about the files: which kind of file, PDF, PNG or JPEG (images need pdftocairo); how the cards are laid out, on ${SHEET_SIZES_TEXT} sheets in one PDF or as images of the sheets, or as separate business cards of ${pageSizeLabel(SEPARATE_CARD_SIZE)}, one file each in a new folder; for sheets, how they are turned, landscape, portrait or whichever fills the sheet best (${SHEET_PLAN_TEXT}); and the name of the PDF or of the folder. Then it asks for the design, for sheets whether to add a QR code with ${SHEET_QR_HOLDS}, and last, for every way of saving, whether to type your own details; Enter on a detail keeps it random.`,
        ],
      },
      {
        heading: "Page sizes:",
        rows: [
          ["a6", `${pageSizeLabel("a6")}: one sheet with the whole collection (the default)`],
          ["a5", `${pageSizeLabel("a5")}: one sheet`],
          ["a4", `${pageSizeLabel("a4")}: one sheet`],
          [
            "business",
            `${pageSizeLabel("business")}: separate numbered cards, one per page or file`,
          ],
        ],
      },
      {
        heading: "Separate cards:",
        paragraphs: [
          "Every card prints one code. Separate cards never carry a QR code. Every card is needed to recover the phrase, and each reveals part of it: this is not Shamir sharing.",
        ],
      },
    ],
    examples: [
      ["mnemocode preview --list", "The installed designs"],
      [
        "mnemocode encode --ask-secrets --format 5 --template business-it --pdf cards.pdf",
        "A real export; the phrase and the dates are asked on the private screen",
      ],
      ["mnemocode encode --help", "Every card option explained"],
    ],
  },
};
