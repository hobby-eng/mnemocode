// re-encode --ask-secrets on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts).

import { describe, expect, it, vi } from "vitest";
import { NO_SUCH_LAST_WORD } from "../src/core/re-encoding.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);

// Public test data only: the BIP39 test phrase masked with 23-09-2026 by the Original Seedshift
// with a valid last word, as word numbers, as `mnemocode encode --mode seedshift-legacy
// --legacy-valid-last-word --format 2` gives it. 24-09-2026 gives other phrases, none of which
// ends with "about".
const LEGACY_VALID = "2027 10 24 2027 10 24 2027 10 24 2027 10 23";
const DATE = "23-09-2026";
const WRONG_DATE = "24-09-2026";
/** The last word of the test phrase, and a BIP39 word that ends no phrase of the backup. */
const LAST_WORD = "about";
const NOT_A_LAST_WORD = "zoo";
/** A word of the old phrase that neither the codes nor the last word typed hold. */
const OLD_WORD = "abandon";
/** The test phrase without Seedshift as Unicode codes, from the BIP39 Chinese list. */
const UNICODE = `${"7684".repeat(11)}5728`;
const CODES_PROMPT = "Encoded seed phrase or record:";
const DATES_PROMPT = "Dates (up to 4, DD-MM-YYYY, separated by spaces):";
const LAST_WORD_PROMPT = "Last word of the original seed phrase:";
/** The questions after the phrase is shown: its confirmation, then Encode's offer of a check. */
const CONFIRMED = ["Is this the seed phrase to re-encode?", "Check the backup now?"];
/** The answers of "What now?" after a last word that no phrase of the backup ends with. */
const AFTER_LAST_WORD = [
  "Type the last word again",
  "Type the dates again",
  "Type the encoded seed phrase again",
  "Stop",
];
/** The old backup typed, the new one given by Encode's options: Unicode codes without Seedshift. */
const ARGS = {
  "ask-secrets": true,
  "old-mode": "seedshift-legacy-valid",
  mode: "direct",
  format: "3",
} as const;

describe("re-encode on the private screen, for a backup with a valid last word", () => {
  questionsOnPrivateScreen();

  /** How often `prompt` was shown. */
  function timesShown(prompt: string): number {
    return seen.screen.split(prompt).length - 1;
  }

  it("offers the dates again after a last word that a wrong date leaves without a phrase, keeping the codes", async () => {
    terminal.answers = [
      `${LEGACY_VALID}\r`,
      `${WRONG_DATE}\r`,
      `${LAST_WORD}\r`,
      `${DATE}\r`,
      `${LAST_WORD}\r`,
    ];
    terminal.choices = ["dates", "person"];
    await runReEncode({ ...ARGS });
    expect(seen.notices).toContain(NO_SUCH_LAST_WORD);
    expect(terminal.questions).toEqual(["What now?", ...CONFIRMED]);
    expect(terminal.labels[0]).toEqual(AFTER_LAST_WORD);
    expect(seen.out).toContain(UNICODE);
    // The codes were typed once, the dates and the last word twice.
    expect(timesShown(CODES_PROMPT)).toBe(1);
    expect(timesShown(DATES_PROMPT)).toBe(2);
    expect(timesShown(LAST_WORD_PROMPT)).toBe(2);
  });

  it("asks for a mistyped last word again, keeping the codes and the dates", async () => {
    terminal.answers = [`${LEGACY_VALID}\r`, `${DATE}\r`, `${NOT_A_LAST_WORD}\r`, `${LAST_WORD}\r`];
    terminal.choices = ["word", "person"];
    await runReEncode({ ...ARGS });
    expect(seen.notices).toContain(NO_SUCH_LAST_WORD);
    expect(terminal.questions).toEqual(["What now?", ...CONFIRMED]);
    expect(terminal.labels[0]).toEqual(AFTER_LAST_WORD);
    expect(seen.out).toContain(UNICODE);
    expect(timesShown(CODES_PROMPT)).toBe(1);
    expect(timesShown(DATES_PROMPT)).toBe(1);
    expect(timesShown(LAST_WORD_PROMPT)).toBe(2);
  });

  it("types the codes again after a last word that ends no phrase, keeping the dates", async () => {
    terminal.answers = [
      `${LEGACY_VALID}\r`,
      `${WRONG_DATE}\r`,
      `${LAST_WORD}\r`,
      `${LEGACY_VALID}\r`,
      `${LAST_WORD}\r`,
      `${DATE}\r`,
      `${LAST_WORD}\r`,
    ];
    terminal.choices = ["backup", "dates", "person"];
    await runReEncode({ ...ARGS });
    expect(terminal.questions).toEqual(["What now?", "What now?", ...CONFIRMED]);
    expect(seen.out).toContain(UNICODE);
    // The wrong date was kept for the codes typed again, until it was typed again itself.
    expect(timesShown(CODES_PROMPT)).toBe(2);
    expect(timesShown(DATES_PROMPT)).toBe(2);
    expect(timesShown(LAST_WORD_PROMPT)).toBe(3);
  });

  // Standard output is a file here, as in `mnemocode re-encode --ask-secrets … > new.txt`: the old
  // phrase is shown only on standard error when it is a terminal, else only its fingerprint
  // (AUD-022-SEC001, AUD-024-ARC001).
  it.each([
    ["a terminal", true],
    ["no terminal", false],
  ])(
    "keeps the old phrase off standard output, with standard error %s",
    async (_, stderrTerminal) => {
      const wasTerminal = process.stderr.isTTY;
      process.stderr.isTTY = stderrTerminal;
      try {
        terminal.answers = [`${LEGACY_VALID}\r`, `${DATE}\r`, `${LAST_WORD}\r`];
        terminal.choices = ["person"];
        await runReEncode({ ...ARGS });
      } finally {
        process.stderr.isTTY = wasTerminal;
      }
      expect(seen.out).toContain(UNICODE);
      expect(seen.out.join("\n")).not.toContain(OLD_WORD);
      expect(seen.notices.join("\n").includes(OLD_WORD)).toBe(stderrTerminal);
    },
  );

  it("stops at Escape after a last word that ends no phrase, and re-encodes nothing", async () => {
    terminal.answers = [`${LEGACY_VALID}\r`, `${WRONG_DATE}\r`, `${LAST_WORD}\r`];
    expect(await runReEncode({ ...ARGS })).toBe(CANCELLED);
    expect(terminal.questions).toEqual(["What now?"]);
    expect(seen.out).not.toContain(UNICODE);
  });
});
