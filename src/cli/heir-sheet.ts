// The sheet for heirs on the command line (encode --heir-sheet): its route through the start menu,
// its size, and saving it. The words are the library's (export/heir-sheet-text.ts), the layout too
// (export/heir-sheet.ts); the route names the menu's entries, questions and answers, and the one
// address it prints is the repository's, whose README leads to the guide for heirs.

// The renderer takes its font through the platform interface; Node.js supplies it here.
import { nodeRenderPlatform } from "../export/platform-node.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import {
  renderHeirSheet,
  type HeirSheetFormat,
  type HeirSheetText,
  parseHeirSheetSize,
} from "../export/heir-sheet.js";
import {
  HeirInstructions,
  type HeirMode,
  type HeirRoute,
  type HeirSheetFacts,
  type HeirShareMode,
} from "../export/heir-sheet-text.js";
import { type ParsedArguments, value } from "./arguments.js";
import {
  MENU_ENTRY_NAMES,
  PHRASE_WORDS_QUESTION,
  phraseWordsAnswer,
  shownEntry,
  TYPED_SOURCE,
} from "./menu-entries.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { README_URL, terminalNotice } from "./terminal.js";
import {
  answerLabel,
  ENCODED_SEEDSHIFT_QUESTION,
  SHARE_SEEDSHIFT_CHOICES,
  SHARE_SEEDSHIFT_QUESTION,
  ENCODED_SEEDSHIFT_CHOICES,
} from "./seedshift-choices.js";
import { SHARE_SEPARATOR } from "../sskr/share-input.js";
import type { Bip39WordCount } from "../core/bip39-sizes.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.heir-sheet", {
  "heir-sheet-size-heir-sheet": () => "--heir-sheet-size needs --heir-sheet.",
});

export type { HeirBackup, HeirSheetFacts } from "../export/heir-sheet-text.js";

/**
 * The menu entries, questions and answers that the steps name, the entries as menu-entries.ts
 * names them. A test checks them against the menu (src/cli/menu.ts), so that the sheet leads
 * through the menu as it is.
 */
export const HEIR_MENU = {
  decode: {
    entry: shownEntry(MENU_ENTRY_NAMES.decode),
    source: TYPED_SOURCE,
    wordsQuestion: PHRASE_WORDS_QUESTION,
    question: ENCODED_SEEDSHIFT_QUESTION,
    answers: {
      direct: answerLabel(ENCODED_SEEDSHIFT_CHOICES, "direct"),
      seedshift: answerLabel(ENCODED_SEEDSHIFT_CHOICES, "seedshift"),
      "seedshift-legacy": answerLabel(ENCODED_SEEDSHIFT_CHOICES, "seedshift-legacy"),
    },
  },
  restore: {
    entry: shownEntry(MENU_ENTRY_NAMES.restore),
    question: SHARE_SEEDSHIFT_QUESTION,
    answers: {
      direct: answerLabel(SHARE_SEEDSHIFT_CHOICES, "direct"),
      seedshift: answerLabel(SHARE_SEEDSHIFT_CHOICES, "seedshift"),
    },
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
 * prompts: the backup or the shares separated by SHARE_SEPARATOR (the share prompt of
 * share-repair.ts), then the dates (datesPrompt).
 */
const MENU_ROUTE: HeirRoute = {
  subtitle: `Made with MnemoCode ${MNEMOCODE_VERSION}, free and offline.`,
  address: README_URL,
  start: [
    `On a computer you trust, open ${README_URL}, download MnemoCode under "Releases" and check it as the guide for heirs there says.`,
    "Go offline, then start MnemoCode by a double-click: it shows a menu.",
  ],
  decode(mode: HeirMode, words: Bip39WordCount, dates: string | undefined): string[] {
    const { entry, source, wordsQuestion, question, answers } = HEIR_MENU.decode;
    return [
      `Choose "${entry}", then "${source}". To "${wordsQuestion}" answer "${phraseWordsAnswer(words)}", and to "${question}" answer "${answers[mode]}".`,
      `Type the backup${thenDates(dates)}. MnemoCode shows the seed phrase.`,
    ];
  },
  restore(mode: HeirShareMode, threshold: number, dates: string | undefined): string[] {
    const { entry, question, answers } = HEIR_MENU.restore;
    return [
      `Choose "${entry}". To "${question}" answer "${answers[mode]}".`,
      `Type any ${threshold} shares, separated by "${SHARE_SEPARATOR}"${thenDates(dates)}. MnemoCode shows the seed phrase.`,
    ];
  },
  dateDigitHelp: `If a digit of a date is unclear, menu entry ${HEIR_MENU.recover.digit} tries every possibility.`,
};

const MENU_INSTRUCTIONS = new HeirInstructions(MENU_ROUTE);

/** The words of the sheet for `facts`, with the steps through the start menu. */
export function heirSheetText(facts: HeirSheetFacts): HeirSheetText {
  return MENU_INSTRUCTIONS.text(facts);
}

/** The size of the sheet; checked before any secret is asked (validateHeirSheetOptions). */
function sheetFormat(args: ParsedArguments): HeirSheetFormat {
  return parseHeirSheetSize(value(args, "heir-sheet-size"));
}

/** Refuses a size without a sheet, or a size that does not exist. */
export function validateHeirSheetOptions(args: ParsedArguments): void {
  if (args["heir-sheet-size"] !== undefined && args["heir-sheet"] === undefined)
    throw ERRORS.create("heir-sheet-size-heir-sheet", []);
  sheetFormat(args);
}

/** Saves the sheet when --heir-sheet names a file, never over an existing one. */
export async function saveHeirSheet(args: ParsedArguments, facts: HeirSheetFacts): Promise<void> {
  const path = value(args, "heir-sheet");
  if (path === undefined) return;
  const bytes = await renderHeirSheet(nodeRenderPlatform, heirSheetText(facts), sheetFormat(args));
  await publishNewPrivateFile(path, bytes);
  terminalNotice(`Saved instructions for heirs: ${path}`, "success");
}
