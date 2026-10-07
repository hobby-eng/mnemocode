import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as traditionalChineseWordlist } from "@scure/bip39/wordlists/traditional-chinese.js";
import {
  BIP39_WORD_COUNTS,
  type Bip39WordCount,
  type MappingRow,
  type MissingWordCandidate,
} from "./types.js";
export { englishWordlist, traditionalChineseWordlist };

export const BIP39_INDEX_BITS = 11;
export const BIP39_DICTIONARY_SIZE = 2 ** BIP39_INDEX_BITS;

export function validatedEnglishWords(mnemonic: string): string[] {
  const words = canonicalEnglishWords(mnemonic);
  assertWordCount(words.length);
  if (!validateMnemonic(words.join(" "), englishWordlist)) {
    throw new Error(
      "The source mnemonic has an invalid BIP39 checksum. Check the words and their order before encoding.",
    );
  }
  return words;
}

export const WORD_COUNT_SET = new Set<number>(BIP39_WORD_COUNTS);

export const ENGLISH_INDEX = new Map(englishWordlist.map((word, index) => [word, index]));

// Lookup keys are four-digit code points, not the visible Chinese characters.
export const UNICODE_INDEX = new Map(
  traditionalChineseWordlist.map((word, index) => [unicodeHex(word), index]),
);

export function canonicalEnglishWords(mnemonic: string): string[] {
  const words = mnemonic.normalize("NFKD").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!WORD_COUNT_SET.has(words.length)) {
    throw new Error("Enter 12, 15, 18, 21, or 24 English BIP39 words.");
  }
  for (const [position, word] of words.entries()) {
    if (!ENGLISH_INDEX.has(word)) {
      throw new Error(`Unknown English BIP39 word at position ${position + 1}.`);
    }
  }
  return words;
}

export function assertWordCount(count: number): asserts count is Bip39WordCount {
  if (!WORD_COUNT_SET.has(count)) throw new Error("Expected 12, 15, 18, 21, or 24 word indexes.");
}

export function unicodeHex(symbol: string): string {
  const points = Array.from(symbol);
  if (points.length !== 1)
    throw new Error("The selected mapped BIP39 character is not one Unicode scalar value.");
  return points[0]!.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
}

export function mappingRow(index: number): MappingRow {
  if (!Number.isInteger(index) || index < 1 || index > BIP39_DICTIONARY_SIZE)
    throw new Error("A wordlist index must be from 1 through 2048.");
  const zeroBased = index - 1;
  return {
    index,
    english: englishWordlist[zeroBased]!,
    unicodeHex: unicodeHex(traditionalChineseWordlist[zeroBased]!),
  };
}

export function allMappingRows(): MappingRow[] {
  return Array.from({ length: BIP39_DICTIONARY_SIZE }, (_, index) => mappingRow(index + 1));
}

export function recoverMissingWord(value: string): MissingWordCandidate[] {
  const words = value.normalize("NFKD").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!WORD_COUNT_SET.has(words.length)) {
    throw new Error("Enter 12, 15, 18, 21, or 24 English BIP39 words with one ? placeholder.");
  }
  const missing = words.flatMap((word, index) => (word === "?" ? [index] : []));
  if (missing.length !== 1)
    throw new Error("Enter exactly one ? placeholder for the forgotten BIP39 word.");
  for (const [position, word] of words.entries()) {
    if (word !== "?" && !ENGLISH_INDEX.has(word))
      throw new Error(`Unknown English BIP39 word at position ${position + 1}.`);
  }
  const missingIndex = missing[0]!;
  return recoverWordAt(words, missingIndex);
}

function recoverWordAt(words: readonly string[], missingIndex: number): MissingWordCandidate[] {
  if (missingIndex === words.length - 1) return finalWordCandidates(words);
  const checksumLength = words.length / 3;
  const candidates: MissingWordCandidate[] = [];
  for (const [index, word] of englishWordlist.entries()) {
    const candidateWords = [...words];
    candidateWords[missingIndex] = word;
    const mnemonic = candidateWords.join(" ");
    if (!validateMnemonic(mnemonic, englishWordlist)) continue;
    const indexes = candidateWords.map((candidate) => ENGLISH_INDEX.get(candidate)!);
    const bitStream = indexes
      .map((candidate) => candidate.toString(2).padStart(BIP39_INDEX_BITS, "0"))
      .join("");
    candidates.push({
      position: missingIndex + 1,
      word,
      wordIndex: index + 1,
      mnemonic,
      checksumBits: bitStream.slice(-checksumLength),
    });
  }
  return candidates;
}

/** Bits in a byte, for the entropy that the last word completes. */
const BYTE_BITS = 8;

/**
 * The valid last words of `words`, whose last word is missing, as recoverWordAt finds them and in
 * the same order, but without validating 2,048 phrases: the last word holds 11 − checksum bits of
 * entropy, and BIP39 gives each of their values one checksum (entropyToMnemonic). This keeps the
 * startup self-test, which recovers last words, quick.
 */
function finalWordCandidates(words: readonly string[]): MissingWordCandidate[] {
  const checksumLength = words.length / 3;
  const prefix = words.slice(0, -1).map((word) => ENGLISH_INDEX.get(word)!);
  return validLastWordIndexes(prefix).map((index) => {
    const word = englishWordlist[index]!;
    return {
      position: words.length,
      word,
      wordIndex: index + 1,
      mnemonic: [...words.slice(0, -1), word].join(" "),
      checksumBits: index.toString(2).padStart(BIP39_INDEX_BITS, "0").slice(-checksumLength),
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
  const checksumLength = (prefix.length + 1) / 3;
  const tailBits = BIP39_INDEX_BITS - checksumLength;
  const knownBits = prefix
    .map((index) => index.toString(2).padStart(BIP39_INDEX_BITS, "0"))
    .join("");
  const indexes: number[] = [];
  for (let tail = 0; tail < 2 ** tailBits; tail += 1) {
    const bits = knownBits + tail.toString(2).padStart(tailBits, "0");
    const entropy = Uint8Array.from({ length: bits.length / BYTE_BITS }, (_, byte) =>
      Number.parseInt(bits.slice(byte * BYTE_BITS, (byte + 1) * BYTE_BITS), 2),
    );
    const mnemonic = entropyToMnemonic(entropy, englishWordlist);
    // One of the candidates is the wallet's.
    entropy.fill(0);
    indexes.push(ENGLISH_INDEX.get(mnemonic.slice(mnemonic.lastIndexOf(" ") + 1))!);
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
  const words = canonicalEnglishWords(value);
  const finalPosition = words.length - 1;
  const checksumLength = words.length / 3;
  const finalIndex = ENGLISH_INDEX.get(words[finalPosition]!)!;
  const legacyEntropyTail = finalIndex >> checksumLength;
  const incomplete = [...words];
  incomplete[finalPosition] = "?";
  return recoverWordAt(incomplete, finalPosition).map((candidate) => ({
    ...candidate,
    preservesLegacyEntropy: (candidate.wordIndex - 1) >> checksumLength === legacyEntropyTail,
  }));
}
