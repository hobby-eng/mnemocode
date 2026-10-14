// Typed answers at a terminal, which leave only their line in the record of answers: the questions
// run as they do at a terminal, with their keys typed by the tests (test/helpers/keyed-terminal.ts)
// on a screen that understands what they write (test/helpers/terminal-screen.ts).
// test/menu-terminal.test.ts has the start menu.

import { describe, expect, it, vi } from "vitest";
import { answerMark, askLine, eraseAnswersSince } from "../src/cli/terminal-choice.js";
import { displayWidth } from "../src/cli/terminal-geometry.js";
import { terminal } from "./helpers/keyed-terminal.js";
import {
  answer,
  answerLine,
  BACKSPACE,
  BEFORE,
  CTRL_A,
  CTRL_D,
  CTRL_U,
  ENTER,
  ESCAPE,
  expectScreen,
  HOME,
  keyedQuestions,
  LEFT,
  LONG_ANSWER,
  screenOf,
  watchScreen,
  type Reported,
} from "./helpers/terminal-screen.js";

const harness = await vi.hoisted(async () => import("./helpers/keyed-terminal.js"));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("node:child_process", async (importOriginal) =>
  harness.replacedChildProcess(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
vi.mock("../src/cli/protection.js", async (importOriginal) =>
  harness.replacedProtection(await importOriginal()),
);
vi.mock("../src/cli/self-test.js", async (importOriginal) =>
  harness.replacedSelfTest(await importOriginal()),
);
vi.mock("../src/export/image-export.js", async (importOriginal) =>
  harness.replacedImageExport(await importOriginal()),
);

keyedQuestions();

describe("a typed answer leaves only its line in the record of answers", () => {
  it.each([
    ["Enter", ""],
    ["Enter after Home", HOME],
    ["Enter after Ctrl+A", CTRL_A],
    ["Enter after Left", LEFT.repeat(5)],
  ])("%s, after a long answer", async (_, moved) => {
    const result = await answer(`${LONG_ANSWER}${moved}${ENTER}`, 20);
    expect(result.answer).toBe(LONG_ANSWER);
    expectScreen(result.screen, screenOf(20, BEFORE + answerLine("Word", LONG_ANSWER)));
  });

  it.each([
    ["Escape", ""],
    ["Escape after Home", HOME],
    ["Escape after Left", LEFT.repeat(5)],
    ["Escape after Ctrl+U", CTRL_U],
  ])("%s, after a long answer", async (_, moved) => {
    const result = await answer(`${LONG_ANSWER}${moved}${ESCAPE}`, 20);
    expect(result.answer).toBeUndefined();
    expectScreen(result.screen, screenOf(20, BEFORE));
  });

  it.each([
    // Prompt and answer end at the right edge: ShownLine has already gone on to the next row.
    [20, 2],
    [20, 3],
    [21, 2],
    [7, 4],
    // The prompt alone ends at the right edge, and Enter takes the fallback.
    [21, 1],
    [7, 3],
  ])("an answer that ends at the right edge of %i columns on row %i", async (columns, rows) => {
    const promptWidth = displayWidth("Word (Enter: about): ");
    const typed = "abandon".repeat(columns).slice(0, columns * rows - promptWidth);
    const result = await answer(`${typed}${ENTER}`, columns, { fallback: "about" });
    const given = typed === "" ? "about" : typed;
    expect(result.answer).toBe(given);
    expectScreen(result.screen, screenOf(columns, BEFORE + answerLine("Word", given)));
    // And the same left with Escape.
    const left = await answer(`${typed}${ESCAPE}`, columns, { fallback: "about" });
    expectScreen(left.screen, screenOf(columns, BEFORE));
  });

  // A wide character, such as a word of a Chinese file name, that reaches the last column does not
  // fit there: the terminal leaves the column empty and puts it whole on the next row.
  it.each([7, 9, 13, 21, 33])(
    "an answer with wide characters at the right edge of %i columns",
    async (columns) => {
      const promptWidth = displayWidth("Word: ");
      for (const narrow of [1, 2, 3].map((left) => columns - left - (promptWidth % columns))) {
        const typed = `${"a".repeat(Math.max(0, narrow))}日本語のファイル`;
        const result = await answer(`${typed}${ENTER}`, columns);
        expect(result.answer).toBe(typed);
        expectScreen(result.screen, screenOf(columns, BEFORE + answerLine("Word", typed)));
        const left = await answer(`${typed}${ESCAPE}`, columns);
        expectScreen(left.screen, screenOf(columns, BEFORE));
        // The line of the record wraps alike, and is counted alike when it is taken away.
        const screen = watchScreen(columns);
        screen.write(BEFORE);
        const mark = answerMark();
        terminal.keysFor = () => `${typed}${ENTER}`;
        await askLine("Word", "Word");
        eraseAnswersSince(mark);
        expectScreen(screen, screenOf(columns, BEFORE));
      }
    },
  );

  it.each([{ columns: 0 }, {}])(
    "counts at 80 columns where the terminal says %j, as readLine wraps",
    async (reported: Reported) => {
      const typed = `${LONG_ANSWER} ${LONG_ANSWER} ${LONG_ANSWER}`;
      const result = await answer(`${typed}${ENTER}`, 80, {}, reported);
      expectScreen(result.screen, screenOf(80, BEFORE + answerLine("Word", typed)));
      const left = await answer(`${typed}${ESCAPE}`, 80, {}, reported);
      expectScreen(left.screen, screenOf(80, BEFORE));
    },
  );
});

describe("a typed answer leaves only its line in the record of answers", () => {
  it("shows a warning above the question and takes it away with it", async () => {
    const warning = "Choose 2 to 16 shares, and 2 or more of them to restore it.";
    let shown: string[] = [];
    terminal.onFirstKey = () => (shown = screen.lines());
    const screen = watchScreen(30);
    screen.write(BEFORE);
    terminal.keysFor = () => `7${ENTER}`;
    expect(await askLine("How many", "In all", { warning })).toBe("7");
    // The warning wraps at 30 columns onto further rows.
    expect(shown.slice(1, 5)).toEqual([
      "",
      "! Choose 2 to 16 shares, and 2",
      " or more of them to restore it",
      ".",
    ]);
    expect(shown[5]).toBe("How many:");
    expectScreen(screen, screenOf(30, BEFORE + answerLine("In all", "7")));
  });

  it("asks again with one line of why, until an answer can be used", async () => {
    const screen = watchScreen(80);
    screen.write(BEFORE);
    const shown: string[][] = [];
    terminal.onFirstKey = () => shown.push(screen.lines());
    // Enter alone, an answer that is not UTF-8 (a stray byte 0xFF), one that the check refuses.
    const keys: (string | Buffer)[] = [
      ENTER,
      Buffer.from([0x61, 0xff, 0x0d]),
      `73c5da0${ENTER}`,
      `73c5da0a${ENTER}`,
    ];
    terminal.keysFor = () => keys.shift()!;
    const given = await askLine("Fingerprint", "Fingerprint", {
      what: "the eight characters of the fingerprint",
      check: (typed) => {
        if (typed !== "73c5da0a")
          throw new Error("A master fingerprint must be eight hexadecimal characters.");
        return typed;
      },
    });
    expect(given).toBe("73c5da0a");
    const warnings = [
      "Type the eight characters of the fingerprint, or press Esc to go back.",
      "The answer is not valid UTF-8 text.",
      "A master fingerprint must be eight hexadecimal characters.",
    ];
    // Each asking shows the warning of the one before it, and only that, above the question.
    expect(shown.map((lines) => lines.slice(1, -1))).toEqual([
      [""],
      ...warnings.map((warning) => ["", `! ${warning}`]),
    ]);
    expectScreen(screen, screenOf(80, BEFORE + answerLine("Fingerprint", "73c5da0a")));
    // Escape still goes back from a question asked again.
    const left = await answer([`x${ENTER}`, `${LONG_ANSWER}${ESCAPE}`], 20, {
      check: (typed) => {
        if (typed === "x") throw new Error("Not x.");
        return typed;
      },
    });
    expect(left.answer).toBeUndefined();
    expectScreen(left.screen, screenOf(20, BEFORE));
  });

  it.each([
    ["Ctrl+D", CTRL_D],
    ["Ctrl+D after a long answer and Ctrl+U", `${LONG_ANSWER}${CTRL_U}${CTRL_D}`],
  ])("%s at a prompt wider than the terminal goes back without a trace", async (_, keys) => {
    // "Word (Enter: about): " takes 21 columns: one more than the screen has.
    const result = await answer(keys, 20, { fallback: "about" });
    expect(result.answer).toBeUndefined();
    expectScreen(result.screen, screenOf(20, BEFORE));
  });

  it.each([
    // A stray byte after an answer typed and taken back again.
    [
      "0xFF after corrections",
      Buffer.from(`${"a".repeat(20)}${BACKSPACE.repeat(20)}\xff\r`, "latin1"),
    ],
    // é from a terminal set to Latin-1: a first byte of three, then an a.
    ["a Latin-1 é", Buffer.from([0xe9, 0x61, 0x0d])],
    // A surrogate, which UTF-8 may not hold, and an overlong slash.
    ["a surrogate", Buffer.from([0x61, 0xed, 0xa0, 0x80, 0x0d])],
    ["an overlong form", Buffer.from([0xc0, 0xaf, 0x0d])],
  ])("an answer with %s is asked again, and only the question goes", async (_, keys) => {
    const result = await answer([keys, `abandon${ENTER}`], 20);
    expect(result.answer).toBe("abandon");
    expectScreen(result.screen, screenOf(20, BEFORE + answerLine("Word", "abandon")));
  });
});
