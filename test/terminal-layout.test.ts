import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressLine, terminalPhrase } from "../src/cli/terminal.js";

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;

/** Standard error as a terminal of `columns` columns, or as a pipe, for the length of a test. */
function stderrAs(tty: boolean, columns = 80): void {
  vi.spyOn(process.stderr, "isTTY", "get").mockReturnValue(tty);
  vi.spyOn(process.stderr, "columns", "get").mockReturnValue(columns);
}

describe("the layout of results on a terminal (terminal.ts)", () => {
  let written: string;
  let out: string[];
  let errors: string[];
  const saved = new Map<string, PropertyDescriptor | undefined>();
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
      if (descriptor === undefined) delete (process.stderr as { [key: string]: unknown })[name];
      else Object.defineProperty(process.stderr, name, descriptor);
    }
    saved.clear();
  });

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
    expect(terminalPhrase(TEST_PHRASE)).toBe(true);
    expect(out.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""))).toEqual([
      "    1. abandon      2. abandon      3. abandon      4. abandon",
      "    5. abandon      6. abandon      7. abandon      8. abandon",
      "    9. abandon     10. abandon     11. abandon     12. about",
      "On one line, for copying:",
      TEST_PHRASE,
    ]);
  });
});
