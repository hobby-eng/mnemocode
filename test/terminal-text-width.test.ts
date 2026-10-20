// Running text on a terminal wraps at TEXT_WIDTH, 78 columns (CORE-36), as in `mhfe`: an error
// beside "✗ Error:", a fact under its own column and a checked fact beside its mark, each line
// after the first indented under the text, no word split; a file or a pipe keeps one line. Public
// texts only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  factLine,
  failureLine,
  resultLines,
  statusLine,
  STYLE_CODES,
  TEXT_WIDTH,
} from "../src/cli/terminal-style.js";

const TERMINAL = { isTTY: true };
/** A refusal of the command line, 222 characters on one line. */
const REFUSAL =
  "--ask-secrets needs a terminal on standard input and standard error. Run the command in a " +
  "terminal, or read the secret from a protected local file (--mnemonic-file, --input-file or " +
  "--share-file) or from standard input (-).";
/** The protection that a private screen shows on Linux, 119 characters. */
const PROTECTION =
  "no core dumps · no network · no other programs · no file writes · kernel: no sockets, no " +
  "other programs, no file writes";

/** The lines of `text` as a terminal shows them, without colour. */
function shown(text: string): string[] {
  return text.replace(STYLE_CODES, "").split("\n");
}

/** Whether every line of `lines` fits the width of running text. */
function fit(lines: readonly string[]): boolean {
  return lines.every((line) => line.length <= TEXT_WIDTH);
}

/** The words of `lines` after their first `indent` characters, as one text. */
function words(lines: readonly string[], indent: number): string {
  return lines.map((line) => line.slice(indent)).join(" ");
}

beforeEach(() => {
  vi.stubEnv("TERM", "xterm");
  vi.stubEnv("NO_COLOR", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("running text on a terminal", () => {
  it("wraps an error beside its mark, and keeps it on one line for a file or a pipe", () => {
    const lines = shown(failureLine(TERMINAL, "mnemocode", REFUSAL));
    expect(lines.length).toBeGreaterThan(2);
    expect(fit(lines)).toBe(true);
    expect(lines[0]).toMatch(/^✗ Error: --ask-secrets /u);
    // "✗ Error: " is nine characters wide; the other lines start under its text.
    for (const line of lines.slice(1)) expect(line).toMatch(/^ {9}\S/u);
    expect(words(lines, 9)).toBe(REFUSAL);
    expect(failureLine({}, "mnemocode", REFUSAL)).toBe(`mnemocode: ${REFUSAL}`);
  });

  it("wraps the value of a fact under its own column", () => {
    const lines = shown(factLine(TERMINAL, "Protection", PROTECTION, 11));
    expect(lines.length).toBe(2);
    expect(fit(lines)).toBe(true);
    // Two spaces, the label's column of 11 and a space.
    expect(lines[0]).toMatch(/^ {2}Protection {2}no core dumps/u);
    expect(lines[1]).toMatch(/^ {14}\S/u);
    expect(words(lines, 14)).toBe(PROTECTION);
    const result = resultLines(TERMINAL, "Encoded", [["Content", PROTECTION]]);
    expect(result.flatMap(shown).every((line) => line.length <= TEXT_WIDTH)).toBe(true);
  });

  it("wraps a checked fact beside its mark, each bold word closed on its own line", () => {
    const label = "Encoded fingerprint (of the masked phrase)";
    const value = "unavailable because legacy Seedshift output may have an invalid BIP39 checksum";
    const lines = shown(statusLine(TERMINAL, label, value, false));
    expect(fit(lines)).toBe(true);
    expect(lines[0]).toMatch(/^! Encoded fingerprint /u);
    for (const line of lines.slice(1)) expect(line).toMatch(/^ {2}\S/u);
    expect(words(lines, 2)).toBe(`${label} ${value}`);
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    const painted = statusLine(TERMINAL, label, value, false).split("\n");
    expect(fit(painted.map((line) => line.replace(STYLE_CODES, "")))).toBe(true);
    for (const line of painted.slice(1)) expect(line.endsWith("\x1b[0m")).toBe(true);
  });

  it("keeps a text that fits as it is, its spaces included", () => {
    expect(factLine(TERMINAL, "File", "a  b", 4)).toBe("  File a  b");
    expect(statusLine(TERMINAL, "Checked", "SHA256SUMS")).toBe("✓ Checked SHA256SUMS");
    expect(failureLine(TERMINAL, "mnemocode", "")).toBe("✗ Error: ");
  });
});
