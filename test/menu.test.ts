import { BIP39_WORD_COUNTS } from "../src/core/bip39-sizes.js";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The questions are answered by a script instead of a terminal: `answers` holds the place of the
// answer to each list question in turn, and `asked` records how many choices each question
// offered. A typed question takes the answers of `typed` for it in turn, then its usual one;
// as at the terminal, an answer that its check refuses is asked again, with the reason as its
// warning, and Enter alone takes the fallback or leaves an optional answer out.
const script = vi.hoisted(() => ({
  answers: [] as number[],
  asked: [] as { question: string; count: number; labels: string[]; warning?: string }[],
  lists: [] as string[][],
  explanations: [] as string[][],
  labels: [] as string[],
  typed: {} as Record<string, string[]>,
  usual: {} as Record<string, string>,
  lines: [] as { question: string; warning?: string }[],
  /** Notes and examples longer than their list's room, which the list would cut. */
  cutNotes: [] as string[],
  /** Whether pdftocairo, which images need, is missing. */
  noImages: false,
  /** The value and the key of each answer, by the question last asked with them. */
  digits: {} as Record<string, { value: unknown; digit?: number }[]>,
}));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-choice.js")>();
  return {
    ...actual,
    choose: async (
      question: string,
      choices: readonly { label: string; value: unknown }[],
      options: { readonly label: string; readonly explanation?: never; readonly warning?: string },
    ) => {
      script.labels.push(options.label);
      script.explanations.push(actual.explanationLines(options.explanation));
      const place = script.answers[script.asked.length] ?? 0;
      const labels = choices.map((choice) => choice.label);
      script.asked.push({ question, count: choices.length, labels, warning: options.warning });
      script.lists.push(actual.listLines(choices as never, place));
      script.digits[question] = (choices as readonly { value: unknown; digit?: number }[]).map(
        ({ value, digit }) => ({ value, digit }),
      );
      const room = actual.notesRoom(choices as never);
      for (const choice of choices as readonly { label: string; note?: string; example?: string }[])
        for (const text of [choice.note, choice.example])
          if (text !== undefined && [...text].length > room)
            script.cutNotes.push(`${question} ${choice.label}: ${text}`);
      return choices[place]!.value;
    },
    askLine: async (question: string, label: string, options: LineQuestion = {}) => {
      script.labels.push(label);
      for (let warning = options.warning; ;) {
        script.lines.push({ question, warning });
        const queued = script.typed[question];
        const typed = (queued?.shift() ?? script.usual[question] ?? "").trim();
        if (typed === "" && options.optional !== undefined) return "";
        const answer = typed === "" ? options.fallback : typed;
        try {
          if (answer === undefined) throw new Error(`Type ${options.what ?? "an answer"}.`);
          return options.check === undefined ? answer : await options.check(answer);
        } catch (error) {
          warning = (error as Error).message;
          // Without a further answer the walk would ask for ever.
          if (queued === undefined || queued.length === 0)
            throw new Error(`"${question}" refused "${answer}": ${warning}`);
        }
      }
    },
  };
});
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
  dropTypedAhead: async () => undefined,
}));
vi.mock("../src/export/image-export.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/export/image-export.js")>()),
  assertImageRenderer: async () => {
    if (script.noImages) throw new Error("pdftocairo is missing");
  },
}));

import { assertAllowedArguments, parseArguments, value } from "../src/cli/arguments.js";
import { businessOptions } from "../src/cli/business-options.js";
import { validateCardOptions } from "../src/cli/card-options.js";
import { commandOptions, isCommandName } from "../src/cli/command-options.js";
import { imageFormat } from "../src/cli/image-options.js";
import { ANSWER_LABEL_WIDTH, type LineQuestion } from "../src/cli/terminal-choice.js";
import { TEXT_WIDTH } from "../src/cli/terminal.js";
import { HEIR_MENU } from "../src/cli/heir-sheet.js";
import {
  ENCODED_SEEDSHIFT_QUESTION,
  SHARE_SEEDSHIFT_QUESTION,
} from "../src/cli/seedshift-choices.js";
import { commandDisplay, MENU_ENTRIES, typedCommand } from "../src/cli/menu.js";
import { MENU_ENTRY_NAMES as ENTRY, type MenuEntryName } from "../src/cli/menu-entries.js";
import { resolveSskrLayout } from "../src/export/sskr-content.js";
import { COIN_ADDRESS_ANSWERS } from "./helpers/coin-addresses.js";
import { formatNumber } from "../src/cli/format-numbers.js";

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
  "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)": "73c5da0a",
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
let files = "";
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

/** Every command line that the questions of `entry` can build, one per path through them. */
async function everyPath(entry: (typeof MENU_ENTRIES)[number]): Promise<string[][]> {
  const runs: string[][] = [];
  const pending: number[][] = [[]];
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
function assertCardOptions(command: string, parsed: ReturnType<typeof parseArguments>): void {
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
async function runOf(
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
function warningsAt(question: string): (string | undefined)[] {
  return script.lines.filter((line) => line.question === question).map((line) => line.warning);
}

describe("start menu", () => {
  it("offers the agreed entries, 1 to 9, 0 for help, and Quit without a digit", () => {
    // Quit has no digit: Escape quits too (owner, 2026-10-13).
    expect(MENU_ENTRIES.map((entry) => entry.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, null]);
    expect(MENU_ENTRIES[0]!.label).toBe("Encode a seed phrase as numbers, codes or colors");
    expect(MENU_ENTRIES[1]!.label).toBe("Re-encode a backup with other dates or in another form");
    expect(MENU_ENTRIES[2]!.label).toBe("Decode numbers, codes or colors back into a seed phrase");
    expect(MENU_ENTRIES[3]!.label).toBe("Split a seed phrase into standard Shamir shares");
    // The entries whose commands ask for a seed phrase or a share.
    expect(MENU_ENTRIES.filter((entry) => entry.asksSecrets).map((entry) => entry.digit)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it.each(MENU_ENTRIES.map((entry) => [entry.label, entry] as const))(
    "%s: every answer builds a command line that MnemoCode accepts",
    async (_, entry) => {
      script.lists = [];
      script.explanations = [];
      script.labels = [];
      script.cutNotes = [];
      for (const run of await everyPath(entry)) {
        const [command, ...rest] = run;
        expect(isCommandName(command!), typedCommand(run)).toBe(true);
        const parsed = parseArguments(rest);
        assertAllowedArguments(parsed, command!, commandOptions[command as never]);
        assertCardOptions(command!, parsed);
        // A secret never goes on the command line: a command that takes one asks for it.
        const secret = [
          "encode",
          "re-encode",
          "decode",
          "sskr-split",
          "sskr-combine",
          "recover-word",
        ];
        if (secret.includes(command!)) expect(parsed["ask-secrets"], typedCommand(run)).toBe(true);
      }
      // Lists and explanations fit a terminal of 80 columns unwrapped (TEXT_WIDTH), and no note of a
      // list is cut to fit.
      for (const line of [...script.lists.flat(), ...script.explanations.flat()])
        expect([...line].length, line).toBeLessThanOrEqual(TEXT_WIDTH);
      expect([...new Set(script.cutNotes)]).toEqual([]);
      // Every question names its line in the record of answers, within the label column.
      for (const label of script.labels)
        expect(label.length, label).toBeLessThanOrEqual(ANSWER_LABEL_WIDTH);
    },
  );

  it("builds the command lines of the usual answers", async () => {
    // Colors, no Seedshift, no shares, as printable cards in the first design, in one PDF of A6
    // sheets turned the way the cards are largest, with a QR code each, with random details.
    expect(await runOf(ENTRY.encode, [2, 1, 0, 3, 0, 0, 2, 0, 0])).toEqual([
      "encode",
      "--ask-secrets",
      "--format",
      "5",
      "--mode",
      "direct",
      "--template",
      "business-architect",
      "--pdf",
      "mnemocode-cards.pdf",
      "--card-qr",
    ]);
    // Word numbers, always masked, with MnemoCode Seedshift, split 2 of 3 into shares in word
    // numbers too, on the screen, with the whole seed phrase beside them (--format).
    expect(await runOf(ENTRY.encode, [0, 0, 1, 0, 1])).toEqual([
      "encode",
      "--sskr",
      "--ask-secrets",
      "--mode",
      "seedshift",
      "--threshold",
      "2",
      "--shares",
      "3",
      "--share-format",
      "indexes",
      "--format",
      "2",
    ]);
    // Colors give color shares without a question about their look.
    expect(await runOf(ENTRY.encode, [2, 1, 1, 0])).toEqual(
      expect.arrayContaining(["--share-format", "colors"]),
    );
    expect(script.asked.map((asked) => asked.question)).not.toContain(
      "How should each share be written?",
    );
    // English words are always masked; the original Seedshift asks nothing about shares.
    expect(await runOf(ENTRY.encode, [4, 1, 0])).toEqual([
      "encode",
      "--ask-secrets",
      "--format",
      "1",
      "--mode",
      "seedshift-legacy",
    ]);
    expect(script.asked.map((asked) => asked.question)).toEqual([
      "Which form should the seed phrase take?",
      "Which Seedshift?",
      "Where should the result go?",
      "Instructions for your heirs?",
    ]);
    // Unicode codes, no Seedshift, a threshold typed under Other, no whole copy, and a sheet for
    // heirs.
    expect(await runOf(ENTRY.encode, [1, 1, 7, 0, 0, 1])).toEqual([
      "encode",
      "--sskr",
      "--ask-secrets",
      "--mode",
      "direct",
      "--threshold",
      "4",
      "--shares",
      "7",
      "--share-format",
      "unicode",
      "--heir-sheet",
      "mnemocode-heirs.pdf",
      "--heir-sheet-size",
      "a5",
    ]);
  });

  it("re-encodes from the Re-encode entry: the old backup as Decode asks it, the rest on the private screen", async () => {
    // Typed, all the codes, MnemoCode Seedshift: the codes, the dates, the confirmation and the new
    // backup are asked by re-encode itself.
    expect(await runOf(ENTRY.reEncode, [0, 0, 1])).toEqual([
      "re-encode",
      "--ask-secrets",
      "--old-mode",
      "seedshift",
    ]);
    expect(script.asked.map((asked) => asked.question)).toEqual([
      "Where is the encoded seed phrase?",
      "How many words does the seed phrase have?",
      "Was Seedshift used when it was encoded?",
    ]);
    // A record file names its mode: none is asked.
    const path = join(files, "record.txt");
    expect(await runOf(ENTRY.reEncode, [1], { "Record file name": [path] })).toEqual([
      "re-encode",
      "--ask-secrets",
      "--input-file",
      path,
    ]);
  });

  it("numbers the forms by their place in the list; the command names the --format number", async () => {
    // English words, listed last, are answered with 5 and are form 1 of the command built.
    const run = (await runOf(ENTRY.encode, [4, 1, 0])) ?? [];
    expect(run[run.indexOf("--format") + 1]).toBe(String(formatNumber("english")));
    const forms = script.digits["Which form should the seed phrase take?"]!;
    expect(forms.map(({ digit }) => digit)).toEqual(forms.map(() => undefined));
    const list = script.lists[0]!.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ""));
    const places = list.map((line) => line.match(/^[›\s]\s(\d)\s/u)?.[1]).filter(Boolean);
    expect(places).toEqual(["1", "2", "3", "4", "5"]);
    expect(forms.at(-1)).toEqual({ value: "english", digit: undefined });
  });

  it("always masks word numbers and words, and calls an unmasked copy weak", async () => {
    for (const form of [0, 4]) {
      await runOf(ENTRY.encode, [form]);
      const questions = script.asked.map((asked) => asked.question);
      expect(questions).not.toContain("Use Seedshift?");
      expect(questions).toContain("Which Seedshift?");
    }
    // Unicode codes may stay unmasked, but the answer says how weak that is.
    script.lists = [];
    await runOf(ENTRY.encode, [1]);
    expect(script.asked[1]!.question).toBe("Use Seedshift?");
    expect(script.lists[1]!.join(" ")).toContain("weak: only disguised");
  });

  it("has the entries, questions and answers that the sheet for heirs names", async () => {
    const asked = async (digit: number) => {
      const entry = MENU_ENTRIES.find((item) => item.digit === digit)!;
      await runOf(entry, []);
      return { entry: `${entry.digit} ${entry.label}`, asked: script.asked };
    };
    for (const [digit, steps] of [
      [3, HEIR_MENU.decode],
      [5, HEIR_MENU.restore],
    ] as const) {
      const { entry, asked: questions } = await asked(digit);
      expect(entry).toBe(steps.entry);
      const question = questions.find((item) => item.question === steps.question);
      expect(question, steps.question).toBeDefined();
      for (const answer of Object.values(steps.answers)) expect(question!.labels).toContain(answer);
    }
    expect((await asked(3)).asked[0]!.labels[0]).toBe(HEIR_MENU.decode.source);
    // Typed codes: the question of how many words, with the answer the sheet gives.
    await runOf(ENTRY.decode, [0]);
    const words = script.asked.find((item) => item.question === HEIR_MENU.decode.wordsQuestion);
    expect(words?.labels).toEqual([
      "All the codes I type",
      ...BIP39_WORD_COUNTS.map((count) => `${count} words`),
    ]);
    expect((await asked(HEIR_MENU.recover.digit)).entry).toBe(HEIR_MENU.recover.entry);
  });

  it("splits into standard shares in words or a short code from the Split entry", async () => {
    // MnemoCode Seedshift, 2 of 3, in Bytewords, on the screen; no "Which Seedshift?" question.
    expect(await runOf(ENTRY.split, [0, 0, 0, 0, 0])).toEqual([
      "encode",
      "--sskr",
      "--ask-secrets",
      "--mode",
      "seedshift",
      "--threshold",
      "2",
      "--shares",
      "3",
      "--share-format",
      "words",
    ]);
    expect(script.asked.map((asked) => asked.question)).not.toContain("Which Seedshift?");
    expect(script.asked[2]!.labels).toEqual(["Words", "Short code"]);
  });

  it("offers printable cards for a phrase and shares in colors or Unicode codes only", async () => {
    const destinations = async (answers: number[]) => {
      await runOf(ENTRY.encode, answers);
      return script.asked.find((asked) => asked.question.startsWith("Where should"))!.labels;
    };
    // Word numbers, MnemoCode Seedshift, no shares: a record or a QR code, no cards.
    expect(await destinations([0, 0, 0])).not.toContain("Also as printable cards");
    // Colors and Unicode codes: cards too.
    expect(await destinations([2, 1, 0])).toContain("Also as printable cards");
    expect(await destinations([1, 1, 0])).toContain("Also as printable cards");
    // Shares of word numbers have no cards; shares of Unicode codes print their codes, with
    // colors that only decorate them, and shares of colors print their colors.
    expect(await destinations([0, 0, 1, 0])).toEqual([
      "Only on this screen",
      "Also in a text file",
    ]);
    expect(await destinations([1, 1, 1, 0])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as printable cards",
      "All of these",
    ]);
    expect(await destinations([2, 1, 1])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as printable cards",
      "All of these",
    ]);
  });

  it("saves to every place at once with All of these, the screen included", async () => {
    // Word numbers, MnemoCode Seedshift, no shares: a record file and a QR code, no cards.
    expect(await runOf(ENTRY.encode, [0, 0, 0, 3, 0])).toEqual([
      "encode",
      "--ask-secrets",
      "--format",
      "2",
      "--mode",
      "seedshift",
      "--output",
      expect.any(String),
      "--qr",
      expect.any(String),
    ]);
    const all = script.asked.find((asked) => asked.question === "Where should the result go?")!;
    expect(all.labels.at(-1)).toBe("All of these");
    // Colors, no Seedshift, no shares: the record, the QR code, then the questions of the cards,
    // a PDF of A6 sheets in the first design here.
    const run = (await runOf(ENTRY.encode, [2, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(run.slice(run.indexOf("--output"), run.indexOf("--qr") + 2)).toEqual([
      "--output",
      expect.any(String),
      "--qr",
      expect.any(String),
    ]);
    expect(run).toContain("--pdf");
    // Shares of colors: a text file and their cards.
    const shares = (await runOf(ENTRY.encode, [2, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(shares[shares.indexOf("--output") + 1]).toEqual(expect.any(String));
    expect(shares).toContain("--template");
  });

  describe("card questions after Also as printable cards", () => {
    // Colors, no Seedshift, no shares, printable cards.
    const SINGLE = [2, 1, 0, 3];
    // Colors, no Seedshift, 2 of 3 shares, printable cards.
    const SHARES = [2, 1, 1, 2];

    /**
     * The options after --template and its design, for the answers to the card questions: the
     * kind of file, the layout, the design, then the QR code and the details on sheets.
     */
    async function cardOptions(start: number[], answers: number[]): Promise<readonly string[]> {
      const run = (await runOf(ENTRY.encode, [...start, ...answers]))!;
      const end = run.indexOf("--heir-sheet");
      return run.slice(run.indexOf("--template") + 2, end < 0 ? undefined : end);
    }

    it("offers only the business card designs for separate cards", async () => {
      // A PDF, then Separate business cards (the fourth layout), in a new folder.
      await runOf(ENTRY.encode, [...SINGLE, 0, 3]);
      const design = script.asked.find((asked) => asked.question === "Which card design?")!;
      expect(design.labels.length).toBeGreaterThan(0);
      for (const label of design.labels) expect(label).toMatch(/card collection$/u);
      // On sheets every design is offered, the material ones too.
      await runOf(ENTRY.encode, [...SINGLE, 0, 0]);
      const sheets = script.asked.find((asked) => asked.question === "Which card design?")!;
      expect(sheets.labels.some((label) => label.endsWith("finish selection"))).toBe(true);
    });

    it("asks the kind of file, then the layout, then the design", async () => {
      expect(await cardOptions(SINGLE, [0, 0, 2, 0, 0])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--card-qr",
      ]);
      expect(await cardOptions(SINGLE, [0, 1, 2, 0, 1])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--page-size",
        "a5",
      ]);
      expect(await cardOptions(SINGLE, [0, 2, 2, 0, 1])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--page-size",
        "a4",
      ]);
      expect(script.asked.map((asked) => asked.question).slice(4)).toEqual([
        "Which kind of file?",
        "How should the cards be laid out?",
        "How should the sheets be turned?",
        "Which card design?",
        "Add a QR code with the codes of the backup, without the extra cards?",
        "Type your own details for the cards?",
        "Instructions for your heirs?",
      ]);
      expect(await cardOptions(SHARES, [0, 0, 2, 0, 1])).toEqual([
        "--pdf",
        "mnemocode-share-cards.pdf",
      ]);
    });

    it("asks how the sheets are turned, landscape first, and never for separate cards", async () => {
      expect(await cardOptions(SINGLE, [0, 0, 0, 0, 1])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--orientation",
        "landscape",
      ]);
      expect(await cardOptions(SINGLE, [1, 1, 1, 0, 1])).toEqual([
        "--images-dir",
        "mnemocode-cards-images",
        "--image-format",
        "png",
        "--page-size",
        "a5",
        "--orientation",
        "portrait",
      ]);
      const turns = script.asked.find((asked) =>
        asked.question.startsWith("How should the sheets"),
      );
      expect(turns!.labels).toEqual(["Landscape", "Portrait", "Whichever fills the sheet best"]);
      await cardOptions(SINGLE, [0, 3, 0]);
      expect(script.asked.map((asked) => asked.question)).not.toContain(
        "How should the sheets be turned?",
      );
    });

    it("saves separate business cards in a new folder, without a QR code", async () => {
      for (const [kind, format] of [
        [0, []],
        [1, ["--image-format", "png"]],
        [2, ["--image-format", "jpg"]],
      ] as const) {
        expect(await cardOptions(SINGLE, [kind, 3, 0])).toEqual([
          "--cards-dir",
          "mnemocode-cards",
          ...format,
        ]);
        expect(script.asked.map((asked) => asked.question)).not.toContain(
          "Add a QR code with the codes of the backup, without the extra cards?",
        );
      }
      // Shares need the layout: without a page size, they would be sheets.
      expect(await cardOptions(SHARES, [0, 3, 0])).toEqual([
        "--cards-dir",
        "mnemocode-share-cards",
        "--card-layout",
        "individual",
      ]);
    });

    it("saves images of A6, A5 or A4 sheets, and says at once when pdftocairo is missing", async () => {
      expect(await cardOptions(SINGLE, [2, 0, 2, 0, 0])).toEqual([
        "--images-dir",
        "mnemocode-cards-images",
        "--image-format",
        "jpg",
        "--card-qr",
      ]);
      expect(await cardOptions(SINGLE, [1, 2, 2, 0, 1])).toEqual([
        "--images-dir",
        "mnemocode-cards-images",
        "--image-format",
        "png",
        "--page-size",
        "a4",
      ]);
      script.noImages = true;
      // PNG first, then the first choice, a PDF, when the question is asked again.
      expect(await cardOptions(SINGLE, [1, 0, 0, 2, 0, 0])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--card-qr",
      ]);
      const kinds = script.asked.filter((asked) => asked.question === "Which kind of file?");
      expect(kinds.map((asked) => asked.warning)).toEqual([
        undefined,
        expect.stringContaining("pdftocairo"),
      ]);
    });

    it("takes typed details, keeps the others random, and refuses what the command refuses", async () => {
      const typed = {
        "Name, in Latin letters": ["Анна", "--help", "Ann Lee"],
        Role: [""],
        Company: [""],
        Email: [""],
        Phone: [""],
        Website: [""],
        Location: [""],
        "Studio name": [""],
        Slogan: ["-"],
        Subtitle: [""],
        Footer: ["x".repeat(101), "Printed with care"],
      };
      const run = (await runOf(ENTRY.encode, [...SINGLE, 0, 0, 2, 0, 0, 1], typed))!;
      expect(run.slice(run.indexOf("--card-qr") + 1)).toEqual([
        "--card-name",
        "Ann Lee",
        "--card-slogan",
        "-",
        "--card-footer",
        "Printed with care",
      ]);
      expect(warningsAt("Name, in Latin letters")).toEqual([
        undefined,
        "Card name must use Latin letters only (spaces, apostrophes and hyphens are allowed).",
        "A detail that starts with - would be read as an option; leave out the -.",
      ]);
      expect(warningsAt("Footer")).toEqual([
        undefined,
        "Card footer is too long (maximum 100 characters).",
      ]);
      // A sheet shows no label before the codes; a separate business card does.
      expect(warningsAt("Label before each code")).toEqual([]);
      script.lines = [];
      await runOf(ENTRY.encode, [...SINGLE, 0, 3, 0, 1], {});
      expect(script.lines.map((line) => line.question)).toEqual([
        "Name of the new folder",
        "Name, in Latin letters",
        "Role",
        "Company",
        "Email",
        "Phone",
        "Website",
        "Location",
        "Label before each code",
      ]);
    });
  });

  it("finds a code of an encoded seed phrase as Decode does, from the Find entry", async () => {
    // A code of the encoded seed phrase: all the codes typed, then without Seedshift.
    expect(await runOf(ENTRY.recover, [1, 0, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "direct",
    ]);
    const questions = script.asked.map((asked) => asked.question);
    expect(questions).toContain(ENCODED_SEEDSHIFT_QUESTION);
    // The codes of a phrase of 12 words before the decoys of its cards, with MnemoCode Seedshift.
    const twelve = await runOf(ENTRY.recover, [1, 1, 1]);
    expect(twelve?.slice(0, 4)).toEqual(["decode", "--ask-secrets", "--words", "12"]);
    expect(twelve).toEqual(expect.arrayContaining(["--mode", "seedshift"]));
  });

  it("asks whether shares were masked as the Restore entry and the commands of shares ask it", async () => {
    // The Find entry, a code of a share, the wallet's fingerprint, then the share question: Yes.
    const run = await runOf(ENTRY.recover, [3, 0, 1]);
    const questions = script.asked.map((asked) => asked.question);
    expect(questions).toContain(SHARE_SEEDSHIFT_QUESTION);
    expect(run).toEqual(expect.arrayContaining(["sskr-export", "--mode", "seedshift"]));
    await runOf(ENTRY.restore, [1]);
    expect(script.asked.map((asked) => asked.question)).toEqual([SHARE_SEEDSHIFT_QUESTION]);
  });

  describe("typed answers are checked at once and asked again", () => {
    // The Find entry, a digit of a date, typed, all the codes typed, MnemoCode Seedshift, then the wallet.
    const DATE_WALLET = [2, 0, 0, 0];

    it("asks the fingerprint and the address again until a wallet can have them", async () => {
      const fingerprint = await runOf(ENTRY.recover, [...DATE_WALLET, 0], {
        "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)": [
          "",
          "73c5da0",
          "73C5DA0A",
        ],
      });
      expect(fingerprint).toEqual(expect.arrayContaining(["--master-fingerprint", "73c5da0a"]));
      expect(
        warningsAt("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)"),
      ).toEqual([
        undefined,
        "Type the eight characters of the fingerprint.",
        "A master fingerprint must be eight hexadecimal characters.",
      ]);
      const address = "Bitcoin address (one of the first receiving ones)";
      // BIP173's testnet example, then the public phrase's first native SegWit address.
      await runOf(ENTRY.recover, [...DATE_WALLET, 1], {
        [address]: [
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        ],
      });
      expect(warningsAt(address)).toEqual([
        undefined,
        "The address is not valid for Bitcoin mainnet; it is a testnet address.",
      ]);
    });

    it("asks the Scanner's key, the lookups and the numbers of shares again", async () => {
      await runOf(ENTRY.recover, [0, 0, 1, 0], {
        "Scanner key": ["age1", "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x"],
      });
      expect(warningsAt("Scanner key")[1]).toContain("62 characters");
      expect(await runOf(ENTRY.table, [0], { Word: ["Abandonn", "Abandon"] })).toEqual([
        "table",
        "--word",
        "abandon",
      ]);
      expect(await runOf(ENTRY.table, [1], { "Word number": ["2049", "0", "007"] })).toEqual([
        "table",
        "--index",
        "7",
      ]);
      expect(await runOf(ENTRY.table, [2], { "Unicode code": ["FFFF", "5bf6"] })).toEqual([
        "table",
        "--unicode",
        "5BF6",
      ]);
      // Other: only the refused number is asked again; a good first number stays.
      const count = "How many shares in all? (2 to 16)";
      const threshold = "How many of them restore the seed phrase?";
      expect(
        await runOf(ENTRY.encode, [1, 1, 7, 0, 0, 0], {
          [count]: ["1", "17", "3"],
          [threshold]: ["4", "3"],
        }),
      ).toEqual(expect.arrayContaining(["--threshold", "3", "--shares", "3"]));
      expect(warningsAt(count)).toEqual([
        undefined,
        "Choose 2 to 16 shares.",
        "Choose 2 to 16 shares.",
      ]);
      expect(warningsAt(threshold)).toEqual([
        undefined,
        "Type a number from 2 to 3, the number of shares.",
      ]);
    });

    it("refuses file names that the command could not use", async () => {
      const name = "QR code file name";
      // Encode: word numbers, MnemoCode Seedshift, no shares, a QR code image.
      const qr = [0, 0, 0, 2];
      const folder = join(files, "folder");
      const refused: [string, string][] = [
        ["-", "- is no file name here; type the name of a file."],
        ["-h", "A name that starts with - would be read as an option; type ./ before it."],
        [
          folder,
          "A folder has this name; give the file another name, or a name inside that folder.",
        ],
        [
          join(files, "no such folder", "qr.png"),
          "The folder containing the output file must already exist and be writable.",
        ],
        [
          join(files, "record.txt", "qr.png"),
          "The folder containing the output file is not a directory.",
        ],
      ];
      // A file dropped into the terminal arrives in quotes; a taken name is numbered later.
      const run = await runOf(ENTRY.encode, [...qr, 0], {
        [name]: [...refused.map(([answer]) => answer), `'${join(files, "record.txt")}'`],
      });
      expect(run).toEqual(expect.arrayContaining(["--qr", join(files, "record.txt")]));
      expect(warningsAt(name)).toEqual([undefined, ...refused.map(([, warning]) => warning)]);
    });

    it("refuses a second file of the same task in the place of the first", async () => {
      // Encode: word numbers, MnemoCode Seedshift, no shares, a record file, and heirs on A5.
      const record = join(files, "backup.txt");
      const heirs = "PDF file name";
      const run = await runOf(ENTRY.encode, [0, 0, 0, 1, 1], {
        "Record file name": [record],
        [heirs]: [record, join(files, "heirs.pdf")],
      });
      expect(run).toEqual(expect.arrayContaining(["--heir-sheet", join(files, "heirs.pdf")]));
      expect(warningsAt(heirs)).toEqual([
        undefined,
        "Another file of this task has this name or this folder; choose another one.",
      ]);
      // The next task starts afresh: the same name may be used again.
      await runOf(ENTRY.encode, [0, 0, 0, 1, 0], { "Record file name": [record] });
      expect(warningsAt("Record file name")).toEqual([undefined, undefined]);
      // A new folder for cards may not hold a file of the same task either.
      script.lines = [];
      const cards = join(files, "cards");
      await runOf(ENTRY.encode, [2, 1, 0, 3, 0, 3, 0, 0, 1], {
        "Name of the new folder": [cards],
        [heirs]: [join(cards, "heirs.pdf"), join(files, "heirs.pdf")],
      });
      expect(warningsAt(heirs)[1]).toBe(
        "Another file of this task has this name or this folder; choose another one.",
      );
    });

    it("reads no file but checks that the one to read is there and small enough", async () => {
      const name = "Record file name";
      const large = join(files, "large.txt");
      // A sparse file one byte larger than the 1 MiB that the command reads.
      await writeFile(large, "");
      await truncate(large, 1024 * 1024 + 1);
      const run = await runOf(ENTRY.decode, [1], {
        [name]: [
          join(files, "missing.txt"),
          join(files, "folder"),
          large,
          "-",
          `"${join(files, "record.txt")}"`,
        ],
      });
      expect(run).toEqual(["decode", "--ask-secrets", "--input-file", join(files, "record.txt")]);
      expect(warningsAt(name)).toEqual([
        undefined,
        "There is no such file; check its name and its folder.",
        "That is a folder; type the name of a file in it.",
        "That file is larger than 1 MiB; it cannot be the one.",
        "- is no file name here; type the name of a file.",
      ]);
    });

    it("takes a new folder where the nearest folder that exists may be written", async () => {
      // Printing sample cards has no folder; Encode's separate cards do. Missing folders are made by the command.
      const deep = join(files, "a", "b", "cards");
      const run = await runOf(ENTRY.encode, [2, 1, 0, 3, 0, 3, 0, 0], {
        "Name of the new folder": [
          join(files, "record.txt", "cards"),
          "''",
          '" "',
          join(files, "cards.pdf"),
          deep,
        ],
      });
      expect(run).toEqual(expect.arrayContaining(["--cards-dir", deep]));
      // A quoted name of spaces leaves a blank one, which the command would refuse at its start.
      const blank = "That name is blank; type a name, or press Enter alone for the one shown.";
      expect(warningsAt("Name of the new folder")).toEqual([
        undefined,
        "A file stands where a folder of this name should be; choose another name.",
        blank,
        blank,
        // A folder named like a PDF would stand in the way of a PDF of that name later.
        "A new folder needs a name without .pdf, which is the ending of a file; choose another name.",
      ]);
    });
  });

  it("passes the answer about Seedshift to decode, No as --mode direct", async () => {
    // Typed, then No: --mode direct, so that decode does not ask again for codes that name no
    // mode; a typed record that names another mode is questioned by decode itself.
    expect(await runOf(ENTRY.decode, [0, 0, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "direct",
    ]);
    const question = script.asked.find((asked) => asked.question.startsWith("Was Seedshift"))!;
    expect(question.labels).toEqual(["No", "MnemoCode Seedshift", "Original Seedshift"]);
    expect(await runOf(ENTRY.decode, [0, 0, 1])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "seedshift",
    ]);
    expect(await runOf(ENTRY.decode, [0, 0, 2])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "seedshift-legacy",
    ]);
    // Codes typed from printed cards: the number of words, which leaves out their decoys.
    expect(await runOf(ENTRY.decode, [0, 5, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--words",
      "24",
      "--mode",
      "direct",
    ]);
    // A QR code image the same.
    expect(await runOf(ENTRY.decode, [2, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--qr-file",
      join(files, "qr.png"),
      "--mode",
      "direct",
    ]);
    // A record file names its own mode: nothing is asked about it.
    expect(await runOf(ENTRY.decode, [1])).toEqual([
      "decode",
      "--ask-secrets",
      "--input-file",
      join(files, "record.txt"),
    ]);
    expect(script.asked.map((asked) => asked.question)).not.toContain(
      "Was Seedshift used when it was encoded?",
    );
  });

  it("shows the typed command with quotes only where a shell needs them", () => {
    const posix = (argument: string) => typedCommand(["preview", "--pdf", argument], "linux");
    const windows = (argument: string) => typedCommand(["preview", "--pdf", argument], "win32");
    expect(
      typedCommand(["decode", "--ask-secrets", "--input-file", "my record.txt"], "linux"),
    ).toBe("mnemocode decode --ask-secrets --input-file 'my record.txt'");
    expect(typedCommand(["table", "--word", "abandon"])).toBe("mnemocode table --word abandon");
    expect(posix("output/cards-2.pdf")).toBe("mnemocode preview --pdf output/cards-2.pdf");
    // = first is a program's path in zsh, @ first splatting in PowerShell; inside they are plain.
    for (const name of ["=cards.pdf", "@cards.pdf"]) {
      expect(posix(name)).toBe(`mnemocode preview --pdf '${name}'`);
      expect(windows(name)).toBe(`mnemocode preview --pdf "${name}"`);
    }
    expect(posix("a=b@c.pdf")).toBe("mnemocode preview --pdf a=b@c.pdf");
    // % is a variable in cmd.exe and , an array in PowerShell.
    expect(posix("100%,2.pdf")).toBe("mnemocode preview --pdf '100%,2.pdf'");

    // Windows: double quotes, which cmd.exe and PowerShell read alike, around paths with spaces
    // and backslashes; ' is plain inside them.
    expect(windows("C:\\Users\\Ann Lee\\My Cards\\cards.pdf")).toBe(
      'mnemocode preview --pdf "C:\\Users\\Ann Lee\\My Cards\\cards.pdf"',
    );
    expect(windows("it's.pdf")).toBe(`mnemocode preview --pdf "it's.pdf"`);
    expect(windows("it\u2019s.pdf")).toBe(`mnemocode preview --pdf "it\u2019s.pdf"`);
    // What either shell still reads inside double quotes gets PowerShell's single quotes, in which
    // ' and its four typographic forms are doubled.
    for (const special of ['"', "\u201C", "\u201D", "\u201E", "$", "`", "%", "!", "^", "\n"])
      expect(windows(`a${special}b.pdf`)).toBe(`mnemocode preview --pdf 'a${special}b.pdf'`);
    expect(windows("C:\\Backups\\")).toBe("mnemocode preview --pdf 'C:\\Backups\\'");
    expect(windows("say \u201Chi\u201D, it's 100%")).toBe(
      "mnemocode preview --pdf 'say \u201Chi\u201D, it''s 100%'",
    );
    expect(windows("'\u2018\u2019\u201A\u201B$")).toBe(
      "mnemocode preview --pdf '''\u2018\u2018\u2019\u2019\u201A\u201A\u201B\u201B$'",
    );

    // PowerShell would pass on 4E00 as 4, 0x10 as 16, 1kb as 1024 and 007 as 7.
    for (const number of ["4E00", "4E5D", "0x10", "1kb", "007", "1.5", ".5", "+5", "-1"]) {
      expect(typedCommand(["table", "--unicode", number], "win32")).toBe(
        `mnemocode table --unicode "${number}"`,
      );
      expect(typedCommand(["table", "--unicode", number], "linux")).toBe(
        `mnemocode table --unicode ${number}`,
      );
    }
    expect(
      typedCommand(
        ["encode", "--sskr", "--threshold", "2", "--shares", "16", "--format", "0"],
        "win32",
      ),
    ).toBe("mnemocode encode --sskr --threshold 2 --shares 16 --format 0");
    expect(typedCommand(["table", "--unicode", "BF6A"], "win32")).toBe(
      "mnemocode table --unicode BF6A",
    );
  });

  /** The POSIX shells to paste into: sh, and bash and zsh where they are installed. */
  const POSIX_SHELLS = [
    "sh",
    ...(process.platform === "win32" ? [] : ["bash", "zsh"]).filter(
      (shell) => spawnSync(shell, ["-c", "true"]).status === 0,
    ),
  ];

  // Windows has no POSIX shell to paste into; its quoting is checked above.
  it.skipIf(process.platform === "win32").each(POSIX_SHELLS)(
    "keeps every file name byte for byte when the command is pasted into %s",
    (shell) => {
      const names = [
        "output/a$(printf b).pdf",
        "a `date` b.pdf",
        "back\\slash \\n.pdf",
        "say \"hi\" and 'bye'.pdf",
        "say \u201Chi\u201D and \u2018bye\u2019.pdf",
        "carte d'identité ✓ 日本.pdf",
        "$HOME/*.pdf",
        "output/a  b.pdf",
        "=sh",
        "@cards.pdf",
        "~/cards.pdf",
        "100%,2.pdf",
        "a=b@c.pdf",
        "4E00",
        `output/${"a".repeat(45)} ${"b".repeat(45)}.pdf`,
      ];
      for (const name of names) {
        // The shown command is run in a real POSIX shell, with mnemocode as a function that prints
        // its arguments one per NUL.
        const script = `mnemocode() { printf '%s\\0' "$@"; }; ${commandDisplay(["preview", "--pdf", name])}`;
        const printed = spawnSync(shell, ["-c", script], { encoding: "utf8" }).stdout.split("\0");
        expect(printed.slice(0, 3)).toEqual(["preview", "--pdf", name]);
      }
    },
  );
});
