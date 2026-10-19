// AUD-010-FUN001 and AUD-010-FUN002: a date search tries each effective shift once, without
// keeping what it tried. Compared with a reference that keeps every shift in a set and reduces
// the shifts itself, as Seedshift applies them: each word modulo 2,048, the last word of MnemoCode
// Seedshift modulo 2^(11 - checksum bits), and no last word at all where every valid last word is
// tried (the Original Seedshift with a valid last word).

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { dateRecoveryCandidates, type SeedshiftMode } from "../src/core/date-recovery.js";
import {
  datePatternCombinations,
  parseDate,
  parseDatePattern,
  sortDates,
} from "../src/core/dates.js";
import { Masking } from "../src/core/masking.js";
import type { DatePattern, DateShiftDate } from "../src/core/types.js";

const WORDS = 2048;
const MODES: readonly SeedshiftMode[] = ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"];

/** The all-zero entropy phrase of `words` words: public, and valid at every length. */
function zeroPhrase(words: number): string {
  return entropyToMnemonic(new Uint8Array((words * 11 - words / 3) / 8), wordlist);
}

/** The shifts as the reference reduces them, from the sorted dates alone. */
function referenceKey(dates: readonly DateShiftDate[], words: number, mode: SeedshiftMode) {
  const sequence = sortDates(dates).flatMap((date) => [date.year, date.month, date.day]);
  const last =
    mode === "seedshift" ? 2 ** (11 - words / 3) : mode === "seedshift-legacy" ? WORDS : 1;
  return Array.from({ length: words }, (_, index) => {
    const shift = sequence[index % sequence.length]!;
    return index === words - 1 ? shift % last : shift % WORDS;
  }).join(",");
}

/** What a search that keeps every shift yields for each combination. */
function reference(
  indexes: readonly number[],
  known: readonly DateShiftDate[],
  patterns: readonly DatePattern[],
  mode: SeedshiftMode,
): string[][] {
  const seen = new Set<string>();
  const masking = Masking.of(mode);
  return [...datePatternCombinations(patterns)].map((guessed) => {
    const key = referenceKey([...known, ...guessed], indexes.length, mode);
    if (seen.has(key)) return [];
    seen.add(key);
    return masking
      .undo(indexes, [...known, ...guessed])
      .filter((result) => result.checksumValid)
      .map((result) => result.recoveredMnemonic);
  });
}

/** What the search yields for each combination. */
function searched(
  indexes: readonly number[],
  known: readonly DateShiftDate[],
  patterns: readonly DatePattern[],
  mode: SeedshiftMode,
): string[][] {
  return [...dateRecoveryCandidates(indexes, known, patterns, mode)].map((candidates) =>
    candidates.map((candidate) => candidate.mnemonic),
  );
}

interface Case {
  readonly words: number;
  readonly known: readonly string[];
  readonly patterns: readonly string[];
}

const CASES: readonly Case[] = [
  // The latest date's day searched at the most dates: its day moves the last word alone.
  { words: 24, known: dates(7, 2001), patterns: ["0?-12-2030"] },
  { words: 24, known: dates(7, 2001), patterns: ["??-12-2030"] },
  { words: 21, known: dates(6, 2001), patterns: ["??-06-2030"] },
  { words: 12, known: dates(3, 2001), patterns: ["??-06-2030"] },
  { words: 15, known: dates(4, 2001), patterns: ["01|09|17|25-12-2030"] },
  // A day searched that is not the latest date's, and fewer dates than the most.
  { words: 24, known: dates(6, 2001), patterns: ["0?-12-1990"] },
  { words: 24, known: dates(3, 2001), patterns: ["??-12-2030"] },
  // Years 2,048 apart, with the latest date and another.
  { words: 12, known: ["15-06-2004"], patterns: ["15-06-1975|4023"] },
  { words: 24, known: dates(7, 2001), patterns: ["0?-12-2030|4078"] },
  { words: 12, known: ["07-03-2004"], patterns: ["15-06-1975|4023", "0?-01-2001|4049"] },
  // Patterns that overlap, so that two of them can swap their dates.
  { words: 12, known: ["01-01-2000"], patterns: ["1?-05-2020", "?5-05-2020"] },
  { words: 12, known: [], patterns: ["1?-05-2020", "?5-05-2020", "15-0?-2020"] },
  { words: 24, known: dates(5, 2001), patterns: ["1?-05-2020", "?5-05-2020", "0?-12-2030"] },
  // The same pattern twice is a set, and a whole forgotten month.
  { words: 12, known: ["01-01-2000"], patterns: ["?-03-2020", "?-03-2020"] },
  { words: 24, known: dates(7, 2001), patterns: ["15-?-2030"] },
];

/** `count` known dates, the first of January of consecutive years from `first`. */
function dates(count: number, first: number): string[] {
  return Array.from({ length: count }, (_, index) => `01-01-${first + index}`);
}

describe("date recovery tries each effective shift once (AUD-010-FUN001)", () => {
  for (const { words, known, patterns } of CASES)
    for (const mode of MODES) {
      it(`tries each effective shift once for ${mode}, ${words} words, ${known.length} known dates and ${patterns.join(" ")}`, () => {
        const phrase = zeroPhrase(words);
        const knownDates = known.map(parseDate);
        const masked = Masking.of(mode).encode(phrase, [
          ...knownDates,
          ...patterns.map(() => parseDate("05-05-2020")),
        ]);
        const parsed = patterns.map(parseDatePattern);
        const indexes = masked.shiftedIndexes;
        const expected = reference(indexes, knownDates, parsed, mode);
        const actual = searched(indexes, knownDates, parsed, mode);
        expect(actual).toEqual(expected);
        const all = actual.flat();
        expect(new Set(all).size).toBe(all.length);
      });
    }

  it("reports a phrase once where the latest date's day moves only part of the last word", () => {
    // 24 words take 8 dates; the day of the latest moves only the last 3 bits of entropy.
    const phrase = zeroPhrase(24);
    const known = dates(7, 2001).map(parseDate);
    const masked = Masking.of("seedshift").encode(phrase, [...known, parseDate("09-12-2030")]);
    const yielded = searched(
      masked.shiftedIndexes,
      known,
      [parseDatePattern("0?-12-2030")],
      "seedshift",
    );
    const found = yielded.flat().filter((mnemonic) => mnemonic === phrase);
    // 01-12-2030 gives the same last word as 09-12-2030 and is tried first.
    expect(found).toHaveLength(1);
    expect(yielded[0]).toContain(phrase);
  });
});

describe("patterns that a host builds itself", () => {
  it("are taken with each value once and in order, so that no phrase comes twice", () => {
    const phrase = zeroPhrase(12);
    const known = dates(3, 2001).map(parseDate);
    const masked = Masking.of("seedshift").encode(phrase, [...known, parseDate("23-09-2026")]);
    // A value given twice, and values out of order, as a host might build them.
    const built = { key: "built", years: [2030, 2026, 2026], months: [9], days: [23] };
    const yielded = searched(masked.shiftedIndexes, known, [built], "seedshift");
    expect(yielded.flat().filter((mnemonic) => mnemonic === phrase)).toHaveLength(1);
    expect(yielded).toHaveLength(2);
  });
});

describe("date recovery keeps nothing for each combination (AUD-010-FUN002)", () => {
  it("holds no more memory after 50,000 more combinations", () => {
    // A set of every shift tried held about 95 bytes a combination and failed past 2^24 of them.
    setFlagsFromString("--expose-gc");
    const collect = runInNewContext("gc") as () => void;
    const heldAfter = (count: number, generator: Iterator<unknown>): number => {
      for (let index = 0; index < count; index += 1) generator.next();
      collect();
      return process.memoryUsage().heapUsed;
    };
    const known = [parseDate("07-03-2004")];
    const masked = Masking.of("seedshift-legacy").encode(zeroPhrase(12), [
      ...known,
      parseDate("15-06-1975"),
      parseDate("05-05-2005"),
    ]);
    const generator = dateRecoveryCandidates(
      masked.shiftedIndexes,
      known,
      [parseDatePattern("??-??-19??"), parseDatePattern("0?-0?-200?")],
      "seedshift-legacy",
    );
    const early = heldAfter(5_000, generator);
    const late = heldAfter(50_000, generator);
    generator.return?.(undefined);
    // The set held 4.5 MiB more at this point.
    expect(late - early).toBeLessThan(1.5 * 1024 * 1024);
  });
});
