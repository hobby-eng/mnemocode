import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  datePatternCandidateCount,
  datePatternCombinationCount,
  datePatternCombinations,
  dateRecoveryCandidates,
  encodeMnemonic,
  expandDatePattern,
  formatDate,
  parseDate,
  parseDatePattern,
} from "../src/core.js";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "mnemocode.js");
const publicMnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function run(arguments_: readonly string[]) {
  return execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
}

describe("date recovery patterns", () => {
  it("supports partial digits and several forgotten components", () => {
    expect(expandDatePattern(parseDatePattern("?3-09-2026")).map((date) => date.day)).toEqual([
      3, 13, 23,
    ]);
    expect(expandDatePattern(parseDatePattern("0?-09-2026")).map((date) => date.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(expandDatePattern(parseDatePattern("??-??-2026"))).toHaveLength(365);
  });

  it("counts a complete calendar without allocating every candidate", () => {
    expect(datePatternCandidateCount(parseDatePattern("??-??-????"))).toBe(3_652_059);
  });

  it("does not repeat permutations of identical incomplete dates", () => {
    const pattern = parseDatePattern("?3-09-2026");
    expect(datePatternCombinationCount([pattern, pattern])).toBe(6);
    expect([...datePatternCombinations([pattern, pattern])]).toHaveLength(6);
  });

  it("finds the forgotten digits in the core, once per combination, without the command line", () => {
    const known = parseDate("10-07-1963");
    const forgotten = parseDate("23-09-2026");
    const encoded = encodeMnemonic(publicMnemonic, [known, forgotten]);
    const patterns = [parseDatePattern("2?-09-2026")];
    const steps = [
      ...dateRecoveryCandidates(encoded.shiftedIndexes, [known], patterns, "seedshift"),
    ];
    // One step per day that the pattern allows, so that a caller can show progress.
    expect(steps).toHaveLength(datePatternCombinationCount(patterns, 100));
    const found = steps.flat();
    // Checksum-valid Seedshift gives a valid phrase for every date; the wallet tells them apart.
    expect(found).toHaveLength(steps.length);
    const right = found.filter((candidate) => candidate.mnemonic === publicMnemonic);
    expect(right.map((candidate) => candidate.dates.map(formatDate))).toEqual([["23-09-2026"]]);
  });

  it("recovers several incomplete dates with per-digit wildcards", async () => {
    const encoded = await run([
      "encode",
      "--mode",
      "seedshift-legacy",
      "--mnemonic",
      publicMnemonic,
      "--dates",
      "10-07-1963",
      "23-09-2026",
      "--format",
      "english",
    ]);
    const raw = encoded.stdout.trim().split("\n").at(-1)!;
    const recovered = await run([
      "recover-date",
      "--mode",
      "seedshift-legacy",
      "--input",
      raw,
      "--dates",
      "?0-07-1963",
      "2?-09-2026",
      "--max-candidates",
      "100",
    ]);
    expect(recovered.stderr).toContain("Recovery search contains 30 date combinations.");
    expect(recovered.stdout).toContain(`10-07-1963 23-09-2026\t${publicMnemonic}`);
  });

  it("requires explicit authorization for a complete-calendar search", async () => {
    const encoded = await run([
      "encode",
      "--mode",
      "seedshift-legacy",
      "--mnemonic",
      publicMnemonic,
      "--dates",
      "10-07-1963",
      "--format",
      "english",
    ]);
    const raw = encoded.stdout.trim().split("\n").at(-1)!;
    await expect(
      run(["recover-date", "--mode", "seedshift-legacy", "--input", raw, "--dates", "??-??-????"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Increase the candidate search limit to at least 3,652,059"),
    });
  });
});
