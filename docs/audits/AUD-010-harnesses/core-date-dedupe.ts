// AUD-010 core probe: date recovery tries each shift vector once and reports each phrase once.
//
// The production search (dateRecoveryCandidates, DateSearch) dedupes date combinations by every
// shift modulo 2048. MnemoCode Seedshift adds the LAST shift modulo 2^(11 - checksum bits), and the
// Original Seedshift with a valid last word ignores the last shift. This probe models the shift
// sequence and the three decoders independently (only @scure/bip39 and its English word list) and
// compares, for every length and mode and a forgotten day, month or year:
//   1. the phrases that the production search yields with the oracle's distinct phrases (no drop,
//      nothing extra),
//   2. that no phrase is yielded twice (the contract of dateRecoveryCandidates: "the checksum-valid
//      phrases that are new"; "each shift is tried once"),
//   3. that the right phrase is among them.
// Then it runs DateSearch.run with a wallet check that matches only the right phrase.
// Public fixtures only: all-zero and counting entropy, synthetic dates.

import { sha256 } from "@noble/hashes/sha2.js";
import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { dateRecoveryCandidates, type SeedshiftMode } from "../../../src/core/date-recovery.js";
import { DatesAnswer, DateSearch } from "../../../src/core/date-search.js";
import { datePatternCombinationCount, deriveShifts, parseDate } from "../../../src/core/dates.js";
import { parseDatePattern } from "../../../src/core/dates.js";
import { Masking } from "../../../src/core/masking.js";
import { MAX_CANDIDATE_RECORDS } from "../../../src/core/candidate-list.js";
import type { Bip39WordCount, DateShiftDate } from "../../../src/core/types.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown>): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}

const LENGTHS = [12, 15, 18, 21, 24] as const;
const MODES: readonly SeedshiftMode[] = ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"];

/** Public phrases: abandon...about, abandon...art and counting entropy for 15, 18, 21. */
function publicPhrase(words: number): string {
  const bytes = (words * 11 - words / 3) / 8;
  if (words === 12 || words === 24) return entropyToMnemonic(new Uint8Array(bytes), wordlist);
  return entropyToMnemonic(
    Uint8Array.from({ length: bytes }, (_, index) => index),
    wordlist,
  );
}

// ---- Independent model of the shift sequence (README "Seedshift": years, months, days of the
// dates sorted in time, repeated over the words).
function modelShifts(dates: readonly DateShiftDate[], words: number): number[] {
  const sorted = [...dates].sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  const sequence = sorted.flatMap((date) => [date.year, date.month, date.day]);
  return Array.from({ length: words }, (_, index) => sequence[index % sequence.length]!);
}

/** Which component of which sorted date lands at the last word, and whether only there. */
function lastComponent(words: number, dates: number) {
  const at = (words - 1) % (3 * dates);
  return {
    part: ["year", "month", "day"][at % 3]!,
    date: Math.floor(at / 3) + 1,
    onlyAtLast: words <= 3 * dates,
  };
}

// ---- Independent decoders, own bit packing, @scure/bip39 only.
const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;

function bitsOf(indexes: readonly number[]): string {
  return indexes.map((index) => index.toString(2).padStart(11, "0")).join("");
}

function bytesOf(bits: string): Uint8Array {
  return Uint8Array.from({ length: bits.length / 8 }, (_, byte) =>
    Number.parseInt(bits.slice(byte * 8, byte * 8 + 8), 2),
  );
}

function oracleDecode(mode: SeedshiftMode, codes: readonly number[], shifts: readonly number[]) {
  const words = codes.length;
  const checksum = words / 3;
  if (mode === "seedshift") {
    const entropyBits = bitsOf(codes).slice(0, words * 11 - checksum);
    const tail = 11 - checksum;
    const chunks = Array.from({ length: words - 1 }, (_, index) =>
      mod(
        Number.parseInt(entropyBits.slice(index * 11, index * 11 + 11), 2) - shifts[index]!,
        2048,
      ),
    );
    const last = mod(Number.parseInt(entropyBits.slice(-tail), 2) - shifts[words - 1]!, 2 ** tail);
    const bits =
      chunks.map((chunk) => chunk.toString(2).padStart(11, "0")).join("") +
      last.toString(2).padStart(tail, "0");
    return [entropyToMnemonic(bytesOf(bits), wordlist)];
  }
  if (mode === "seedshift-legacy") {
    const phrase = codes
      .map((code, index) => wordlist[mod(code - shifts[index]!, 2048)]!)
      .join(" ");
    return validateMnemonic(phrase, wordlist) ? [phrase] : [];
  }
  // Every last word whose checksum fits: each value of the last word's entropy bits with the
  // checksum that SHA-256 of the entropy gives (BIP39), own packing, @noble/hashes only.
  const prefix = codes.slice(0, -1).map((code, index) => mod(code - shifts[index]!, 2048));
  const tail = 11 - checksum;
  const found: string[] = [];
  for (let value = 0; value < 2 ** tail; value += 1) {
    const entropy = bytesOf(bitsOf(prefix) + value.toString(2).padStart(tail, "0"));
    const sum = sha256(entropy)[0]! >>> (8 - checksum);
    const last = (value << checksum) | sum;
    found.push([...prefix, last].map((index) => wordlist[index]!).join(" "));
  }
  return found;
}

/** Every date of an explicit list of years, months and days, in calendar order. */
function datesOf(years: readonly number[], months: readonly number[], days: readonly number[]) {
  const daysIn = (year: number, month: number) =>
    month === 2
      ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  const out: DateShiftDate[] = [];
  for (const year of years)
    for (const month of months)
      for (const day of days) if (day <= daysIn(year, month)) out.push({ year, month, day });
  return out;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ---- Spot check of the legacy-valid oracle against @scure/bip39 validateMnemonic: every one of
// the 2,048 last words for one prefix per length.
for (const words of LENGTHS) {
  const codes = Array.from({ length: words }, (_, index) => (index * 397) % 2048);
  const zero = codes.map(() => 0);
  const fromSha = oracleDecode("seedshift-legacy-valid", codes, zero);
  const prefix = codes
    .slice(0, -1)
    .map((index) => wordlist[index]!)
    .join(" ");
  const fromValidate = wordlist
    .map((last) => `${prefix} ${last}`)
    .filter((phrase) => validateMnemonic(phrase, wordlist));
  check(
    `legacy-valid oracle equals validateMnemonic brute force, ${words} words`,
    JSON.stringify(fromSha) === JSON.stringify(fromValidate),
    { sha: fromSha.length, validate: fromValidate.length },
  );
}

// ---- 0. deriveShifts agrees with the model on the place of each component.
for (const words of LENGTHS)
  for (let count = 1; count <= words / 3; count += 1) {
    // Distinct sentinel values: year 1000+k, month (k mod 12)+1, day 28 - k.
    const dates = range(1, count).map((k) => ({
      year: 1000 + k,
      month: (k % 12) + 1,
      day: 28 - k,
    }));
    const production = deriveShifts(dates, words as Bip39WordCount);
    const model = modelShifts(dates, words);
    const where = lastComponent(words, count);
    const sorted = [...dates].sort((a, b) => a.year - b.year);
    const lastValue = (sorted[where.date - 1] as Record<string, number>)[where.part];
    const ok =
      JSON.stringify(production) === JSON.stringify(model) && production[words - 1] === lastValue;
    if (!ok)
      check(`deriveShifts model ${words} words ${count} dates`, false, { production, model });
  }
check("deriveShifts equals the independent model for every length and date count", true, {
  lastComponentAlways: "day",
  onlyAtLastWhen: "dates = words / 3",
});

// ---- 1-3. Production search against the oracle.
interface Case {
  readonly label: string;
  readonly known: readonly DateShiftDate[];
  readonly truth: DateShiftDate;
  readonly pattern: string;
  readonly guessed: readonly DateShiftDate[];
}

function casesFor(words: number): Case[] {
  const max = words / 3;
  // Known dates before the guessed one, so that the guessed date sorts last.
  const earlyMax = range(1, max - 1).map((k) => ({ year: 1990 + k, month: 1 + (k % 12), day: k }));
  const earlyTwo = [{ year: 1991, month: 3, day: 7 }];
  const truth = { year: 2030, month: 6, day: 25 };
  const cases: Case[] = [];
  for (const [label, known] of [
    [`${max} dates (maximum)`, earlyMax],
    ["2 dates", earlyTwo],
  ] as const) {
    cases.push(
      {
        label: `${label}, forgotten day ??-06-2030`,
        known,
        truth,
        pattern: "??-06-2030",
        guessed: datesOf([2030], [6], range(1, 30)),
      },
      {
        label: `${label}, forgotten month 25-?-2030`,
        known,
        truth,
        pattern: "25-?-2030",
        guessed: datesOf([2030], range(1, 12), [25]),
      },
      {
        label: `${label}, forgotten year digits 25-06-20??`,
        known,
        truth,
        pattern: "25-06-20??",
        guessed: datesOf(range(2000, 2099), [6], [25]),
      },
      {
        label: `${label}, year 2048 apart 25-06-2030|4078`,
        known,
        truth,
        pattern: "25-06-2030|4078",
        guessed: datesOf([2030, 4078], [6], [25]),
      },
    );
  }
  return cases;
}

const duplicateSummary: Record<string, unknown>[] = [];
for (const words of LENGTHS) {
  const phrase = publicPhrase(words);
  for (const mode of MODES) {
    const masking = Masking.of(mode);
    for (const testCase of casesFor(words)) {
      // Skip the year scan in legacy-valid mode beyond 12 words only if it would be slow: it is not.
      const all = [...testCase.known, testCase.truth];
      const codes = masking.encode(phrase, all).shiftedIndexes;
      // Oracle: every guessed date, decoded independently; cached by the exact shift vector.
      const cache = new Map<string, string[]>();
      const oracle = new Set<string>();
      for (const guess of testCase.guessed) {
        const shifts = modelShifts([...testCase.known, guess], words);
        const key = shifts.join(",");
        if (!cache.has(key)) cache.set(key, oracleDecode(mode, codes, shifts));
        for (const found of cache.get(key)!) oracle.add(found);
      }
      const pattern = parseDatePattern(testCase.pattern);
      const steps = [...dateRecoveryCandidates(codes, testCase.known, [pattern], mode)];
      const yielded = steps.flat().map((candidate) => candidate.mnemonic);
      const distinct = new Set(yielded);
      const missing = [...oracle].filter((found) => !distinct.has(found)).length;
      const extra = [...distinct].filter((found) => !oracle.has(found)).length;
      const label = `${words} words, ${mode}, ${testCase.label}`;
      const where = lastComponent(words, testCase.known.length + 1);
      check(
        `${label}: steps = combinations`,
        steps.length === datePatternCombinationCount([pattern]),
        {
          steps: steps.length,
          combinations: datePatternCombinationCount([pattern]),
        },
      );
      check(
        `${label}: same distinct phrases as the oracle (no drop, no extra)`,
        missing === 0 && extra === 0,
        {
          oracleDistinct: oracle.size,
          productionDistinct: distinct.size,
          missing,
          extra,
        },
      );
      check(`${label}: right phrase found`, distinct.has(phrase), { found: distinct.has(phrase) });
      const repeated = yielded.length - distinct.size;
      check(`${label}: no phrase yielded twice`, repeated === 0, {
        yielded: yielded.length,
        distinct: distinct.size,
        repeated,
        lastWordShift: `${where.part} of date ${where.date}`,
        lastShiftOnlyAtLastWord: where.onlyAtLast,
      });
      if (repeated > 0)
        duplicateSummary.push({
          words,
          mode,
          case: testCase.label,
          yielded: yielded.length,
          distinct: distinct.size,
        });
    }
  }
}

// ---- 4. Minimal reproduction through DateSearch.run with a wallet check.
{
  const phrase = publicPhrase(24); // abandon x23 art
  const known = range(1, 7).map((year) => ({ year: 2000 + year, month: 1, day: 1 }));
  const truth = parseDate("09-12-2030");
  const codes = Masking.of("seedshift").encode(phrase, [...known, truth]).shiftedIndexes;
  const line = [...known.map((d) => `01-01-${d.year}`), "0?-12-2030"].join(" ");
  const dates = DatesAnswer.parse(line, { patterns: true, wordCount: 24 });
  let checks = 0;
  const search = new DateSearch({
    indexes: codes,
    dates,
    mode: "seedshift",
    walletCheck: (mnemonic) => {
      checks += 1;
      return { matched: mnemonic === phrase, path: "m" };
    },
    keep: 10,
  });
  const result = await search.run();
  check(
    "DateSearch 24 words seedshift, 8 dates, 0?-12-2030: the wallet's phrase is one match",
    result.matchCount === 1,
    {
      dates: line,
      combinations: result.combinations,
      walletChecks: checks,
      checksumValid: result.checksumValid,
      matchCount: result.matchCount,
      shownDates: result.shown.map((match) => match.dates.split(" ").at(-1)),
      keptDistinct: new Set(result.kept).size,
      kept: result.kept.length,
    },
  );
}
{
  const phrase = publicPhrase(12); // abandon x11 about
  const known = [parseDate("01-01-2001"), parseDate("01-01-2002"), parseDate("01-01-2003")];
  const truth = parseDate("25-06-2030");
  const codes = Masking.of("seedshift-legacy-valid").encode(phrase, [
    ...known,
    truth,
  ]).shiftedIndexes;
  const line = "01-01-2001 01-01-2002 01-01-2003 ??-06-2030";
  const dates = DatesAnswer.parse(line, { patterns: true, wordCount: 12 });
  const search = new DateSearch({
    indexes: codes,
    dates,
    mode: "seedshift-legacy-valid",
    keep: 100_000,
    maxShown: 0,
  });
  const result = await search.run();
  const distinct = new Set(result.kept).size;
  check(
    "DateSearch 12 words legacy-valid, 4 dates, ??-06-2030: each candidate once",
    result.matchCount === distinct,
    {
      dates: line,
      combinations: result.combinations,
      checksumValid: result.checksumValid,
      matchCount: result.matchCount,
      keptDistinct: distinct,
      estimatedChecksPerCombination: search.checks(),
    },
  );
}

// ---- 5. The candidate list: recover-date refuses a list when matchCount > MAX_CANDIDATE_RECORDS
// (src/cli/recover-date-command.ts, TooManyForList). Distinct candidates that fit a list are
// refused once each is counted for every day of the latest date (about 85 seconds).
{
  const phrase = publicPhrase(12);
  const known = [parseDate("01-01-1991"), parseDate("01-01-1992"), parseDate("01-01-1993")];
  const truth = parseDate("15-06-2010");
  const codes = Masking.of("seedshift-legacy-valid").encode(phrase, [
    ...known,
    truth,
  ]).shiftedIndexes;
  const line = "01-01-1991 01-01-1992 01-01-1993 ??-??-200?|201?";
  const dates = DatesAnswer.parse(line, { patterns: true, wordCount: 12 });
  const distinct = new Set<string>();
  const search = new DateSearch({
    indexes: codes,
    dates,
    mode: "seedshift-legacy-valid",
    maxShown: 0,
  });
  const result = await search.run({ onMatch: (match) => distinct.add(match.mnemonic) });
  check(
    "legacy-valid 12 words, 4 dates, ??-??-200?|201?: a list is refused only when the distinct candidates exceed it",
    result.matchCount > MAX_CANDIDATE_RECORDS === distinct.size > MAX_CANDIDATE_RECORDS,
    {
      dates: line,
      combinations: result.combinations,
      matchCount: result.matchCount,
      distinctCandidates: distinct.size,
      listLimit: MAX_CANDIDATE_RECORDS,
      rightPhraseFound: distinct.has(phrase),
    },
  );
}

console.log(JSON.stringify({ duplicateSummary }));
console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
