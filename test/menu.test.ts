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
      fallback ?? { Word: "abandon", "Word number": "1", "Unicode code": "5BF6" }[question],
  };
});

import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { commandOptions, isCommandName } from "../src/cli/command-options.js";
import { LINE_WIDTH } from "../src/cli/terminal-choice.js";
import { MENU_ENTRIES, typedCommand } from "../src/cli/menu.js";

/** Questions whose answers all lead to command lines of the same shape; only the first is taken. */
const SAME_SHAPE = new Set([
  "Which card design?",
  "How many shares, and how many of them restore the seed phrase?",
]);

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
    // Word numbers with MnemoCode Seedshift, split 2 of 3 into shares written as color codes, on
    // the screen.
    script.answers = [0, 0, 0, 1, 1, 0];
    script.asked = [];
    expect(await encode.action()).toEqual({
      run: [
        "encode",
        "--sskr",
        "--ask-secrets",
        "--format",
        "2",
        "--mode",
        "seedshift",
        "--threshold",
        "2",
        "--shares",
        "3",
        "--share-format",
        "colors",
      ],
    });
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
    ]);
  });

  it("offers printable cards only where they print colors", async () => {
    const destinations = async (answers: number[]) => {
      script.answers = answers;
      script.asked = [];
      await MENU_ENTRIES[0]!.action();
      return script.asked.find((asked) => asked.question.startsWith("Where should"))!.labels;
    };
    // Word numbers, no Seedshift, no shares: a record or a QR code, no cards.
    expect(await destinations([0, 1, 0])).not.toContain("Also as printable cards");
    // Colors: cards too.
    expect(await destinations([2, 1, 0])).toContain("Also as printable cards");
    // Shares written as text: QR codes, no cards; as color codes: cards, no QR codes.
    expect(await destinations([2, 1, 1, 0])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as QR codes",
    ]);
    expect(await destinations([0, 1, 1, 1])).toEqual([
      "Only on this screen",
      "Also in a text file",
      "Also as printable cards",
    ]);
  });

  it("shows the typed command with quotes only where a shell needs them", () => {
    expect(typedCommand(["decode", "--ask-secrets", "--input-file", "my record.txt"])).toBe(
      'mnemocode decode --ask-secrets --input-file "my record.txt"',
    );
    expect(typedCommand(["table", "--word", "abandon"])).toBe("mnemocode table --word abandon");
  });
});
