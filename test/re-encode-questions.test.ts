import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// re-encode --ask-secrets on the private screen, with the terminal replaced: each question that
// reads a line takes the next of `terminal.answers`, as a terminal in raw mode delivers it, and
// each list question (choose) the next of `terminal.choices`, or Escape when none is left. Nothing
// reads the real terminal.
const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
  /** The labels of each list question, in order. */
  labels: [] as string[][],
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => false,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => true,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  return {
    ...actual,
    terminalAvailable: () => true,
    withRawTerminal: async <T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ) => {
      const bytes = [...Buffer.from(terminal.answers.shift() ?? "", "utf8")];
      return body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
    },
  };
});
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (question: string, choices: readonly { readonly label: string }[]) => {
    terminal.questions.push(question);
    terminal.labels.push(choices.map((choice) => choice.label));
    return terminal.choices.shift();
  },
}));

import { NO_SUCH_LAST_WORD } from "../src/core/re-encoding.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { InputCancelledError } from "../src/cli/terminal-input.js";

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
  let screen: string;
  let out: string[];
  let notices: string[];
  beforeEach(() => {
    terminal.answers = [];
    terminal.choices = [];
    terminal.questions = [];
    terminal.labels = [];
    screen = "";
    out = [];
    notices = [];
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      screen += Buffer.from(chunk as Uint8Array).toString("utf8");
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      out.push(line.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      notices.push(line.join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** How often `prompt` was shown. */
  function timesShown(prompt: string): number {
    return screen.split(prompt).length - 1;
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
    expect(notices).toContain(NO_SUCH_LAST_WORD);
    expect(terminal.questions).toEqual(["What now?", ...CONFIRMED]);
    expect(terminal.labels[0]).toEqual(AFTER_LAST_WORD);
    expect(out).toContain(UNICODE);
    // The codes were typed once, the dates and the last word twice.
    expect(timesShown(CODES_PROMPT)).toBe(1);
    expect(timesShown(DATES_PROMPT)).toBe(2);
    expect(timesShown(LAST_WORD_PROMPT)).toBe(2);
  });

  it("asks for a mistyped last word again, keeping the codes and the dates", async () => {
    terminal.answers = [`${LEGACY_VALID}\r`, `${DATE}\r`, `${NOT_A_LAST_WORD}\r`, `${LAST_WORD}\r`];
    terminal.choices = ["word", "person"];
    await runReEncode({ ...ARGS });
    expect(notices).toContain(NO_SUCH_LAST_WORD);
    expect(terminal.questions).toEqual(["What now?", ...CONFIRMED]);
    expect(terminal.labels[0]).toEqual(AFTER_LAST_WORD);
    expect(out).toContain(UNICODE);
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
    expect(out).toContain(UNICODE);
    // The wrong date was kept for the codes typed again, until it was typed again itself.
    expect(timesShown(CODES_PROMPT)).toBe(2);
    expect(timesShown(DATES_PROMPT)).toBe(2);
    expect(timesShown(LAST_WORD_PROMPT)).toBe(3);
  });

  it("stops at Escape after a last word that ends no phrase, and re-encodes nothing", async () => {
    terminal.answers = [`${LEGACY_VALID}\r`, `${WRONG_DATE}\r`, `${LAST_WORD}\r`];
    await expect(runReEncode({ ...ARGS })).rejects.toBeInstanceOf(InputCancelledError);
    expect(terminal.questions).toEqual(["What now?"]);
    expect(out).not.toContain(UNICODE);
  });
});
