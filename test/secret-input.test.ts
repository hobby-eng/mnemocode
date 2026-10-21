import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The terminal is replaced by `answers`: each hidden question reads the bytes queued there, as a
// terminal in raw mode would deliver them; `switched` counts the times raw mode was asked for.
const terminal = vi.hoisted(() => ({
  available: true,
  answers: "",
  switched: 0,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  class CountedKeys extends actual.TerminalKeys {
    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      terminal.switched += 1;
      const next: NextByte = async () => {
        if (terminal.answers === "") return undefined;
        const byte = terminal.answers.charCodeAt(0);
        terminal.answers = terminal.answers.slice(1);
        return byte;
      };
      // Nothing more comes within any wait, as from a terminal that is never pasted into: each
      // line break ends an answer, and the next answer waits in `answers` for the next question.
      return body(next, async () => false);
    }
  }
  return {
    ...actual,
    terminalAvailable: () => terminal.available,
    TerminalKeys: CountedKeys,
  };
});

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArguments } from "../src/cli/arguments.js";
import { runDecode } from "../src/cli/decode-command.js";
import { askSecretUntil } from "../src/cli/ask.js";
import { datesPrompt } from "../src/cli/input.js";
import { withPrivateScreen } from "../src/cli/private-screen.js";
import { ENTER_ALTERNATE_SCREEN, LEAVE_ALTERNATE_SCREEN } from "../src/cli/terminal.js";

/** The answer as typed: the secret questions take a reading of it, here none. */
const typed = (answer: string) => answer;
import { CANCELLED, type MoreWithin, type NextByte } from "../src/cli/terminal-keys.js";
import { BUILT_CLI } from "./helpers/built-cli.js";
import { BACKSPACE, CTRL_C } from "./helpers/keys.js";
import { DATES_PROMPT, DECODE_DATES_PROMPT } from "./helpers/prompts.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";

let written: string[];

beforeEach(() => {
  terminal.available = true;
  terminal.answers = "";
  terminal.switched = 0;
  written = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("secret input", () => {
  it("reads the answer at a hidden prompt and shows only the question", async () => {
    terminal.answers = "  test only  \r";
    expect(await askSecretUntil("Seed phrase (English BIP39 words):", typed)).toBe("test only");
    expect(written.join("")).toBe("Seed phrase (English BIP39 words): \n");
  });

  it("shows the answer as it is typed on the private screen, which is cleared afterwards", async () => {
    // The heading of the private screen and the summary left after it.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The answer, then Enter, which clears the private screen.
    terminal.answers = `test onlz${BACKSPACE}y\r\r`;
    expect(await withPrivateScreen(() => askSecretUntil("Seed phrase:", typed))).toBe("test only");
    // Backspace redraws the answer after the prompt (13 columns): back to its start, cleared,
    // written again; then y is added.
    const echo = "Seed phrase: test onlz\r\x1b[13C\x1b[Jtest onl\r\x1b[21Cy\n";
    const shown = written.join("");
    expect(shown).toContain(echo);
    // Shown on the private screen, which is left once Enter was pressed.
    expect(shown.indexOf(ENTER_ALTERNATE_SCREEN)).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf(ENTER_ALTERNATE_SCREEN)).toBeLessThan(shown.indexOf(echo));
    expect(shown.lastIndexOf(LEAVE_ALTERNATE_SCREEN)).toBeGreaterThan(shown.indexOf(echo));
    expect(terminal.answers).toBe("");
  });

  it("reads the same answer on Linux, macOS and Windows", async () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      terminal.answers = "test only\r";
      expect(await askSecretUntil("Seed phrase:", typed)).toBe("test only");
    }
  });

  it("refuses without a terminal before it touches one", async () => {
    terminal.available = false;
    await expect(askSecretUntil("Seed phrase:", typed)).rejects.toThrow("needs a terminal");
    expect(terminal.switched).toBe(0);
  });

  it("asks again after an empty answer, with one line that repeats nothing typed", async () => {
    const notices = vi.spyOn(console, "error").mockImplementation(() => undefined);
    terminal.answers = "   \rtest only\r";
    expect(await askSecretUntil("Seed phrase:", typed)).toBe("test only");
    expect(notices).toHaveBeenCalledWith("Type an answer, or press Ctrl+C to stop.");
    expect(written.join("").match(/Seed phrase: /gu)).toHaveLength(2);
  });

  it("cancels at the end of the input instead of asking again", async () => {
    terminal.answers = "";
    expect(await askSecretUntil("Seed phrase:", typed)).toBe(CANCELLED);
    expect(written.join("").match(/Seed phrase: /gu)).toHaveLength(1);
  });

  it("stops at Ctrl+C", async () => {
    terminal.answers = `test${CTRL_C}`;
    expect(await askSecretUntil("Seed phrase:", typed)).toBe(CANCELLED);
  });

  it("asks only for the dates when a record file gives the encoded seed phrase", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-hidden-"));
    const record = join(directory, "record.txt");
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const words = join(directory, "public-mnemonic.txt");
      const dates = join(directory, "public-dates.txt");
      await writeFile(words, TEST_PHRASE, "utf8");
      await writeFile(dates, DATE, "utf8");
      await promisify(execFile)(process.execPath, [
        BUILT_CLI,
        "encode",
        "--mnemonic-file",
        words,
        "--format",
        "3",
        "--dates-file",
        dates,
        "--output",
        record,
      ]);
      terminal.answers = `${DATE}\r`;
      await runDecode(parseArguments(["--ask-secrets", "--input-file", record]));
      expect(printed).toHaveBeenCalledWith(TEST_PHRASE);
      // The record's 12 words take up to 4 dates, and the question says so; decode searches a
      // date with ? for a forgotten digit.
      expect(written.join("")).toContain(DECODE_DATES_PROMPT);
      expect(written.join("")).not.toContain("Encoded seed phrase");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("names the most dates a seed phrase takes: one for every three words", () => {
    expect(datesPrompt(12)).toBe(DATES_PROMPT);
    expect(datesPrompt(24)).toBe("Dates (up to 8, DD-MM-YYYY, separated by spaces):");
    // A count that is not a BIP39 length, or none yet, leaves the number out.
    expect(datesPrompt(13)).toBe("Dates (DD-MM-YYYY, separated by spaces):");
    expect(datesPrompt(undefined)).toBe("Dates (DD-MM-YYYY, separated by spaces):");
  });
});
