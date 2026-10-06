import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// The questions are answered by a script instead of a terminal: `answers` holds the place of the
// answer to each question in turn, and `asked` records how many choices each question offered.
const script = vi.hoisted(() => ({
  answers: [] as number[],
  asked: [] as { question: string; count: number; labels: string[] }[],
  lists: [] as string[][],
  explanations: [] as string[][],
  labels: [] as string[],
}));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-choice.js")>();
  return {
    ...actual,
    choose: async (
      question: string,
      choices: readonly { label: string; value: unknown }[],
      options: { readonly label: string; readonly explanation?: never },
    ) => {
      script.labels.push(options.label);
      script.explanations.push(actual.explanationLines(options.explanation));
      const place = script.answers[script.asked.length] ?? 0;
      const labels = choices.map((choice) => choice.label);
      script.asked.push({ question, count: choices.length, labels });
      script.lists.push(actual.listLines(choices as never, place));
      return choices[place]!.value;
    },
    askLine: async (question: string, _label: string, fallback?: string) =>
      fallback ??
      {
        Word: "abandon",
        "Word number": "1",
        "Unicode code": "5BF6",
        "How many shares in all? (2 to 16)": "7",
        "How many of them restore the seed phrase?": "4",
        // The public test phrase's fingerprint and its first native SegWit address.
        Fingerprint: "73c5da0a",
        // A public test key: the recipient of a key that is thrown away.
        "Scanner key": "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x",
        "Bitcoin address": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
      }[question],
  };
});

import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { commandOptions, isCommandName } from "../src/cli/command-options.js";
import { LINE_WIDTH } from "../src/cli/terminal-choice.js";
import { HEIR_MENU } from "../src/cli/heir-sheet.js";
import { commandDisplay, MENU_ENTRIES, typedCommand } from "../src/cli/menu.js";

/** Questions whose answers all lead to command lines of the same shape; only the first is taken. */
const SAME_SHAPE = new Set(["Which card design?"]);

/** Every command line that the questions of `entry` can build, one per path through them. */
async function everyPath(entry: (typeof MENU_ENTRIES)[number]): Promise<string[][]> {
  const runs: string[][] = [];
  const pending: number[][] = [[]];
  while (pending.length > 0) {
    script.answers = pending.pop()!;
    script.asked = [];
    const action = await entry.action();
    if (typeof action === "object" && action !== null) runs.push([...action.run]);
    // Every other answer to a question asked after the scripted ones is a path of its own.
    for (let index = script.answers.length; index < script.asked.length; index += 1) {
      const { question, count } = script.asked[index]!;
      if (SAME_SHAPE.has(question)) continue;
      const before = script.asked.slice(0, index).map((_, place) => script.answers[place] ?? 0);
      for (let other = 1; other < count; other += 1) pending.push([...before, other]);
    }
  }
  return runs;
}

describe("start menu", () => {
  it("offers the agreed entries, numbered 1 to 9 and 0 for Quit", () => {
    expect(MENU_ENTRIES.map((entry) => entry.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(MENU_ENTRIES[2]!.label).toBe("Split a seed phrase into standard Shamir shares");
    expect(MENU_ENTRIES[0]!.label).toBe("Encode a seed phrase as numbers, codes or colors");
    expect(MENU_ENTRIES[1]!.label).toBe("Decode numbers, codes or colors back into a seed phrase");
  });

  it.each(MENU_ENTRIES.map((entry) => [entry.label, entry] as const))(
    "%s: every answer builds a command line that MnemoCode accepts",
    async (_, entry) => {
      script.lists = [];
      script.explanations = [];
      script.labels = [];
      for (const run of await everyPath(entry)) {
        const [command, ...rest] = run;
        expect(isCommandName(command!), typedCommand(run)).toBe(true);
        const parsed = parseArguments(rest);
        assertAllowedArguments(parsed, command!, commandOptions[command as never]);
        // A secret never goes on the command line: a command that takes one asks for it.
        if (["encode", "decode", "sskr-split", "sskr-combine", "recover-word"].includes(command!))
          expect(parsed["ask-secrets"], typedCommand(run)).toBe(true);
      }
      // A list or an explanation that wrapped would upset its redrawing (terminal-choice.ts).
      for (const line of [...script.lists.flat(), ...script.explanations.flat()])
        expect([...line].length, line).toBeLessThanOrEqual(LINE_WIDTH);
      // Every question names its line in the record of answers, shorter than the label column.
      for (const label of script.labels) expect(label.length, label).toBeLessThan(10);
    },
  );

  it("builds the command lines of the usual answers", async () => {
    const encode = MENU_ENTRIES[0]!;
    // Colors, no Seedshift, no shares, as printable cards in the first design.
    script.answers = [2, 1, 0, 3, 0];
    script.asked = [];
    expect(await encode.action()).toEqual({
      run: [
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
      ],
    });
    // Word numbers, always masked, with MnemoCode Seedshift, split 2 of 3 into shares in word
    // numbers too, on the screen, with the whole seed phrase beside them (--format).
    script.answers = [0, 0, 1, 0, 1];
    script.asked = [];
    expect(await encode.action()).toEqual({
      run: [
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
      ],
    });
    // Colors give color shares without a question about their look.
    script.answers = [2, 1, 1, 0];
    script.asked = [];
    expect(await encode.action()).toMatchObject({
      run: expect.arrayContaining(["--share-format", "colors"]),
    });
    expect(script.asked.map((asked) => asked.question)).not.toContain(
      "How should each share be written?",
    );
    // English words are always masked; the original Seedshift asks nothing about shares.
    script.answers = [4, 1, 0];
    script.asked = [];
    expect(await encode.action()).toEqual({
      run: ["encode", "--ask-secrets", "--format", "1", "--mode", "seedshift-legacy"],
    });
    expect(script.asked.map((asked) => asked.question)).toEqual([
      "Which form should the seed phrase take?",
      "Which Seedshift?",
      "Where should the result go?",
      "Instructions for your heirs?",
    ]);
    // Unicode codes, no Seedshift, a threshold typed under Other, no whole copy, and a sheet for
    // heirs.
    script.answers = [1, 1, 7, 0, 0, 1];
    script.asked = [];
    expect(await encode.action()).toEqual({
      run: [
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
      ],
    });
  });

  it("always masks word numbers and words, and calls an unmasked copy weak", async () => {
    for (const form of [0, 4]) {
      script.answers = [form];
      script.asked = [];
      await MENU_ENTRIES[0]!.action();
      const questions = script.asked.map((asked) => asked.question);
      expect(questions).not.toContain("Use Seedshift?");
      expect(questions).toContain("Which Seedshift?");
    }
    // Unicode codes may stay unmasked, but the answer says how weak that is.
    script.answers = [1];
    script.asked = [];
    script.lists = [];
    await MENU_ENTRIES[0]!.action();
    expect(script.asked[1]!.question).toBe("Use Seedshift?");
    expect(script.lists[1]!.join(" ")).toContain("weak: only disguised");
  });

  it("has the entries, questions and answers that the sheet for heirs names", async () => {
    const asked = async (digit: number) => {
      const entry = MENU_ENTRIES.find((item) => item.digit === digit)!;
      script.answers = [];
      script.asked = [];
      await entry.action();
      return { entry: `${entry.digit} ${entry.label}`, asked: script.asked };
    };
    for (const [digit, steps] of [
      [2, HEIR_MENU.decode],
      [4, HEIR_MENU.restore],
    ] as const) {
      const { entry, asked: questions } = await asked(digit);
      expect(entry).toBe(steps.entry);
      const question = questions.find((item) => item.question === steps.question);
      expect(question, steps.question).toBeDefined();
      for (const answer of Object.values(steps.answers)) expect(question!.labels).toContain(answer);
    }
    expect((await asked(2)).asked[0]!.labels[0]).toBe(HEIR_MENU.decode.source);
    expect((await asked(HEIR_MENU.recover.digit)).entry).toBe(HEIR_MENU.recover.entry);
  });

  it("splits into standard shares in words or a short code from entry 3", async () => {
    const split = MENU_ENTRIES[2]!;
    // MnemoCode Seedshift, 2 of 3, in Bytewords, on the screen; no "Which Seedshift?" question.
    script.answers = [0, 0, 0, 0, 0];
    script.asked = [];
    expect(await split.action()).toEqual({
      run: [
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
      ],
    });
    expect(script.asked.map((asked) => asked.question)).not.toContain("Which Seedshift?");
    expect(script.asked[2]!.labels).toEqual(["Words", "Short code"]);
  });

  it("offers printable cards only where they print colors", async () => {
    const destinations = async (answers: number[]) => {
      script.answers = answers;
      script.asked = [];
      await MENU_ENTRIES[0]!.action();
      return script.asked.find((asked) => asked.question.startsWith("Where should"))!.labels;
    };
    // Word numbers, MnemoCode Seedshift, no shares: a record or a QR code, no cards.
    expect(await destinations([0, 0, 0])).not.toContain("Also as printable cards");
    // Colors: cards too.
    expect(await destinations([2, 1, 0])).toContain("Also as printable cards");
    // Shares of word numbers are plain text: QR codes, no cards. Shares of colors are color codes:
    // disguised cards, no QR codes.
    expect(await destinations([0, 0, 1, 0])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as QR codes",
    ]);
    expect(await destinations([2, 1, 1])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as printable cards",
    ]);
  });

  it("shows the typed command with quotes only where a shell needs them", () => {
    expect(
      typedCommand(["decode", "--ask-secrets", "--input-file", "my record.txt"], "linux"),
    ).toBe("mnemocode decode --ask-secrets --input-file 'my record.txt'");
    expect(typedCommand(["table", "--word", "abandon"])).toBe("mnemocode table --word abandon");
    expect(typedCommand(["preview", "--pdf", "it's.pdf"], "win32")).toBe(
      "mnemocode preview --pdf 'it''s.pdf'",
    );
  });

  // Windows has no POSIX shell to paste into; its quoting is checked above.
  it.skipIf(process.platform === "win32")(
    "keeps every file name byte for byte when the command is pasted into a shell",
    () => {
      const names = [
        "output/a$(printf b).pdf",
        "a `date` b.pdf",
        "back\\slash \\n.pdf",
        "say \"hi\" and 'bye'.pdf",
        "carte d'identité ✓ 日本.pdf",
        "$HOME/*.pdf",
        "output/a  b.pdf",
        `output/${"a".repeat(45)} ${"b".repeat(45)}.pdf`,
      ];
      for (const name of names) {
        // The shown command is run in a real POSIX shell, with mnemocode as a function that prints
        // its arguments one per NUL.
        const script = `mnemocode() { printf '%s\\0' "$@"; }; ${commandDisplay(["preview", "--pdf", name])}`;
        const printed = spawnSync("sh", ["-c", script], { encoding: "utf8" }).stdout.split("\0");
        expect(printed.slice(0, 3)).toEqual(["preview", "--pdf", name]);
      }
    },
  );
});
