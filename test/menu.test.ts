// The start menu: the questions of each entry and the command lines that they build, with the
// questions answered by a script (test/helpers/menu-script.ts) and the paths through them walked
// (test/helpers/menu-paths.ts). test/menu-typed-answers.test.ts has the typed answers. Public test
// data only.

import { BIP39_WORD_COUNTS } from "../src/core/bip39-sizes.js";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { commandOptions, isCommandName } from "../src/cli/command-options.js";
import { ANSWER_LABEL_WIDTH } from "../src/cli/terminal-choice.js";
import { TEXT_WIDTH } from "../src/cli/terminal.js";
import { HEIR_MENU } from "../src/cli/heir-sheet.js";
import { ENCODED_SEEDSHIFT_QUESTION } from "../src/cli/seedshift-choices.js";
import { MENU_ENTRIES, typedCommand } from "../src/cli/menu.js";
import { MENU_ENTRY_NAMES as ENTRY } from "../src/cli/menu-entries.js";
import { formatNumber } from "../src/cli/format-numbers.js";
import { anyOf, containing } from "./helpers/matchers.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import {
  answeredByScript,
  assertCardOptions,
  cardOptions,
  everyPath,
  files,
  runOf,
  SHARES,
  SINGLE,
  warningsAt,
} from "./helpers/menu-paths.js";
import { script } from "./helpers/menu-script.js";

const harness = await vi.hoisted(async () => import("./helpers/menu-script.js"));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/export/image-export.js", async (importOriginal) =>
  harness.replacedImageExport(await importOriginal()),
);

answeredByScript();

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
      // Lists and explanations fit a terminal of 80 columns unwrapped (TEXT_WIDTH), and no note of
      // a list is cut to fit.
      for (const line of [...script.lists.flat(), ...script.explanations.flat()])
        expect(Array.from(line).length, line).toBeLessThanOrEqual(TEXT_WIDTH);
      expect([...new Set(script.cutNotes)]).toEqual([]);
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
    // numbers too, on the screen, with the original wallet phrase in word numbers beside them.
    expect(await runOf(ENTRY.encode, [0, 0, 1, 0, 2, 0])).toEqual([
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
      "codes",
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

  it("offers independent choices for the original wallet phrase and the Seedshift words", async () => {
    for (const [choice, form] of [undefined, "words", "codes", "both"].entries()) {
      for (const words of [0, 1]) {
        const run = (await runOf(ENTRY.encode, [0, 0, 1, 0, choice, words, 0]))!;
        const args = parseArguments(run.slice(1));
        expect(args["show-original"]).toBe(form);
        expect(args.format).toBe(form === "codes" || form === "both" ? "2" : undefined);
        expect(args["show-masked-words"]).toBe(words === 1 ? true : undefined);
      }
    }
  });
});

describe("start menu", () => {
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
    const list = script.lists[0]!.map((line) => line.replace(STYLE_CODES, ""));
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
});

describe("start menu", () => {
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
      anyOf(String),
      "--qr",
      anyOf(String),
    ]);
    const all = script.asked.find((asked) => asked.question === "Where should the result go?")!;
    expect(all.labels.at(-1)).toBe("All of these");
    // Colors, no Seedshift, no shares: the record, the QR code, then the questions of the cards,
    // a PDF of A6 sheets in the first design here.
    const run = (await runOf(ENTRY.encode, [2, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(run.slice(run.indexOf("--output"), run.indexOf("--qr") + 2)).toEqual([
      "--output",
      anyOf(String),
      "--qr",
      anyOf(String),
    ]);
    expect(run).toContain("--pdf");
    // Shares of colors: a text file and their cards.
    const shares = (await runOf(ENTRY.encode, [2, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0]))!;
    expect(shares[shares.indexOf("--output") + 1]).toEqual(anyOf(String));
    expect(shares).toContain("--template");
  });
});

describe("start menu", () => {
  describe("card questions after Also as printable cards", () => {
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
  });
});

describe("start menu", () => {
  describe("card questions after Also as printable cards", () => {
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
      expect(kinds.map((asked) => asked.warning)).toEqual([undefined, containing("pdftocairo")]);
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
});
