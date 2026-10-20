// Encode's result on a terminal keeps its running text within TEXT_WIDTH (CORE-36): the sentences
// about the legacy last word and the fingerprint that the legacy codes may lack, each wrapped at
// spaces; a file or a pipe keeps each on one line, as a script reads it. Public test phrase only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printEncodeResult } from "../src/cli/encode-report.js";
import { STYLE_CODES, TEXT_WIDTH } from "../src/cli/terminal-style.js";
import { parseDate } from "../src/core/dates.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/** Dates whose legacy shift of the test phrase keeps a valid checksum. */
const VALID_DATES = ["01-02-2001", "03-04-2001", "05-06-2010", "07-08-2015"];
/** A date whose legacy shift needs another last word for a valid checksum. */
const INVALID_DATES = ["23-09-2026"];
const ALREADY_VALID =
  "Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed.";

/** What printEncodeResult writes to standard error for the legacy encoding with `dates`. */
function legacyReport(dates: readonly string[]): string[] {
  const entered = dates.map((date) => parseDate(date));
  const encoding = EncodedBackup.encode(TEST_PHRASE, entered, "english", "seedshift-legacy");
  const written: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    written.push(String(line));
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  printEncodeResult({ encoding, mode: "seedshift-legacy", enteredDates: entered });
  return written.flatMap((line) => line.replace(STYLE_CODES, "").split("\n"));
}

const tty = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

beforeEach(() => {
  vi.stubEnv("TERM", "xterm");
  vi.stubEnv("NO_COLOR", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (tty === undefined) Reflect.deleteProperty(process.stderr, "isTTY");
  else Object.defineProperty(process.stderr, "isTTY", tty);
});

describe("the legacy result of Encode", () => {
  it("wraps its sentences on a terminal at the width of running text", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    for (const dates of [VALID_DATES, INVALID_DATES]) {
      const lines = legacyReport(dates);
      expect(lines.filter((line) => line.length > TEXT_WIDTH)).toEqual([]);
    }
    const valid = legacyReport(VALID_DATES);
    const start = valid.findIndex((line) => line.startsWith("Legacy shifted phrase"));
    expect(start).toBeGreaterThan(-1);
    expect(`${valid[start]} ${valid[start + 1]}`).toBe(ALREADY_VALID);
    const optional = legacyReport(INVALID_DATES);
    const phrase = optional.findIndex((line) => line.startsWith("Optional checksum-valid legacy"));
    expect(phrase).toBeGreaterThan(-1);
    // The phrase goes on under its label, word by word.
    expect(optional[phrase + 1]).toMatch(/^[a-z]+( [a-z]+)*$/u);
  });

  it("keeps each sentence on one line for a file or a pipe", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
    expect(legacyReport(VALID_DATES)).toContain(ALREADY_VALID);
    const optional = legacyReport(INVALID_DATES);
    const phrase = optional.find((line) => line.startsWith("Optional checksum-valid legacy"));
    expect(phrase?.split(": ")[1]?.split(" ")).toHaveLength(12);
  });
});
