// The command lines that the start menu builds, walked with the questions answered by a script
// (menu-script.ts): every path through an entry's questions, the line of given answers, and the
// checks that the commands make of the options of cards. The questions draw on standard error, in
// colour, which only the script reads. Public test data only.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { parseArguments, value } from "../../src/cli/arguments.js";
import { businessOptions } from "../../src/cli/business-options.js";
import { validateCardOptions } from "../../src/cli/card-options.js";
import { imageFormat } from "../../src/cli/image-options.js";
import { MENU_ENTRIES } from "../../src/cli/menu.js";
import { MENU_ENTRY_NAMES as ENTRY, type MenuEntryName } from "../../src/cli/menu-entries.js";
import { encodeFormat } from "../../src/cli/input.js";
import { AnswerRecord } from "../../src/cli/terminal-choice.js";
import { parseSskrLayout, resolveSskrLayout } from "../../src/export/sskr-content.js";
import { COIN_ADDRESS_ANSWERS } from "./coin-addresses.js";
import { script } from "./menu-script.js";
import { FINGERPRINT_PROMPT } from "./prompts.js";
import { TEST_ADDRESS, TEST_FINGERPRINT } from "./test-phrase.js";

/** The public recipient of a disposable Scanner key, used by menu tests. */
export const PUBLIC_SCANNER_KEY = "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x";
/** The list question that chooses a card design. */
export const CARD_DESIGN_QUESTION = "Which card design?";
/** The list question that chooses the coin of a wallet reference. */
export const COIN_QUESTION = "Which coin is the address for?";
/** The list question that chooses sheet orientation. */
export const SHEET_ORIENTATION_QUESTION = "How should the sheets be turned?";
/** The list question that enables typed card details. */
export const CARD_DETAILS_QUESTION = "Type your own details for the cards?";
/** The typed question of the share threshold. */
export const SHARE_THRESHOLD_QUESTION = "How many of them restore the seed phrase?";
/** The typed question of the number of shares. */
export const SHARE_COUNT_QUESTION = "How many shares in all? (2 to 16)";
/** The typed question of a Bitcoin address used to recognise the wallet. */
export const BITCOIN_ADDRESS_QUESTION = "Bitcoin address (one of the first receiving ones)";
/** The typed prompt for the card's name. */
export const CARD_NAME_PROMPT = "Name, in Latin letters";
/** The typed prompt for a record destination. */
export const RECORD_FILE_PROMPT = "Record file name";
/** The question that enables the complete-backup QR on sheets. */
export const BACKUP_QR_QUESTION =
  "Add a QR code with the codes of the backup, without the extra cards?";

/** Questions whose answers all lead to command lines of the same shape; only the first is taken. */
const SAME_SHAPE = new Set([CARD_DESIGN_QUESTION]);

/**
 * Questions whose other answers only add options of their own, the same under every path: they
 * are taken where the question is first asked, and elsewhere only its first answer.
 */
const TAKEN_ONCE = new Set([
  CARD_DETAILS_QUESTION,
  COIN_QUESTION,
  // Each other answer adds --orientation alone, the same for every layout of sheets.
  SHEET_ORIENTATION_QUESTION,
]);

/**
 * The usual answer of each typed question without a fallback, as public test data. The details
 * of the cards are left random (Enter): Encode draws its cards to check a detail typed for them
 * (cards-fit.ts), which takes seconds, so only the tests of typed details type them
 * (typedCardDetails).
 */
export const USUAL: Readonly<Record<string, string>> = {
  Word: "abandon",
  "Word number": "1",
  "Unicode code": "5BF6",
  [SHARE_COUNT_QUESTION]: "7",
  [SHARE_THRESHOLD_QUESTION]: "4",
  // The public test phrase's fingerprint and its first native SegWit address.
  [FINGERPRINT_PROMPT]: TEST_FINGERPRINT,
  [BITCOIN_ADDRESS_QUESTION]: TEST_ADDRESS,
  // The public test phrase's first address in each other coin.
  ...COIN_ADDRESS_ANSWERS,
  // A public test key: the recipient of a key that is thrown away.
  "Scanner key": PUBLIC_SCANNER_KEY,
};

/** Invented details for the cards, as the decoy that they are, by their question. */
const CARD_DETAILS: Readonly<Record<string, string>> = {
  [CARD_NAME_PROMPT]: "Ann Lee",
  Role: "Architect",
  Company: "Example Studio",
  Email: "ann@example.com",
  Phone: "+1 555 0100",
  Website: "example.com",
  Location: "Remote",
  "Studio name": "Example Works",
  Slogan: "-",
  Subtitle: "Selected works",
  Footer: "Printed with care",
  "Label before each code": "No.",
};

/**
 * Every detail of the cards (CARD_DETAILS) typed each of `times` times that it is asked, as the
 * typed answers of runOf.
 */
export function typedCardDetails(times = 1): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(CARD_DETAILS).map(([question, answer]) => [
      question,
      Array<string>(times).fill(answer),
    ]),
  );
}

/** A folder of files for the questions that read one: a record and a QR code image. */
export let files = "";

/** The writer of standard error, which answeredByScript replaces while a test runs. */
// oxlint-disable-next-line typescript/unbound-method -- kept to be put back on process.stderr
const originalWrite = process.stderr.write;

/**
 * Before the tests, the folder of `files` and the usual answers; before each, no typed answers
 * and no lines asked, and standard error a terminal in colour that no one reads: the colour tells
 * the label of each line of the record of answers (recordLabel); after each, standard error and
 * the colour settings put back; after them, the folder removed.
 */
export function answeredByScript(): void {
  beforeAll(async () => {
    files = await mkdtemp(join(tmpdir(), "mnemocode-menu-"));
    await writeFile(join(files, "record.txt"), "MNC1\n");
    await writeFile(join(files, "qr.png"), "");
    await mkdir(join(files, "folder"));
    script.usual = {
      ...USUAL,
      [RECORD_FILE_PROMPT]: join(files, "record.txt"),
      "QR code file name": join(files, "qr.png"),
    };
  });
  afterAll(async () => {
    await rm(files, { recursive: true, force: true });
  });
  beforeEach(() => {
    script.typed = {};
    script.lines = [];
    script.noImages = false;
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("NO_COLOR", undefined);
    // Replaced by hand, not with vi.spyOn: a spy keeps every call it sees, and the walk through
    // every path writes so much that the kept calls would take gigabytes.
    process.stderr.write = () => true;
  });
  afterEach(() => {
    process.stderr.write = originalWrite;
    vi.unstubAllEnvs();
  });
}

/** Runs `entry` as the menu does a task, with a record of answers of its own. */
function runTask(entry: (typeof MENU_ENTRIES)[number]): ReturnType<typeof entry.action> {
  AnswerRecord.start();
  return entry.action();
}

/**
 * One of `of` parts of a walk (everyPath), so that a walk too long for one test is several: the
 * paths whose first PART_ANSWERS answers after the walk's prefix add up to `part`, modulo `of`.
 */
export interface WalkPart {
  readonly part: number;
  readonly of: number;
}

/**
 * How many answers after its prefix put a path in its part of a walk. A path that ends before
 * them goes on with first answers, which add nothing, but may lead to paths of any part: every
 * part takes it.
 */
const PART_ANSWERS = 3;

/**
 * Every command line after a fixed answer prefix, or the whole entry when it is empty; in `share`
 * only its part of them (WalkPart), every part by default.
 */
export async function everyPath(
  entry: (typeof MENU_ENTRIES)[number],
  prefix: readonly number[] = [],
  share: WalkPart = { part: 0, of: 1 },
): Promise<string[][]> {
  const runs: string[][] = [];
  const pending: number[][] = [[...prefix]];
  const taken = new Set<string>();
  const decided = prefix.length + PART_ANSWERS;
  const inPart = (answers: readonly number[]): boolean =>
    answers.length < decided ||
    answers.slice(prefix.length, decided).reduce((sum, answer) => sum + answer, 0) % share.of ===
      share.part;
  while (pending.length > 0) {
    script.answers = pending.pop()!;
    script.asked = [];
    const action = await runTask(entry);
    if (typeof action === "object" && action !== null) runs.push([...action.run]);
    // Every other answer to a question asked after the scripted ones is a path of its own.
    for (let index = script.answers.length; index < script.asked.length; index += 1) {
      const { question, labels } = script.asked[index]!;
      if (SAME_SHAPE.has(question) || taken.has(question)) continue;
      if (TAKEN_ONCE.has(question)) taken.add(question);
      const before = script.asked.slice(0, index).map((_, place) => script.answers[place] ?? 0);
      for (let other = 1; other < labels.length; other += 1)
        if (inPart([...before, other])) pending.push([...before, other]);
    }
  }
  return runs;
}

/**
 * Checks the options of a command line for cards as the commands check them before asking for a
 * secret: the details and the page size, the image format, and for a single copy the card options
 * of its form, for shares the layout of their cards.
 */
export function assertCardOptions(
  command: string,
  parsed: ReturnType<typeof parseArguments>,
): void {
  if (parsed.template === undefined || command === "preview") return;
  const settings = businessOptions(parsed);
  if (parsed["image-format"] !== undefined) imageFormat(parsed);
  if (parsed.sskr === true)
    resolveSskrLayout(parseSskrLayout(value(parsed, "card-layout")), settings.pageSize);
  else validateCardOptions(parsed, encodeFormat(value(parsed, "format")));
}

/** The command line that `answers` give in `entry`, with `typed` for its typed questions. */
export async function runOf(
  entry: MenuEntryName,
  answers: number[],
  typed: Record<string, string[]> = {},
): Promise<readonly string[] | undefined> {
  script.answers = answers;
  script.asked = [];
  script.typed = typed;
  const action = await runTask(MENU_ENTRIES.find((shown) => shown.digit === entry.digit)!);
  return typeof action === "object" ? action.run : undefined;
}

/** The warnings shown above the typed question `question`, in order. */
export function warningsAt(question: string): (string | undefined)[] {
  return script.lines.filter((line) => line.question === question).map((line) => line.warning);
}

/** Colors, no Seedshift, no shares, printable cards. */
export const SINGLE = [4, 1, 0, 2];
/** Colors, no Seedshift, 2 of 3 shares, printable cards. */
export const SHARES = [4, 1, 1, 2];

/**
 * The options after --template and its design, for the answers to the card questions: the
 * kind of file, the layout, the design, then the QR code and the details on sheets.
 */
export async function cardOptions(start: number[], answers: number[]): Promise<readonly string[]> {
  const run = (await runOf(ENTRY.encode, [...start, ...answers]))!;
  const end = run.indexOf("--heir-sheet");
  return run.slice(run.indexOf("--template") + 2, end < 0 ? undefined : end);
}

/**
 * The Find entry, a digit of a date, typed, all the codes typed, MnemoCode Seedshift, the wallet.
 */
export const DATE_WALLET = [2, 0, 0, 0];

/** The POSIX shells to paste into: sh, and bash and zsh where they are installed. */
export const POSIX_SHELLS = [
  "sh",
  ...(process.platform === "win32" ? [] : ["bash", "zsh"]).filter(
    (shell) => spawnSync(shell, ["-c", "true"]).status === 0,
  ),
];
