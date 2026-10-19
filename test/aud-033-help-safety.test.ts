import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printCommandHelp, printTopicHelp, printUsage } from "../src/cli/usage.js";

const SAFETY =
  "Recovery material: a record, with its dates if it has any, restores the wallet; it is not encryption.";
const PAGES = [
  ["overview", () => printUsage()],
  ["short command", () => printCommandHelp("encode", false)],
  ["full command", () => printCommandHelp("encode", true)],
  ["topic", () => printTopicHelp("formats")],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a closing safety warning on every help surface", () => {
  it.each(PAGES)("keeps %s help plain and ends with the complete safety text", (_, show) => {
    vi.stubEnv("NO_COLOR", "1");
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      output.push(String(value));
    });
    show();
    const text = output.join("\n").trim();
    expect(text).toBe(stripVTControlCharacters(text));
    expect(text.replace(/\s+/gu, " ").endsWith(SAFETY)).toBe(true);
  });

  it.each(PAGES)("styles the final warning of %s help with the shared bold yellow", (_, show) => {
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("CLICOLOR_FORCE", "1");
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      output.push(String(value));
    });
    show();
    const text = output.join("\n");
    expect(stripVTControlCharacters(text).replace(/\s+/gu, " ").trim().endsWith(SAFETY)).toBe(true);
    expect(text).toContain("\x1b[1;33mRecovery material:");
  });
});
