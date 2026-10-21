import { afterEach, describe, expect, it, vi } from "vitest";
import { STYLE_CODES, TEXT_WIDTH } from "../src/cli/terminal-style.js";
import { LONGEST_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

// The report of the self-test command on a person's terminal, from the real checks: only the
// process protection, which a test process cannot have, is taken as granted.

vi.mock("../src/cli/protection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/protection.js")>();
  return {
    ...actual,
    ProcessProtection: class extends actual.ProcessProtection {
      static override assert(): void {
        // Granted: a test process runs outside the permission model.
      }
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the self-test's report on a terminal", () => {
  it(
    "wraps every line within 78 columns, a detail's further lines under its column (CORE-36)",
    async () => {
      streamsAsTerminal();
      vi.stubEnv("TERM", "xterm-256color");
      const printed: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line: unknown) => {
        printed.push(String(line));
      });
      const { runSelfTest } = await import("../src/cli/self-test.js");
      await runSelfTest();
      const lines = printed.flatMap((text) => text.replace(STYLE_CODES, "").split("\n"));
      const wide = lines.filter((line) => Array.from(line).length > TEXT_WIDTH);
      expect(wide).toEqual([]);
      // A time stays whole: "(74.5 ms)" is never broken before its unit.
      expect(lines.filter((line) => /\(\d+\.\d$|^\s*ms\)/u.test(line))).toEqual([]);
      // A detail that does not fit beside its name goes on under it, never back to column 1.
      const card = lines.findIndex((line) => line.startsWith("✓ Card sets "));
      expect(card).toBeGreaterThan(0);
      const detailColumn = lines[card]!.indexOf("colors of codes");
      expect(lines[card + 1]).toMatch(new RegExp(`^ {${detailColumn}}\\S`, "u"));
      expect(lines.at(-1)).toMatch(/^✓ Passed: \d+ public vectors;/u);
    },
    LONGEST_TEST_TIME_LIMIT_MS,
  );
});
