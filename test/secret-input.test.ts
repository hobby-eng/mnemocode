import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The terminal is replaced by `answers`: each hidden question reads the bytes queued there, as a
// terminal in raw mode would deliver them; `switched` counts the times raw mode was asked for.
const terminal = vi.hoisted(() => ({
  available: true,
  answers: "",
  switched: 0,
  privateScreen: false,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => terminal.privateScreen,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  return {
    ...actual,
    terminalAvailable: () => terminal.available,
    withRawTerminal: async <T>(body: (next: () => Promise<number | undefined>) => Promise<T>) => {
      terminal.switched += 1;
      return body(async () => {
        if (terminal.answers === "") return undefined;
        const byte = terminal.answers.charCodeAt(0);
        terminal.answers = terminal.answers.slice(1);
        return byte;
      });
    },
  };
});

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseArguments } from "../src/cli/arguments.js";
import { runDecode } from "../src/cli/decode-command.js";
import { askSecret, datesPrompt, encodedWordCount } from "../src/cli/input.js";
import { InputCancelled } from "../src/cli/terminal-input.js";

const TEST_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("secret input", () => {
  let written: string[];
  beforeEach(() => {
    terminal.available = true;
    terminal.answers = "";
    terminal.switched = 0;
    terminal.privateScreen = false;
    written = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads the answer at a hidden prompt and shows only the question", async () => {
    terminal.answers = "  test only  \r";
    expect(await askSecret("Seed phrase (English BIP39 words):")).toBe("test only");
    expect(written.join("")).toBe("Seed phrase (English BIP39 words): \n");
  });

  it("shows the answer as it is typed on the private screen, which is cleared afterwards", async () => {
    terminal.privateScreen = true;
    terminal.answers = "test onlz\x7fy\r";
    expect(await askSecret("Seed phrase:")).toBe("test only");
    // Backspace redraws the answer after the prompt (13 columns): back to its start, cleared, written
    // again; then y is added.
    expect(written.join("")).toBe("Seed phrase: test onlz\r\x1b[13C\x1b[Jtest onl\r\x1b[21Cy\n");
  });

  it("works the same on every system: no system program is asked", async () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      terminal.answers = "test only\r";
      expect(await askSecret("Seed phrase:")).toBe("test only");
    }
  });

  it("refuses without a terminal before it touches one", async () => {
    terminal.available = false;
    await expect(askSecret("Seed phrase:")).rejects.toThrow("needs a terminal");
    expect(terminal.switched).toBe(0);
  });

  it.each([
    ["an empty answer", "   \r", "must not be empty"],
    ["the end of the input", "", "cancelled or failed"],
  ])("refuses %s", async (_, answers, message) => {
    terminal.answers = answers;
    await expect(askSecret("Seed phrase:")).rejects.toThrow(message);
  });

  it("stops at Ctrl+C", async () => {
    terminal.answers = "test\x03";
    await expect(askSecret("Seed phrase:")).rejects.toBeInstanceOf(InputCancelled);
  });

  it("asks only for the dates when a record file gives the encoded seed phrase", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-hidden-"));
    const record = join(directory, "record.txt");
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await promisify(execFile)(process.execPath, [
        "dist/mnemocode.js",
        "encode",
        "--mnemonic",
        TEST_PHRASE,
        "--format",
        "3",
        "--dates",
        "23-09-2026",
        "--output",
        record,
      ]);
      terminal.answers = "23-09-2026\r";
      await runDecode(parseArguments(["--ask-secrets", "--input-file", record]));
      expect(printed).toHaveBeenCalledWith(TEST_PHRASE);
      // The record's 12 words take up to 4 dates, and the question says so.
      expect(written.join("")).toContain("Dates (up to 4, DD-MM-YYYY, separated by spaces):");
      expect(written.join("")).not.toContain("Encoded seed phrase");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("names the most dates a seed phrase takes: one for every three words", () => {
    expect(datesPrompt(12)).toBe("Dates (up to 4, DD-MM-YYYY, separated by spaces):");
    expect(datesPrompt(24)).toBe("Dates (up to 8, DD-MM-YYYY, separated by spaces):");
    // A count that is not a BIP39 length, or none yet, leaves the number out.
    expect(datesPrompt(13)).toBe("Dates (DD-MM-YYYY, separated by spaces):");
    expect(datesPrompt(undefined)).toBe("Dates (DD-MM-YYYY, separated by spaces):");
    expect(encodedWordCount("1 2 3 4 5 6 7 8 9 10 11 12 13 14 15")).toBe(15);
    expect(encodedWordCount("not an encoded seed phrase")).toBeUndefined();
  });
});
