// The sheet for heirs on the command line (encode --heir-sheet): its route through the start menu,
// its size, and saving it. The words are the library's (export/heir-sheet-text.ts), the layout too
// (export/heir-sheet.ts); the route names the menu's entries, questions and answers, and the one
// address it prints is the repository's, whose README leads to the guide for heirs.

// The renderer takes its font through the platform interface; Node.js supplies it here.
import "../export/platform-node.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import {
  A5,
  A6,
  renderHeirSheet,
  type HeirSheetFormat,
  type HeirSheetText,
} from "../export/heir-sheet.js";
import {
  HeirInstructions,
  type HeirMode,
  type HeirRoute,
  type HeirSheetFacts,
  type HeirShareMode,
} from "../export/heir-sheet-text.js";
import { type ParsedArguments, value } from "./arguments.js";
import { MENU_ENTRY_NAMES, shownEntry } from "./menu-entries.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { README_URL, terminalNotice } from "./terminal.js";

export type { HeirBackup, HeirSheetFacts } from "../export/heir-sheet-text.js";

/**
 * The menu entries, questions and answers that the steps name, the entries as menu-entries.ts
 * names them. A test checks them against the menu (src/cli/menu.ts), so that the sheet leads
 * through the menu as it is.
 */
export const HEIR_MENU = {
  decode: {
    entry: shownEntry(MENU_ENTRY_NAMES.decode),
    source: "Type or paste it",
    question: "Was Seedshift used when it was encoded?",
    answers: {
      direct: "No",
      seedshift: "MnemoCode Seedshift",
      "seedshift-legacy": "Original Seedshift",
    },
  },
  restore: {
    entry: shownEntry(MENU_ENTRY_NAMES.restore),
    question: "Was Seedshift used before it was split?",
    answers: { direct: "No", seedshift: "Yes" },
  },
  recover: {
    digit: MENU_ENTRY_NAMES.recover.digit,
    entry: shownEntry(MENU_ENTRY_NAMES.recover),
  },
} as const;

/** ", then `dates`" after what is typed, or nothing when no dates are asked. */
function thenDates(dates: string | undefined): string {
  return dates === undefined ? "" : `, then ${dates}`;
}

/**
 * The way through MnemoCode's start menu, as a double-click opens it. What is typed follows the
 * prompts: the backup or the shares separated by ";" (the share prompt of sskr-command.ts), then
 * the dates (datesPrompt).
 */
const MENU_ROUTE: HeirRoute = {
  subtitle: `Made with MnemoCode ${MNEMOCODE_VERSION}, free and offline.`,
  address: README_URL,
  start: [
    `On a computer you trust, open ${README_URL}, download MnemoCode under "Releases" and check it as the guide for heirs there says.`,
    "Go offline, then start MnemoCode by a double-click: it shows a menu.",
  ],
  decode(mode: HeirMode, dates: string | undefined): string[] {
    const { entry, source, question, answers } = HEIR_MENU.decode;
    return [
      `Choose "${entry}", then "${source}". To "${question}" answer "${answers[mode]}".`,
      `Type the backup${thenDates(dates)}. MnemoCode shows the seed phrase.`,
    ];
  },
  restore(mode: HeirShareMode, threshold: number, dates: string | undefined): string[] {
    const { entry, question, answers } = HEIR_MENU.restore;
    return [
      `Choose "${entry}". To "${question}" answer "${answers[mode]}".`,
      `Type any ${threshold} shares, separated by ";"${thenDates(dates)}. MnemoCode shows the seed phrase.`,
    ];
  },
  dateDigitHelp: `If a digit of a date is unclear, menu entry ${HEIR_MENU.recover.digit} tries every possibility.`,
};

const MENU_INSTRUCTIONS = new HeirInstructions(MENU_ROUTE);

/** The words of the sheet for `facts`, with the steps through the start menu. */
export function heirSheetText(facts: HeirSheetFacts): HeirSheetText {
  return MENU_INSTRUCTIONS.text(facts);
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
