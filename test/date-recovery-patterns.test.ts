import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it } from "vitest";
import { Masking } from "../src/core/masking.js";
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

  it("tries a shift once: a year 2,048 years later gives the same phrase, which is found once", () => {
    // Two dates, one with a forgotten year and one with a forgotten digit of its month.
    const dates = [parseDate("10-01-2010"), parseDate("15-10-2025")];
    const encoded = encodeMnemonic(publicMnemonic, dates);
    const patterns = [parseDatePattern("15-10-?"), parseDatePattern("10-?1-2010")];
    const steps = [...dateRecoveryCandidates(encoded.shiftedIndexes, [], patterns, "seedshift")];
    expect(steps).toHaveLength(datePatternCombinationCount(patterns));
    // 2025, 4073, 6121 and 8169 shift every word alike: only the earliest year is tried.
    const right = steps.flat().filter((candidate) => candidate.mnemonic === publicMnemonic);
    expect(right.map((candidate) => candidate.dates.map(formatDate))).toEqual([
      ["10-01-2010", "15-10-2025"],
    ]);
    // Every phrase found is found once.
    const phrases = steps.flat().map((candidate) => candidate.mnemonic);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("finds no phrase twice and the right one once, in every mode, length and forgotten part", () => {
    const phrases = {
      12: publicMnemonic,
      24: entropyToMnemonic(
        Uint8Array.from({ length: 32 }, (_, index) => index),
        wordlist,
      ),
    };
    // A whole year, a day and a month, a whole day and month, a forgotten digit of each part, and
    // two patterns that both fit the same date, which two orders of the dates give.
    const cases: readonly {
      readonly known: readonly string[];
      readonly patterns: readonly string[];
    }[] = [
      { known: ["10-01-2010"], patterns: ["15-10-?"] },
      { known: ["10-01-2010"], patterns: ["?-?-2025"] },
      { known: [], patterns: ["1?-01|10-2010|2025", "?0|?5-01|10-2010|2025"] },
      { known: ["15-10-2025"], patterns: ["?0-0?-2010"] },
      { known: ["15-10-2025"], patterns: ["10-01-20?0"] },
    ];
    const right = ["10-01-2010", "15-10-2025"];
    for (const words of [12, 24] as const)
      for (const mode of ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"] as const) {
        const masking = Masking.of(mode);
        const encoded = masking.encode(phrases[words], right.map(parseDate));
        // The legacy record with a replaced last word gives 128 phrases for each date: its whole
        // year, ten thousand dates, is left to the other modes, which share the same search.
        for (const { known, patterns } of cases.filter(
          (each) => mode !== "seedshift-legacy-valid" || !each.patterns.includes("15-10-?"),
        )) {
          const label = `${words} words, ${mode}, ${[...known, ...patterns].join(" ")}`;
          const found = [
            ...dateRecoveryCandidates(
              encoded.shiftedIndexes,
              known.map(parseDate),
              patterns.map(parseDatePattern),
              mode,
            ),
          ].flat();
          const mnemonics = found.map((candidate) => candidate.mnemonic);
          expect(new Set(mnemonics).size, label).toBe(mnemonics.length);
          const matches = found.filter((candidate) => candidate.mnemonic === phrases[words]);
          expect(matches.length, label).toBe(1);
          expect(
            [...known.map(parseDate), ...matches[0]!.dates]
              .map(formatDate)
              .sort((left, right) => left.slice(6).localeCompare(right.slice(6))),
            label,
          ).toEqual(right);
        }
      }
  }, 180_000);

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

  it("refuses a search of more dates than --max-candidates allows", async () => {
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
      run([
        "recover-date",
        "--mode",
        "seedshift-legacy",
        "--input",
        raw,
        "--dates",
        "??-??-????",
        "--max-candidates",
        "1000",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Increase the candidate search limit to at least 3,652,059"),
    });
  });
});
