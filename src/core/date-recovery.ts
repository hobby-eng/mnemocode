// Finds forgotten digits of Seedshift dates: every combination that the date patterns allow is
// tried with the known dates, and the checksum-valid phrases are kept. Only the wallet tells which
// of them is the right one, so the caller checks each against a fingerprint or an address; the
// command line and other hosts share this search and differ only in that check and in reporting.

import {
  compareDates,
  datePatternCombinations,
  daysInMonth,
  deriveShifts,
  ownedPattern,
  sortDates,
} from "./dates.js";
import { Masking } from "./masking.js";
import type { Bip39WordCount, DatePattern, DateShiftDate } from "./types.js";
import { assertWordCount, BIP39_DICTIONARY_SIZE } from "./words.js";

/** The Seedshift variants whose dates can be searched. */
export type SeedshiftMode = "seedshift" | "seedshift-legacy" | "seedshift-legacy-valid";

/** A phrase that one combination of dates gives, with the guessed dates sorted. */
export interface DateCandidate {
  readonly dates: readonly DateShiftDate[];
  readonly mnemonic: string;
}

/** The largest year of a date (core/dates.ts). */
const LAST_YEAR = 9999;
/** The days of the longest month: a shift modulo more than this tells every day apart. */
const LONGEST_MONTH = 31;
/** Shifts, years, months and days are put together in one array for each date. */
const SHIFTS_PER_DATE = 3;

/**
 * Tries every combination of the forgotten dates (datePatternCombinations) together with the
 * known ones. It yields once per combination, with the checksum-valid phrases that are new, so
 * that the caller can count combinations for progress and check each phrase as it comes.
 *
 * A combination that shifts every word as an earlier one did gives the same phrases, and none:
 * the same dates in another order, a year 2,048 years later, since Seedshift adds the year to a
 * word number modulo the 2,048 words, or a last date whose day the mode adds to the last word
 * only in part (Masking.effectiveShifts). So each shift is tried once, with the earliest dates
 * that give it. Whether an earlier combination gave it is worked out from the combination itself
 * (EarlierShifts), never kept: a search of two billion combinations needs no memory for it.
 */
export function* dateRecoveryCandidates(
  indexes: readonly number[],
  knownDates: readonly DateShiftDate[],
  patterns: readonly DatePattern[],
  mode: SeedshiftMode,
): Generator<readonly DateCandidate[]> {
  // A JavaScript host may pass any value; another mode would silently decode another way.
  if (!Masking.isMode(mode) || !Masking.of(mode).masked)
    throw new Error("Unsupported Seedshift mode.");
  assertWordCount(indexes.length);
  const masking = Masking.of(mode);
  // A host may build patterns itself: each value once and in order, as parsing gives them.
  const owned = patterns.map(ownedPattern);
  const earlier = new EarlierShifts(knownDates, owned, masking, indexes.length);
  for (const guessed of datePatternCombinations(owned)) {
    if (earlier.gaveShiftsOf(guessed)) {
      yield [];
      continue;
    }
    const sorted = sortDates(guessed);
    yield masking
      .undo(indexes, [...knownDates, ...guessed])
      .filter((result) => result.checksumValid)
      .map((result) => ({ dates: sorted, mnemonic: result.recoveredMnemonic }));
  }
}

/** A date with what tells it apart in the shifts: its year modulo 2,048, its month and its day. */
function shiftKeyOf(date: DateShiftDate): string {
  return `${date.year % BIP39_DICTIONARY_SIZE}-${date.month}-${date.day}`;
}

/** A value that may stand in a pattern's place, with the date of the combination it stands for. */
interface Stand {
  readonly date: DateShiftDate;
  /** The shift key that it takes up, or undefined for a last date of another day. */
  readonly key: string | undefined;
}

/**
 * Whether an earlier combination of the patterns gave the same effective shifts as a given one.
 *
 * Two combinations give the same shifts only where their sorted dates agree, place by place, in
 * the year modulo 2,048, the month and the day, except for the day of the last date where the
 * mode adds it to the last word in part. So every date of an earlier combination has the shift
 * key of one of the guessed dates, or is such a last date, and the patterns allow only a few:
 * those are tried in the order the search goes, up to the combination itself.
 */
class EarlierShifts {
  readonly #known: readonly DateShiftDate[];
  readonly #patterns: readonly DatePattern[];
  readonly #allowed: readonly {
    readonly years: ReadonlySet<number>;
    readonly months: ReadonlySet<number>;
    readonly days: ReadonlySet<number>;
  }[];
  /** For each pattern, the earlier one with the same key, whose date it never precedes. */
  readonly #sameAs: readonly (number | undefined)[];
  readonly #masking: Masking;
  readonly #wordCount: Bip39WordCount;
  readonly #lastModulus: number;

  constructor(
    known: readonly DateShiftDate[],
    patterns: readonly DatePattern[],
    masking: Masking,
    wordCount: Bip39WordCount,
  ) {
    this.#known = known;
    this.#patterns = patterns;
    this.#allowed = patterns.map((pattern) => ({
      years: new Set(pattern.years),
      months: new Set(pattern.months),
      days: new Set(pattern.days),
    }));
    // datePatternCombinations takes patterns with one key as a set: never an earlier date later.
    this.#sameAs = patterns.map((pattern, index) => {
      const before = patterns.slice(0, index).map((other) => other.key);
      const at = before.lastIndexOf(pattern.key);
      return at < 0 ? undefined : at;
    });
    this.#masking = masking;
    this.#wordCount = wordCount;
    this.#lastModulus = masking.lastShiftModulus(wordCount);
  }

  /** Whether a combination before `guessed` gave its effective shifts, and so its phrases. */
  gaveShiftsOf(guessed: readonly DateShiftDate[]): boolean {
    const shifts = this.#shiftsOf(guessed);
    const remaining = new Map<string, number>();
    for (const date of guessed) {
      const key = shiftKeyOf(date);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const lastDay = this.#lastDayStands(sortDates([...this.#known, ...guessed]));
    const stands = this.#patterns.map((_, index) => this.#standsFor(index, remaining, lastDay));
    return this.#search(guessed, shifts, stands, remaining, [], false, false);
  }

  /** The effective shifts of a combination, as one text. */
  #shiftsOf(guessed: readonly DateShiftDate[]): string {
    const shifts = deriveShifts([...this.#known, ...guessed], this.#wordCount);
    return this.#masking.effectiveShifts(shifts).join(",");
  }

  /**
   * Where the day of the last date moves only the last word, and only in part: the year, the
   * month and the remainder of the day that every other last date must share with it.
   */
  #lastDayStands(
    all: readonly DateShiftDate[],
  ): { readonly year: number; readonly month: number; readonly day: number } | undefined {
    if (this.#lastModulus > LONGEST_MONTH) return undefined;
    // With fewer dates the shifts repeat, and the day of the last date moves other words too.
    if (all.length * SHIFTS_PER_DATE !== this.#wordCount) return undefined;
    const last = all.at(-1)!;
    return {
      year: last.year % BIP39_DICTIONARY_SIZE,
      month: last.month,
      day: last.day % this.#lastModulus,
    };
  }

  /** The dates that may stand in the place of pattern `index`, earliest first. */
  #standsFor(
    index: number,
    remaining: ReadonlyMap<string, number>,
    lastDay: { readonly year: number; readonly month: number; readonly day: number } | undefined,
  ): Stand[] {
    const allowed = this.#allowed[index]!;
    const stands: Stand[] = [];
    const add = (year: number, month: number, day: number, key: string | undefined) => {
      if (!allowed.years.has(year) || !allowed.months.has(month) || !allowed.days.has(day)) return;
      if (day > daysInMonth(year, month)) return;
      stands.push({ date: { year, month, day }, key });
    };
    for (const key of remaining.keys()) {
      const [year, month, day] = key.split("-").map(Number) as [number, number, number];
      for (let other = year; other <= LAST_YEAR; other += BIP39_DICTIONARY_SIZE)
        if (other >= 1) add(other, month, day, key);
    }
    if (lastDay !== undefined)
      for (let year = lastDay.year; year <= LAST_YEAR; year += BIP39_DICTIONARY_SIZE)
        for (const day of allowed.days)
          if (year >= 1 && day % this.#lastModulus === lastDay.day)
            add(year, lastDay.month, day, undefined);
    return stands.sort((left, right) => compareDates(left.date, right.date));
  }

  /**
   * Tries the dates that may stand in each place from `chosen.length` on, in the order of the
   * search, while the combination is not yet later than `guessed`; true once one before it gives
   * the same shifts. Each guessed date's shift key is taken up once, and one place at most may
   * hold a last date of another day.
   */
  #search(
    guessed: readonly DateShiftDate[],
    shifts: string,
    stands: readonly Stand[][],
    remaining: Map<string, number>,
    chosen: DateShiftDate[],
    before: boolean,
    lastDayUsed: boolean,
  ): boolean {
    const index = chosen.length;
    if (index === guessed.length) return before && this.#shiftsOf(chosen) === shifts;
    const sameAs = this.#sameAs[index];
    for (const stand of stands[index]!) {
      if (sameAs !== undefined && compareDates(stand.date, chosen[sameAs]!) < 0) continue;
      const order = before ? -1 : compareDates(stand.date, guessed[index]!);
      // The stands are sorted, so every later one is later than the combination too.
      if (order > 0) break;
      const count = stand.key === undefined ? 0 : (remaining.get(stand.key) ?? 0);
      if (stand.key === undefined ? lastDayUsed : count === 0) continue;
      if (stand.key !== undefined) remaining.set(stand.key, count - 1);
      chosen.push(stand.date);
      const found = this.#search(
        guessed,
        shifts,
        stands,
        remaining,
        chosen,
        order < 0,
        lastDayUsed || stand.key === undefined,
      );
      chosen.pop();
      if (stand.key !== undefined) remaining.set(stand.key, count);
      if (found) return true;
    }
    return false;
  }
}
