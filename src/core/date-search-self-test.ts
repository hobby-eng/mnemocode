// The self-test of forgotten dates (core/dates.ts, core/date-search.ts): how many dates a typed
// pattern stands for (a ? for a digit, a lone ? for a part or for a whole date, values joined by
// |), the patterns that are refused, the search of the published Seedshift vector over the digit
// it forgot, and, with the host's master fingerprint, the date search that the wallet decides.
// core/self-test.ts runs the quick part before every command of the command line and all of it in
// the full self-test.
//
// From the host it needs, for the full check only, the master fingerprint of a phrase. It holds
// public test data, no secret.
//
// Host-neutral: it imports only other core modules.

import { dateRecoveryCandidates } from "./date-recovery.js";
import { DatesAnswer, DateSearch } from "./date-search.js";
import { formatDate } from "./dates.js";
import { expectRefused, expectSame } from "./self-test-check.js";

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** Its master fingerprint (vectors/mnemocode-v1.json, direct-12, sourceFingerprint). */
const PUBLIC_FINGERPRINT = "73c5da0a";
/**
 * The public phrase masked with MnemoCode Seedshift and 23-09-2026, as word numbers counted from 1
 * (vectors/mnemocode-v1.json, checksum-valid-seedshift-12).
 */
const MASKED_NUMBERS = [2027, 10, 24, 2027, 10, 24, 2027, 10, 24, 2027, 10, 377] as const;
const MASKED_INDEXES = MASKED_NUMBERS.map((number) => number - 1);
const MASKED_DATE = "23-09-2026";
/** The masked phrase's date with its last digit forgotten. */
const FORGOTTEN_LAST_DIGIT = "23-09-202?";
/** A phrase of twelve words takes four dates, one for every three words. */
const TWELVE_WORDS = { wordCount: 12, patterns: true } as const;

/**
 * Typed dates and the combinations they stand for, counted independently with Python's datetime:
 * a ? for each forgotten digit, a lone ? for a whole part, values joined by |, a complete date
 * beside one with ?, and two dates of the same pattern, which count once in either order
 * (n × (n + 1) / 2 for n dates). These are quick enough for every start.
 */
const QUICK_COMBINATIONS: readonly (readonly [string, number])[] = [
  [FORGOTTEN_LAST_DIGIT, 10],
  ["?-09-2026", 30],
  ["05|15-09-2026", 2],
  [`${FORGOTTEN_LAST_DIGIT} ${FORGOTTEN_LAST_DIGIT}`, 55],
  [`10-07-1963 ${FORGOTTEN_LAST_DIGIT}`, 10],
];
/**
 * Patterns that take some milliseconds each to read, for the full self-test only, with a lone ?
 * for a date of which nothing is remembered: every date from 01-01-0001 to 31-12-9999, which takes
 * some tenths of a second.
 */
const SLOW_COMBINATIONS: readonly (readonly [string, number])[] = [
  ["2?-0?-19??", 8_924],
  ["29-02-????", 2_424],
  ["?-?-200? ?-?-200?", 6_674_031],
  ["?", 3_652_059],
];

/** Typed dates that must be refused, and why. */
const REFUSED_DATES: readonly (readonly [string, RegExp])[] = [
  ["23-09-26", /four-digit year/u],
  ["31-02-202?", /real calendar date/u],
  ["32-0?-2026", /valid day/u],
  ["23-1?-202", /DD-MM-YYYY/u],
  // Three dates of the 2000s with a lone ? for the day and the month: 8,131,194,435 combinations.
  ["?-?-200? ?-?-200? ?-?-200?", /safety limit/u],
  ["01-01-2001 02-01-2001 03-01-2001 04-01-2001 05-01-2001", /at most 4 dates/u],
];

/** The combinations of each of `patterns`, as DatesAnswer counts them. */
function checkCombinations(patterns: readonly (readonly [string, number])[]): void {
  for (const [typed, combinations] of patterns)
    expectSame(
      DatesAnswer.parse(typed, TWELVE_WORDS).combinations,
      combinations,
      `Date pattern ${typed} combinations`,
    );
}

/**
 * The quick known answers: the combinations of each pattern, the refusals, and the search of the
 * masked phrase over its forgotten digit, of which only 23-09-2026 gives the public phrase.
 */
export function checkDateSearchStartup(): void {
  checkCombinations(QUICK_COMBINATIONS);
  for (const [typed, because] of REFUSED_DATES)
    expectRefused(
      () => DatesAnswer.parse(typed, TWELVE_WORDS),
      because,
      `The date pattern ${typed}`,
    );
  expectRefused(
    () => DatesAnswer.parse(FORGOTTEN_LAST_DIGIT, { wordCount: 12, patterns: false }),
    /type every date in full/u,
    "A forgotten digit where dates are not searched",
  );
  const dates = DatesAnswer.parse(FORGOTTEN_LAST_DIGIT, TWELVE_WORDS);
  let combinations = 0;
  const found: string[] = [];
  for (const candidates of dateRecoveryCandidates(
    MASKED_INDEXES,
    dates.known,
    dates.patterns,
    "seedshift",
  )) {
    combinations += 1;
    for (const candidate of candidates)
      if (candidate.mnemonic === PUBLIC_MNEMONIC) found.push(candidate.dates.map(formatDate)[0]!);
  }
  expectSame(combinations, 10, "Date search combinations");
  expectSame(found.join(" "), MASKED_DATE, "Date search of the Seedshift vector");
}

/**
 * Every check: the quick ones, and the date search with the wallet, which the host's master
 * fingerprint tells: of the ten checksum-valid phrases, only that of 23-09-2026 is the wallet's.
 */
export async function checkDateSearch(
  fingerprint: (mnemonic: string) => string | PromiseLike<string>,
): Promise<void> {
  checkDateSearchStartup();
  checkCombinations(SLOW_COMBINATIONS);
  const result = await new DateSearch({
    indexes: MASKED_INDEXES,
    dates: DatesAnswer.parse(FORGOTTEN_LAST_DIGIT, TWELVE_WORDS),
    mode: "seedshift",
    walletCheck: async (mnemonic) => ({
      matched: (await fingerprint(mnemonic)) === PUBLIC_FINGERPRINT,
      path: "m",
    }),
  }).run();
  expectSame(result.combinations, 10, "Date search combinations");
  // MnemoCode Seedshift gives a valid phrase for every date: only the wallet tells them apart.
  expectSame(result.checksumValid, 10, "Date search checksum-valid phrases");
  expectSame(result.matchCount, 1, "Date search wallet matches");
  expectSame(result.shown[0]?.dates, MASKED_DATE, "Date search dates");
  expectSame(result.shown[0]?.mnemonic, PUBLIC_MNEMONIC, "Date search phrase");
}
