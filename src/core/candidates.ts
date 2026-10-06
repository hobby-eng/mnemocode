// Searches for a seed phrase with unknown or missing words (docs/CANDIDATES.md). Every combination
// is checked against the BIP39 checksum, and the candidates come in one fixed order, so that
// candidate N is the same on MnemoCode's screen, in the Wallet Deriver and in a candidate list.
// Host-neutral: it imports only @scure/bip39's word list and @noble/hashes.

import { sha256 } from "@noble/hashes/sha2.js";
import {
  BIP39_DICTIONARY_SIZE,
  BIP39_INDEX_BITS,
  englishWordlist,
  ENGLISH_INDEX,
} from "./words.js";
import { BIP39_WORD_COUNTS } from "./types.js";

/** Combinations that one search may check; at a few microseconds each, about a minute. */
export const MAX_SEARCH_COMBINATIONS = 2 ** 24;
/** BIP39 adds one checksum bit for every 32 bits of entropy, and a word is 11 bits. */
const ENTROPY_BITS_PER_CHECKSUM_BIT = 32;
const BYTE_BITS = 8;

/** The words a place may hold, as ascending indexes in the BIP39 English list; one if known. */
export type WordPlace = readonly number[];

/** A search: unknown words at known places, or one word missing at an unknown place. */
export type WordSearch =
  | { readonly kind: "unknown-words"; readonly places: readonly WordPlace[] }
  | { readonly kind: "missing-word"; readonly written: readonly number[] };

/** A candidate: the word indexes of the whole phrase. */
export type CandidateWords = readonly number[];

const ALL_WORDS: WordPlace = Array.from({ length: BIP39_DICTIONARY_SIZE }, (_, index) => index);
const PHRASE_LENGTHS = new Set<number>(BIP39_WORD_COUNTS);

/** Lower-case NFKD words, as BIP39 compares them. */
function wordsOf(text: string): string[] {
  return text.normalize("NFKD").toLowerCase().trim().split(/\s+/u).filter(Boolean);
}

/** The words that one written place allows: a word, ?, a prefix with *, or words joined by |. */
function placeOf(written: string, position: number): WordPlace {
  const where = `place ${position}`;
  if (written === "?") return ALL_WORDS;
  if (written.endsWith("*")) {
    const prefix = written.slice(0, -1);
    const indexes = ALL_WORDS.filter((index) => englishWordlist[index]!.startsWith(prefix));
    // The letters are part of a secret word: the message names only their place.
    if (prefix === "" || /[*?|]/u.test(prefix) || indexes.length === 0)
      throw new Error(`No BIP39 word starts with the letters at ${where}.`);
    return indexes;
  }
  const words = written.split("|");
  const indexes = words.map((word) => ENGLISH_INDEX.get(word));
  if (indexes.some((index) => index === undefined))
    throw new Error(`Unknown English BIP39 word at ${where}.`);
  return [...new Set(indexes as number[])].sort((a, b) => a - b);
}

/** Reads a phrase with unknown words at known places; at least one place must be unknown. */
export function parseUnknownWords(text: string): WordSearch {
  const written = wordsOf(text);
  if (!PHRASE_LENGTHS.has(written.length))
    throw new Error("Enter 12, 15, 18, 21 or 24 places: words, ?, a prefix with *, or a|b.");
  const places = written.map((word, index) => placeOf(word, index + 1));
  if (places.every((place) => place.length === 1))
    throw new Error("Mark each forgotten word with ?, a prefix with *, or a|b.");
  return { kind: "unknown-words", places };
}

/** Reads a phrase with one word missing at an unknown place: one word fewer than a valid length. */
export function parseMissingWord(text: string): WordSearch {
  const written = wordsOf(text);
  if (!PHRASE_LENGTHS.has(written.length + 1))
    throw new Error("Enter the 11, 14, 17, 20 or 23 words you have, in their order.");
  const indexes = written.map((word, index) => {
    const found = ENGLISH_INDEX.get(word);
    if (found === undefined) throw new Error(`Unknown English BIP39 word at place ${index + 1}.`);
    return found;
  });
  return { kind: "missing-word", written: indexes };
}

/** Whether a word index is one of the BIP39 list. */
function isWordIndex(value: unknown): boolean {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) < BIP39_DICTIONARY_SIZE
  );
}

/**
 * Refuses a search that the parsers above could not have made: another host may build its own,
 * and an empty place, for one, would never end (AUD-008-API003).
 */
function assertSearch(search: WordSearch): void {
  if (search.kind === "missing-word") {
    if (!Array.isArray(search.written) || !PHRASE_LENGTHS.has(search.written.length + 1))
      throw new Error("A missing-word search needs one word fewer than a valid phrase length.");
    if (!search.written.every(isWordIndex)) throw new Error("A written word is not a BIP39 index.");
    return;
  }
  if (search.kind !== "unknown-words") throw new Error("Unknown kind of word search.");
  if (!Array.isArray(search.places) || !PHRASE_LENGTHS.has(search.places.length))
    throw new Error("A word search needs 12, 15, 18, 21 or 24 places.");
  for (const place of search.places)
    // Ascending and distinct, so that the order of docs/CANDIDATES.md holds.
    if (
      !Array.isArray(place) ||
      place.length === 0 ||
      !place.every((index, at) => isWordIndex(index) && (at === 0 || index > place[at - 1]!))
    )
      throw new Error("Every place needs one or more BIP39 indexes in ascending order.");
}

/** The combinations a search checks: the work it takes, which MAX_SEARCH_COMBINATIONS bounds. */
export function searchCombinations(search: WordSearch): number {
  assertSearch(search);
  if (search.kind === "missing-word") return (search.written.length + 1) * BIP39_DICTIONARY_SIZE;
  return search.places.reduce((product, place) => product * place.length, 1);
}

/** The BIP39 entropy that the words carry, without their checksum bits. */
export function entropyOfWords(words: CandidateWords): Uint8Array {
  const checksumBits = (words.length * BIP39_INDEX_BITS) / (ENTROPY_BITS_PER_CHECKSUM_BIT + 1);
  const entropyBits = words.length * BIP39_INDEX_BITS - checksumBits;
  const entropy = new Uint8Array(entropyBits / BYTE_BITS);
  let buffer = 0;
  let bits = 0;
  let filled = 0;
  for (const word of words) {
    buffer = (buffer << BIP39_INDEX_BITS) | word;
    bits += BIP39_INDEX_BITS;
    while (bits >= BYTE_BITS && filled < entropy.length) {
      bits -= BYTE_BITS;
      entropy[filled++] = (buffer >>> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  return entropy;
}

/** Whether the last bits of the last word are the BIP39 checksum of the entropy before them. */
export function checksumValid(words: CandidateWords): boolean {
  const checksumBits = (words.length * BIP39_INDEX_BITS) / (ENTROPY_BITS_PER_CHECKSUM_BIT + 1);
  const entropy = entropyOfWords(words);
  const expected = sha256(entropy)[0]! >>> (BYTE_BITS - checksumBits);
  entropy.fill(0);
  return (words.at(-1)! & ((1 << checksumBits) - 1)) === expected;
}

/** The English phrase of word indexes. */
export function phraseOfWords(words: CandidateWords): string {
  return words.map((index) => englishWordlist[index]!).join(" ");
}

/**
 * Every combination of the unknown places, in lexicographic order of their words with the last
 * place changing fastest, as a mixed-radix counter.
 */
function* unknownWordCombinations(places: readonly WordPlace[]): Generator<number[]> {
  const counters = places.map(() => 0);
  const words = places.map((place) => place[0]!);
  for (;;) {
    yield words;
    let place = places.length - 1;
    while (place >= 0 && counters[place] === places[place]!.length - 1) {
      counters[place] = 0;
      words[place] = places[place]![0]!;
      place -= 1;
    }
    if (place < 0) return;
    counters[place]! += 1;
    words[place] = places[place]![counters[place]!]!;
  }
}

/**
 * Every phrase with one word inserted into `written`, place p ascending, then the word in list
 * order; a word inserted just after the same written word repeats the phrase of the place before.
 */
function* missingWordCombinations(written: readonly number[]): Generator<number[]> {
  for (let place = 0; place <= written.length; place += 1)
    for (let word = 0; word < BIP39_DICTIONARY_SIZE; word += 1) {
      if (place > 0 && written[place - 1] === word) continue;
      yield [...written.slice(0, place), word, ...written.slice(place)];
    }
}

/**
 * Where a missing-word candidate holds its inserted word, counting from 0: the first place of a
 * run of equal words, as the search counts it.
 */
export function insertedPlace(written: readonly number[], words: CandidateWords): number {
  let place = 0;
  while (place < written.length && words[place] === written[place]) place += 1;
  while (place > 0 && words[place - 1] === words[place]) place -= 1;
  return place;
}

/**
 * The candidates of a search, in the order of docs/CANDIDATES.md: the combinations whose checksum
 * is valid. A yielded array may be reused for the next one; copy it to keep it.
 */
export function* searchCandidates(search: WordSearch): Generator<CandidateWords> {
  if (searchCombinations(search) > MAX_SEARCH_COMBINATIONS)
    throw new Error(
      `This search has more than ${MAX_SEARCH_COMBINATIONS.toLocaleString("en-US")} combinations: give more of the words, or a few letters of them.`,
    );
  const combinations =
    search.kind === "unknown-words"
      ? unknownWordCombinations(search.places)
      : missingWordCombinations(search.written);
  for (const words of combinations) if (checksumValid(words)) yield words;
}
