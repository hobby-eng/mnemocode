// The command lines that the start menu builds, walked with the questions answered by a script
// (menu-script.ts): every path through an entry's questions, the line of given answers, and the
// checks that the commands make of the options of cards. Public test data only.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { parseArguments, value } from "../../src/cli/arguments.js";
import { businessOptions } from "../../src/cli/business-options.js";
import { validateCardOptions } from "../../src/cli/card-options.js";
import { imageFormat } from "../../src/cli/image-options.js";
import { MENU_ENTRIES } from "../../src/cli/menu.js";
import { MENU_ENTRY_NAMES as ENTRY, type MenuEntryName } from "../../src/cli/menu-entries.js";
import { resolveSskrLayout } from "../../src/export/sskr-content.js";
import { COIN_ADDRESS_ANSWERS } from "./coin-addresses.js";
import { script } from "./menu-script.js";

/** Questions whose answers all lead to command lines of the same shape; only the first is taken. */
const SAME_SHAPE = new Set(["Which card design?"]);

/**
 * Questions whose other answers only add options of their own, the same under every path: they
 * are taken where the question is first asked, and elsewhere only its first answer.
 */
const TAKEN_ONCE = new Set([
  "Type your own details for the cards?",
  "Which coin is the address for?",
  // Each other answer adds --orientation alone, the same for every layout of sheets.
  "How should the sheets be turned?",
]);

/** The usual answer of each typed question without a fallback, as public test data. */
const USUAL: Readonly<Record<string, string>> = {
  Word: "abandon",
  "Word number": "1",
  "Unicode code": "5BF6",
  "How many shares in all? (2 to 16)": "7",
  "How many of them restore the seed phrase?": "4",
  // The public test phrase's fingerprint and its first native SegWit address.
  "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.)":
    "73c5da0a",
  "Bitcoin address (one of the first receiving ones)": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  // The public test phrase\'s first address in each other coin.
  ...COIN_ADDRESS_ANSWERS,
  // A public test key: the recipient of a key that is thrown away.
  "Scanner key": "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x",
  // Invented details for the cards, as the decoy that they are.
  "Name, in Latin letters": "Ann Lee",
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

/** A folder of files for the questions that read one: a record and a QR code image. */
export let files = "";

/**
 * Before the tests, the folder of `files` and the usual answers; before each, no typed answers
 * and no lines asked; after them, the folder removed.
 */
export function answeredByScript(): void {
  beforeAll(async () => {
    files = await mkdtemp(join(tmpdir(), "mnemocode-menu-"));
    await writeFile(join(files, "record.txt"), "MNC1\n");
    await writeFile(join(files, "qr.png"), "");
    await mkdir(join(files, "folder"));
    script.usual = {
      ...USUAL,
      "Record file name": join(files, "record.txt"),
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
  });
}

/** Every command line after a fixed answer prefix, or the whole entry when it is empty. */
export async function everyPath(
  entry: (typeof MENU_ENTRIES)[number],
  prefix: readonly number[] = [],
): Promise<string[][]> {
  const runs: string[][] = [];
  const pending: number[][] = [[...prefix]];
  const taken = new Set<string>();
  while (pending.length > 0) {
    script.answers = pending.pop()!;
    script.asked = [];
    const action = await entry.action();
    if (typeof action === "object" && action !== null) runs.push([...action.run]);
    // Every other answer to a question asked after the scripted ones is a path of its own.
    for (let index = script.answers.length; index < script.asked.length; index += 1) {
      const { question, count } = script.asked[index]!;
      if (SAME_SHAPE.has(question) || taken.has(question)) continue;
      if (TAKEN_ONCE.has(question)) taken.add(question);
      const before = script.asked.slice(0, index).map((_, place) => script.answers[place] ?? 0);
      for (let other = 1; other < count; other += 1) pending.push([...before, other]);
    }
  }
  return runs;
}

/** The --format numbers as the encoded forms that validateCardOptions takes. */
const FORM_OF_NUMBER = { "3": "unicode", "4": "colors-unicode", "5": "colors" } as const;

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
    resolveSskrLayout(value(parsed, "card-layout") as never, settings.pageSize);
  else
    validateCardOptions(
      parsed,
      FORM_OF_NUMBER[value(parsed, "format") as keyof typeof FORM_OF_NUMBER],
    );
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
  const action = await MENU_ENTRIES.find((shown) => shown.digit === entry.digit)!.action();
  return typeof action === "object" ? action.run : undefined;
}

/** The warnings shown above the typed question `question`, in order. */
export function warningsAt(question: string): (string | undefined)[] {
  return script.lines.filter((line) => line.question === question).map((line) => line.warning);
}

/** Colors, no Seedshift, no shares, printable cards. */
export const SINGLE = [2, 1, 0, 3];
/** Colors, no Seedshift, 2 of 3 shares, printable cards. */
export const SHARES = [2, 1, 1, 2];

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
