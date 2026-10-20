import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { phraseChecksumValid, indexesOfWords } from "./english-words.js";
import {
  BIP39_DICTIONARY_SIZE,
  BIP39_INDEX_BITS,
  englishWordlist,
  phraseOfIndexes,
  validatedEnglishWords,
  validLastWordIndexes,
} from "./words.js";
import {
  lastWordEntropyBits,
  lastWordEntropyValues,
  assertPhraseIndexes,
  assertWordCount,
} from "./bip39-sizes.js";
import { bitsOf, bitsOfIndexes, modulo, bytesToBits, bitsToBytes, wipedAfter } from "./bits.js";
import { entropyOfWords } from "./word-candidate.js";
import { sortDates, deriveShifts } from "./dates.js";
import { resultFromIndexes, parseInput } from "./representations.js";
import type { EncodedResult, DecodedResult, DateShiftDate, EncodedFormat } from "./types.js";
import { textPieces } from "./pieces.js";
import { defined } from "./defined.js";

/** BIP39 words for owned entropy bits; the temporary byte buffer is cleared afterwards. */
function mnemonicFromEntropyBits(bits: string): string {
  const entropy = bitsToBytes(bits);
  try {
    return entropyToMnemonic(entropy, englishWordlist);
  } finally {
    entropy.fill(0);
  }
}

/** Entropy bits of a checksum-valid phrase; the temporary byte buffer is cleared afterwards. */
function entropyBitsOf(mnemonic: string): string {
  const entropy = mnemonicToEntropy(mnemonic, englishWordlist);
  try {
    return bytesToBits(entropy);
  } finally {
    entropy.fill(0);
  }
}

/** Masks (`sign` 1) or unmasks (−1); the shift is added or taken away. */
type Direction = 1 | -1;

/**
 * The Original Seedshift on word numbers: each index moved by its shift modulo the 2,048 words, in
 * `direction`. Encode, decode and the valid-last-word search all move them through it.
 */
function shiftedIndexes(
  indexes: readonly number[],
  shifts: readonly number[],
  direction: Direction,
): number[] {
  return indexes.map((index, position) =>
    modulo(index + direction * defined(shifts[position]), BIP39_DICTIONARY_SIZE),
  );
}

/**
 * MnemoCode Seedshift on the entropy bits of a phrase of `wordCount` words: each 11-bit chunk moved
 * by its shift modulo 2,048, and the bits that the last word keeps beside the checksum modulo
 * their own range, in `direction`. Encode and decode both move them through it.
 */
function shiftedEntropyBits(
  entropy: string,
  shifts: readonly number[],
  wordCount: number,
  direction: Direction,
): string {
  const tailWidth = lastWordEntropyBits(wordCount);
  // Every word but the last, whose bits the tail below carries.
  const chunks = textPieces(
    entropy.slice(0, (wordCount - 1) * BIP39_INDEX_BITS),
    BIP39_INDEX_BITS,
    (bits) => Number.parseInt(bits, 2),
  );
  const tail = Number.parseInt(entropy.slice(-tailWidth), 2);
  const movedTail = modulo(
    tail + direction * defined(shifts.at(-1)),
    lastWordEntropyValues(wordCount),
  );
  return bitsOfIndexes(shiftedIndexes(chunks, shifts, direction)) + bitsOf(movedTail, tailWidth);
}

/** Dates sorted in calendar order, and the shifts that they give a phrase. */
interface DatedShifts {
  /** The dates, earliest first. */
  readonly sortedDates: DateShiftDate[];
  /** The shift of each word, in word order. */
  readonly shifts: number[];
}

/** The dates sorted, and the shifts that they give a phrase of `wordCount` words. */
function datedShifts(dates: readonly DateShiftDate[], wordCount: number): DatedShifts {
  // The callers checked the count already; this narrows it, and costs nothing.
  assertWordCount(wordCount);
  const sortedDates = sortDates(dates);
  return { sortedDates, shifts: deriveShifts(sortedDates, wordCount) };
}

/** The words of a seed phrase to be masked, checked, with its dates sorted and their shifts. */
function datedPhrase(mnemonic: string, dates: readonly DateShiftDate[]) {
  const words = validatedEnglishWords(mnemonic);
  return { words, ...datedShifts(dates, words.length) };
}

/** The shifts of a phrase written without dates: none. */
function noShifts(wordCount: number): number[] {
  return Array.from({ length: wordCount }, () => 0);
}

/**
 * The MnemoCode Seedshift record of `mnemonic` under `dates`, the shifted word numbers of a phrase
 * that keeps a valid checksum. It shifts the entropy chunks, not the checksum bits: the final chunk
 * is shorter because BIP39 appends its checksum to the last word, and entropyToMnemonic recomputes
 * it. Modular addition is reversible even when several dates produce the same shifts. Refuses a
 * phrase that validatedEnglishWords refuses (core.words.enter-english-bip39-words,
 * unknown-english-bip39-word-at-position, words-fail-bip39-checksum-check-each-word-their) and
 * dates that deriveShifts refuses (core.dates.no-date, derive-shifts-refused and the calendar
 * checks it names).
 */
export function encodeMnemonic(mnemonic: string, dates: readonly DateShiftDate[]): EncodedResult {
  const { words, sortedDates, shifts } = datedPhrase(mnemonic, dates);
  const shiftedEntropy = shiftedEntropyBits(
    entropyBitsOf(words.join(" ")),
    shifts,
    words.length,
    1,
  );
  const shiftedWords = mnemonicFromEntropyBits(shiftedEntropy).split(" ");
  return resultFromIndexes(words, indexesOfWords(shiftedWords), sortedDates, shifts);
}

/**
 * The Original Seedshift record of `mnemonic` under `dates`, each word number moved by its shift
 * modulo 2,048, retained for compatibility with existing records. Refuses what encodeMnemonic
 * refuses: a phrase that validatedEnglishWords refuses (core.words.enter-english-bip39-words,
 * unknown-english-bip39-word-at-position, words-fail-bip39-checksum-check-each-word-their) and
 * dates that deriveShifts refuses (core.dates.no-date, derive-shifts-refused and the calendar
 * checks it names).
 */
export function encodeMnemonicLegacy(
  mnemonic: string,
  dates: readonly DateShiftDate[],
): EncodedResult {
  const { words, sortedDates, shifts } = datedPhrase(mnemonic, dates);
  return resultFromIndexes(
    words,
    shiftedIndexes(indexesOfWords(words), shifts, 1),
    sortedDates,
    shifts,
  );
}

/**
 * Replaces only the derived checksum bits of a legacy result, preserving its visible entropy
 * prefix. Refuses shifted indexes that are no phrase, as entropyOfWords does: their count
 * (core.bip39-sizes.expected-word-indexes), then an index above 2047
 * (core.bip39-sizes.assert-word-indexes-refused), which would shift every later bit of the entropy.
 */
export function legacyChecksumValidResult(result: EncodedResult): EncodedResult {
  const checksumValid = wipedAfter(entropyOfWords(result.shiftedIndexes), (entropy) =>
    entropyToMnemonic(entropy, englishWordlist),
  );
  return resultFromIndexes(
    result.sourceMnemonic.split(" "),
    indexesOfWords(checksumValid.split(" ")),
    result.dates,
    result.shifts,
  );
}

/**
 * The record of `mnemonic` without any date shift: its own word numbers, words and Unicode codes.
 * Refuses a phrase that validatedEnglishWords refuses (core.words.enter-english-bip39-words,
 * unknown-english-bip39-word-at-position, words-fail-bip39-checksum-check-each-word-their).
 */
export function representMnemonic(mnemonic: string): EncodedResult {
  const words = validatedEnglishWords(mnemonic);
  return resultFromIndexes(words, indexesOfWords(words), [], noShifts(words.length));
}

/**
 * The dates of a record of `indexes`, checked as every decoder checks them, sorted, and the shifts
 * that they give: the indexes are a phrase's count of whole numbers from 0 through 2047.
 */
function datedRecord(indexes: readonly number[], dates: readonly DateShiftDate[]): DatedShifts {
  assertPhraseIndexes(indexes);
  return datedShifts(dates, indexes.length);
}

/**
 * A decoded result of `recoveredIndexes`, with whether its phrase has a valid checksum: computed
 * unless the caller knows it (`checksumValid`).
 */
function decodedResult(
  recoveredIndexes: number[],
  dates: DateShiftDate[],
  shifts: number[],
  checksumValid?: boolean,
): DecodedResult {
  const recoveredMnemonic = phraseOfIndexes(recoveredIndexes);
  return {
    recoveredMnemonic,
    recoveredIndexes,
    dates,
    shifts,
    checksumValid: checksumValid ?? phraseChecksumValid(recoveredMnemonic),
  };
}

/**
 * The phrase that encodeMnemonic masked into `indexes` under `dates`: the shifts are subtracted in
 * the same per-chunk moduli. The codes must keep the BIP39 checksum, which Masking checks before
 * (Masking.assertCodes); call it through Masking. Refuses indexes that are no phrase
 * (assertPhraseIndexes: core.bip39-sizes.expected-word-indexes, assert-word-indexes-refused) and
 * dates that deriveShifts refuses (core.dates.no-date, derive-shifts-refused and the calendar
 * checks it names).
 */
export function undoSeedshift(
  indexes: readonly number[],
  dates: readonly DateShiftDate[],
): DecodedResult {
  const { sortedDates, shifts } = datedRecord(indexes, dates);
  const containerMnemonic = phraseOfIndexes(indexes);
  const recoveredMnemonic = mnemonicFromEntropyBits(
    shiftedEntropyBits(entropyBitsOf(containerMnemonic), shifts, indexes.length, -1),
  );
  return decodedResult(indexesOfWords(recoveredMnemonic.split(" ")), sortedDates, shifts);
}

/**
 * The phrase of an Original Seedshift record, `indexes` under `dates`, whose shifted words need not
 * have a valid checksum; the result says whether the phrase has one. Refuses indexes that are no
 * phrase (assertPhraseIndexes: core.bip39-sizes.expected-word-indexes,
 * assert-word-indexes-refused) and dates that deriveShifts refuses (core.dates.no-date,
 * derive-shifts-refused and the calendar checks it names).
 */
export function decodeIndexesLegacy(
  indexes: readonly number[],
  dates: readonly DateShiftDate[],
): DecodedResult {
  const { sortedDates, shifts } = datedRecord(indexes, dates);
  return decodedResult(shiftedIndexes(indexes, shifts, -1), sortedDates, shifts);
}

/**
 * Recovers every possible original mnemonic after a legacy shifted final word was replaced by a
 * checksum-valid decoy word. The replacement discards information, so independent evidence is
 * needed to select a candidate. The codes must keep the BIP39 checksum, which Masking checks before
 * (Masking.assertCodes); call it through Masking. Refuses indexes that are no phrase
 * (assertPhraseIndexes: core.bip39-sizes.expected-word-indexes, assert-word-indexes-refused) and
 * dates that deriveShifts refuses (core.dates.no-date, derive-shifts-refused and the calendar
 * checks it names).
 */
export function undoLegacyValid(
  indexes: readonly number[],
  dates: readonly DateShiftDate[],
): DecodedResult[] {
  const { sortedDates, shifts } = datedRecord(indexes, dates);
  const recoveredPrefix = shiftedIndexes(indexes.slice(0, -1), shifts, -1);
  // Historical records may replace the entire last word. Do not narrow this
  // search to our own checksum-only replacement without an explicit format version: every last
  // word with a valid checksum is a candidate, in the order of the word list.
  // A deliberate fast path: every last word that validLastWordIndexes gives has a valid checksum
  // by its construction, and a date search decodes many of them for every date combination.
  return validLastWordIndexes(recoveredPrefix).map((lastIndex) =>
    decodedResult([...recoveredPrefix, lastIndex], sortedDates, shifts, true),
  );
}

/**
 * The Original Seedshift undone from codes written in `format`. A compatibility entry kept for
 * existing callers; new code uses EncodedBackup.read(text, format, mode). Refuses what parseInput
 * refuses (a `format` that names no form, core.encoded-form.unsupported-encoded-format, and codes
 * that do not read in it), then what decodeIndexesLegacy refuses
 * (core.bip39-sizes.expected-word-indexes, assert-word-indexes-refused, core.dates.no-date,
 * derive-shifts-refused and the calendar checks deriveShifts names).
 */
export function decodeInputLegacy(
  value: string,
  format: EncodedFormat,
  dates: readonly DateShiftDate[],
): DecodedResult {
  return decodeIndexesLegacy(parseInput(value, format), dates);
}

/**
 * The mnemonic of indexes that were written without date shifting: the words themselves. Refuses
 * indexes that are no phrase (assertPhraseIndexes: core.bip39-sizes.expected-word-indexes,
 * assert-word-indexes-refused).
 */
export function decodeIndexesDirect(indexes: readonly number[]): DecodedResult {
  assertPhraseIndexes(indexes);
  return decodedResult([...indexes], [], noShifts(indexes.length));
}

/**
 * Recovers a mnemonic from a direct representation that was created without date shifting. A
 * compatibility entry kept for existing callers; new code uses EncodedBackup.read(text, format,
 * "direct"). Refuses what parseInput refuses (a `format` that names no form,
 * core.encoded-form.unsupported-encoded-format, and codes that do not read in it), then indexes
 * that are no phrase (core.bip39-sizes.expected-word-indexes, assert-word-indexes-refused).
 */
export function decodeInputDirect(value: string, format: EncodedFormat): DecodedResult {
  return decodeIndexesDirect(parseInput(value, format));
}
