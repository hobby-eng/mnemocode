// The searches of recover-word and of sskr-combine run on a step screen of their own, opened once
// the last question before them was answered, and what a search says of its size and time is drawn
// on it (CORE-39): the words, shares, dates or wallet typed before are no longer on the screen.
// The terminal is replaced (test/helpers/question-terminal.ts). Public test data only: the
// "abandon … about" phrase, its fingerprint 73c5da0a, and shares split from it here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { runSskrCombine } from "../src/cli/sskr-restore-command.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { markUnits } from "./helpers/shares.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

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
    terminal.answers = [`${"abandon ".repeat(11)}?\r`];
    await runRecoverWord({ "ask-secrets": true });
    expect(seen.notices).toContain(SEARCH_SCREEN);
    expect(seen.out.some((line) => line.includes(TEST_PHRASE))).toBe(true);
  });
});

describe("the searches of sskr-combine", () => {
  const masked = encodeMnemonic(TEST_PHRASE, [parseDate("23-09-2026")]).shiftedEnglish.join(" ");
  let shares: string[];
  beforeEach(async () => {
    shares = await splitSskrMnemonic(masked, 2, 3);
  });

  /** The notice just before the one that starts with `start`: the screen it is drawn on. */
  function screenOf(start: string): string | undefined {
    const at = seen.notices.findIndex((line) => line.startsWith(start));
    expect(at).toBeGreaterThan(0);
    return seen.notices[at - 1];
  }

  it("says the time of a date search on its own step screen, after the wallet", async () => {
    terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r", `${TEST_FINGERPRINT}\r`];
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
