// The text of `mnemocode --help`, of `mnemocode <command> --help` and of the help topics.
// usage.ts lays it out. Every option a command accepts (command-options.ts) appears in its page,
// and a test checks that.

import { HARD_MAX_COMBINATIONS } from "../core/date-search.js";
import { MAX_ADDRESS_COUNT } from "../core/wallet-evidence.js";
import type { CommandName } from "./command-options.js";

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
export const TEST_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
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
    "Standard input must be the terminal; without one the command stops at once. Output sent to a file goes there as before.",
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
  details: ["Text input may be up to 1 MiB."],
};

const dates: HelpOption = {
  flag: "--dates",
  value: "DATE ...",
  summary: "One or more dates, DD-MM-YYYY, separated by spaces",
  details: [
    "YYYY-MM-DD is also accepted. The order does not matter: the dates are sorted, oldest first. A year always has four digits, 0001 to 9999, so the year 26 is written 0026.",
    "Up to one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words. Dates are never stored; keep them yourself.",
  ],
};

const encodedText: HelpOption = {
  flag: "--input",
  value: "TEXT",
  summary: "The encoded record as text",
  details: ["Any of the five formats, with or without an MNC1 header."],
};

const encodedFile: HelpOption = {
  flag: "--input-file",
  value: "PATH",
  summary: "Read the encoded record from a file; - reads standard input",
  details: [
    "A file saved with encode --output names its mode and format, so only the dates are needed with it.",
  ],
};

const encodedQr: HelpOption = {
  flag: "--qr-file",
  value: "PNG",
  summary: "Read the encoded record from a QR code in a PNG image",
  details: [
    "The image is read on this computer. It may be up to 16 MiB and 4096 pixels on a side. A QR code holds no header, so give --mode for a masked record; without it, --ask-secrets asks how it was masked.",
  ],
};

const decodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: "direct, seedshift, seedshift-legacy or seedshift-legacy-valid",
  details: [
    "Needed for typed text, terminal output and QR codes, which carry no header; without it, --ask-secrets asks how they were masked. A file saved with --output names its mode; a --mode that contradicts it stops the command, and with --ask-secrets MnemoCode offers to read the record as it says or to give it again. See mnemocode help modes.",
  ],
};

const decodeFormat: HelpOption = {
  flag: "--format",
  value: "FORMAT",
  summary: "The record format, 1 to 5 or its name; usually found automatically",
  details: [
    "MnemoCode picks the format itself when exactly one fits the whole record. Otherwise it asks in the terminal, and a script must pass --format. See mnemocode help formats.",
  ],
};

const maxCandidates: HelpOption = {
  flag: "--max-candidates",
  value: "N",
  summary: "Most combinations a search of dates tries without asking",
  details: [
    `Without it, a search that takes up to 12 hours on this computer starts at once; a longer one is asked for on the private screen and needs this option elsewhere. The number of attempts, and the time with a wallet check, are shown before the search starts. Up to ${HARD_MAX_COMBINATIONS.toLocaleString("en-US")}; every supported date is 3,652,059 attempts.`,
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
    "Files are named 01-ABCDEF.pdf, 02-123456.pdf and so on; each holds only its own reference or group. Use it with --page-size business or without a page size. The folder must not exist yet: it is created only when every card is ready.",
  ],
};

const imagesDir: HelpOption = {
  flag: "--images-dir",
  value: "NEW_FOLDER",
  summary: "Save the pages as images in a new folder",
  details: [
    "Needs the Poppler program pdftocairo; PDF files do not. Pages are drawn at 300 dpi. If pdftocairo is missing, MnemoCode says so before it asks for a secret.",
  ],
};

const imageFormat: HelpOption = {
  flag: "--image-format",
  value: "png|jpg",
  summary: "Image format for --images-dir and --cards-dir; default png",
  details: [
    "jpeg is accepted for jpg. PNG keeps text and QR codes sharp; JPEG uses quality 90. The rounded corners of a separate card are transparent in PNG and white in JPEG.",
  ],
};

const pageSize: HelpOption = {
  flag: "--page-size",
  value: "a6|a4|business",
  summary: "a6 (default) or a4 for one sheet, business for separate cards",
  details: [
    "a6 is 148 x 105 mm and a4 210 x 297 mm: the whole collection on one sheet, scaled to the page, a design proposal that cannot be cut into cards. business gives real 90 x 50 mm cards, numbered, one per page or file. Print at 100% / actual size.",
  ],
};

const orientation: HelpOption = {
  flag: "--orientation",
  value: "portrait|landscape",
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
  value: "qr|collection|individual",
  summary: "How each share is printed; follows the page size if omitted",
  details: [
    "qr: one document with a QR code per share, in any page size. collection: one sheet per share (a6 or a4); --card-qr adds a QR code. individual: numbered business cards without a QR code; every card of a share is needed to rebuild that share.",
    "The cards print each share in the form it is written in: its colors, or its word numbers, Unicode codes or Bytewords, three to a card, beside colors drawn at random that only decorate them. A share written as ur:sskr prints its Bytewords.",
  ],
};

const threshold: HelpOption = {
  flag: "--threshold",
  value: "N",
  summary: "Shares needed to restore the phrase, at least 2",
};

const shares: HelpOption = {
  flag: "--shares",
  value: "M",
  summary: "Shares to make, N to 16",
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
        "Standard and SLIP-132 forms are accepted: xpub, ypub, zpub, Ypub, Zpub; on testnet tpub, upub, vpub, Upub, Vpub.",
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
      summary: "A 33-byte compressed public key, one of the --scan-gap from the selected place",
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
      value: "mainnet|testnet",
      summary: "Network of the address or key; default mainnet",
    },
    {
      flag: "--bitcoin-profile",
      value: "NAME",
      summary: "auto (default), or a comma-separated list of address types",
      details: [
        "The types are legacy (BIP44), nested-segwit (BIP49), native-segwit (BIP84) and taproot (BIP86), such as native-segwit,taproot. auto tries all four at the selected place.",
      ],
    },
    { flag: "--account", value: "N", summary: "Account number; default 0" },
    { flag: "--branch", value: "N", summary: "0 for receiving, 1 for change; default 0" },
    { flag: "--index", value: "N", summary: "The first address number compared; default 0" },
    {
      flag: "--scan-gap",
      value: "N",
      summary: "Scan N addresses from --index on; default 20",
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
    "Without it, a search that takes up to 12 hours on this computer starts at once. The number a repair needs, and its time, are shown before it starts; on the private screen a longer search is asked for instead.",
  ],
};

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
      summary: "Encrypt the list with a passphrase of 12 characters or more, read from a file",
      details: [
        "With --ask-secrets and neither key nor passphrase file, the passphrase is asked on the private screen.",
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
    summary: "A file with one share per line; may be repeated",
  },
  {
    flag: "--share-qr",
    value: "PNG",
    summary: "A QR code of one share in a PNG image; may be repeated",
    details: ["A PDF cannot be read; save the QR code as a PNG image first."],
  },
  {
    ...askSecrets,
    summary: "Type the shares on the private screen, separated by semicolons",
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
  value: "a5|a6",
  summary: "The size of that sheet; default a5",
  details: [
    "a5 is the size of a notebook, 148 x 210 mm, with larger print; a6 is the size of a postcard and of the cards, 105 x 148 mm, with small print.",
  ],
};

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
          {
            flag: "--mode",
            value: "MODE",
            summary: "direct, seedshift or seedshift-legacy; see mnemocode help modes",
            details: [
              "Without --mode, MnemoCode uses seedshift when --dates is given and direct otherwise.",
            ],
          },
          dates,
          {
            flag: "--format",
            value: "FORMAT",
            summary: "The form of the result, 1 to 5 or its name; default 1 (english)",
            details: [
              "1 english words, 2 indexes, 3 unicode codes, 4 colors-unicode, 5 colors. Cards need 4 or 5. See mnemocode help formats. With --sskr the whole phrase is shown beside the shares only when --format is given.",
            ],
          },
          {
            ...legacyValidLastWord,
            details: [
              "A legacy result usually fails the BIP39 checksum. With this option only the checksum bits of the last word are calculated again, as with the same option of the original Seedshift; the record becomes seedshift-legacy-valid. Its decoding lists every possible last word.",
            ],
          },
        ],
      },
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
            summary: "Show the color codes as colored cards in the terminal (formats 4 and 5)",
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
        heading: "Cards (formats 4 and 5):",
        options: [
          template,
          pdf,
          cardsDir,
          imagesDir,
          imageFormat,
          pageSize,
          orientation,
          cardQr,
          { flag: "--title", value: "TEXT", summary: "Collection title; default the studio name" },
          {
            flag: "--events",
            value: "LABEL ...",
            summary: "One label per date, for dated Unicode cards",
            details: [
              "For cards that print the dates with format 3. No template of that kind is installed yet.",
            ],
          },
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
            summary:
              "How the shares are shown: ur, words, indexes, unicode, colors, colors-unicode",
            details: [
              "ur (the default) is the standard short form, ur:sskr/...; words writes the same share in standard Bytewords, one English word per byte. Other SSKR programs read both. indexes, unicode, colors and colors-unicode write a share with the signs of --format 2, 3, 5 and 4, so that it looks like that form; sskr-combine then shows the restored backup in that form again. Only MnemoCode reads these. A saved text file holds the shares in the same form.",
            ],
          },
          cardLayout,
        ],
      },
    ],
    asks: [
      ["Phrase", "English BIP39 words"],
      ["Dates", "one line, such as 23-09-2026 08-08-1988; none in direct mode"],
      ["Event labels", "one per date, for dated Unicode cards, unless --events"],
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
        "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --cards-dir ./share-cards --card-layout qr",
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
      "Reads a record in any of the five formats, from text, a file or a QR code, and prints the phrase with its fingerprint. A masked record needs the same dates. A seedshift-legacy-valid record gives every possible last word, each with its fingerprint: 128 candidates for 12 words, 8 for 24.",
      "With --ask-secrets the record is checked before the dates are asked for. Codes without an MNC1 header do not say how they were made: without --mode, MnemoCode asks whether Seedshift was used, and which. Where the codes of a masked record form a valid BIP39 phrase, their encoded fingerprint is shown before the dates, to compare with the one encode showed.",
      "A date may then hold ? for each forgotten digit, as in recover-date: the dates are searched, and the matches listed as recover-date lists them. Before the search the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for. It is needed where every date gives a valid phrase, as in seedshift mode; with seedshift-legacy, whose checksum sorts out most dates, it may be left out.",
      "On the private screen the codes may hold ? where one cannot be read: a word number, a word, a Unicode code or a whole color, narrowed by a few letters (ab*), words joined by |, or a ? for one digit. The right codes are told by the encoded fingerprint that encode showed, by the wallet with the dates, which may hold ? too, or by a list where they are few. A Shamir share typed in place of the codes, or read from a QR code, leads to the restore from shares, the share kept as the first; after a share from a QR code the next can be read from another.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG> | --input <TEXT>)",
    groups: [
      {
        heading: "Options:",
        options: [askSecrets, encodedFile, encodedQr, encodedText, dates, decodeMode, decodeFormat],
      },
      {
        heading: "Answers for the private screen (--ask-secrets), where dates or codes hold ?:",
        options: [
          {
            flag: "--input-kind",
            value: "codes|share",
            summary: "What a text that may be a Shamir share is read as",
            details: [
              "share restores the seed phrase from shares, the text kept as the first share; codes reads it as the encoded seed phrase. Without it, MnemoCode asks when the text is or may be a share.",
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
              "Codes are counted with every date combination they are tried with. Without it, a search that takes up to 12 hours on this computer starts at once, and a longer one is asked for. The number of combinations and their time are shown before the search starts.",
            ],
          },
          { flag: "--max-results", value: "N", summary: "Most date matches shown; default 100" },
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
      ["Search", "one longer than 12 hours, unless --max-candidates or --max-tries allows it"],
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

  "recover-date": {
    summary: "Find a forgotten digit of a date",
    about: [
      "Tries every date that fits one to three incomplete dates, where each forgotten digit is written as ?, and lists the candidates that pass a recovery check. Every check is local and offline.",
      "In the seedshift and seedshift-legacy-valid modes every date gives a valid phrase, so a recovery check is required; with --ask-secrets it is asked for after the dates when no option gives it. In seedshift-legacy mode the BIP39 checksum can be used instead, a weak filter of 4 to 8 bits.",
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
          { ...decodeMode, summary: "seedshift, seedshift-legacy or seedshift-legacy-valid" },
          decodeFormat,
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
            summary: "Most candidates shown; default 100",
          },
          {
            flag: "--progress-every",
            value: "N",
            summary: "Report progress after every N attempts; default 1000",
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
      ["List passphrase", "for a candidate list, unless --candidates-passphrase-file"],
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
      "Put ? in place of each forgotten word, ab* for a word that starts with ab, or rich|rice for one of a few words. MnemoCode tries every combination, up to 16,777,216, and lists those that pass the checksum test: for one forgotten word about 128 in a 12-word phrase, about 8 in 24 words. With one forgotten word each row shows the word, its number in the BIP39 list, the checksum bits and the whole phrase. A recovery check marks the matching rows; the other candidates are still shown. More than 2,048 candidates are not shown: save them with --candidates-file, or check them against the wallet.",
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
              "Give the 11, 14, 17, 20 or 23 words you have, in their order; every place and every word is tried.",
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
      ["List passphrase", "for a candidate list, unless --candidates-passphrase-file"],
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
      ["Shares", "shares separated by semicolons, ? for each unreadable element"],
      ["Dates", "only with --mode seedshift; ? for each forgotten digit"],
      [
        "Wallet",
        "for dates with ?, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
      ["List passphrase", "for a candidate list, unless --candidates-passphrase-file"],
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
      "Replace each unreadable element with ? at its place, on any of the shares, up to 64 on one share. In a color or the Unicode code of a word written apart, a ? may also stand for one digit, such as #B5?0?? or 4E?0, and the digits read are used; other forms take a ? only for a whole element. The shares are solved together: their checksums, the data they share and every share beyond the threshold settle most marks without trying anything, and the hash stored with the secret decides the rest. How many combinations are left, how long they take and what would help is shown first. More than one answer is listed, never chosen.",
      "A share file has one full share per line; join paper line breaks before saving it.",
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
      ["Shares", "shares separated by semicolons, ? for each unreadable element"],
      ["Dates", "only with --mode seedshift; ? for each forgotten digit"],
      [
        "Wallet",
        "when several sets of shares fit, unless an option gives it; then how many addresses, unless --scan-gap",
      ],
    ],
    examples: [
      [
        "mnemocode sskr-export --share-file ./shares.txt --cards-dir ./share-cards --card-layout collection --template business-it",
        "One collection sheet per share",
      ],
      [
        "mnemocode sskr-export --share-file ./shares.txt --cards-dir ./sskr-a6 --page-size a6 --orientation portrait",
        "The same on portrait A6 sheets",
      ],
      [
        "mnemocode sskr-export --share-file ./shares.txt --cards-dir ./share-qr --card-layout qr",
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
            value: "12|15|18|21|24",
            summary: "Length of the test phrase; default 12",
          },
          pdf,
          cardsDir,
          imagesDir,
          imageFormat,
          pageSize,
          orientation,
          cardQr,
          { flag: "--title", value: "TEXT", summary: "Collection title; default the studio name" },
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
        "Real 90 x 50 mm cards, one per page",
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
      "Prints the row of the BIP39 table that links an English word, its number from 1 to 2048 and the four-digit Unicode code of format 3, or the whole table.",
    ],
    usage: "(--word <WORD> | --index <N> | --unicode <HEX> | --all)",
    groups: [
      {
        heading: "Options (exactly one):",
        options: [
          { flag: "--word", value: "WORD", summary: "An English BIP39 word" },
          { flag: "--index", value: "N", summary: "A word number, 1 to 2048" },
          { flag: "--unicode", value: "HEX", summary: "A four-digit Unicode code, such as 5BF6" },
          { flag: "--all", summary: "The whole table: number, word and code, tab-separated" },
        ],
      },
    ],
    examples: [
      ["mnemocode table --word abandon", "The row of abandon"],
      ["mnemocode table --index 1", "The first word"],
      ["mnemocode table --unicode 5BF6", "The word with this code"],
      ["mnemocode table --all", "All 2,048 rows"],
    ],
  },

  "self-test": {
    summary: "Run the full self-test",
    about: [
      "Checks every phrase length, format and mode, the sorting of dates, the public test vectors, the 24 English BIP39 seed vectors, the date and word searches with a wallet, encrypted candidate lists, the check of a written backup, marked Shamir shares repaired together and with dates, every coin address vector, the sheet for heirs, share cards, QR images beside a sheet and card export with every kind of artwork and font. The check of each feature is also given a case it must refuse. Run it before using a newly built or copied installation.",
      "A smaller core self-test runs before every command that processes data, in about a third of a second: it checks both BIP39 word lists and fixed test phrases in every mode, and compares each feature with known answers: the BIP39 seed and fingerprint, dates with ? and |, codes and shares marked with ?, the word search, the candidate list, wallet evidence and the addresses of the twelve coins, the sheet for heirs and share cards. A failure stops the command before any input is read.",
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
          ["Words", "12   15   18   21   24"],
          ["Candidates", "128  64   32   16   8"],
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
    summary: "The five forms a phrase can be written in (--format)",
    sections: [
      {
        heading: "Formats:",
        rows: [
          ["1  english", "English BIP39 words"],
          ["2  indexes", "The numbers of the words in the BIP39 list, 1 to 2048, as in Seedshift"],
          [
            "3  unicode",
            "Four-digit Unicode codes of the words of the Traditional Chinese BIP39 list; only the codes are written, spaced or joined",
          ],
          [
            "4  colors-unicode",
            "The color codes of format 5, each written as two four-digit Private Use codes; all five lengths; plain text that needs no special font",
          ],
          [
            "5  colors",
            "Color codes such as #01AB63: 8 to 16 codes for 12 to 24 words, BIP39Colors-compatible for 12 and 24 words; MnemoCode also supports 15, 18 and 21. Separated or joined, in any order, but every code is needed",
          ],
        ],
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
      ["mnemocode table --word abandon", "One word in formats 1 to 3"],
    ],
  },

  cards: {
    summary: "Printing the encoded phrase as cards or material samples",
    sections: [
      {
        heading: "What a card holds:",
        paragraphs: [
          "In formats 4 and 5 the phrase is a short list of color codes. A template places them into a familiar document, such as a print studio proposal with sample business cards. Each card shows one color and its code, such as Ref. 01AB63. The printed codes are the whole value: decode turns them back into the phrase.",
          "The names, companies and contact details are a decoy that makes the cards look ordinary, invented at random unless given with --card-name and the other details. Like the photographs, they are not needed for recovery.",
        ],
      },
      {
        heading: "In the menu:",
        paragraphs: [
          'After "Also as printable cards", the menu asks how to save the cards: one PDF of A6 or A4 sheets, separate business cards in a new folder as PDF, PNG or JPEG, or images of the sheets as PNG or JPEG. Images need pdftocairo. For sheets it then asks whether to add a QR code with all the codes of the sheet. Last, for every way of saving, it asks whether to type your own details; Enter on a detail keeps it random.',
        ],
      },
      {
        heading: "Page sizes:",
        rows: [
          ["a6", "148 x 105 mm: one sheet with the whole collection (the default)"],
          ["a4", "210 x 297 mm: one sheet"],
          ["business", "90 x 50 mm: separate numbered cards, one per page or file"],
        ],
      },
      {
        heading: "Separate cards:",
        paragraphs: [
          "Three designs put four, six or eight codes on each card. Separate cards never carry a QR code. Every card is needed to recover the phrase, and each reveals part of it: this is not Shamir sharing.",
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
