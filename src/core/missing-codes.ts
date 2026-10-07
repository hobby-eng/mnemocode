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
  EVERY_WORD,
  MAX_SEARCH_COMBINATIONS,
  searchCandidates,
  wordPlaceOf,
  type WordPlace,
} from "./candidates.js";
import { COLOR_UNICODE_BASE, COLOR_UNICODE_WIDTH, wordPositionPatterns } from "./colors.js";
import { EncodedBackup, type EncodedFormat, type EncodedMode } from "./encoded-backup.js";
import { Masking } from "./masking.js";
import { nextTask, TURN_MILLISECONDS } from "./search-turns.js";
import {
  BIP39_DICTIONARY_SIZE,
  traditionalChineseWordlist,
  unicodeHex,
  UNICODE_INDEX,
  WORD_COUNT_SET,
} from "./words.js";

/** Codes found that a search keeps by default: more than any person compares by eye. */
export const MAX_FOUND_CODES = 100;
/** The forms whose codes may be marked, in the order that detection tries them. */
const MARKED_FORMATS: readonly EncodedFormat[] = [
  "english",
  "indexes",
  "unicode",
  "colors",
  "colors-unicode",
];
/** The digits of a word number, 1 to 2048, and of a Unicode code. */
const MAX_NUMBER_DIGITS = 4;
const CODE_DIGITS = 4;
/** Two four-digit Private Use codes make one color in Color Unicode (core/colors.ts). */
const CODES_PER_COLOR = 2;
const REDACTED = "[MissingCodes: redacted]";
const UNICODE_CODES = traditionalChineseWordlist.map(unicodeHex);

/** Whether `written` fits `pattern`, of the same length, a ? in the pattern fitting any symbol. */
function fits(pattern: string, written: string): boolean {
  if (pattern.length !== written.length) return false;
  for (let index = 0; index < pattern.length; index += 1)
    if (pattern[index] !== "?" && pattern[index] !== written[index]) return false;
  return true;
}

/** The words whose 1-based number fits `pattern`, as typed or as four digits of a color. */
function wordsOfNumber(pattern: string, padded: boolean): WordPlace {
  const words: number[] = [];
  for (let index = 0; index < BIP39_DICTIONARY_SIZE; index += 1) {
    const number = String(index + 1);
    if (fits(pattern, padded ? number.padStart(MAX_NUMBER_DIGITS, "0") : number)) words.push(index);
  }
  return words;
}

/** The words that one word number allows: a number, a lone ?, or a number with ? for a digit. */
function numberPlace(written: string, place: number): WordPlace {
  if (written === "?") return EVERY_WORD;
  if (/^[0-9?]{1,4}$/u.test(written)) {
    const words = wordsOfNumber(written, false);
    if (words.length > 0) return words;
  }
  throw new Error(`Word number ${place} is no number from 1 through 2048.`);
}

/** The words that one Unicode code allows: a code, a lone ?, or a code with ? for a digit. */
function codePlace(written: string, place: number): WordPlace {
  if (written === "?") return EVERY_WORD;
  if (written.length === CODE_DIGITS && /^[0-9A-F?]+$/u.test(written)) {
    const words = UNICODE_CODES.flatMap((code, index) => (fits(written, code) ? [index] : []));
    if (words.length > 0) return words;
  }
  throw new Error(`Code ${place} is no Unicode code of the word list.`);
}

/** Text split at spaces, commas and semicolons, upper case. */
function tokensOf(text: string, extra = ""): string[] {
  return text
    .toUpperCase()
    .split(new RegExp(`[\\s,;${extra}]+`, "u"))
    .filter(Boolean);
}

/**
 * Units of `width` hexadecimal digits written apart, or run together where each ? stands for a
 * whole unit; undefined when the text is neither.
 */
function hexUnits(text: string, width: number, extra = ""): string[] | undefined {
  const tokens = tokensOf(text, extra);
  const unit = new RegExp(`^(?:\\?|[0-9A-F?]{${width}})$`, "u");
  if (tokens.length > 1 && tokens.every((token) => unit.test(token))) return tokens;
  const compact = tokens.join("");
  const units = compact.match(new RegExp(`[0-9A-F]{${width}}|\\?`, "gu"));
  return units !== null && units.join("") === compact ? units : undefined;
}

/** The colors of Color Unicode codes, each undefined where one of its two codes cannot be read. */
function unicodeColors(text: string): (string | undefined)[] {
  // The codes may also be the Private Use symbols themselves.
  const symbols = Array.from(text.replace(/\s+/gu, ""));
  const points =
    symbols.length > 0 && symbols.every((symbol) => symbol === "?" || /^[-]$/u.test(symbol))
      ? symbols.map((symbol) =>
          symbol === "?" ? "?" : symbol.codePointAt(0)!.toString(16).toUpperCase(),
        )
      : hexUnits(text, CODE_DIGITS);
  if (points === undefined || points.length % CODES_PER_COLOR !== 0)
    throw new Error("Color Unicode needs two four-digit codes for every color.");
  return Array.from({ length: points.length / CODES_PER_COLOR }, (_, color) => {
    const pair = points.slice(color * CODES_PER_COLOR, (color + 1) * CODES_PER_COLOR);
    // A code with ? among its digits leaves its color unknown: its digits are no digits of it.
    if (pair.some((code) => code.includes("?"))) return undefined;
    const [high, low] = pair.map((code) => Number.parseInt(code, 16) - COLOR_UNICODE_BASE);
    if ([high!, low!].some((part) => part < 0 || part >= COLOR_UNICODE_WIDTH))
      throw new Error("Color Unicode uses only MnemoCode Private Use Area code points.");
    return `#${(high! * COLOR_UNICODE_WIDTH + low!).toString(16).toUpperCase().padStart(6, "0")}`;
  });
}

/** The places of colors, each word a pattern of its four position digits (wordPositionPatterns). */
function colorPlaces(colors: readonly (string | undefined)[]): WordPlace[] {
  return wordPositionPatterns(colors).map((pattern, place) => {
    const words = wordsOfNumber(pattern, true);
    if (words.length === 0) throw new Error(`The colors give no word at place ${place + 1}.`);
    return words;
  });
}

/** The places of `text` read in `format`, each with the codes it may hold. */
function placesOf(text: string, format: EncodedFormat): WordPlace[] {
  switch (format) {
    case "english":
      return text
        .normalize("NFKD")
        .toLowerCase()
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .map((word, index) => wordPlaceOf(word, index + 1));
    case "indexes":
      return tokensOf(text).map((token, index) => numberPlace(token, index + 1));
    case "unicode": {
      const codes = hexUnits(text, CODE_DIGITS);
      if (codes === undefined)
        throw new Error("Unicode codes have four hexadecimal digits each, or ? where unread.");
      return codes.map((code, index) => codePlace(code, index + 1));
    }
    case "colors": {
      const colors = hexUnits(text, 6, "#");
      if (colors === undefined || colors.some((color) => color !== "?" && color.includes("?")))
        throw new Error("Mark a color that cannot be read with one ? in place of the whole color.");
      return colorPlaces(colors.map((color) => (color === "?" ? undefined : `#${color}`)));
    }
    case "colors-unicode":
      return colorPlaces(unicodeColors(text));
    default:
      throw new Error("These codes cannot be marked in this form.");
  }
}

/** How a search for missing codes runs, with the host's services. */
export interface MissingCodesRun {
  /** Whether the codes, BIP39 indexes from 0 to 2047, are the right ones; may answer later. */
  readonly check: (codes: readonly number[]) => boolean | Promise<boolean>;
  /** How many codes that passed are kept; MAX_FOUND_CODES by default. */
  readonly maxFound?: number | undefined;
  /** Called at each turn with the candidates checked and those that passed. */
  readonly onProgress?:
    ((progress: { readonly count: number; readonly found: number }) => void) | undefined;
  /** Stops the search at its next turn; the signal's reason is thrown. */
  readonly signal?: AbortSignal | undefined;
  /** How the search lets the host's event loop run; a zero timeout by default. */
  readonly turn?: (() => Promise<void>) | undefined;
}

/** What a search for missing codes found. */
export interface MissingCodesResult {
  /** The codes that passed the check, in the order searched, at most maxFound of them. */
  readonly found: readonly EncodedBackup[];
  /** How many passed, all of them. */
  readonly passed: number;
  /** How many candidates were checked. */
  readonly count: number;
}

/**
 * Codes with marks, read in one form and taken with one mode, and the search for them. A class,
 * because the places are read and checked once, and then tell their size, are searched and give
 * EncodedBackups; toString, toJSON and Node's inspect show none of the codes.
 */
export class MissingCodes {
  readonly #places: readonly WordPlace[];
  readonly #format: EncodedFormat;
  readonly #mode: EncodedMode;
  readonly #combinations: number;

  private constructor(places: readonly WordPlace[], format: EncodedFormat, mode: EncodedMode) {
    if (!WORD_COUNT_SET.has(places.length))
      throw new Error(`These are ${places.length} codes; a seed phrase has 12, 15, 18, 21 or 24.`);
    if (places.every((place) => place.length === 1))
      throw new Error("No code is marked: mark each code that cannot be read with ?.");
    const combinations = places.reduce((all, place) => all * place.length, 1);
    if (combinations > MAX_SEARCH_COMBINATIONS)
      throw new Error(
        `The marks leave ${combinations.toLocaleString("en-US")} combinations; at most ${MAX_SEARCH_COMBINATIONS.toLocaleString("en-US")} can be searched. Read a few letters or digits of the codes, or mark fewer.`,
      );
    this.#places = Object.freeze(places.map((place) => Object.freeze([...place])));
    this.#format = format;
    this.#mode = mode;
    this.#combinations = combinations;
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
    return MARKED_FORMATS.filter((format) => {
      try {
        return WORD_COUNT_SET.has(placesOf(text, format).length);
      } catch {
        return false;
      }
    });
  }

  /** Reads the marked codes of `text` in `format`, taken with `mode`; throws why they cannot be. */
  static read(text: string, format: EncodedFormat, mode: EncodedMode): MissingCodes {
    return new MissingCodes(placesOf(text, format), format, mode);
  }

  /** The same codes taken with another mode. */
  withMode(mode: EncodedMode): MissingCodes {
    return new MissingCodes(this.#places, this.#format, mode);
  }

  get format(): EncodedFormat {
    return this.#format;
  }

  get mode(): EncodedMode {
    return this.#mode;
  }

  get wordCount(): number {
    return this.#places.length;
  }

  /** The places, counted from 1, whose code is not known. */
  get missingPlaces(): number[] {
    return this.#places.flatMap((place, index) => (place.length > 1 ? [index + 1] : []));
  }

  /** The combinations of codes that the marks leave. */
  get combinations(): number {
    return this.#combinations;
  }

  /** Whether the codes keep a BIP39 checksum of their own, which the search then holds them to. */
  get checksummed(): boolean {
    const masking = Masking.of(this.#mode);
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
    const checksumBits = this.wordCount / 3;
    return Math.max(1, Math.round(this.#combinations / 2 ** checksumBits));
  }

  /** The candidates, as BIP39 indexes, in a steady order; each array is a fresh copy. */
  *candidates(): Generator<number[]> {
    if (this.checksummed) {
      for (const words of searchCandidates({ kind: "unknown-words", places: this.#places }))
        yield [...words];
      return;
    }
    const chosen = this.#places.map(() => 0);
    for (;;) {
      yield chosen.map((choice, place) => this.#places[place]![choice]!);
      let place = this.#places.length - 1;
      while (place >= 0 && chosen[place] === this.#places[place]!.length - 1) {
        chosen[place] = 0;
        place -= 1;
      }
      if (place < 0) return;
      chosen[place] = chosen[place]! + 1;
    }
  }

  /**
   * Checks every candidate with the host's check, letting its event loop run now and then, and
   * keeps the first maxFound that pass, as EncodedBackups of this form and mode.
   */
  async run(run: MissingCodesRun): Promise<MissingCodesResult> {
    const maxFound = run.maxFound ?? MAX_FOUND_CODES;
    if (!Number.isSafeInteger(maxFound) || maxFound < 1)
      throw new RangeError("maxFound must be a whole number of 1 or more.");
    const turn = run.turn ?? nextTask;
    const found: EncodedBackup[] = [];
    let count = 0;
    let passed = 0;
    run.signal?.throwIfAborted();
    let lastTurn = Date.now();
    for (const codes of this.candidates()) {
      count += 1;
      if (await run.check(codes)) {
        passed += 1;
        if (found.length < maxFound) found.push(EncodedBackup.of(codes, this.#format, this.#mode));
      }
      if (Date.now() - lastTurn >= TURN_MILLISECONDS) {
        await turn();
        run.signal?.throwIfAborted();
        run.onProgress?.({ count, found: passed });
        lastTurn = Date.now();
      }
    }
    return { found, passed, count };
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
