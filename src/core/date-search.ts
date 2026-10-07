// Forgotten Seedshift dates: what one answer of dates holds, how many combinations it stands for,
// how much work their search is, and the search itself. A program that only searches dates takes
// this module and the core modules it imports (dates, date-recovery, seedshift, words, and masking
// for what each mode costs and whether it needs the wallet); it needs nothing about shares, cards,
// records or terminals.
//
// From the host it needs, as parameters: a wallet check for each checksum-valid phrase
// (core/wallet-check.ts: the command line passes its Bitcoin evidence check; a page passes its own
// derivation, which may answer asynchronously), and for a run a progress callback, a match
// callback, an AbortSignal and how it yields to its event loop.
//
// It does not ask, print, read files or derive keys, and it keeps no phrase beyond the result it
// returns. Its messages name a wrong date by its place, never by what was typed.
//
// Host-neutral: test/portable-modules.test.ts checks that it reaches only host-neutral modules.

import {
  datePatternCombinationCount,
  formatDate,
  isDatePattern,
  maximumDates,
  ownedDate,
  ownedPattern,
  parseDate,
  parseDatePattern,
  tooManyDatesMessage,
} from "./dates.js";
import { dateRecoveryCandidates, type SeedshiftMode } from "./date-recovery.js";
import { Masking, type MaskingMode } from "./masking.js";
import { placesInWords } from "./places.js";
import { keptCount, nextTask, QUESTION_SECONDS, TURN_MILLISECONDS } from "./search-turns.js";
import type { Bip39WordCount, DatePattern, DateShiftDate } from "./types.js";
import type { WalletCheck } from "./wallet-check.js";
import { assertWordCount, BIP39_DICTIONARY_SIZE, WORD_COUNT_SET } from "./words.js";

export type { WalletCheck, WalletMatch } from "./wallet-check.js";

/**
 * Date combinations that no search exceeds: with a wallet check of about 1.5 ms, about a month, as
 * for the share search (2^40 checks). A search longer than twelve hours is asked for first.
 */
export const HARD_MAX_COMBINATIONS = 2 ** 31;
/** Dates with ? that one search takes. */
export const MAX_INCOMPLETE_DATES = 3;
/** Matches that a search keeps to show unless the host asks for another number. */
export const MAX_SHOWN_MATCHES = 100;
/** How a date search with more matches than a candidate list holds is narrowed (TooManyForList). */
export const NARROW_DATE_SEARCH = "narrow the dates, or give the wallet's fingerprint";
/**
 * A phrase to time the host's wallet check with: the one of all-zero entropy, "abandon … about",
 * public test data, which the check derives like any other.
 */
const PROBE_PHRASE = `${"abandon ".repeat(11)}about`;
/** Wallet checks timed for an estimate: enough to smooth a first slow call, quick to make. */
const PROBE_CHECKS = 3;
/** Combinations decoded for an estimate: some hundredths of a second, enough to be steady. */
const PROBE_COMBINATIONS = 256;
/**
 * The BIP39 indexes of a public phrase of 24 words, all-zero entropy, which the decoding is timed
 * with: as long as a phrase gets, so that every count of dates fits it, and public test data.
 */
const PROBE_INDEXES: readonly number[] = [...Array<number>(23).fill(0), 102];
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Whether a mode gives a checksum-valid phrase for every date, so that only the wallet tells the
 * right dates: the modes whose codes keep the BIP39 checksum (MnemoCode Seedshift, and the
 * original's checksum-valid last word) keep it for every date too.
 */
export function walletNeeded(mode: MaskingMode): boolean {
  return Masking.of(mode).keepsChecksum;
}

/** What a dates answer may hold. */
export interface DatesRules {
  /** The words of the seed phrase, which take one date for every three (maximumDates). */
  readonly wordCount?: number | undefined;
  /** Whether ? may stand for forgotten digits: only where the dates are searched. */
  readonly patterns: boolean;
}

/** A date as typed, with digits or ?: DD-MM-YYYY, or YYYY-MM-DD as parseDate also reads it. */
/**
 * A typed date in the shape of a date, DD-MM-YYYY or YYYY-MM-DD: each part its digits, ? for one
 * that is forgotten, values joined by |, or a lone ? for the whole part; or a lone ? for a whole
 * date. A year has four digits, so that a two-digit one is named as such.
 */
const SHORT_PART = String.raw`(?:\?|[0-9?|]{2,})`;
const YEAR_PART = String.raw`(?:\?|[0-9?|]{4,})`;
const DATE_SHAPE = new RegExp(
  String.raw`^(?:\?|${SHORT_PART}-${SHORT_PART}-${YEAR_PART}|${YEAR_PART}-${SHORT_PART}-${SHORT_PART})$`,
  "u",
);
/** The dates are split at spaces; a comma or a semicolon between them is taken as one too. */
const DATE_SEPARATORS = /[\s,;]+/u;

/** The words of a BIP39 phrase, or undefined for a count that is none. */
function phraseLength(wordCount: number | undefined): Bip39WordCount | undefined {
  return wordCount !== undefined && WORD_COUNT_SET.has(wordCount)
    ? (wordCount as Bip39WordCount)
    : undefined;
}

/** What toString, toJSON and Node.js's inspect show of the dates or of a search: never a date. */
const REDACTED_DATES = "[DatesAnswer: redacted]";
const REDACTED_SEARCH = "[DateSearch: redacted]";

/** `message` from the core after the place of the date it is about: "Date 2: the day ...". */
function atPlace(place: number, message: string): string {
  return `Date ${place}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

/** Whether two patterns allow the same dates: the same values in each part, in any order. */
function sameDates(left: DatePattern, right: DatePattern): boolean {
  const same = (a: readonly number[], b: readonly number[]) => {
    const values = new Set(a);
    return values.size === new Set(b).size && b.every((value) => values.has(value));
  };
  return (
    same(left.years, right.years) && same(left.months, right.months) && same(left.days, right.days)
  );
}

/**
 * Refuses a pattern with the key of an earlier one that allows other dates, naming it by its place.
 * The key groups patterns that allow the same dates: the count of combinations takes one pattern
 * for each key, and the search tries the dates of one key in ascending order only, so such a
 * pattern would be counted wrongly and searched incompletely. parse makes each key of the digits
 * typed, so that it never refuses here; a host that builds its own patterns may.
 */
function assertKeysFit(patterns: readonly DatePattern[], places: readonly number[]): void {
  patterns.forEach((pattern, index) => {
    const earlier = patterns.slice(0, index).find((other) => other.key === pattern.key);
    if (earlier !== undefined && !sameDates(earlier, pattern))
      throw new Error(
        atPlace(
          places[index] ?? index + 1,
          "Its pattern has the key of an earlier one that allows other dates.",
        ),
      );
  });
}

/**
 * The dates of one answer: the complete ones, and the ones with ? for forgotten digits. A class
 * pays off here: it is built only by `parse` or `of`, and its constructor refuses an answer that
 * cannot be searched, so every DatesAnswer can be; it never changes afterwards; and it keeps the
 * dates, which are part of a secret, out of toString, toJSON and Node.js's inspect.
 */
export class DatesAnswer {
  readonly #known: readonly DateShiftDate[];
  readonly #patterns: readonly DatePattern[];
  /** The places, counted from 1 among the dates typed, of the dates with ?. */
  readonly #incompletePlaces: readonly number[];

  private constructor(
    known: readonly DateShiftDate[],
    patterns: readonly DatePattern[],
    incompletePlaces: readonly number[],
  ) {
    // The limits are checked here, not only in parse and of: a private constructor is private to
    // TypeScript alone, and a JavaScript host can call it (AUD-009-FUN001).
    if (patterns.length > MAX_INCOMPLETE_DATES)
      throw new Error(`Date recovery supports at most ${MAX_INCOMPLETE_DATES} incomplete dates.`);
    // Copied and frozen, date by date: a caller that kept a date or a pattern could otherwise
    // change it after the limits were checked (AUD-009-FUN001). Array.from reads a hole of a
    // sparse list as undefined, which is refused; map would keep it.
    this.#known = Object.freeze(Array.from(known, (date) => ownedDate(date)));
    this.#patterns = Object.freeze(Array.from(patterns, (pattern) => ownedPattern(pattern)));
    this.#incompletePlaces = Object.freeze([...incompletePlaces]);
    assertKeysFit(this.#patterns, this.#incompletePlaces);
    if (this.combinations > HARD_MAX_COMBINATIONS)
      throw new Error(
        `The date patterns produce more than ${HARD_MAX_COMBINATIONS.toLocaleString("en-US")} combinations, which exceeds the safety limit. Narrow at least one pattern.`,
      );
  }

  /**
   * Reads the dates of one answer, as a person types them in one line. The messages name a wrong
   * date by its place and never repeat it.
   */
  static parse(line: string, rules: DatesRules): DatesAnswer {
    const typed = line.split(DATE_SEPARATORS).filter(Boolean);
    if (typed.length === 0) throw new Error("Type at least one date.");
    const words = phraseLength(rules.wordCount);
    if (words !== undefined && typed.length > maximumDates(words))
      throw new Error(tooManyDatesMessage(words));
    const known: DateShiftDate[] = [];
    const patterns: DatePattern[] = [];
    const incompletePlaces: number[] = [];
    typed.forEach((text, index) => {
      const place = index + 1;
      const incomplete = isDatePattern(text);
      if (incomplete && !rules.patterns)
        throw new Error(
          "? and | stand for what is forgotten only where MnemoCode can search dates; type every date in full.",
        );
      if (!DATE_SHAPE.test(text))
        throw new Error(
          atPlace(
            place,
            incomplete
              ? "Use DD-MM-YYYY with ? for each forgotten digit, values joined by | such as 05|15, or a lone ? for a whole date."
              : "Use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
          ),
        );
      try {
        if (incomplete) patterns.push(parseDatePattern(text));
        else known.push(parseDate(text));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new Error(atPlace(place, error.message), { cause: error });
      }
      if (incomplete) incompletePlaces.push(place);
    });
    return new DatesAnswer(known, patterns, incompletePlaces);
  }

  /**
   * The answer of dates read elsewhere, such as complete dates given as command-line options or
   * typed into separate fields, held to the same limits as `parse`. The dates with ? count as
   * typed after the complete ones.
   */
  static of(known: readonly DateShiftDate[], patterns: readonly DatePattern[] = []): DatesAnswer {
    if (known.length + patterns.length === 0) throw new Error("Type at least one date.");
    // Each date is checked as parse checks a typed one, and named by its place (AUD-009-API001).
    const checked = <T>(value: T, place: number, own: (value: T) => T): T => {
      try {
        return own(value);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new Error(atPlace(place, error.message), { cause: error });
      }
    };
    // Array.from, not map: a hole of a sparse list is then a date that is refused, not skipped.
    const ownKnown = Array.from(known, (date, index) => checked(date, index + 1, ownedDate));
    const ownPatterns = Array.from(patterns, (pattern, index) =>
      checked(pattern, known.length + index + 1, ownedPattern),
    );
    const places = ownPatterns.map((_, index) => known.length + index + 1);
    return new DatesAnswer(ownKnown, ownPatterns, places);
  }

  /** The complete dates, in the order typed; a copy, so that the answer stays as it was built. */
  get known(): DateShiftDate[] {
    return [...this.#known];
  }

  /** The dates with ? for forgotten digits, in the order typed; none when every date is whole. */
  get patterns(): DatePattern[] {
    return [...this.#patterns];
  }

  /** How many dates the answer holds, complete or not. */
  get count(): number {
    return this.#known.length + this.#patterns.length;
  }

  /** Whether a date holds ? for a forgotten digit, so that the dates must be searched. */
  get hasForgottenDigits(): boolean {
    return this.#patterns.length > 0;
  }

  /**
   * The combinations of dates that the answer stands for: 1 when every date is whole, and
   * HARD_MAX_COMBINATIONS + 1 for any count above that limit.
   */
  get combinations(): number {
    return datePatternCombinationCount(this.#patterns, HARD_MAX_COMBINATIONS);
  }

  /** The places, counted from 1 among the dates typed, of the dates that hold ?. */
  get incompletePlaces(): number[] {
    return [...this.#incompletePlaces];
  }

  /**
   * The line that a page shows while the dates are typed: which dates hold ? and the combinations
   * they stand for, such as "Dates 2 and 3 have forgotten digits: 3,650 combinations."; undefined
   * when every date is whole.
   */
  get forgottenDigitsNote(): string | undefined {
    const places = this.#incompletePlaces;
    if (places.length === 0) return undefined;
    const combinations = this.combinations;
    const counted = `${combinations.toLocaleString("en-US")} ${combinations === 1 ? "combination" : "combinations"}`;
    return places.length === 1
      ? `Date ${places[0]} has forgotten digits: ${counted}.`
      : `Dates ${placesInWords(places)} have forgotten digits: ${counted}.`;
  }

  /** Whether a phrase of `wordCount` words takes this many dates; never for another count. */
  fitsPhrase(wordCount: number): boolean {
    const words = phraseLength(wordCount);
    return words !== undefined && this.count <= maximumDates(words);
  }

  /**
   * Why a phrase of `wordCount` words cannot take these dates, or undefined when it can or when
   * the count is not known yet (no phrase length).
   */
  tooManyFor(wordCount: number | undefined): string | undefined {
    const words = phraseLength(wordCount);
    return words !== undefined && this.count > maximumDates(words)
      ? tooManyDatesMessage(words)
      : undefined;
  }

  toString(): string {
    return REDACTED_DATES;
  }

  toJSON(): string {
    return REDACTED_DATES;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED_DATES;
  }
}

/** A match: its dates as DD-MM-YYYY, sorted and joined by spaces, its phrase, and its path. */
export interface DateMatch {
  readonly dates: string;
  readonly mnemonic: string;
  /** Where the wallet matched; none without a wallet check. */
  readonly evidence?: string | undefined;
}

/** How far a search has come. */
export interface DateSearchProgress {
  /** The date combinations tried so far. */
  readonly checked: number;
  /** The date combinations of the whole search. */
  readonly combinations: number;
  /** The candidates with a valid BIP39 checksum so far. */
  readonly checksumValid: number;
  /** The candidates that matched the wallet so far, or every checksum-valid one without one. */
  readonly matchCount: number;
}

/** What a search found. */
export interface DateSearchResult {
  /** The date combinations searched. */
  readonly combinations: number;
  /** The candidates with a valid BIP39 checksum. */
  readonly checksumValid: number;
  /** The candidates that matched the wallet, or every checksum-valid one without a wallet. */
  readonly matchCount: number;
  /** The first `maxShown` matches. */
  readonly shown: readonly DateMatch[];
  /** The phrase of every match, kept only when `keep` is above 0, at most `keep` of them. */
  readonly kept: readonly string[];
}

/** How fast a search goes in a host, in seconds, as DateSearch.pace measures it. */
export interface SearchPace {
  /** One call of the wallet check; 0 without one. */
  readonly perCheck: number;
  /** Decoding one combination of the dates. */
  readonly perCombination: number;
}

/** What a search is built with. */
export interface DateSearchOptions {
  /** The encoded seed phrase's BIP39 indexes, 0 to 2047. */
  readonly indexes: readonly number[];
  readonly dates: DatesAnswer;
  readonly mode: SeedshiftMode;
  /** Compares each checksum-valid phrase with the wallet; none keeps every such phrase. */
  readonly walletCheck?: WalletCheck | undefined;
  /** How many matches are kept to be shown; MAX_SHOWN_MATCHES by default. */
  readonly maxShown?: number | undefined;
  /** How many match phrases are kept, for a candidate list; 0, the default, keeps none. */
  readonly keep?: number | undefined;
}

/** How a search runs. */
export interface DateSearchRun {
  /** Called after every `progressEvery` combinations and after the last one. */
  readonly onProgress?: ((progress: DateSearchProgress) => void) | undefined;
  /** Combinations between two progress calls; only after the last one by default. */
  readonly progressEvery?: number | undefined;
  /** Called with every match as it is found, also those beyond `maxShown`. */
  readonly onMatch?: ((match: DateMatch) => void) | undefined;
  /** Stops the search at its next turn; the signal's reason is thrown. */
  readonly signal?: AbortSignal | undefined;
  /** How the search lets the host's event loop run; a zero timeout by default. */
  readonly turn?: (() => Promise<void>) | undefined;
}

/** Combinations between two progress calls: a whole number of 1 or more; none for the last only. */
function progressStep(every: number | undefined): number {
  if (every === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(every) || every < 1)
    throw new RangeError("progressEvery must be a whole number of 1 or more.");
  return every;
}

/**
 * One search for the forgotten digits of the dates: every combination that the patterns allow is
 * tried with the known dates, and each checksum-valid phrase is compared with the wallet. A class
 * pays off here: it is built once with its phrase, dates, mode and the host's wallet check, which
 * it checks against each other, and then tells its size and its work before it runs, as a page
 * shows them before the person starts the search; toString, toJSON and Node.js's inspect show
 * none of its codes or dates.
 */
export class DateSearch {
  readonly #indexes: readonly number[];
  readonly #dates: DatesAnswer;
  readonly #mode: SeedshiftMode;
  readonly #walletCheck: WalletCheck | undefined;
  readonly #maxShown: number;
  readonly #keep: number;

  constructor(options: DateSearchOptions) {
    // Copied first and the copy checked, as EncodedBackup.of checks codes: a hole or a code outside
    // the BIP39 list is refused before the search tells its size, not at its first combination.
    const indexes = Array.from(options.indexes);
    const words = indexes.length;
    assertWordCount(words);
    if (
      indexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= BIP39_DICTIONARY_SIZE,
      )
    )
      throw new Error("Every BIP39 index must be an integer from 0 through 2047.");
    // A JavaScript host may pass any value; another mode would silently decode another way.
    if (!Masking.isMode(options.mode) || !Masking.of(options.mode).masked)
      throw new Error("Unsupported Seedshift mode.");
    if (!(options.dates instanceof DatesAnswer))
      throw new TypeError("The dates must be a DatesAnswer.");
    if (!options.dates.fitsPhrase(words)) throw new Error(tooManyDatesMessage(words));
    this.#indexes = Object.freeze(indexes);
    this.#dates = options.dates;
    this.#mode = options.mode;
    this.#walletCheck = options.walletCheck;
    this.#maxShown = keptCount(options.maxShown, MAX_SHOWN_MATCHES, "maxShown");
    this.#keep = keptCount(options.keep, 0, "keep");
  }

  /** The date combinations that the search tries. */
  get combinations(): number {
    return this.#dates.combinations;
  }

  /**
   * Seconds that one call of `walletCheck` takes in this host, from a few checks of the public
   * test phrase, for estimatedSeconds. It may answer later, as a page's derivation does.
   */
  static async secondsPerCheck(walletCheck: WalletCheck): Promise<number> {
    const start = performance.now();
    for (let check = 0; check < PROBE_CHECKS; check += 1) await walletCheck(PROBE_PHRASE);
    return (performance.now() - start) / MILLISECONDS_PER_SECOND / PROBE_CHECKS;
  }

  /**
   * Seconds that decoding one combination of `dates` takes in this host in `mode`, from the first
   * combinations of a search of a public phrase: for a search without a wallet check it is all
   * the work, and beside one it is still a part (estimatedSeconds).
   */
  static secondsPerCombination(mode: SeedshiftMode, dates: DatesAnswer): number {
    const start = performance.now();
    let decoded = 0;
    for (const candidates of dateRecoveryCandidates(
      PROBE_INDEXES,
      dates.known,
      dates.patterns,
      mode,
    )) {
      // The phrases are made as the search makes them; only the time counts.
      void candidates;
      decoded += 1;
      if (decoded >= PROBE_COMBINATIONS) break;
    }
    return (performance.now() - start) / MILLISECONDS_PER_SECOND / Math.max(1, decoded);
  }

  /**
   * The pace of this search in this host: one wallet check (secondsPerCheck), 0 without one, and
   * the decoding of one combination (secondsPerCombination), for estimatedSeconds.
   */
  async pace(): Promise<SearchPace> {
    return {
      perCheck:
        this.#walletCheck === undefined ? 0 : await DateSearch.secondsPerCheck(this.#walletCheck),
      perCombination: DateSearch.secondsPerCombination(this.#mode, this.#dates),
    };
  }

  /**
   * The checksum-valid phrases, so the wallet checks, that one combination gives on average, for
   * an estimate of the time (Masking.checksPerCombination): MnemoCode Seedshift gives a valid
   * phrase for every date; the Original Seedshift gives one only by chance, once in 2^bits; with
   * a valid last word every last word whose checksum fits is tried, 2^(11 - bits) of them.
   */
  checks(): number {
    return Masking.of(this.#mode).checksPerCombination(this.#indexes.length);
  }

  /**
   * About how many seconds the search takes at `pace`, as the host measured it (pace): the
   * decoding of every combination, and a wallet check of each checksum-valid phrase if there is
   * a wallet check.
   */
  estimatedSeconds(pace: SearchPace): number {
    const checks = this.#walletCheck === undefined ? 0 : this.checks() * pace.perCheck;
    return this.combinations * (pace.perCombination + checks);
  }

  /**
   * Whether the search is to be asked for first: it tries more combinations than `limit`, the
   * person's own limit, or without one takes longer than QUESTION_SECONDS at `pace`.
   */
  needsQuestion(pace: SearchPace, limit?: number): boolean {
    if (limit !== undefined) return this.combinations > limit;
    return this.estimatedSeconds(pace) > QUESTION_SECONDS;
  }

  /** Runs the search; the host's callbacks and signal come in with `run`. */
  async run(run: DateSearchRun = {}): Promise<DateSearchResult> {
    const progressEvery = progressStep(run.progressEvery);
    const turn = run.turn ?? nextTask;
    const combinations = this.combinations;
    const shown: DateMatch[] = [];
    const kept: string[] = [];
    let checked = 0;
    let checksumValid = 0;
    let matchCount = 0;
    run.signal?.throwIfAborted();
    let lastTurn = Date.now();
    for (const candidates of dateRecoveryCandidates(
      this.#indexes,
      this.#dates.known,
      this.#dates.patterns,
      this.#mode,
    )) {
      checked += 1;
      if (Date.now() - lastTurn >= TURN_MILLISECONDS) {
        await turn();
        run.signal?.throwIfAborted();
        lastTurn = Date.now();
      }
      for (const candidate of candidates) {
        checksumValid += 1;
        const match =
          this.#walletCheck === undefined ? undefined : await this.#walletCheck(candidate.mnemonic);
        if (match !== undefined && !match.matched) continue;
        matchCount += 1;
        if (kept.length < this.#keep) kept.push(candidate.mnemonic);
        if (shown.length >= this.#maxShown && run.onMatch === undefined) continue;
        const found: DateMatch = {
          dates: candidate.dates.map(formatDate).join(" "),
          mnemonic: candidate.mnemonic,
          evidence: match?.path,
        };
        if (shown.length < this.#maxShown) shown.push(found);
        run.onMatch?.(found);
      }
      if (checked % progressEvery === 0 || checked === combinations)
        run.onProgress?.({ checked, combinations, checksumValid, matchCount });
    }
    return { combinations, checksumValid, matchCount, shown, kept };
  }

  toString(): string {
    return REDACTED_SEARCH;
  }

  toJSON(): string {
    return REDACTED_SEARCH;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED_SEARCH;
  }
}
