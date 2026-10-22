// The help pages of the commands of Shamir shares: sskr-combine, sskr-export and sskr-split.
// help-pages.ts puts them among the pages of the other commands.

import { Masking } from "../core/masking.js";
import { listInWords } from "../core/places.js";
import { MASKING_MODES } from "../core/types.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../sskr/joint-repair.js";
import { SHARE_SEPARATOR } from "../sskr/share-input.js";
import { type CommandHelp } from "./help-types.js";
import {
  ASK_SECRETS,
  BACKUP_CHECK,
  CANDIDATE_LIST_GROUP,
  CARD_LAYOUT,
  DATES,
  DATES_FILE,
  ENCODE_MODE,
  HEIR_SHEET,
  HEIR_SHEET_SIZE,
  IDENTITY_GROUP,
  IMAGES_DIR,
  LIST_PASSPHRASE_ASK,
  MAX_CANDIDATES,
  MAX_TRIES,
  MNEMONIC_FILE,
  MNEMONIC_TEXT,
  ORIENTATION,
  PAGE_SIZE,
  PDF,
  SHARE_CARD_QR,
  SHARE_CARDS_DIR,
  SHARE_CARDS_NEEDED,
  SHARE_IMAGE_FORMAT,
  SHARE_INPUTS,
  SHARE_QR_DIR,
  SHARES,
  SHARE_WALLET_CHECK,
  TEMPLATE,
  THRESHOLD,
} from "./help-options.js";

/** The modes in which sskr-split splits a phrase: those of Masking.isSplitMode. */
const SPLIT_MODES = MASKING_MODES.filter((mode) => Masking.isSplitMode(mode));

/** The pages of the commands of Shamir shares. */
export const SHARE_COMMAND_HELP: Readonly<
  Record<"sskr-combine" | "sskr-export" | "sskr-split", CommandHelp>
> = {
  "sskr-combine": {
    summary: "Restore a phrase from Shamir shares",
    about: [
      "Needs at least the threshold number of shares, in any of the share forms, which may be mixed. Type each element that cannot be read as ?: the shares are then repaired together, and every phrase that passes the hash stored in the shares is listed with its fingerprint. Shares of different sets, two different shares with the same member number and too few shares are refused; a share given twice is used once.",
      "With --ask-secrets each share is read as soon as the answer is given: a share that cannot be read is named and typed again alone, and a result that cannot be used offers what to change. Where nothing tells which of two shares is wrong, such as two that are the same member of the set but differ, both are named and you choose which to change or leave out.",
      "On the private screen with --mode seedshift, complete shares show the encoded fingerprint of the masked phrase they hold before the dates are asked for, to compare with the one the split showed. A date may then hold ? for each forgotten digit, also together with ? in the shares: the dates are searched as recover-date searches them, after the wallet's fingerprint or one of its first receiving addresses, of Bitcoin or another coin, is asked for, and the work, share combinations times date combinations, is shown first.",
    ],
    usage: "[OPTIONS] (--ask-secrets | --share-file <PATH> | --share-qr <PNG>)",
    groups: [
      {
        heading: "Options:",
        options: [
          ...SHARE_INPUTS,
          {
            flag: "--mode",
            value: "MODE",
            summary: "seedshift when the phrase was masked before splitting",
            details: [
              "The mode and the dates are not stored in the shares; give the same ones as for the split.",
            ],
          },
          DATES,
          DATES_FILE,
          MAX_TRIES,
          MAX_CANDIDATES,
        ],
      },
      SHARE_WALLET_CHECK,
      CANDIDATE_LIST_GROUP,
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
        "mnemocode sskr-combine --share-file ./first-share.txt --share-file ./second-share.txt",
        "Two shares from separate protected files",
      ],
      ["mnemocode sskr-combine --share-file ./selected-shares.txt", "Shares from a file"],
      [
        "mnemocode sskr-combine --share-qr ./first.png --share-qr ./second.png",
        "Shares from QR images",
      ],
      [
        "mnemocode sskr-combine --share-file ./shares.txt --mode seedshift --dates-file dates.txt",
        "Shares of a phrase masked before splitting",
      ],
    ],
    notes: [
      SHARE_CARDS_NEEDED,
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
    usage: "[OPTIONS] (--ask-secrets | --share-file <PATH> | --share-qr <PNG>)",
    groups: [
      { heading: "The shares:", options: [...SHARE_INPUTS, MAX_TRIES, MAX_CANDIDATES] },
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
            ...PDF,
            summary: "Save all shares in one multi-page PDF",
            details: ["A taken name is numbered, as shares-1.pdf, never replaced."],
          },
          SHARE_CARDS_DIR,
          SHARE_QR_DIR,
          { ...IMAGES_DIR, summary: "Save the pages of all shares as images in a new folder" },
          SHARE_IMAGE_FORMAT,
          CARD_LAYOUT,
          { ...TEMPLATE, summary: "The card design; default business-it" },
          PAGE_SIZE,
          ORIENTATION,
          SHARE_CARD_QR,
        ],
      },
      IDENTITY_GROUP,
      {
        ...SHARE_WALLET_CHECK,
        options: [
          ...SHARE_WALLET_CHECK.options,
          {
            flag: "--mode",
            value: "seedshift",
            summary: "The phrase was masked before splitting: check the wallet after the dates",
            details: [
              "Without it the wallet check compares the phrase that the shares hold, which is the wallet of a standard split.",
            ],
          },
          DATES,
          DATES_FILE,
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
    summary: "encode --sskr, with --format for the share format",
    about: [
      "Splits the phrase like encode --sskr, but here --format selects the share format, as --share-format does there.",
    ],
    usage: "[OPTIONS] --threshold <N> --shares <M> (--ask-secrets | --mnemonic-file <PATH>)",
    groups: [
      {
        heading: "Options:",
        options: [
          ASK_SECRETS,
          MNEMONIC_FILE,
          MNEMONIC_TEXT,
          // The rule without --mode is encode's (transformMode), which its details state.
          {
            ...ENCODE_MODE,
            summary: `${listInWords(SPLIT_MODES, "or")}; see mnemocode help modes`,
          },
          DATES,
          DATES_FILE,
          THRESHOLD,
          SHARES,
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
          { ...PDF, summary: "Save all shares in one PDF" },
          SHARE_CARDS_DIR,
          SHARE_QR_DIR,
          IMAGES_DIR,
          SHARE_IMAGE_FORMAT,
          CARD_LAYOUT,
          TEMPLATE,
          PAGE_SIZE,
          ORIENTATION,
          SHARE_CARD_QR,
          HEIR_SHEET,
          HEIR_SHEET_SIZE,
          BACKUP_CHECK,
        ],
      },
      IDENTITY_GROUP,
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
};
