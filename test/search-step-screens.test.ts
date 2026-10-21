// The searches of recover-word and of sskr-combine run on a step screen of their own, opened once
// the last question before them was answered, and what a search says of its size and time is drawn
// on it (CORE-39): the words, shares, dates or wallet typed before are no longer on the screen.
// The terminal is replaced (test/helpers/question-terminal.ts). Public test data only: the
// "abandon … about" phrase, its fingerprint, and shares split from it here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { runSskrCombine } from "../src/cli/sskr-restore-command.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { markUnits } from "./helpers/shares.js";
import {
  DATE_LAST_DIGIT_FORGOTTEN,
  LAST_WORD_FORGOTTEN,
  MASKED_WORDS,
  replacedAt,
  TEST_FINGERPRINT,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

questionsOnPrivateScreen();

/**
 * Each step screen opened, as a notice: how many typed answers were still to come, and how many
 * lines of a result were shown. One opened after the last answer and before any result is the
 * search's.
 */
function stepScreen(): string {
  return `step screen (${terminal.answers.length} answers to come, ${seen.out.length} lines shown)`;
}

/** The step screen of a search: every answer typed, nothing of the result shown yet. */
const SEARCH_SCREEN = "step screen (0 answers to come, 0 lines shown)";

beforeEach(() => {
  PrivateSteps.open(
    () => seen.notices.push(stepScreen()),
    () => undefined,
  );
});
afterEach(() => {
  PrivateSteps.close();
});

describe("the search of recover-word", () => {
  it("opens a step screen of its own once the words are typed", async () => {
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`];
    await runRecoverWord({ "ask-secrets": true });
    expect(seen.notices).toContain(SEARCH_SCREEN);
    expect(seen.out.some((line) => line.includes(TEST_PHRASE))).toBe(true);
  });

  it("asks what comes next under its result and warnings, then types the words on a new screen", async () => {
    // Each step screen says how many list questions were asked before it.
    PrivateSteps.open(
      () => seen.notices.push(`step screen after ${terminal.questions.length} questions`),
      () => undefined,
    );
    terminal.answers = [
      `${LAST_WORD_FORGOTTEN}\r`,
      `${replacedAt(TEST_PHRASE, { 12: "about|abandon" })}\r`,
    ];
    terminal.choices = ["Type the words again"];
    await runRecoverWord({ "ask-secrets": true, "master-fingerprint": "00000000" });
    const result = seen.notices.indexOf(
      "Matched 0 of 128 candidates against the requested master fingerprint locally.",
    );
    const typedAgain = seen.notices.indexOf("step screen after 1 questions");
    // The result and its warnings stay on the screen of "What now?", which opens none of its own;
    // the words typed again then have a step screen of their own.
    expect(result).toBeGreaterThan(0);
    expect(typedAgain).toBeGreaterThan(result);
    const between = seen.notices.slice(result, typedAgain);
    expect(between.some((line) => line.startsWith("step screen"))).toBe(false);
    expect(between).toContain(
      "A master fingerprint is only 32 bits and is a filter, not proof of recovery.",
    );
    expect(terminal.questions).toEqual(["What now?", "What now?"]);
  });
});

describe("the searches of sskr-combine", () => {
  let shares: string[];
  beforeEach(async () => {
    shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
  });

  /** The notice just before the one that starts with `start`: the screen it is drawn on. */
  function screenOf(start: string): string | undefined {
    const at = seen.notices.findIndex((line) => line.startsWith(start));
    expect(at).toBeGreaterThan(0);
    return seen.notices[at - 1];
  }

  it("says the time of a date search on its own step screen, after the wallet", async () => {
    terminal.answers = [
      `${shares[0]};${shares[2]}\r`,
      `${DATE_LAST_DIGIT_FORGOTTEN}\r`,
      `${TEST_FINGERPRINT}\r`,
    ];
    terminal.choices = ["Fingerprint"];
    await runSskrCombine({ "ask-secrets": true, mode: "seedshift" });
    expect(screenOf("The search tries 10 date combinations:")).toBe(SEARCH_SCREEN);
    expect(seen.out).toContain(TEST_PHRASE);
  });

  it("says the time of a search of marked shares on its own step screen, after the wallet", async () => {
    // One unreadable colour of the second share, which the shares settle together.
    const marked = markUnits(shares[1]!, "colors", [5]);
    terminal.answers = [`${shares[0]};${marked}\r`, "?3-09-2026\r", `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["Fingerprint"];
    await runSskrCombine({ "ask-secrets": true, mode: "seedshift" });
    expect(screenOf("The search tries 1 share combination, then 3 date combinations")).toBe(
      SEARCH_SCREEN,
    );
    expect(seen.out).toContain(TEST_PHRASE);
  });
});
