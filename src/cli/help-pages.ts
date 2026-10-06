// The text of `mnemocode --help`, of `mnemocode <command> --help` and of the help topics.
// usage.ts lays it out. Every option a command accepts (command-options.ts) appears in its page,
// and a test checks that.

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
    "The image is read on this computer. It may be up to 16 MiB and 4096 pixels on a side. A QR code holds no header, so give --mode for a masked record.",
  ],
};

const decodeMode: HelpOption = {
  flag: "--mode",
  value: "MODE",
  summary: "direct, seedshift, seedshift-legacy or seedshift-legacy-valid",
  details: [
    "Needed for typed text, terminal output and QR codes, which carry no header. A file saved with --output names its mode; a --mode that contradicts it stops the command. See mnemocode help modes.",
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
  heading: "Details printed on the cards (decoration, not needed for recovery):",
  options: identityOptions,
};

const cardLayout: HelpOption = {
  flag: "--card-layout",
  value: "qr|collection|individual",
  summary: "How each share is printed; follows the page size if omitted",
  details: [
    "qr: one document with a QR code per share, in any page size. collection: one sheet per share (a6 or a4); --card-qr adds a QR code. individual: numbered business cards without a QR code; every card of a share is needed to rebuild that share.",
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
  heading: "Recovery checks (one of the first six marks the matching candidates):",
  options: [
    {
      flag: "--master-fingerprint",
      value: "HEX",
      summary: "The BIP32 master fingerprint, eight hexadecimal digits",
      details: ["It has only 32 bits, so it is a filter and not a proof."],
    },
    {
      flag: "--bitcoin-address",
      value: "ADDRESS",
      summary: "A Bitcoin address of the wallet at the selected place",
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
      summary: "A 33-byte compressed public key at the selected place",
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
    { flag: "--index", value: "N", summary: "Address number; default 0" },
  ],
};

const shareInputs: readonly HelpOption[] = [
  {
    flag: "--share",
    value: "TEXT",
    summary: "One complete share as text; repeat for each share",
    details: ["ur:sskr/..., Bytewords or MnemoCode share colors; the form is found automatically."],
  },
  {
    flag: "--share-file",
    value: "PATH",
    summary: "A file with one complete share per line; may be repeated",
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
              "1 english words, 2 indexes, 3 unicode codes, 4 colors-unicode, 5 colors. Cards need 4 or 5. See mnemocode help formats.",
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
              "The record starts with MNC1:<mode>:<format>:, so decode needs only the file and the dates. Dates are never stored. A taken name is numbered, as record (1).txt, never replaced.",
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
          {
            flag: "--heir-sheet",
            value: "PATH",
            summary: "Also save one sheet that tells heirs how to restore the backup",
            details: [
              "A PDF of one sheet to print on both sides. The front says what the backup looks like, how many shares restore it and how many dates it needs, and leaves the rest of its room for a hint written by hand; the back gives the steps in the menu and the basics for someone new to wallets. It holds no secret: no codes, no dates, no fingerprint and no places. Not with --legacy-valid-last-word. See Instructions for heirs in the README.",
            ],
          },
          {
            flag: "--heir-sheet-size",
            value: "a5|a6",
            summary: "The size of that sheet; default a5",
            details: [
              "a5 is the size of a notebook, 148 x 210 mm, with larger print; a6 is the size of a postcard and of the cards, 105 x 148 mm, with small print.",
            ],
          },
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
            value: "ur|words|colors",
            summary: "How the shares are shown; default ur",
            details: [
              "ur is the standard short form, ur:sskr/... words writes the same share in standard Bytewords, one English word per byte, as other SSKR tools do. colors writes a share as color codes whose order matters; they are a different format from --format 5. A saved text file holds the shares in the same form.",
            ],
          },
          cardLayout,
        ],
      },
    ],
    asks: [
      ["Phrase", "English BIP39 words"],
      ["Dates", "one line, such as 23-09-2026 08-08-1988; none in direct mode"],
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
      "Fingerprints are calculated for an empty BIP39 passphrase. They are public identifiers, not secrets. A legacy result may not be a valid phrase, so only the original fingerprint is shown.",
      "Individual cards are not Shamir sharing: every card is needed, and each reveals a part of the encoded phrase.",
    ],
  },

  decode: {
    summary: "Turn an encoded record back into the phrase",
    about: [
      "Reads a record in any of the five formats, from text, a file or a QR code, and prints the phrase with its fingerprint. A masked record needs the same dates. A seedshift-legacy-valid record gives every possible last word, each with its fingerprint: 128 candidates for 12 words, 8 for 24.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG> | --input <TEXT>)",
    groups: [
      {
        heading: "Options:",
        options: [askSecrets, encodedFile, encodedQr, encodedText, dates, decodeMode, decodeFormat],
      },
    ],
    asks: [
      ["Encoded record", "unless --input-file or --qr-file gives it"],
      ["Dates", "one line; none in direct mode"],
    ],
    examples: [
      ["mnemocode decode --ask-secrets", "Record and dates on the private screen"],
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
      "In the seedshift and seedshift-legacy-valid modes every date gives a valid phrase, so a recovery check is required. In seedshift-legacy mode the BIP39 checksum can be used instead, a weak filter of 4 to 8 bits.",
    ],
    usage: "[OPTIONS] --dates <PATTERN ...> <RECOVERY CHECK>",
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
            summary: "The dates, with ? for each forgotten digit, such as ??-09-2026",
            details: [
              "?3-09-2026 tries days ending in 3, 0?-09-2026 days 1 to 9, ??-??-2026 every date in 2026, ????-??-?? every supported date. One to three dates may be incomplete; two identical patterns are tried once.",
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
          {
            flag: "--max-candidates",
            value: "N",
            summary: "Most dates tried; default 1000000, at most 10000000",
            details: [
              "The number of attempts is shown before the search starts. Every supported date is 3,652,059 attempts and needs --max-candidates 3652059. Large searches can take hours.",
            ],
          },
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
    ],
    asks: [
      ["Encoded record", "unless --input-file or --qr-file gives it"],
      ["Dates", "one line, with ? in place of each forgotten digit"],
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
    notes: ['Quote the patterns, as in "??-09-2026", so that the shell does not expand the ?.'],
  },

  "recover-word": {
    summary: "Find one forgotten word of a phrase",
    about: [
      "Put exactly one ? in place of the forgotten word. MnemoCode tries all 2,048 words and prints every word that passes the checksum test: about 128 for a 12-word phrase, about 8 for 24 words. Each row shows the word, its number in the BIP39 list, the checksum bits and the whole phrase. A recovery check marks the matching rows; the other candidates are still shown.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH> | --mnemonic <TEXT>)",
    groups: [
      {
        heading: "The phrase:",
        options: [
          askSecrets,
          mnemonicFile,
          { ...mnemonicText, summary: "The phrase with ? in place of the forgotten word" },
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
    ],
    asks: [["Phrase", "with ? in place of the forgotten word"]],
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
      [
        "mnemocode recover-word --legacy-valid-last-word --ask-secrets",
        "Valid last words for a stored legacy phrase",
      ],
    ],
  },

  "sskr-combine": {
    summary: "Restore a phrase from Shamir shares",
    about: [
      "Needs at least the threshold number of complete shares, in any of the share forms, which may be mixed. A damaged share, the same share twice, shares of different sets and too few shares are refused. The share library checks the restored secret against a hash stored in the shares.",
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
        ],
      },
    ],
    asks: [
      ["Shares", "complete shares separated by semicolons"],
      ["Dates", "only with --mode seedshift"],
    ],
    examples: [
      ["mnemocode sskr-combine --ask-secrets", "Shares on the private screen"],
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
    ],
  },

  "sskr-export": {
    summary: "Print existing Shamir shares as cards",
    about: [
      "Prints shares made earlier as cards, PDFs, images or a share file. It changes only the presentation and never makes new shares.",
    ],
    usage:
      "[OPTIONS] (--ask-secrets | --share <TEXT> ... | --share-file <PATH> | --share-qr <PNG>)",
    groups: [
      { heading: "The shares:", options: shareInputs },
      {
        heading: "Output:",
        options: [
          {
            flag: "--format",
            value: "ur|words|colors",
            summary: "How the shares are shown; default ur",
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
            details: ["A taken name is numbered, as shares (1).pdf, never replaced."],
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
            details: ["Each QR code holds only its own share, as color codes."],
          },
        ],
      },
      identityGroup,
    ],
    asks: [["Shares", "complete shares separated by semicolons"]],
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
          { flag: "--format", value: "ur|words|colors", summary: "The share format; default ur" },
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
        ],
      },
      identityGroup,
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
      "Checks every phrase length, format and mode, the sorting of dates, the public test vectors, writing and reading QR codes, Shamir shares and card export with every kind of artwork and font. Run it before using a newly built or copied installation.",
      "A smaller core self-test runs before every command that processes data: it checks the BIP39 word list and fixed test phrases in every mode, and a failure stops the command before any input is read.",
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
          "In formats 4 and 5 the phrase is a short list of color codes. A template places them into a familiar document, such as a print studio proposal with sample business cards. Each card shows one color and its code, such as Ref. 01AB63. The printed codes are the whole value: decode turns them back into the phrase. Names, companies and photographs are decoration.",
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
