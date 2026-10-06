// The words of the optional sheet for heirs (encode --heir-sheet, README "Instructions for heirs").
// It says what the backup is and how to restore it with the menu, and leaves room for a hint
// written by hand. It never names anything that would help whoever finds it: no codes, no dates,
// no fingerprint (it would let a finder test guessed dates) and no places where shares are kept
// (listing them all on one sheet would undo the point of splitting the backup). It prints one
// address, the repository's, whose README leads to the guide for heirs (docs/HEIRS.md). Nothing
// else is linked: the sheet may be kept for decades, and a page elsewhere can change, vanish, or
// pass to someone who abuses its address.

import { MNEMOCODE_VERSION } from "../version.js";
// The renderer takes its font through the platform interface; Node.js supplies it here.
import "../export/platform-node.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import {
  A5,
  A6,
  renderHeirSheet,
  type HeirSheetFormat,
  type HeirSheetSection,
  type HeirSheetText,
} from "../export/heir-sheet.js";
import { type ParsedArguments, value } from "./arguments.js";
import type { EncodedFormat } from "./input.js";
import type { ShareFormat } from "./sskr-command.js";
import { README_URL, terminalNotice } from "./terminal.js";

/** What was made: the seed phrase in one encoded form, or Shamir shares of it. */
export type HeirBackup =
  | { readonly kind: "encoded"; readonly format: EncodedFormat }
  | {
      readonly kind: "shares";
      readonly format: ShareFormat;
      readonly threshold: number;
      readonly count: number;
    };

export interface HeirSheetFacts {
  readonly backup: HeirBackup;
  readonly mode: "direct" | "seedshift" | "seedshift-legacy";
  /** How many dates mask the seed phrase; none in direct mode. */
  readonly dates: number;
}

/**
 * The menu entries, questions and answers that the steps name. A test checks them against the
 * menu (src/cli/menu.ts), so that the sheet leads through the menu as it is.
 */
export const HEIR_MENU = {
  decode: {
    entry: "2 Decode numbers, codes or colors back into a seed phrase",
    source: "Type or paste it",
    question: "Was Seedshift used when it was encoded?",
    answers: {
      direct: "No",
      seedshift: "MnemoCode Seedshift",
      "seedshift-legacy": "Original Seedshift",
    },
  },
  restore: {
    entry: "3 Restore a seed phrase from Shamir shares",
    question: "Was Seedshift used before it was split?",
    answers: { direct: "No", seedshift: "Yes" },
  },
  recover: { digit: 4, entry: "4 Find a forgotten word of a seed phrase or a date digit" },
} as const;

/** How each encoded form looks, so that an heir recognises the backup. */
const ENCODED_LOOKS: Readonly<Record<EncodedFormat, string>> = {
  english: "English words that look like a seed phrase but are masked",
  indexes: "numbers from 1 to 2048, one per word",
  unicode: "codes of four digits and letters A to F, one per word",
  colors: "color codes such as #1EAB91, on paper or on printed cards",
  "colors-unicode": "codes of digits and letters A to F that stand for colors",
};

/** How each share format looks. */
const SHARE_LOOKS: Readonly<Record<ShareFormat, string>> = {
  words: "words such as tuna next keep gyro",
  ur: "codes that start with ur:sskr/",
  colors: "color codes such as #1EAB91, on paper or on printed cards",
};

function needs({ backup, mode, dates }: HeirSheetFacts): string[] {
  const lines =
    backup.kind === "shares"
      ? [
          `Any ${backup.threshold} of the ${backup.count} Shamir shares, written as ${SHARE_LOOKS[backup.format]}.`,
        ]
      : mode === "direct" && backup.format === "english"
        ? ["The seed phrase itself: English words, not masked."]
        : [`The backup: ${ENCODED_LOOKS[backup.format]}.`];
  lines.push(
    mode === "direct"
      ? "No secret dates are needed."
      : dates === 1
        ? "The owner's secret date (see the back). It is written nowhere; the hint may lead to it."
        : `The owner's ${dates} secret dates (see the back). They are written nowhere; the hint may lead to them.`,
  );
  return lines;
}

function steps({ backup, mode, dates }: HeirSheetFacts): string[] {
  const restore = "Open the wallet with this seed phrase in a wallet program (see below).";
  if (backup.kind === "encoded" && backup.format === "english" && mode === "direct")
    return [restore];
  // As the prompts ask for them (datesPrompt, and the share prompt of sskr-command.ts).
  const withDates =
    mode === "direct"
      ? ""
      : `, then the secret ${dates === 1 ? "date" : "dates"} as day-month-year (23-09-2026)`;
  const start = [
    `On a computer you trust, open ${README_URL}, download MnemoCode under "Releases" and check it as the guide for heirs there says.`,
    "Go offline, then start MnemoCode by a double-click: it shows a menu.",
  ];
  if (backup.kind === "shares") {
    if (mode === "seedshift-legacy") throw new Error("Shares cannot use the original Seedshift.");
    const { entry, question, answers } = HEIR_MENU.restore;
    return [
      ...start,
      `Choose "${entry}". To "${question}" answer "${answers[mode]}".`,
      `Type any ${backup.threshold} shares, separated by ";"${withDates}. MnemoCode shows the seed phrase.`,
      restore,
    ];
  }
  const { entry, source, question, answers } = HEIR_MENU.decode;
  return [
    ...start,
    `Choose "${entry}", then "${source}". To "${question}" answer "${answers[mode]}".`,
    `Type the backup${withDates}. MnemoCode shows the seed phrase.`,
    restore,
  ];
}

function trouble({ mode }: HeirSheetFacts): string {
  const mistyped =
    "An error usually means a mistyped code or word: check each one against the paper.";
  if (mode === "direct") return mistyped;
  return `${mistyped} If a digit of a date is unclear, menu entry ${HEIR_MENU.recover.digit} tries every possibility.`;
}

function hintNote({ mode }: HeirSheetFacts): string {
  const note = "By hand: what only your heirs will understand";
  return mode === "direct" ? `${note}.` : `${note}, never the dates themselves.`;
}

/** The back: what someone who has never used a wallet needs to know first. */
function basics({ mode }: HeirSheetFacts): HeirSheetSection[] {
  const sections: HeirSheetSection[] = [
    {
      heading: "Seed phrase",
      paragraphs: [
        "Cryptocurrency is recorded on a public ledger, not at a bank. Whoever knows the seed phrase of a wallet, 12 to 24 English words from the BIP39 list, can spend what it holds; any BIP39 wallet program opens it.",
      ],
    },
  ];
  if (mode !== "direct")
    sections.push({
      heading: "Secret dates",
      paragraphs: [
        // The example is the one of the README (How checksum-valid Seedshift works).
        'The owner masked the words with dates of their choosing, such as birthdays: the year, month and day of each date move the words along the BIP39 list of 2048 words, like a simple cipher (with 23-09-2026, "abandon" becomes "wool"). Only the same dates move them back; a wrong date gives no error, just another seed phrase with an empty wallet. The dates have nothing to do with today\'s date.',
      ],
    });
  sections.push(
    {
      heading: "Opening the wallet",
      paragraphs: [
        'Install a well-known wallet program from its own website, choose "Restore" (not "Create") and type the seed phrase. Wallet empty? Check the dates, try the program the owner used, or look for a BIP39 passphrase, an extra word that MnemoCode does not keep. Then move everything to a new wallet of your own.',
      ],
    },
    {
      heading: "Scams",
      paragraphs: [
        "Nobody honest asks for a seed phrase; whoever has it can take everything for good. For help, ask someone you trust to sit beside you, and keep the words in your own hands.",
      ],
    },
  );
  return sections;
}

export function heirSheetText(facts: HeirSheetFacts): HeirSheetText {
  return {
    title: "How to restore this wallet backup",
    subtitle: `Made with MnemoCode ${MNEMOCODE_VERSION}, free and offline.`,
    newcomer: 'The steps are on the back. New to wallets? Read "The basics" there first.',
    needs: needs(facts),
    hintNote: hintNote(facts),
    steps: steps(facts),
    trouble: trouble(facts),
    warning: `Never type the backup${facts.mode === "direct" ? "" : ", the dates"} or the seed phrase into a website or send them to anyone.`,
    footer: "This sheet holds no secret. Keep it apart from the backup.",
    basicsTitle: "The basics",
    basics: basics(facts),
  };
}

/** The sizes that --heir-sheet-size takes; A5 unless it says otherwise. */
const SHEET_SIZES: Readonly<Record<string, HeirSheetFormat>> = { a5: A5, a6: A6 };

/** The size of the sheet; checked before any secret is asked (validateHeirSheetOptions). */
function sheetFormat(args: ParsedArguments): HeirSheetFormat {
  const size = value(args, "heir-sheet-size") ?? "a5";
  const format = Object.hasOwn(SHEET_SIZES, size) ? SHEET_SIZES[size] : undefined;
  if (format === undefined)
    throw new Error("The size of the instructions for heirs must be a5 or a6.");
  return format;
}

/** Refuses a size without a sheet, or a size that does not exist. */
export function validateHeirSheetOptions(args: ParsedArguments): void {
  if (args["heir-sheet-size"] !== undefined && args["heir-sheet"] === undefined)
    throw new Error("--heir-sheet-size needs --heir-sheet.");
  sheetFormat(args);
}

/** Saves the sheet when --heir-sheet names a file, never over an existing one. */
export async function saveHeirSheet(args: ParsedArguments, facts: HeirSheetFacts): Promise<void> {
  const path = value(args, "heir-sheet");
  if (path === undefined) return;
  const bytes = await renderHeirSheet(heirSheetText(facts), sheetFormat(args));
  await publishNewPrivateFile(path, bytes);
  terminalNotice(`Saved instructions for heirs: ${path}`, "success");
}
