import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printableText, printCodes, ProgressLine, terminalPhrase } from "../src/cli/terminal.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

/** Standard error as a terminal of `columns` columns, or as a pipe, for the length of a test. */
function stderrAs(tty: boolean, columns = 80): void {
  vi.spyOn(process.stderr, "isTTY", "get").mockReturnValue(tty);
  vi.spyOn(process.stderr, "columns", "get").mockReturnValue(columns);
}

let written: string;
let out: string[];
let errors: string[];
const saved = new Map<string, PropertyDescriptor | undefined>();

/** Gives each test a terminal of its own whose writes it records, and puts it back after. */
function watchTerminalOfEachTest(): void {
  beforeEach(() => {
    written = "";
    out = [];
    errors = [];
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("NO_COLOR", "1");
    // Defined first, and put back after: a pipe has no such properties to spy on.
    for (const name of ["isTTY", "columns"] as const) {
      saved.set(name, Object.getOwnPropertyDescriptor(process.stderr, name));
      Object.defineProperty(process.stderr, name, { configurable: true, get: () => undefined });
    }
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      out.push(line.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      errors.push(line.join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) Reflect.deleteProperty(process.stderr, name);
      else Object.defineProperty(process.stderr, name, descriptor);
    }
    saved.clear();
  });
}

describe("the layout of results on a terminal (terminal.ts)", () => {
  watchTerminalOfEachTest();

  it("rewrites the progress of a search in place on a terminal, and closes its line", () => {
    stderrAs(true);
    const progress = new ProgressLine();
    progress.show("Checked 10%.");
    progress.show("Checked 20%.");
    progress.end();
    progress.end();
    expect(written).toBe("\r\x1b[2KChecked 10%.\r\x1b[2KChecked 20%.\n");
    expect(errors).toEqual([]);
  });

  it("cuts a progress line to the window, so that it never wraps", () => {
    stderrAs(true, 10);
    const progress = new ProgressLine();
    progress.show("Checked 1,234 of 5,678.");
    expect(written).toBe("\r\x1b[2KChecked 1");
  });

  it("writes each progress as a line of its own in a pipe or on a dumb terminal", () => {
    stderrAs(false);
    const progress = new ProgressLine();
    progress.show("Checked 10%.");
    progress.end();
    stderrAs(true);
    vi.stubEnv("TERM", "dumb");
    progress.show("Checked 20%.");
    progress.end();
    expect(errors).toEqual(["Checked 10%.", "Checked 20%."]);
    expect(written).toBe("");
  });

  it("shows a phrase numbered, four words to a row, then on one line, only in colour", () => {
    expect(terminalPhrase(TEST_PHRASE)).toBe(false);
    expect(out).toEqual([]);
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    streamsAsTerminal();
    expect(terminalPhrase(TEST_PHRASE)).toBe(true);
    expect(out.map((line) => line.replace(STYLE_CODES, ""))).toEqual([
      "    1. abandon      2. abandon      3. abandon      4. abandon",
      "    5. abandon      6. abandon      7. abandon      8. abandon",
      "    9. abandon     10. abandon     11. abandon     12. about",
      "On one line, for copying:",
      TEST_PHRASE,
    ]);
  });

  it("takes its layout from the terminal and its colour from the colour settings (AUD-037-UI006)", () => {
    // A terminal without colour keeps the layout, with no colour codes.
    streamsAsTerminal();
    expect(terminalPhrase(TEST_PHRASE)).toBe(true);
    expect(out.join("\n")).not.toMatch(STYLE_CODES);
    expect(out[0]).toBe("    1. abandon      2. abandon      3. abandon      4. abandon");
  });

  it("keeps the plain form of a pipe that colour is forced on", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    expect(terminalPhrase(TEST_PHRASE)).toBe(false);
    expect(out).toEqual([]);
  });

  it("shows codes written joined apart, then joined, and one line in a pipe", () => {
    // The public phrase in Unicode codes, which are written joined.
    const unicode = `${"7684".repeat(11)}5728`;
    printCodes(unicode, "unicode");
    expect(out).toEqual([unicode]);
    out.length = 0;
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    streamsAsTerminal();
    printCodes(unicode, "unicode");
    expect(out.map((line) => line.replace(STYLE_CODES, ""))).toEqual([
      `${"7684 ".repeat(11)}5728`,
      "Joined, for copying:",
      unicode,
    ]);
    // A share's Unicode codes, written apart, also get the joined line.
    out.length = 0;
    printCodes("7A0B 971E 80CC", "unicode");
    expect(out.at(-1)).toBe("7A0B971E80CC");
    out.length = 0;
    printCodes("E000E064E13AE191", "colors-unicode");
    // Code by code, as a ? stands for one code in every reader.
    expect(out[0]!.replace(STYLE_CODES, "")).toBe("E000 E064 E13A E191");
    // Forms written apart already are shown as they are.
    out.length = 0;
    printCodes(TEST_PHRASE, "english");
    expect(out).toEqual([TEST_PHRASE]);
  });
});

describe("text from outside the program (AUD-010-SEC002)", () => {
  it("is shown without control characters, which could move the cursor or erase a line", () => {
    // What a crafted QR code image held: cursor up, erase the line, red, a reset and a bell.
    const crafted = "\u001b[1A\u001b[2K\u001b[31mRED\u001b[0m hello\u0007";
    expect(printableText(crafted)).toBe("\ufffd[1A\ufffd[2K\ufffd[31mRED\ufffd[0m hello\ufffd");
    // C1 controls and DEL too; ordinary text, Bytewords and Unicode stay as they are.
    expect(printableText("a\u009bb\u007fc")).toBe("a\ufffdb\ufffdc");
    expect(printableText("ur:sskr/tuna next keep 7AE5 漢")).toBe("ur:sskr/tuna next keep 7AE5 漢");
  });
});
