// A step that an answer under a result leads to, the dates or the codes typed again or a search with
// another wallet, opens a step screen of its own (CORE-39): the result above the question is no
// longer on the screen of the next prompt or search. The questions asked under the result, such as
// "What now?" and the wallet asked with it, open none. The terminal is replaced
// (test/helpers/question-terminal.ts), with both streams terminals, as a person's are. Public test
// data only: the "abandon … about" phrase, its fingerprint and its masked forms.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeMnemonicLegacy, formatEncoded, parseDate } from "../src/core.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { runDecode } from "../src/cli/decode-command.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { questionsOnPrivateScreen, seen, terminal, windowOf } from "./helpers/question-terminal.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { DATE, MASKED, TEST_FINGERPRINT, TEST_PHRASE, WRONG_DATE } from "./helpers/test-phrase.js";
import { DATES_AGAIN_ANSWER, RE_ENCODE_CONFIRMATION, WALLET_QUESTION } from "./helpers/prompts.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

questionsOnPrivateScreen();

/** The test phrase masked with the Original Seedshift and DATE, as word numbers and as words. */
const LEGACY = encodeMnemonicLegacy(TEST_PHRASE, [parseDate(DATE)]);
const LEGACY_NUMBERS = formatEncoded(LEGACY, "indexes");
const LEGACY_WORDS = formatEncoded(LEGACY, "english");
/** A wallet that no phrase of the test data gives. */
const NO_WALLET = "00000000";

/**
 * Each step screen opened, as a notice: how many list questions were asked before it, and how many
 * typed answers were still to come.
 */
function stepScreen(): string {
  return `step screen after ${terminal.questions.length} questions, ${terminal.answers.length} answers to come`;
}

/** The step screens opened after `questions` list questions. */
function screensAfter(questions: number): string[] {
  return seen.notices.filter((line) => line.startsWith(`step screen after ${questions} questions`));
}

beforeEach(() => {
  streamsAsTerminal();
  terminal.stdoutTerminal = true;
  windowOf(60, 80);
  PrivateSteps.open(
    () => seen.notices.push(stepScreen()),
    () => undefined,
  );
});
afterEach(() => {
  PrivateSteps.close();
});

describe("decode", () => {
  it("types the dates again on a step screen of their own, after a phrase without a valid checksum", async () => {
    terminal.answers = [`${LEGACY_NUMBERS}\r`, `${WRONG_DATE}\r`, `${DATE}\r`];
    terminal.choices = [DATES_AGAIN_ANSWER];
    await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
    expect(terminal.questions).toEqual(["What now?"]);
    expect(screensAfter(1)).toEqual(["step screen after 1 questions, 1 answers to come"]);
  });
});

describe("recover-date", () => {
  it("types the dates again on a step screen of their own, and searches them on another", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r", "2?-09-2026\r"];
    terminal.choices = ["Change the dates", "Stop"];
    await runRecoverDate({
      "ask-secrets": true,
      mode: "seedshift",
      "master-fingerprint": NO_WALLET,
    });
    expect(terminal.questions).toEqual(["What now?", "What now?"]);
    expect(screensAfter(1)).toEqual([
      "step screen after 1 questions, 1 answers to come",
      "step screen after 1 questions, 0 answers to come",
    ]);
  });

  it("searches with another wallet on a step screen of its own, the wallet asked under the result", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r", `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["Change the wallet", "Fingerprint"];
    await runRecoverDate({
      "ask-secrets": true,
      mode: "seedshift",
      "master-fingerprint": NO_WALLET,
    });
    expect(terminal.questions).toEqual(["What now?", WALLET_QUESTION]);
    expect(screensAfter(1)).toEqual([]);
    expect(screensAfter(2)).toEqual(["step screen after 2 questions, 0 answers to come"]);
    expect(seen.out.join("\n")).toContain("matched at m");
  });
});

describe("re-encode", () => {
  it("types the dates again on a step screen of their own, after the phrase shown to be confirmed", async () => {
    terminal.answers = [`${MASKED}\r`, `${WRONG_DATE}\r`, `${DATE}\r`];
    terminal.choices = [DATES_AGAIN_ANSWER, "Yes, I recognise it", "No"];
    await runReEncode({
      "ask-secrets": true,
      "old-mode": "seedshift",
      mode: "direct",
      format: "3",
    });
    expect(terminal.questions.slice(0, 2)).toEqual([
      RE_ENCODE_CONFIRMATION,
      RE_ENCODE_CONFIRMATION,
    ]);
    expect(screensAfter(1)).toEqual(["step screen after 1 questions, 1 answers to come"]);
  });
});

describe("recover-word --legacy-valid-last-word", () => {
  it("shows the replacements on a step screen of their own, without the phrase typed", async () => {
    terminal.answers = [`${LEGACY_WORDS}\r`];
    terminal.choices = ["Done"];
    await runRecoverWord({
      "ask-secrets": true,
      "legacy-valid-last-word": true,
      "master-fingerprint": NO_WALLET,
    });
    expect(terminal.questions).toEqual(["What now?"]);
    expect(screensAfter(0)).toEqual([
      "step screen after 0 questions, 1 answers to come",
      "step screen after 0 questions, 0 answers to come",
    ]);
  });
});
