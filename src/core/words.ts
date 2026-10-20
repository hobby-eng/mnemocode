import { entropyToMnemonic } from "@scure/bip39";
import { completeHexUnits, fitsPattern, UNICODE_CODE_DIGITS } from "./code-text.js";
import { wordlist as traditionalChineseWordlist } from "@scure/bip39/wordlists/traditional-chinese.js";
import {
  BIP39_DICTIONARY_SIZE,
  BIP39_INDEX_BITS,
  checksumBits,
  lastWordEntropyBits,
  lastWordEntropyValues,
  WORD_NUMBER_DIGITS,
  WORD_NUMBERS_THROUGH,
  isBip39WordCount,
  WORD_COUNTS_TEXT,
  assertWordCount,
} from "./bip39-sizes.js";
import {
  englishTokens,
  englishWordlist,
  ENGLISH_INDEX,
  phraseChecksumValid,
  phraseOfIndexes,
  wordsOfIndexes,
  indexesOfWords,
  fingerprintOfValidPhrase,
} from "./english-words.js";
import { bitsOf, bitsOfIndexes, bitsToBytes, lastWordChecksumBits } from "./bits.js";
import type { MappingRow, MissingWordCandidate } from "./types.js";
import { defined } from "./defined.js";
import { DECIMAL_DIGITS } from "./typed-number.js";
import { ErrorCatalog } from "./error-catalog.js";
import { WordTable, type WordTableLookup, type WordTableFormat } from "./word-table.js";

export {
  WORD_TABLE_FORMATS,
  UNICODE_CODE_HINT,
  type WordTableLookup,
  type WordTableFormat,
} from "./word-table.js";

const ERRORS = new ErrorCatalog("core.words", {
  "words-fail-bip39-checksum-check-each-word-their": () =>
    "These words fail the BIP39 checksum: check each word and their order.",
  "enter-english-bip39-words": (value0: string) => `Enter ${value0} English BIP39 words.`,
  "unknown-english-bip39-word-at-position": (value0: string) =>
    `Unknown English BIP39 word at position ${value0}.`,
  "word-numbers-run-together": () => WORD_NUMBERS_RUN_TOGETHER,
  "indexes-decimal-integers-from": (value0: string) =>
    `Indexes must be decimal integers from ${value0}.`,
  "indexes-use-seedshift-compatible-numbering-from": (value0: string) =>
    `Indexes use Seedshift-compatible numbering from ${value0}.`,
  "unicode-codes-four-hexadecimal-digits-each-separated-by": () =>
    "Unicode codes have four hexadecimal digits each, separated by spaces or joined.",
  "unicode-code-not-bip39-word": (value0: string) => `Unicode code ${value0} is not a BIP39 word.`,
  "mode-exact-old-final-word-stands-no-word": () =>
    "This mode needs the exact old final word: ? stands for no word here.",
});

export { englishWordlist, traditionalChineseWordlist };
// The English words alone belong to english-words.ts; here too for the modules that take both.
export {
  englishTokens,
  ENGLISH_INDEX,
  fingerprintOfValidPhrase,
  phraseChecksumValid,
  phraseOfIndexes,
  wordsOfIndexes,
};

// The sizes of a phrase belong to bip39-sizes.ts, which loads no word list; here too for the
// modules that already take the words.
export { BIP39_DICTIONARY_SIZE, BIP39_INDEX_BITS };

/**
 * The English words of `mnemonic`, in their canonical form; refuses a count of words that BIP39
 * does not have, a word that is not in its list and a failed checksum.
 */
export function validatedEnglishWords(mnemonic: string): string[] {
  const words = canonicalEnglishWords(mnemonic);
  assertWordCount(words.length);
  if (!phraseChecksumValid(words.join(" "))) {
    throw ERRORS.create("words-fail-bip39-checksum-check-each-word-their", []);
  }
  return words;
}

// Lookup keys are four-digit code points, not the visible Chinese characters.
/** The Unicode code of each word, by its index: four hexadecimal digits of its Chinese word. */
export const UNICODE_CODES: readonly string[] = Object.freeze(WordTable.unicodeCodes);
/** The word number, from 0, of each Unicode code of the BIP39 Chinese word list. */
export const UNICODE_INDEX: ReadonlyMap<string, number> = new Map(
  UNICODE_CODES.map((code, index) => [code, index]),
);

/** The word indexes whose Unicode code fits `pattern`, a ? standing for any digit. */
export function unicodeCodesFitting(pattern: string): number[] {
  return UNICODE_CODES.flatMap((code, index) => (fitsPattern(pattern, code) ? [index] : []));
}

/** The Unicode codes of BIP39 indexes, counted from 0. */
export function unicodeCodesOfIndexes(indexes: readonly number[]): string[] {
  return indexes.map((index) => defined(UNICODE_CODES[index]));
}

/**
 * The English words of `mnemonic`, lower case and NFKD as BIP39 takes them; refuses a count of
 * words that BIP39 does not have and a word that is not in its list.
 */
export function canonicalEnglishWords(mnemonic: string): string[] {
  const words = englishTokens(mnemonic);
  if (!isBip39WordCount(words.length)) {
    throw ERRORS.create("enter-english-bip39-words", [`${WORD_COUNTS_TEXT}`]);
  }
  for (const [position, word] of words.entries()) {
    if (!ENGLISH_INDEX.has(word)) {
      throw ERRORS.create("unknown-english-bip39-word-at-position", [`${position + 1}`]);
    }
  }
  return words;
}

/**
 * The word index, counted from 0, of a word number as written in `syntax`, decimal digits by
 * default (DECIMAL_DIGITS), counted from 1 as
 * Seedshift does, for WORD_NUMBER_RANGE; undefined when it is none. Every reader of word numbers
 * (phrases, shares, the word table, marked codes) reads them through it.
 */
export function wordIndexOf(token: string, syntax?: RegExp): number | undefined {
  return WordTable.indexOfNumber(token, syntax);
}

/**
 * Why digits longer than any word number cannot be read: they are word numbers written together,
 * which no reader can tell apart, as 1234 may be 1 234, 12 34 or 1234 itself. Codes of a fixed
 * width, such as Unicode codes and colors, may be run together; word numbers may not.
 */
export const WORD_NUMBERS_RUN_TOGETHER =
  "Word numbers run together cannot be told apart: write them apart, separated by spaces.";

/**
 * Whether `token`, digits and ? for unread ones, is word numbers run together: more digits than
 * the highest word number has, and no word number with leading zeros, such as 00007.
 */
export function runTogetherNumbers(token: string): boolean {
  return (
    /^[0-9?]+$/u.test(token) &&
    token.length > WORD_NUMBER_DIGITS &&
    wordIndexOf(token) === undefined
  );
}

/** wordIndexOf for a word number of a phrase; throws why it is none, its digits or its range. */
export function wordIndexOfNumber(token: string): number {
  if (runTogetherNumbers(token)) throw ERRORS.create("word-numbers-run-together", []);
  if (!DECIMAL_DIGITS.test(token))
    throw ERRORS.create("indexes-decimal-integers-from", [`${WORD_NUMBERS_THROUGH}`]);
  const index = wordIndexOf(token);
  if (index === undefined)
    throw ERRORS.create("indexes-use-seedshift-compatible-numbering-from", [
      `${WORD_NUMBERS_THROUGH}`,
    ]);
  return index;
}

/**
 * The word indexes of Unicode codes, four hexadecimal digits each, written apart or joined: the
 * one reader of codes for phrases and shares. A refusal names the place, never the code.
 */
export function unicodeIndexesOf(text: string): number[] {
  const codes = completeHexUnits(text, UNICODE_CODE_DIGITS);
  if (codes === undefined)
    throw ERRORS.create("unicode-codes-four-hexadecimal-digits-each-separated-by", []);
  return codes.map((code, place) => {
    const index = WordTable.indexOfUnicode(code);
    if (index === undefined) throw ERRORS.create("unicode-code-not-bip39-word", [`${place + 1}`]);
    return index;
  });
}

// The count rule belongs to bip39-sizes.ts, which loads no word list; here too for its old callers.
export { assertWordCount };

/**
 * The Unicode code of `symbol`, one Unicode scalar value, as four or more hexadecimal digits in
 * capitals.
 */
export function unicodeHex(symbol: string): string {
  return WordTable.unicodeHex(symbol);
}

/** The row of the word table for word number `index`, from 1 through 2,048. */
export function mappingRow(index: number): MappingRow {
  return WordTable.row(index);
}

/** Every row of the word table, in the order of the word numbers. */
export function allMappingRows(): MappingRow[] {
  return WordTable.rows();
}

/** Compatibility lookup; new hosts import WordTable from core/word-table. */
export function wordTableRow(lookup: WordTableLookup, text: string): MappingRow {
  return WordTable.lookup(lookup, text);
}

/** Compatibility text export; new hosts import WordTable from core/word-table. */
export function wordTableText(format?: WordTableFormat): string {
  return WordTable.text(format);
}

/**
 * The valid last words of `words`, whose last word is missing, in the order of the word list,
 * found without validating 2,048 phrases: the last word holds 11 − checksum bits of entropy, and
 * BIP39 gives each of their values one checksum (entropyToMnemonic). This keeps the startup
 * self-test, which recovers last words, quick. Forgotten words elsewhere are the word search's
 * (WordCandidateSearch, candidates.ts).
 */
function finalWordCandidates(words: readonly string[]): MissingWordCandidate[] {
  const prefix = indexesOfWords(words.slice(0, -1));
  return validLastWordIndexes(prefix).map((index) => {
    const word = defined(englishWordlist[index]);
    return {
      position: words.length,
      word,
      wordIndex: index + 1,
      mnemonic: [...words.slice(0, -1), word].join(" "),
      checksumBits: lastWordChecksumBits(index, words.length),
    };
  });
}

/**
 * The word numbers, counted from 0 and in their order, that end a phrase of `prefix` (every word
 * but the last, as BIP39 indexes) with a valid checksum: one for each value of the entropy bits
 * that the last word holds, 2^(11 − checksum bits) of them, found from the entropy rather than by
 * validating 2,048 phrases.
 */
export function validLastWordIndexes(prefix: readonly number[]): number[] {
  const wordCount = prefix.length + 1;
  const tailBits = lastWordEntropyBits(wordCount);
  const knownBits = bitsOfIndexes(prefix);
  const indexes: number[] = [];
  for (let tail = 0; tail < lastWordEntropyValues(wordCount); tail += 1) {
    const entropy = bitsToBytes(knownBits + bitsOf(tail, tailBits));
    const mnemonic = entropyToMnemonic(entropy, englishWordlist);
    // One of the candidates is the wallet's.
    entropy.fill(0);
    indexes.push(defined(ENGLISH_INDEX.get(mnemonic.slice(mnemonic.lastIndexOf(" ") + 1))));
  }
  return indexes;
}

/**
 * Enumerates checksum-valid replacement containers for an old exact-legacy
 * shifted phrase. The supplied final word may have an invalid BIP39 checksum;
 * it is retained only to identify the one replacement that preserves its
 * entropy-bearing high bits.
 */
export function recoverLegacyValidLastWords(value: string): MissingWordCandidate[] {
  // A ? typed out of habit would otherwise be refused as a word that is no BIP39 word.
  if (englishTokens(value).includes("?"))
    throw ERRORS.create("mode-exact-old-final-word-stands-no-word", []);
  const words = canonicalEnglishWords(value);
  const finalPosition = words.length - 1;
  const checksumLength = checksumBits(words.length);
  const finalIndex = defined(ENGLISH_INDEX.get(defined(words[finalPosition])));
  const legacyEntropyTail = finalIndex >> checksumLength;
  const incomplete = [...words];
  incomplete[finalPosition] = "?";
  return finalWordCandidates(incomplete).map((candidate) => ({
    ...candidate,
    preservesLegacyEntropy: (candidate.wordIndex - 1) >> checksumLength === legacyEntropyTail,
  }));
}
