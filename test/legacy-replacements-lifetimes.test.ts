// recover-word --legacy-valid-last-word owns the phrase typed as bytes (SecretValue) while its
// replacements are shown and asked about, finds the replacements again where they are used, and
// wipes the phrase when it is typed again and when the command ends (CORE-24). The terminal is
// replaced (test/helpers/question-terminal.ts). Public test data only: the "abandon … about"
// phrase masked with the Original Seedshift and the public date, and the phrase itself.

import { describe, expect, it, vi } from "vitest";
import { encodeMnemonicLegacy, formatEncoded, parseDate } from "../src/core.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { SecretValue } from "../src/core/secret-value.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { WIPED_CODE } from "./helpers/owner-lifetime.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";
import { WORDS_AGAIN_ANSWER } from "./helpers/prompts.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

questionsOnPrivateScreen();

/** The legacy record of the test phrase, as English words: the phrase that is typed. */
const LEGACY_WORDS = formatEncoded(encodeMnemonicLegacy(TEST_PHRASE, [parseDate(DATE)]), "english");
/** A wallet that no replacement gives, so that "What now?" is asked under the replacements. */
const NO_WALLET = "00000000";
const ARGS = {
  "ask-secrets": true,
  "legacy-valid-last-word": true,
  "master-fingerprint": NO_WALLET,
} as const;

/** Whether `secret` can still be read; false once it was wiped. */
function readable(secret: SecretValue<string>): boolean {
  try {
    return secret.value.length > 0;
  } catch (error) {
    expect(error).toHaveProperty("code", WIPED_CODE);
    return false;
  }
}

/** Every SecretValue that a text was made into so far, and its text, through the real factory. */
function madeTexts(): { readonly made: () => [string, SecretValue<string>][] } {
  const spy = vi.spyOn(SecretValue, "text");
  return {
    made: () =>
      spy.mock.calls.flatMap(([text], index) => {
        const result = spy.mock.results[index];
        if (result?.type !== "return") return [];
        const made: [string, SecretValue<string>] = [text, result.value];
        return [made];
      }),
  };
}

/** The values made from `phrase`, as the command keeps it. */
function phraseValues(
  made: [string, SecretValue<string>][],
  phrase: string,
): SecretValue<string>[] {
  return made.filter(([text]) => text === phrase).map(([, secret]) => secret);
}

describe("The legacy phrase of recover-word", () => {
  it("is kept as bytes under the replacements shown, and wiped when the command ends", async () => {
    const { made } = madeTexts();
    let atQuestion: boolean[] = [];
    terminal.answers = [`${LEGACY_WORDS}\r`];
    terminal.choices = [
      async () => {
        atQuestion = phraseValues(made(), LEGACY_WORDS).map(readable);
        return "Done";
      },
    ];
    await runRecoverWord({ ...ARGS });
    expect(terminal.questions).toEqual(["What now?"]);
    // The replacements were shown from the bytes: 128 of them, none matching the wallet.
    expect(seen.notices).toContain(
      "Matched 0 of 128 candidates against the requested master fingerprint locally.",
    );
    expect(atQuestion).toEqual([true]);
    expect(phraseValues(made(), LEGACY_WORDS).map(readable)).toEqual([false]);
  });

  it("is wiped once another phrase is typed in its place", async () => {
    const { made } = madeTexts();
    let firstAtSecond: boolean[] = [];
    terminal.answers = [`${LEGACY_WORDS}\r`, `${TEST_PHRASE}\r`];
    terminal.choices = [
      WORDS_AGAIN_ANSWER,
      async () => {
        firstAtSecond = phraseValues(made(), LEGACY_WORDS).map(readable);
        return "Done";
      },
    ];
    await runRecoverWord({ ...ARGS });
    expect(terminal.questions).toEqual(["What now?", "What now?"]);
    expect(firstAtSecond).toEqual([false]);
    expect(phraseValues(made(), TEST_PHRASE).map(readable)).toEqual([false]);
  });
});
