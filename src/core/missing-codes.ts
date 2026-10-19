// Codes of an encoded seed phrase of which some cannot be read, each marked at its place, and the
// search for them. A ? stands for a code that cannot be read. In English words a few letters with
// * or words joined by | narrow it, as recover-word reads them; in word numbers and Unicode codes a
// ? may stand for one digit, such as 1?34 or 4E?0; in colors a ? stands for a whole color. Each
// place then holds the codes that fit what was read.
//
// Codes that keep a BIP39 checksum of their own, those of MnemoCode Seedshift and those without
// Seedshift, are searched only where the checksum holds, as the word search does (candidates.ts);
// the Original Seedshift's codes keep none, and every combination is a candidate. What tells the
// right codes is the host's check, which it composes: the encoded fingerprint noted at Encode, or
// the wallet once the dates have decoded a candidate (EncodedBackup.decode).
//
// Needs from the host: the check, and for a long search an AbortSignal and the turns of its event
// loop. Does not: decode, compare wallets or show anything.
//
// Host-neutral: it imports only other core modules (test/portable-modules.test.ts).

import {
  codeTokens,
  fitsPattern,
  hexUnits,
  UNICODE_CODE_DIGITS,
  withJoinedMarksHint,
} from "./code-text.js";
import {
  EVERY_WORD,
  placeCombinations,
  searchCandidates,
  wordPlaceOf,
  type WordPlace,
  assertSearchable,
  expectedCandidates,
  searchCombinations,
  unknownPlacesOf,
} from "./candidates.js";
import {
  WORD_NUMBERS_THROUGH,
  WORD_NUMBER_DIGITS,
  wordNumberOf,
  isBip39WordCount,
  WORD_COUNTS_TEXT,
} from "./bip39-sizes.js";
import {
  colorOfUnicodePair,
  COLOR_UNICODE_PAIRS,
  COLOR_UNICODE_POINTS_PER_COLOR,
  wordPositionPlacements,
  markedColorSymbols,
  RGB_HEX_DIGITS,
} from "./colors.js";
import { EncodedBackup, type EncodedFormat } from "./encoded-backup.js";
import { Masking } from "./masking.js";
import { ENCODED_FORMATS, type MaskingMode } from "./types.js";
import { SearchTurns, keptCount, type SearchProgress, type SearchRun } from "./search-turns.js";
import {
  BIP39_DICTIONARY_SIZE,
  englishTokens,
  runTogetherNumbers,
  unicodeCodesFitting,
  wordIndexOfNumber,
  WORD_NUMBERS_RUN_TOGETHER,
} from "./words.js";
import { Redacted } from "./redacted.js";
import { SecretValue } from "./secret-value.js";
import { defined } from "./defined.js";
import { ErrorCatalog, suppliedMessage } from "./error-catalog.js";

const ERRORS = new ErrorCatalog("core.missing-codes", {
  "word-number-no-number-from": (value0: string, value1: string) =>
    `Word number ${value0} is no number from ${value1}.`,
  "word-numbers-run-together": () => WORD_NUMBERS_RUN_TOGETHER,
  "code-no-unicode-code-word-list": (value0: string) =>
    `Code ${value0} is no Unicode code of the word list.`,
  "unicode-colors-refused": suppliedMessage,
  "colors-give-no-word-at-place": (value0: string) => `The colors give no word at place ${value0}.`,
  "places-refused": suppliedMessage,
  "mark-color-cannot-read-one-place-whole-color": () =>
    "Mark a color that cannot be read with one ? in place of the whole color.",
  "codes-cannot-marked-form": () => "These codes cannot be marked in this form.",
  "codes-seed-phrase": (value0: string, value1: string) =>
    `These are ${value0} codes; a seed phrase has ${value1}.`,
  "no-code-marked-mark-each-code-cannot-read": () =>
    "No code is marked: mark each code that cannot be read with ?.",
});

/** What makes a search of marked codes smaller, in the words of its refusal (assertSearchable). */
const NARROW_MARKED_CODES = "read a few letters or digits of the codes, or mark fewer";

/** Codes found that a search keeps by default: more than any person compares by eye. */
export const MAX_FOUND_CODES = 100;

/** The words whose 1-based number fits `pattern`, as typed or as four digits of a color. */
function wordsOfNumber(pattern: string, padded: boolean): WordPlace {
  const words: number[] = [];
  for (let index = 0; index < BIP39_DICTIONARY_SIZE; index += 1) {
    const number = String(wordNumberOf(index));
    if (fitsPattern(pattern, padded ? number.padStart(WORD_NUMBER_DIGITS, "0") : number))
      words.push(index);
  }
  return words;
}

/** A word number with ? for unread digits: at most the digits of 2048. */
const MARKED_WORD_NUMBER = new RegExp(`^[0-9?]{1,${WORD_NUMBER_DIGITS}}$`, "u");

/** The refusal of word number `place`, which no number of a word fits. */
function noWordNumber(place: number): Error {
  return ERRORS.create("word-number-no-number-from", [`${place}`, `${WORD_NUMBERS_THROUGH}`]);
}

/** The words that one word number allows: a number, a lone ?, or a number with ? for a digit. */
function numberPlace(written: string, place: number): WordPlace {
  if (written === "?") return EVERY_WORD;
  // A known number is read as complete codes read it, leading zeros included.
  if (!written.includes("?")) {
    try {
      return [wordIndexOfNumber(written)];
    } catch {
      throw noWordNumber(place);
    }
  }
  if (MARKED_WORD_NUMBER.test(written)) {
    const words = wordsOfNumber(written, false);
    if (words.length > 0) return words;
  }
  if (runTogetherNumbers(written)) throw ERRORS.create("word-numbers-run-together", []);
  throw noWordNumber(place);
}

/** The words that one Unicode code allows: a code, a lone ?, or a code with ? for a digit. */
function codePlace(written: string, place: number): WordPlace {
  if (written === "?") return EVERY_WORD;
  if (written.length === UNICODE_CODE_DIGITS && /^[0-9A-F?]+$/u.test(written)) {
    const words = unicodeCodesFitting(written);
    if (words.length > 0) return words;
  }
  throw ERRORS.create("code-no-unicode-code-word-list", [`${place}`]);
}

/** The colors of Color Unicode codes, each undefined where one of its two codes cannot be read. */
function unicodeColors(text: string): (string | undefined)[] {
  // The codes may also be the Private Use symbols themselves.
  const points = markedColorSymbols(text) ?? hexUnits(text, UNICODE_CODE_DIGITS);
  if (points === undefined || points.length % COLOR_UNICODE_POINTS_PER_COLOR !== 0)
    throw ERRORS.create("unicode-colors-refused", [withJoinedMarksHint(COLOR_UNICODE_PAIRS, text)]);
  return Array.from({ length: points.length / COLOR_UNICODE_POINTS_PER_COLOR }, (_, color) => {
    const pair = points.slice(
      color * COLOR_UNICODE_POINTS_PER_COLOR,
      (color + 1) * COLOR_UNICODE_POINTS_PER_COLOR,
    );
    // A code with ? among its digits leaves its color unknown: its digits are no digits of it.
    if (pair.some((code) => code.includes("?"))) return undefined;
    const [high, low] = pair.map((code) => Number.parseInt(code, 16));
    return colorOfUnicodePair(defined(high), defined(low));
  });
}

/**
 * The places of colors in each placement that their tags allow (wordPositionPlacements), each
 * word a pattern of its four position digits. A placement that leaves no word at a place is not
 * the record's; where none is left, the first one says where.
 */
function colorPlaces(colors: readonly (string | undefined)[]): WordPlace[][] {
  const placements = wordPositionPlacements(colors).map((patterns) =>
    patterns.map((pattern) => wordsOfNumber(pattern, true)),
  );
  const possible = placements.filter((places) => places.every((words) => words.length > 0));
  if (possible.length > 0) return possible;
  const place = defined(placements[0]).findIndex((words) => words.length === 0);
  throw ERRORS.create("colors-give-no-word-at-place", [`${place + 1}`]);
}

/**
 * The places of `text` read in `format`, each with the codes it may hold, in each placement that
 * the codes allow: one, but for colors whose tags leave it open.
 */
function placementsOf(text: string, format: EncodedFormat): WordPlace[][] {
  switch (format) {
    case "english":
      return [englishTokens(text).map((word, index) => wordPlaceOf(word, index + 1))];
    case "indexes":
      return [codeTokens(text).map((token, index) => numberPlace(token, index + 1))];
    case "unicode": {
      const codes = hexUnits(text, UNICODE_CODE_DIGITS);
      if (codes === undefined)
        throw ERRORS.create("places-refused", [
          withJoinedMarksHint(
            "Unicode codes have four hexadecimal digits each, or ? where unread.",
            text,
          ),
        ]);
      return [codes.map((code, index) => codePlace(code, index + 1))];
    }
    case "colors": {
      const colors = hexUnits(text, RGB_HEX_DIGITS);
      if (colors === undefined || colors.some((color) => color !== "?" && color.includes("?")))
        throw ERRORS.create("mark-color-cannot-read-one-place-whole-color", []);
      return colorPlaces(colors.map((color) => (color === "?" ? undefined : `#${color}`)));
    }
    case "colors-unicode":
      return colorPlaces(unicodeColors(text));
    default:
      throw ERRORS.create("codes-cannot-marked-form", []);
  }
}

/**
 * How the check of every candidate of marked codes runs, with the host's services (MissingCodes
 * run). The search of one way (missing-codes-search.ts) builds it.
 */
export interface CodesCheckRun extends SearchRun {
  /**
   * Whether the codes, BIP39 indexes from 0 to 2047, are the right ones; may answer later.
   * Borrows the array until this check settles; run wipes it after making any retained backup.
   */
  readonly check: (codes: readonly number[]) => boolean | Promise<boolean>;
  /** How many codes that passed are kept; MAX_FOUND_CODES by default. */
  readonly maxFound?: number | undefined;
  /** Called at each turn with the candidates checked and those that passed. */
  readonly onProgress?: ((progress: SearchProgress) => void) | undefined;
}

/** What the check of every candidate of marked codes found (MissingCodes run). */
export interface CodesCheckResult {
  /** The codes that passed the check, in the order searched, at most maxFound of them. */
  readonly found: readonly EncodedBackup[];
  /** How many passed, all of them. */
  readonly passed: number;
  /** How many candidates were checked. */
  readonly count: number;
  /** Whether the host stopped the search: then only the candidates checked before it count. */
  readonly stopped: boolean;
}

/**
 * Codes with marks, read in one form and taken with one mode, and the search for them. A class,
 * because the places are read and checked once, and then tell their size, are searched and give
 * EncodedBackups; toString, toJSON and Node's inspect show none of the codes.
 */
export class MissingCodes extends Redacted implements Disposable {
  /** The places of every placement, one after another, each `#wordCount` long. */
  readonly #values: SecretValue<readonly WordPlace[]>;
  readonly #wordCount: number;
  readonly #active = new Set<() => void>();
  readonly #format: EncodedFormat;
  readonly #masking: Masking;
  readonly #combinations: number;

  private constructor(
    placements: readonly (readonly WordPlace[])[],
    format: EncodedFormat,
    mode: MaskingMode,
  ) {
    super("MissingCodes");
    // A JavaScript host may pass any value, which would be refused only by a later operation
    // (AUD-014-API006): refused here by the guard that complete codes have (EncodedBackup).
    const masking = Masking.of(mode);
    const wordCount = placements[0]?.length ?? 0;
    if (!isBip39WordCount(wordCount))
      throw ERRORS.create("codes-seed-phrase", [`${wordCount}`, `${WORD_COUNTS_TEXT}`]);
    if (placements.some((places) => places.every((place) => place.length === 1)))
      throw ERRORS.create("no-code-marked-mark-each-code-cannot-read", []);
    // Counted and bounded as the word search counts and bounds its places (candidates.ts), every
    // placement together.
    const combinations = placements.reduce(
      (total, places) => total + searchCombinations({ kind: "unknown-words", places }),
      0,
    );
    assertSearchable(combinations, NARROW_MARKED_CODES);
    this.#values = SecretValue.numberLists(placements.flat());
    this.#wordCount = wordCount;
    this.#format = format;
    this.#masking = masking;
    this.#combinations = combinations;
  }

  /** The places of each placement that the codes allow: one, but for colors (placementsOf). */
  get #placements(): readonly (readonly WordPlace[])[] {
    const places = this.#values.value;
    return Array.from({ length: places.length / this.#wordCount }, (_, placement) =>
      places.slice(placement * this.#wordCount, (placement + 1) * this.#wordCount),
    );
  }

  /**
   * Whether `text` marks codes it lacks: a ?, or in English words a prefix with * or words joined
   * by |. A host reads such codes here rather than as complete ones.
   */
  static marked(text: string): boolean {
    return /[?*|]/u.test(text);
  }

  /** Every form that the marked codes may be in, for a host that asks for one when several fit. */
  static formats(text: string): EncodedFormat[] {
    // Codes of every form may be marked; detection tries them in their order.
    return ENCODED_FORMATS.filter((format) => {
      try {
        return isBip39WordCount(placementsOf(text, format)[0]?.length ?? 0);
      } catch {
        return false;
      }
    });
  }

  /** Reads the marked codes of `text` in `format`, taken with `mode`; throws why they cannot be. */
  static read(text: string, format: EncodedFormat, mode: MaskingMode): MissingCodes {
    return new MissingCodes(placementsOf(text, format), format, mode);
  }

  /** The same codes taken with another mode. */
  withMode(mode: MaskingMode): MissingCodes {
    return new MissingCodes(this.#placements, this.#format, mode);
  }

  /** The validated representation format of these marked codes. */
  get format(): EncodedFormat {
    return this.#format;
  }

  /** The validated transformation mode used when a candidate is decoded. */
  get mode(): MaskingMode {
    return this.#masking.mode;
  }

  /** Number of BIP39 word positions in the encoded phrase, before candidate expansion. */
  get wordCount(): number {
    this.#values.assertLive();
    return this.#wordCount;
  }

  /** The places, counted from 1, whose code is not known, in any placement. */
  get missingPlaces(): number[] {
    return [...new Set(this.placements.flat())].sort((a, b) => a - b);
  }

  /**
   * The places, counted from 1, whose code is not known, for each placement that the codes allow:
   * one, but for colors whose tags leave it open (wordPositionPlacements).
   */
  get placements(): number[][] {
    return this.#placements.map((places) => unknownPlacesOf(places).map((index) => index + 1));
  }

  /** The combinations of codes that the marks leave. */
  get combinations(): number {
    return this.#combinations;
  }

  /** Whether the codes keep a BIP39 checksum of their own, which the search then holds them to. */
  get checksummed(): boolean {
    const masking = this.#masking;
    // Codes without Seedshift are the phrase itself, whose checksum BIP39 keeps: Masking says
    // otherwise for them only because such a phrase typed with a wrong checksum is still decoded
    // and shown with a warning, not refused.
    return masking.keepsChecksum || !masking.masked;
  }

  /**
   * About how many candidates the search checks: the combinations that pass the checksum, one in
   * 2^bits, where the codes keep one; every combination where they keep none.
   */
  get expected(): number {
    if (!this.checksummed) return this.#combinations;
    return this.#placements.reduce(
      (total, places) => total + expectedCandidates({ kind: "unknown-words", places }).count,
      0,
    );
  }

  /**
   * Candidates in steady order, each a caller-owned copy. Ending this owner closes active
   * iterators; a new iteration after disposal is refused.
   */
  candidates(): Generator<number[]> {
    this.#values.assertLive();
    const iterator = this.#iterate((active) => {
      if (active) this.#active.add(close);
      else this.#active.delete(close);
    });
    const finish = iterator.return.bind(iterator);
    const close = (): void => {
      finish(undefined);
    };
    return iterator;
  }

  *#iterate(state: (active: boolean) => void): Generator<number[], void, unknown> {
    this.#values.assertLive();
    state(true);
    try {
      const placements = this.#placements;
      for (const [placement, places] of placements.entries()) {
        const candidates = this.checksummed
          ? searchCandidates({ kind: "unknown-words", places })
          : placeCombinations(places);
        // A candidate that an earlier placement gives too is given once.
        const earlier = placements.slice(0, placement);
        for (const codes of candidates)
          if (!earlier.some((other) => other.every((place, at) => place.includes(codes[at] ?? -1))))
            yield [...codes];
      }
    } finally {
      state(false);
    }
  }

  /**
   * Checks every candidate with the host's check, letting its event loop run now and then, and
   * keeps the first maxFound that pass, as EncodedBackups of this form and mode. Returned backups
   * belong to the caller, including stopped partial results. A failed run wipes its kept backups;
   * the codes must stay live until the run ends.
   */
  async run(run: CodesCheckRun): Promise<CodesCheckResult> {
    this.#values.assertLive();
    const maxFound = keptCount(run.maxFound, MAX_FOUND_CODES, "maxFound", 1);
    const found: EncodedBackup[] = [];
    let count = 0;
    let passed = 0;
    const turns = SearchTurns.of(run);
    try {
      for (const codes of this.candidates()) {
        try {
          if (turns.stopped) return { found, passed, count, stopped: true };
          const passes = await run.check(codes);
          this.#values.assertLive();
          // An answer that came after a stop is not counted (AUD-015-API001).
          if (turns.stopped) return { found, passed, count, stopped: true };
          count += 1;
          if (passes) {
            passed += 1;
            if (found.length < maxFound)
              found.push(EncodedBackup.of(codes, this.#format, this.mode));
          }
        } finally {
          codes.fill(0);
        }
        const turn = await turns.due();
        this.#values.assertLive();
        if (turn === "stopped") return { found, passed, count, stopped: true };
        if (turn === "turned") run.onProgress?.({ checked: count, found: passed });
      }
      this.#values.assertLive();
      // The final progress callback can stop the run after its last turn.
      return { found, passed, count, stopped: turns.stopped };
    } catch (error) {
      for (const backup of found) backup.wipe();
      throw error;
    }
  }

  /** Ends the retained code lifetime and closes every active candidate iterator; idempotent. */
  wipe(): void {
    this.#values.wipeAndClose(this.#active);
  }

  /** Ends retained-code access and active candidate iterators through the idempotent wipe(). */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
