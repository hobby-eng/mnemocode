// The start menu: the questions of each entry and the command lines that they build, with the
// questions answered by a script (test/helpers/menu-script.ts) and the paths through them walked
// (test/helpers/menu-paths.ts). test/menu-typed-answers.test.ts has the typed answers. Public test
// data only.

import { BIP39_WORD_COUNTS } from "../src/core/bip39-sizes.js";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { COMMAND_OPTIONS, isCommandName } from "../src/cli/command-options.js";
import { ANSWER_LABEL_WIDTH } from "../src/cli/terminal-choice.js";
import { TEXT_WIDTH } from "../src/cli/terminal.js";
import { HEIR_MENU } from "../src/cli/heir-sheet.js";
import { ENCODED_SEEDSHIFT_QUESTION } from "../src/cli/seedshift-choices.js";
import { MENU_ENTRIES } from "../src/cli/menu.js";
import { typedCommand } from "../src/cli/shell-command.js";
import { MENU_ENTRY_NAMES as ENTRY } from "../src/cli/menu-entries.js";
import { formatNumber } from "../src/cli/format-numbers.js";
import { anyOf, containing } from "./helpers/matchers.js";
import {
  answeredByScript,
  assertCardOptions,
  cardOptions,
  everyPath,
  files,
  runOf,
  SHARES,
  SINGLE,
  typedCardDetails,
  warningsAt,
  RECORD_FILE_PROMPT,
  CARD_DESIGN_QUESTION,
  SHEET_ORIENTATION_QUESTION,
  BACKUP_QR_QUESTION,
  CARD_DETAILS_QUESTION,
  CARD_NAME_PROMPT,
} from "./helpers/menu-paths.js";
import { script } from "./helpers/menu-script.js";
import { takeCutNotes } from "./helpers/cut-notes.js";
import { ENCODE_FORM_LABELS } from "./helpers/encode-form-cases.js";
import { SEEDSHIFT_QUESTION } from "./helpers/prompts.js";

const harness = await vi.hoisted(async () => import("./helpers/menu-script.js"));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/export/image-export.js", async (importOriginal) =>
  harness.replacedImageExport(await importOriginal()),
);

answeredByScript();

/** The parts of each Encode form's walk: its paths through the real questions take seconds. */
const ENCODE_WALK_PARTS = 5;

/** The options that `command` accepts; the test fails on a name that is no command. */
function optionsOf(command: string): readonly string[] {
  if (!isCommandName(command)) throw new Error(`No command is named ${command}.`);
  return COMMAND_OPTIONS[command];
}

/** Checks `run` as its command checks its options before it asks for a secret. */
function assertAccepted(run: readonly string[]): void {
  const [command, ...rest] = run;
  expect(isCommandName(command!), typedCommand(run)).toBe(true);
  const parsed = parseArguments(rest);
  assertAllowedArguments(parsed, command!, optionsOf(command!));
  assertCardOptions(command!, parsed);
}

describe("start menu", () => {
  it("offers one QR path when printable cards are available", async () => {
    for (const form of [0, 1, 2, 3, 4]) {
      for (const shares of [false, true]) {
        script.drawnLines = new Set();
        takeCutNotes();
        const run = await runOf(ENTRY.encode, [form, form < 2 ? 0 : 1, shares ? 1 : 0]);
        expect(run).toBeDefined();
        const output = script.asked.find((asked) => asked.question.startsWith("Where should"))!;
        expect(output.labels.some((label) => label.includes("printable cards"))).toBe(form >= 2);
        expect(output.labels.some((label) => label.includes("QR code"))).toBe(form < 2);
        expect(output.labels).toHaveLength(4);
        for (const line of script.drawnLines)
          expect(Array.from(line).length, line).toBeLessThanOrEqual(TEXT_WIDTH);
        expect(takeCutNotes()).toEqual([]);
      }
    }
  });

  it("offers QR images and all destinations for standard shares too", async () => {
    const run = (await runOf(ENTRY.split, [1, 0, 0, 3]))!;
    const output = script.asked.find((asked) => asked.question === "Where should the shares go?")!;
    expect(output.labels).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and QR code images",
      "All of these",
    ]);
    expect(run).toContain("--output");
    expect(run).toContain("--qr-dir");
    expect(run).not.toContain("--template");
  });

  it("offers the same original copy for masked backups without shares and skips it for direct copies", async () => {
    const masked = (await runOf(ENTRY.encode, [1, 0, 0, 0, 1]))!;
    expect(masked).toEqual(expect.arrayContaining(["--show-original", "words"]));
    const copy = script.asked.find(
      (asked) => asked.question === "Also show the original seed phrase, before Seedshift?",
    )!;
    expect(copy.labels).toEqual(["No", "Yes, show the words"]);
    await runOf(ENTRY.encode, [4, 1, 0, 0]);
    expect(
      script.asked.some((asked) => asked.question.startsWith("Also show the original seed phrase")),
    ).toBe(false);
  });

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

  // Split the large Encode product at its first answer, and each form's walk into parts by the
  // answers after it (WalkPart), keeping every later path and the same 60-second limit per test.
  // No fixture or validation is removed on slower hosted runners.
  const walks = MENU_ENTRIES.flatMap((entry) =>
    entry.digit === ENTRY.encode.digit
      ? ENCODE_FORM_LABELS.flatMap((form, index) =>
          Array.from({ length: ENCODE_WALK_PARTS }, (_, part) => ({
            label: `${entry.label}: ${form}, part ${part + 1} of ${ENCODE_WALK_PARTS}`,
            entry,
            prefix: [index],
            share: { part, of: ENCODE_WALK_PARTS },
          })),
        )
      : [{ label: entry.label, entry, prefix: [], share: { part: 0, of: 1 } }],
  );
  it.each(walks)(
    "builds a command line that MnemoCode accepts from every answer of $label",
    async ({ entry, prefix, share }) => {
      script.drawnLines = new Set();
      script.labels = [];
      takeCutNotes();
      for (const run of await everyPath(entry, prefix, share)) {
        assertAccepted(run);
        const [command, ...rest] = run;
        const parsed = parseArguments(rest);
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
      if (entry.digit === ENTRY.encode.digit)
        expect(script.asked[0]?.labels).toEqual(ENCODE_FORM_LABELS);
      // An entry that asks something draws its lists and writes its lines in the record.
      if (script.asked.length > 0) {
        expect(script.drawnLines.size).toBeGreaterThan(0);
        expect(script.labels).not.toEqual([]);
      }
      // Lists, their explanations and questions fit a terminal of 80 columns unwrapped
      // (TEXT_WIDTH), and no note of a list is cut to fit (cut-notes.ts).
      for (const line of script.drawnLines)
        expect(Array.from(line).length, line).toBeLessThanOrEqual(TEXT_WIDTH);
      expect([...new Set(takeCutNotes())]).toEqual([]);
      // Every question names its line in the record of answers, within the label column.
      for (const label of script.labels)
        expect(label.length, label).toBeLessThanOrEqual(ANSWER_LABEL_WIDTH);
    },
  );
});

describe("start menu", () => {
  it("builds the command lines of the usual answers", async () => {
    // Colors, no Seedshift, no shares, as printable cards in the first design, in one PDF of A6
    // sheets turned the way the cards are largest, with a QR code each, with random details.
    expect(await runOf(ENTRY.encode, [4, 1, 0, 2, 0, 0, 2, 0, 0])).toEqual([
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
    // numbers too, on the screen, with only the original English words beside them.
    expect(await runOf(ENTRY.encode, [1, 0, 1, 0, 1, 0])).toEqual([
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
      "--show-original",
      "words",
    ]);
    // Colors give color shares without a question about their look.
    expect(await runOf(ENTRY.encode, [4, 1, 1, 0])).toEqual(
      expect.arrayContaining(["--share-format", "colors"]),
    );
    expect(script.asked.map((asked) => asked.question)).not.toContain(
      "How should each share be written?",
    );
    // English words are always masked; the original Seedshift asks nothing about shares.
    expect(await runOf(ENTRY.encode, [0, 1, 0])).toEqual([
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
      "Also show the original seed phrase, before Seedshift?",
      "Instructions for your heirs?",
    ]);
    // Unicode codes, no Seedshift, a threshold typed under Other, no whole copy, and a sheet for
    // heirs.
    expect(await runOf(ENTRY.encode, [2, 1, 7, 0, 0, 1])).toEqual([
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

  it("offers independent choices for the original wallet phrase and the Seedshift words", async () => {
    for (const [choice, form] of [undefined, "words"].entries()) {
      for (const words of [0, 1]) {
        const run = (await runOf(ENTRY.encode, [1, 0, 1, 0, choice, words, 0]))!;
        const args = parseArguments(run.slice(1));
        expect(args["show-original"]).toBe(form);
        expect(args.format).toBeUndefined();
        expect(args["show-masked-words"]).toBe(words === 1 ? true : undefined);
      }
    }
  });
});

describe("start menu", () => {
  it("builds re-encode arguments from typed-backup answers or a record file", async () => {
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
      SEEDSHIFT_QUESTION,
    ]);
    // A record file names its mode: none is asked.
    const path = join(files, "record.txt");
    expect(await runOf(ENTRY.reEncode, [1], { [RECORD_FILE_PROMPT]: [path] })).toEqual([
      "re-encode",
      "--ask-secrets",
      "--input-file",
      path,
    ]);
  });

  it("numbers the forms by their place in the list, which is their --format number", async () => {
    // English words, listed first, are answered with 1 and are --format 1 of the command built.
    const run = (await runOf(ENTRY.encode, [0, 1, 0])) ?? [];
    expect(run[run.indexOf("--format") + 1]).toBe(String(formatNumber("english")));
    const forms = script.asked[0]!.list!.entries;
    expect(forms.map(({ digit }) => digit)).toEqual([1, 2, 3, 4, 5]);
    // Each form's place is its number (owner, 2026-10-20): the form chosen at each place, with the
    // first answer to every later question, is the --format of that number.
    for (const [place, { digit }] of forms.entries()) {
      const formRun = (await runOf(ENTRY.encode, [place])) ?? [];
      expect(formRun[formRun.indexOf("--format") + 1], forms[place]!.label).toBe(String(digit));
    }
  });

  it("always masks word numbers and words, and calls an unmasked copy weak", async () => {
    for (const form of [1, 0]) {
      await runOf(ENTRY.encode, [form]);
      const questions = script.asked.map((asked) => asked.question);
      expect(questions).not.toContain("Use Seedshift?");
      expect(questions).toContain("Which Seedshift?");
    }
    // Unicode codes may stay unmasked, but the answer says how weak that is.
    await runOf(ENTRY.encode, [2]);
    expect(script.asked[1]!.question).toBe("Use Seedshift?");
    const notes = script.asked[1]!.list!.entries.flatMap(({ note, example }) => [note, example]);
    expect(notes.join(" ")).toContain("weak: only disguised");
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
});

describe("start menu", () => {
  it("offers printable cards for a phrase and shares in colors or Unicode codes only", async () => {
    const destinations = async (answers: number[]) => {
      await runOf(ENTRY.encode, answers);
      return script.asked.find((asked) => asked.question.startsWith("Where should"))!.labels;
    };
    // Word numbers or English words, MnemoCode Seedshift, no shares: a record or a QR code, no
    // cards.
    expect(await destinations([1, 0, 0])).not.toContain("Screen and printable cards");
    expect(await destinations([0, 0, 0])).not.toContain("Screen and printable cards");
    // Colors, colors as text and Unicode codes: cards too.
    expect(await destinations([4, 1, 0])).toContain("Screen and printable cards");
    expect(await destinations([3, 1, 0])).toContain("Screen and printable cards");
    expect(await destinations([2, 1, 0])).toContain("Screen and printable cards");
    // Shares of word numbers have no cards; shares of Unicode codes print their codes, with
    // colors that only decorate them, and shares of colors print their colors.
    expect(await destinations([1, 0, 1, 0])).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and QR code images",
      "All of these",
    ]);
    // Shares of a phrase in English words have no cards either; shares of colors as text do.
    expect(await destinations([0, 0, 1])).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and QR code images",
      "All of these",
    ]);
    expect(await destinations([3, 1, 1, 0])).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and printable cards",
      "All of these",
    ]);
    expect(await destinations([2, 1, 1, 0])).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and printable cards",
      "All of these",
    ]);
    expect(await destinations([4, 1, 1])).toEqual([
      "Only on this screen",
      "Screen and a text file",
      "Screen and printable cards",
      "All of these",
    ]);
  });

  it("saves to every place at once with All of these, the screen included", async () => {
    // Word numbers, MnemoCode Seedshift, no shares: a record file and a QR code, no cards.
    expect(await runOf(ENTRY.encode, [1, 0, 0, 3, 0])).toEqual([
      "encode",
      "--ask-secrets",
      "--format",
      "2",
      "--mode",
      "seedshift",
      "--output",
      anyOf(String),
      "--qr",
      anyOf(String),
    ]);
    const all = script.asked.find((asked) => asked.question === "Where should the result go?")!;
    expect(all.labels.at(-1)).toBe("All of these");
    // Colors: the record and cards, whose questions own QR output, without a second QR path.
    script.lines = [];
    const run = (await runOf(ENTRY.encode, [4, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(run[run.indexOf("--output") + 1]).toEqual(anyOf(String));
    expect(run).not.toContain("--qr");
    expect(script.lines.some((line) => line.question === "QR code file name")).toBe(false);
    expect(script.asked.filter((asked) => asked.question === BACKUP_QR_QUESTION)).toHaveLength(1);
    expect(run).toContain("--pdf");
    // Shares of colors: a text file and cards, without a standalone QR folder question.
    const shares = (await runOf(ENTRY.encode, [4, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(shares[shares.indexOf("--output") + 1]).toEqual(anyOf(String));
    expect(shares).not.toContain("--qr-dir");
    expect(shares).toContain("--template");
    expect(script.asked.filter((asked) => asked.question === BACKUP_QR_QUESTION)).toHaveLength(1);
  });

  it("selects screen and cards without a record or standalone QR destination", async () => {
    for (const form of [2, 3, 4]) {
      for (const shares of [false, true]) {
        const run = (await runOf(ENTRY.encode, [form, 1, shares ? 1 : 0, 2]))!;
        expect(run).toContain("--pdf");
        expect(run).not.toContain("--output");
        expect(run).not.toContain("--qr");
        expect(run).not.toContain("--qr-dir");
        expect(script.lines.some((line) => line.question === RECORD_FILE_PROMPT)).toBe(false);
        const output = script.asked.find((asked) => asked.question.startsWith("Where should"))!;
        expect(output.labels[2]).toBe("Screen and printable cards");
      }
    }
  });

  it("selects screen and QR without a text file for forms without cards", async () => {
    for (const form of [0, 1]) {
      for (const shares of [false, true]) {
        const run = (await runOf(ENTRY.encode, [form, 0, shares ? 1 : 0, 2]))!;
        expect(run).toContain(shares ? "--qr-dir" : "--qr");
        expect(run).not.toContain("--output");
        expect(run).not.toContain("--template");
      }
      const standard = (await runOf(ENTRY.split, [1, 0, form, 2]))!;
      expect(standard).toContain("--qr-dir");
      expect(standard).not.toContain("--output");
    }
  });
});

describe("start menu", () => {
  describe("card questions after Screen and printable cards", () => {
    it("offers only the business card designs for separate cards", async () => {
      // A PDF, then Separate business cards (the fourth layout), in a new folder.
      await runOf(ENTRY.encode, [...SINGLE, 0, 3]);
      const design = script.asked.find((asked) => asked.question === CARD_DESIGN_QUESTION)!;
      expect(design.labels.length).toBeGreaterThan(0);
      for (const label of design.labels) expect(label).toMatch(/card collection$/u);
      // On sheets every design is offered, the material ones too.
      await runOf(ENTRY.encode, [...SINGLE, 0, 0]);
      const sheets = script.asked.find((asked) => asked.question === CARD_DESIGN_QUESTION)!;
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
        SHEET_ORIENTATION_QUESTION,
        CARD_DESIGN_QUESTION,
        BACKUP_QR_QUESTION,
        CARD_DETAILS_QUESTION,
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
      expect(script.asked.map((asked) => asked.question)).not.toContain(SHEET_ORIENTATION_QUESTION);
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
        expect(script.asked.map((asked) => asked.question)).not.toContain(BACKUP_QR_QUESTION);
      }
      // Shares need the layout: without a page size, they would be sheets.
      expect(await cardOptions(SHARES, [0, 3, 0])).toEqual([
        "--cards-dir",
        "mnemocode-share-cards",
        "--card-layout",
        "individual",
      ]);
    });
  });
});

describe("start menu", () => {
  describe("card questions after Screen and printable cards", () => {
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
      expect(await cardOptions(SINGLE, [1, 1, 2, 0, 1])).toEqual([
        "--images-dir",
        "mnemocode-cards-images",
        "--image-format",
        "png",
        "--page-size",
        "a5",
      ]);
      script.noImages = true;
      // PNG first, then the first choice, a PDF, when the question is asked again.
      expect(await cardOptions(SINGLE, [1, 0, 0, 2, 0, 0])).toEqual([
        "--pdf",
        "mnemocode-cards.pdf",
        "--card-qr",
      ]);
      const kinds = script.asked.filter((asked) => asked.question === "Which kind of file?");
      expect(kinds.map((asked) => asked.warning)).toEqual([undefined, containing("pdftocairo")]);
    });

    it("takes typed details, keeps the others random, and refuses what the command refuses", async () => {
      const typed = {
        [CARD_NAME_PROMPT]: ["Анна", "--help", "Ann Lee"],
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
      assertAccepted(run);
      expect(warningsAt(CARD_NAME_PROMPT)).toEqual([
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
      // Every detail of separate business cards typed, which the command takes.
      assertAccepted((await runOf(ENTRY.encode, [...SINGLE, 0, 3, 0, 1], typedCardDetails()))!);
      expect(script.lines.map((line) => line.question)).toEqual([
        "Name of the new folder",
        CARD_NAME_PROMPT,
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

  it("asks the card details again, keeping every other answer, when the cards cannot print them", async () => {
    // 84 Latin letters and spaces: a name the details take, too long for its line on the card.
    const long =
      "Maximilian Alexander Konstantin Wolfgang Bartholomew Fitzgerald Montgomery Vanderbi";
    const run = (await runOf(ENTRY.encode, [...SINGLE, 0, 0, 2, 0, 0, 1, 1], {
      // Every detail typed again where the details are asked again.
      ...typedCardDetails(2),
      [CARD_NAME_PROMPT]: [long, "Ann Lee"],
    }))!;
    const details = CARD_DETAILS_QUESTION;
    expect(
      script.asked.filter((asked) => asked.question === details).map((asked) => asked.warning),
    ).toEqual([
      undefined,
      "The line with the subtitle and the name is too long to fit legibly on the card; shorten it.",
    ]);
    // Every answer before the details is kept: only the details were asked again.
    const others = script.asked
      .filter((asked) => asked.question !== details)
      .map((asked) => asked.question);
    expect(new Set(others).size).toBe(others.length);
    expect(run.slice(0, run.indexOf("--card-name"))).toEqual([
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
    expect(run[run.indexOf("--card-name") + 1]).toBe("Ann Lee");
    expect(run).not.toContain(long);
    // Every detail of a sheet typed, which the command takes.
    assertAccepted(run);
  });

  it("asks the details of share cards again when the cards cannot print them", async () => {
    const long =
      "Maximilian Alexander Konstantin Wolfgang Bartholomew Fitzgerald Montgomery Vanderbi";
    const run = (await runOf(ENTRY.encode, [...SHARES, 0, 0, 2, 0, 0, 1, 1], {
      // Every detail typed again where the details are asked again.
      ...typedCardDetails(2),
      [CARD_NAME_PROMPT]: [long, "Ann Lee"],
    }))!;
    const details = CARD_DETAILS_QUESTION;
    expect(
      script.asked.filter((asked) => asked.question === details).map((asked) => asked.warning),
    ).toEqual([undefined, expect.stringContaining("too long to fit legibly on the card")]);
    expect(run[run.indexOf("--card-name") + 1]).toBe("Ann Lee");
    assertAccepted(run);
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
});
