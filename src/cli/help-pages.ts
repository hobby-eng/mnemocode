// The text of `mnemocode --help`, of `mnemocode <command> --help` and of the help topics.
// usage.ts lays it out; the options are in help-options.ts and the pages of the share commands in
// help-share-pages.ts. Every option a command accepts (command-options.ts) appears in its page,
// and a test checks that.

import { MAX_SHOWN_MATCHES, MAX_INCOMPLETE_DATES } from "../core/date-search.js";
import type { CommandName } from "./command-options.js";
import { ENCODED_FORMATS, MASKING_MODES } from "../core/types.js";
import { COLOR_FORMAT_NUMBERS, formatNumber, FORMAT_NUMBER_RANGE } from "./format-numbers.js";
import {
  WORD_NUMBERS,
  BIP39_WORD_COUNTS,
  WORD_COUNTS_LESS_ONE_TEXT,
  BIP39_DICTIONARY_SIZE,
  checksumBits,
} from "../core/bip39-sizes.js";
import { listInWords } from "../core/places.js";
import { DEFAULT_SAMPLE_WORDS } from "../export/card-preview.js";
import {
  pageSizeLabel,
  SEPARATE_CARD_SIZE,
  SHEET_QR_HOLDS,
  SHEET_SIZES_TEXT,
} from "../export/card-settings.js";
import { SHEET_PLAN_TEXT } from "../export/collection-layout.js";
import { PROGRESS_EVERY } from "./date-search.js";
import { counting } from "../core/search-plan.js";
import { MAX_SEARCH_COMBINATIONS, MAX_SHOWN_CANDIDATES } from "../core/candidates.js";
import { QUESTION_HOURS } from "../core/search-turns.js";
import { numberWord } from "../core/prose.js";
import { COINS } from "../core/coins.js";
import { defined } from "../core/defined.js";
import { type CommandHelp, type TopicHelp } from "./help-types.js";
import { FINGERPRINT_DISCLOSURE } from "./terminal.js";
import {
  askSecrets,
  candidateListGroup,
  cardQr,
  cardsDir,
  dates,
  datesFile,
  decodeFormat,
  decodeMode,
  encodedFile,
  encodedQr,
  encodedQrOf,
  encodedText,
  encodeFormat,
  encodeLegacyValidLastWord,
  encodeMode,
  encodeOutputGroups,
  evidenceGroup,
  FORMAT_DESCRIPTIONS,
  identityGroup,
  imageFormat,
  imagesDir,
  legacyValidCandidates,
  legacyValidLastWord,
  lastWordInputs,
  LIST_PASSPHRASE_ASK,
  MASKED_MODES,
  maxCandidates,
  maxTries,
  mnemonicFile,
  mnemonicText,
  orientation,
  pageSize,
  pdf,
  phraseWords,
  recordFormatOf,
  TABLE_COLUMN,
  template,
  TEST_FINGERPRINT,
  TEST_PHRASE_VARIABLE,
  title,
} from "./help-options.js";
import { SHARE_COMMAND_HELP } from "./help-share-pages.js";

export const commandHelp: Readonly<Record<CommandName, CommandHelp>> = {
  encode: {
    summary: "Write a phrase in another form, masked with dates if given",
    about: [
      "Writes an English BIP39 phrase as words, numbers, Unicode codes or colors, after masking it with dates in seedshift mode. It can show the result in the terminal, save it as a record file or a QR code, print it as cards, or split it into Shamir shares. After encoding it prints the fingerprint of the original phrase and of the masked phrase.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH>)",
    groups: [
      {
        heading: "The phrase and the transformation:",
        options: [
          askSecrets,
          mnemonicFile,
          mnemonicText,
          encodeMode,
          dates,
          datesFile,
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
      [
        "mnemocode encode --mode seedshift --ask-secrets --format 3",
        "A real phrase, dates asked for, as Unicode",
      ],
      [
        `printf '%s\\n' ${TEST_PHRASE_VARIABLE} | mnemocode encode --mode direct --mnemonic-file - --format 5 --cards`,
        "The test phrase as colors, shown as cards in the terminal",
      ],
      [
        "mnemocode encode --mode seedshift --ask-secrets --format 1",
        "Mask the phrase with dates, both typed on the private screen",
      ],
      [
        "mnemocode encode --mnemonic-file phrase.txt --dates-file dates.txt --format 5 --output shifted.txt",
        "Use protected local files and save the record; Decode also needs the dates",
      ],
      [
        "mnemocode encode --mode seedshift-legacy --ask-secrets --format 1",
        "Use the original Seedshift mode with private inputs",
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
      `Fingerprints are calculated for an empty BIP39 passphrase. ${FINGERPRINT_DISCLOSURE} A legacy result is a valid phrase only by chance; when it is not, only the original fingerprint is shown.`,
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
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG>)",
    groups: [
      {
        heading: "Options:",
        options: [
          askSecrets,
          encodedFile,
          encodedQr,
          encodedText,
          dates,
          datesFile,
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
        "mnemocode decode --input-file shifted.txt --dates-file dates.txt",
        "A record file names its mode and format; only the dates are needed",
      ],
      [
        "mnemocode decode --mode seedshift --ask-secrets",
        "Type the Seedshift backup and its dates privately",
      ],
      [
        "mnemocode decode --mode seedshift --qr-file my-qr.png --dates-file dates.txt",
        "Read a QR code saved by encode --qr",
      ],
      [
        "mnemocode decode --mode seedshift-legacy --ask-secrets --format 3",
        "Type a legacy Unicode-code backup and its dates privately",
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
    usage: "[OPTIONS] (--ask-secrets | --input-file <PATH> | --qr-file <PNG>)",
    groups: [
      {
        heading: "The old backup:",
        options: [
          askSecrets,
          encodedFile,
          encodedQrOf("--old-mode"),
          encodedText,
          {
            ...dates,
            flag: "--old-dates",
            summary: "Refused material argument; use --old-dates-file or --ask-secrets",
          },
          {
            ...datesFile,
            flag: "--old-dates-file",
            summary: "Read the old backup's dates from a file or -",
          },
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
          ...lastWordInputs,
        ],
      },
      {
        heading:
          "The new backup (without these, --ask-secrets asks it once the phrase is confirmed):",
        options: [encodeMode, dates, datesFile, encodeFormat, encodeLegacyValidLastWord],
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
        `mnemocode re-encode --input-file shifted.txt --old-mode seedshift --old-dates-file old-dates.txt --mode direct --format 3 --master-fingerprint ${TEST_FINGERPRINT}`,
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
    usage: "[OPTIONS] (--ask-secrets | --dates-file <PATH>) [<RECOVERY CHECK>]",
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
            summary: "Refused material argument; put patterns in --dates-file or use --ask-secrets",
          },
          {
            ...datesFile,
            summary: "Read dates with ? for forgotten digits from a file or -",
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
        `mnemocode recover-date --mode seedshift --input-file shifted.txt --dates-file date-patterns.txt --master-fingerprint ${TEST_FINGERPRINT}`,
        "Find the forgotten day with the fingerprint",
      ],
      [
        "mnemocode recover-date --mode seedshift --input-file shifted.txt --dates-file date-patterns.txt --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu --bitcoin-profile native-segwit",
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
    usage: "[OPTIONS] (--ask-secrets | --mnemonic-file <PATH>)",
    groups: [
      {
        heading: "The phrase:",
        options: [
          askSecrets,
          mnemonicFile,
          mnemonicText,
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
        "mnemocode recover-word --mnemonic-file words-with-marks.txt",
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

  ...SHARE_COMMAND_HELP,

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
    usage:
      "(--word <WORD> | --index <N> | --unicode <HEX> | --all | --recovery-guide | --word-lists-dir <PATH>) [--table-format <NAME>] [--output <PATH>]",
    groups: [
      {
        heading: "Options (exactly one):",
        options: [
          { flag: "--word", value: "WORD", summary: "An English BIP39 word" },
          { flag: "--index", value: "N", summary: `A word number, ${WORD_NUMBERS}` },
          { flag: "--unicode", value: "HEX", summary: "A four-digit Unicode code, such as 5BF6" },
          { flag: "--all", summary: "The whole table: number, word and code, tab-separated" },
          {
            flag: "--recovery-guide",
            summary: "Standalone English instructions for manual recovery",
          },
          {
            flag: "--word-lists-dir",
            value: "PATH",
            summary: "Full set in a new folder: numbered lists, full mapping and guide",
          },
        ],
      },
      {
        heading: "Export:",
        options: [
          {
            flag: "--table-format",
            value: "NAME",
            summary:
              "With --all: english, chinese (Traditional), unicode or mapping; numbered from 1",
          },
          {
            flag: "--output",
            value: "PATH",
            summary: "Save the full word list or recovery guide as a UTF-8 text file",
          },
        ],
      },
    ],
    examples: [
      ["mnemocode table --word abandon", "The row of abandon"],
      ["mnemocode table --index 1", "The first word"],
      ["mnemocode table --unicode 5BF6", "The word with this code"],
      ["mnemocode table --all", `All ${counting(BIP39_DICTIONARY_SIZE)} rows`],
      [
        "mnemocode table --all --table-format mapping --output bip39-mapping.txt",
        "Save the complete English/Chinese/Unicode mapping",
      ],
      [
        "mnemocode table --recovery-guide --output manual-recovery.md",
        "Save the printable English recovery guide",
      ],
      [
        "mnemocode table --word-lists-dir ./recovery-pack",
        "Save all dictionaries and the guide in one folder",
      ],
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
            "Masks the phrase with dates. The result is always a valid BIP39 phrase, and the same dates give the original back without a search. The default when --dates-file is given.",
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
        "mnemocode encode --mode seedshift --ask-secrets --format 1",
        "Enter the phrase and its dates privately",
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
        `printf '%s\\n' ${TEST_PHRASE_VARIABLE} | mnemocode encode --mode direct --mnemonic-file - --format 3`,
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
        "mnemocode encode --mode seedshift --ask-secrets --format 5 --template business-it --pdf cards.pdf",
        "A real export; the phrase and the dates are asked on the private screen",
      ],
      ["mnemocode encode --help", "Every card option explained"],
    ],
  },
};
