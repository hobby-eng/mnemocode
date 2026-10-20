/** Shared contracts; importing types never loads renderers or platform adapters. */

import { isOneOf } from "./one-of.js";

// The phrase lengths belong to the sizes of BIP39, which load no word list.
export { BIP39_WORD_COUNTS, type Bip39WordCount } from "./bip39-sizes.js";

/**
 * The forms that codes are written in. Their order is the one the command line numbers them in
 * (--format 1 to 5), the menu offers them in and detection tries them in.
 */
export const ENCODED_FORMATS = Object.freeze([
  "english",
  "indexes",
  "unicode",
  "colors-unicode",
  "colors",
] as const);
/** A form of codes that a seed phrase is written in (ENCODED_FORMATS). */
export type EncodedFormat = (typeof ENCODED_FORMATS)[number];

/** Whether `value` names a form of codes; a record, an option or a host may pass anything. */
export function isEncodedFormat(value: unknown): value is EncodedFormat {
  return isOneOf(ENCODED_FORMATS, value);
}
/** What encode writes: codes in one of their forms, or JSON with every form and the shifts. */
export type OutputFormat = EncodedFormat | "json";

/**
 * The transformation modes by the names that records, the command line and the menu use, in the
 * order the menu and the help name them. core/masking.ts gives each its rules; the names are here
 * so that a record is read without loading them.
 */
export const MASKING_MODES = Object.freeze([
  "direct",
  "seedshift",
  "seedshift-legacy",
  "seedshift-legacy-valid",
] as const);
/** A transformation mode: no Seedshift, or one of the Seedshifts (MASKING_MODES). */
export type MaskingMode = (typeof MASKING_MODES)[number];

/** Whether `value` names a transformation mode; a record, an option or a host may pass anything. */
export function isMaskingMode(value: unknown): value is MaskingMode {
  return isOneOf(MASKING_MODES, value);
}

/** A date of the calendar, as Seedshift takes it: year, month from 1 and day from 1. */
export interface DateShiftDate {
  /** The year, from 1 through 9999 (DATE_PARTS.year). */
  readonly year: number;
  /** The month, counted from 1: 1 through 12. */
  readonly month: number;
  /** The day of the month, counted from 1, no later than the last day of that month and year. */
  readonly day: number;
}

/**
 * What encoding a phrase gives: the phrase, its shifted word numbers with their English words and
 * Unicode codes, the dates and the shift of each word.
 */
export interface EncodedResult {
  /** The phrase encoded: its English words, in lower case, joined by single spaces. */
  readonly sourceMnemonic: string;
  /** The BIP39 index of each code, from 0 through 2047, in word order: what every form writes. */
  readonly shiftedIndexes: readonly number[];
  /** The English word of each shifted index, in the same order. */
  readonly shiftedEnglish: readonly string[];
  /** The Unicode code of each shifted index, four uppercase hexadecimal digits, in that order. */
  readonly unicodeCodePoints: readonly string[];
  /** The dates of the Seedshift in calendar order, earliest first; none without Seedshift. */
  readonly dates: readonly DateShiftDate[];
  /**
   * The shift of each word, in word order: the years, months and days of the dates in turn; each
   * 0 without Seedshift.
   */
  readonly shifts: readonly number[];
}

/**
 * What decoding codes gives: the phrase recovered, its word numbers, the dates, the shift of each
 * word and whether the phrase's checksum is valid.
 */
export interface DecodedResult {
  /** The phrase recovered: its English words, in lower case, joined by single spaces. */
  readonly recoveredMnemonic: string;
  /** The BIP39 index of each word of it, from 0 through 2047, in word order. */
  readonly recoveredIndexes: readonly number[];
  /** The dates it was decoded with, in calendar order, earliest first; none without Seedshift. */
  readonly dates: readonly DateShiftDate[];
  /** The shift undone from each word, in word order; each 0 without Seedshift. */
  readonly shifts: readonly number[];
  /**
   * Whether the recovered phrase has a valid BIP39 checksum. False is a result, not a refusal: a
   * host says so, and a search of the Original Seedshift filters by it.
   */
  readonly checksumValid: boolean;
}

/** One row of the word table: a word number, its English word and its Unicode code. */
export interface MappingRow {
  /** The word number, counted from 1: 1 through 2048, one more than the BIP39 index. */
  readonly index: number;
  /** The English BIP39 word of that number, in lower case. */
  readonly english: string;
  /** The code point of its Traditional Chinese BIP39 word: four uppercase hexadecimal digits. */
  readonly unicodeHex: string;
}

/**
 * A candidate for a forgotten word: its place, the word and its number, the whole phrase with it
 * and its checksum bits, and, for a last word of the Original Seedshift, whether it keeps the
 * entropy of the legacy encoding (preservesLegacyEntropy).
 */
export interface MissingWordCandidate {
  /** The place of the word in the phrase, counted from 1: the phrase's length for a last word. */
  readonly position: number;
  /** The English BIP39 word in that place, in lower case. */
  readonly word: string;
  /** The word number of `word`, counted from 1: 1 through 2048. */
  readonly wordIndex: number;
  /** The whole phrase with `word` in its place, English words joined by single spaces. */
  readonly mnemonic: string;
  /** The checksum bits that the last word ends with, as 0 and 1 characters: 4 to 8 of them. */
  readonly checksumBits: string;
  /**
   * For a last word of the Original Seedshift (recoverLegacyValidLastWords): whether it keeps the
   * entropy bits of the last word that was typed. Absent elsewhere.
   */
  readonly preservesLegacyEntropy?: boolean;
}

/**
 * The dates that a pattern stands for: its key, the pattern written in one canonical way, and the
 * years, months and days that its digits allow.
 */
export interface DatePattern {
  /**
   * The pattern in one canonical way, year first with each part's values sorted, such as
   * 2025-??-05|15: patterns with one key must allow the same dates (KEY_CONFLICT).
   */
  readonly key: string;
  /** The years that it allows, from 1 through 9999, each once, in ascending order. */
  readonly years: readonly number[];
  /** The months that it allows, counted from 1, each once, in ascending order. */
  readonly months: readonly number[];
  /** The days of the month that it allows, counted from 1, each once, in ascending order. */
  readonly days: readonly number[];
}

/**
 * How a form prints on cards: coloured cards, the one kind that installed designs draw, which print
 * its colors or its codes. A form without a kind has no cards (EncodedForm.cardKind). A new kind
 * comes with its first approved design.
 */
export type CardKind = "colors";
