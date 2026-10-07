// Forgotten words of a seed phrase (docs/CANDIDATES.md): unknown words at known places, each
// marked with ?, a prefix with * or a few words joined by |, or one word missing at an unknown
// place. Every combination is checked against the BIP39 checksum, and the candidates come in one
// fixed order, so that candidate N is the same on MnemoCode's screen, in the Wallet Deriver and in
// a candidate list. WordCandidateSearch, at the end, is the entry; the functions before it stay
// for the hosts that already call them. A program that only searches words takes this module with
// core/words.ts and core/types.ts; it needs nothing about dates, shares, lists or terminals.
//
// From the host it needs nothing to step through the candidates at its own pace. Its run does what
// every host does around them, by the same rules: it checks each candidate with the host's wallet
// check (core/wallet-check.ts), keeps the first MAX_SHOWN_CANDIDATES and every one that matched to
// be shown, keeps the entropy of every candidate for a candidate list, and says when the list is
// full, with a progress callback, an AbortSignal and how it yields to the host's event loop.
//
// It does not derive keys, save lists or print. Its messages name a wrong word by its place, never
// by what was typed.
//
// Host-neutral: through core/words.ts it reaches only @scure/bip39 and its word lists, and it
// imports @noble/hashes for the checksum.

import { sha256 } from "@noble/hashes/sha2.js";
import {
  BIP39_DICTIONARY_SIZE,
  BIP39_INDEX_BITS,
  englishWordlist,
  ENGLISH_INDEX,
} from "./words.js";
import { BIP39_WORD_COUNTS } from "./types.js";
import { keptCount, nextTask, TURN_MILLISECONDS } from "./search-turns.js";
import type { WalletCheck, WalletMatch } from "./wallet-check.js";

/** Combinations that one search may check; at a few microseconds each, about a minute. */
export const MAX_SEARCH_COMBINATIONS = 2 ** 24;
/**
 * Candidates that a host shows at most, each with its number: enough for a word missing at an
 * unknown place of 12 words, about 1,500. More go to a candidate list, or through a wallet check
 * that shows only those that match.
 */
export const MAX_SHOWN_CANDIDATES = 2_048;
/** How a word search with too many combinations or candidates is narrowed, in every message. */
export const NARROW_WORD_SEARCH = "give more of the words, or a few letters of them";
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

/** How many candidates a search finds: exactly, where the checksum tells it, or about. */
export interface ExpectedCandidates {
  /** The candidates; when not exact, their expected number rounded to a whole one. */
  readonly count: number;
  /** Whether `count` is exact, as it is when the last place may hold any word. */
  readonly exact: boolean;
}

const REDACTED_CANDIDATE = "[WordCandidate: redacted]";
const REDACTED_SEARCH = "[WordCandidateSearch: redacted]";
/**
 * Every word, for a place marked with ?. Frozen: parseUnknownWords hands this one list out in its
 * search, and a host that changed it there would change every later search.
 */
const ALL_WORDS: WordPlace = Object.freeze(
  Array.from({ length: BIP39_DICTIONARY_SIZE }, (_, index) => index),
);
/** Every word, for a place that cannot be read at all, as one shared frozen list. */
export const EVERY_WORD: WordPlace = ALL_WORDS;
const PHRASE_LENGTHS = new Set<number>(BIP39_WORD_COUNTS);

/** The checksum bits at the end of a phrase of `wordCount` words: one for every three words. */
function checksumBitCount(wordCount: number): number {
  return (wordCount * BIP39_INDEX_BITS) / (ENTROPY_BITS_PER_CHECKSUM_BIT + 1);
}

/** Lower-case NFKD words, as BIP39 compares them. */
function wordsOf(text: string): string[] {
  return text.normalize("NFKD").toLowerCase().trim().split(/\s+/u).filter(Boolean);
}

/**
 * The words that one written place allows: a word, ?, a prefix with *, or words joined by |; the
 * place is counted from 1 and named only by its number in a refusal.
 */
export function wordPlaceOf(written: string, position: number): WordPlace {
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
  const places = written.map((word, index) => wordPlaceOf(word, index + 1));
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
 * Whether every element up to the length passes `test`. Array.prototype.every skips the holes of a
 * sparse array, which would then be read as undefined words; an index loop reads them too.
 */
function everyElement(
  values: readonly unknown[],
  test: (value: unknown, at: number) => boolean,
): boolean {
  for (let at = 0; at < values.length; at += 1) if (!test(values[at], at)) return false;
  return true;
}

/** Whether a place holds one or more word indexes, ascending and distinct. */
function isPlace(place: unknown): boolean {
  return (
    Array.isArray(place) &&
    place.length > 0 &&
    // Ascending and distinct, so that the order of docs/CANDIDATES.md holds.
    everyElement(
      place,
      (index, at) => isWordIndex(index) && (at === 0 || (index as number) > place[at - 1]),
    )
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
    if (!everyElement(search.written, isWordIndex))
      throw new Error("A written word is not a BIP39 index.");
    return;
  }
  if (search.kind !== "unknown-words") throw new Error("Unknown kind of word search.");
  if (!Array.isArray(search.places) || !PHRASE_LENGTHS.has(search.places.length))
    throw new Error("A word search needs 12, 15, 18, 21 or 24 places.");
  if (!everyElement(search.places, isPlace))
    throw new Error("Every place needs one or more BIP39 indexes in ascending order.");
}

/** The combinations a search checks: the work it takes, which MAX_SEARCH_COMBINATIONS bounds. */
export function searchCombinations(search: WordSearch): number {
  assertSearch(search);
  if (search.kind === "missing-word") return (search.written.length + 1) * BIP39_DICTIONARY_SIZE;
  return search.places.reduce((product, place) => product * place.length, 1);
}

/** The refusal of a search with more combinations than MAX_SEARCH_COMBINATIONS. */
function tooManyCombinations(): Error {
  return new Error(
    `This search has more than ${MAX_SEARCH_COMBINATIONS.toLocaleString("en-US")} combinations: ${NARROW_WORD_SEARCH}.`,
  );
}

/**
 * How many candidates a search finds, told before it runs. When the last place may hold any word,
 * exactly one in 2^(words / 3) of its words passes the checksum for each combination of the other
 * places, so the count is exact; otherwise a combination passes once in 2^(words / 3) on average.
 */
export function expectedCandidates(search: WordSearch): ExpectedCandidates {
  const combinations = searchCombinations(search);
  const wordCount =
    search.kind === "unknown-words" ? search.places.length : search.written.length + 1;
  const passing = combinations / 2 ** checksumBitCount(wordCount);
  const exact =
    search.kind === "unknown-words" && search.places.at(-1)!.length === BIP39_DICTIONARY_SIZE;
  return { count: exact ? passing : Math.round(passing), exact };
}

/** The BIP39 entropy that the words carry, without their checksum bits. */
export function entropyOfWords(words: CandidateWords): Uint8Array {
  const entropyBits = words.length * BIP39_INDEX_BITS - checksumBitCount(words.length);
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
  const checksumBits = checksumBitCount(words.length);
  const entropy = entropyOfWords(words);
  const expected = sha256(entropy)[0]! >>> (BYTE_BITS - checksumBits);
  entropy.fill(0);
  return (words.at(-1)! & ((1 << checksumBits) - 1)) === expected;
}

/** The English phrase of word indexes. */
export function phraseOfWords(words: CandidateWords): string {
  return words.map((index) => englishWordlist[index]!).join(" ");
}

function wipeAll(entropies: readonly Uint8Array[]): void {
  for (const entropy of entropies) entropy.fill(0);
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
  if (searchCombinations(search) > MAX_SEARCH_COMBINATIONS) throw tooManyCombinations();
  const combinations =
    search.kind === "unknown-words"
      ? unknownWordCombinations(search.places)
      : missingWordCombinations(search.written);
  for (const words of combinations) if (checksumValid(words)) yield words;
}

/** How a word search runs, with the host's services. */
export interface WordSearchRun {
  /** Compares each candidate with the wallet; without it no candidate is compared. */
  readonly walletCheck?: WalletCheck | undefined;
  /** How many candidates are kept to be shown, besides those that matched; MAX_SHOWN_CANDIDATES. */
  readonly maxShown?: number | undefined;
  /** How many entropies are kept for a candidate list; 0, the default, keeps none. */
  readonly keep?: number | undefined;
  /** Called once when the candidates are more than `keep`; throw to stop the search. */
  readonly onListFull?: (() => void) | undefined;
  /** Called at each turn with the candidates so far and those that matched. */
  readonly onProgress?:
    ((progress: { readonly count: number; readonly matched: number }) => void) | undefined;
  /** Stops the search at its next turn; the signal's reason is thrown. */
  readonly signal?: AbortSignal | undefined;
  /** How the search lets the host's event loop run; a zero timeout by default. */
  readonly turn?: (() => Promise<void>) | undefined;
}

/** A candidate kept to be shown, with what the wallet check said of it. */
export interface ShownCandidate {
  readonly candidate: WordCandidate;
  readonly match?: WalletMatch;
}

/** What a word search found. */
export interface WordSearchResult {
  /** The first `maxShown` candidates, and every later one that matched the wallet. */
  readonly shown: readonly ShownCandidate[];
  /** The entropy of every candidate for a list, record N for candidate N; the caller wipes them. */
  readonly entropies: Uint8Array[];
  /** The candidates found, all of them. */
  readonly count: number;
  /** The candidates that matched the wallet. */
  readonly matched: number;
  /** The first warning of the wallet check, such as that a fingerprint is only a filter. */
  readonly warning: string | undefined;
  /** Whether the candidates were more than `keep`, so that no list holds them. */
  readonly listFull: boolean;
}

/**
 * One candidate of a word search: its number among the candidates, counting from 1, and its
 * words. A class pays off here: a candidate may be the wallet's own seed phrase, so it never shows
 * its words through toString, toJSON or Node's inspect, and it tells its phrase, its entropy and
 * its checksum bits itself, so that every host shows the same.
 */
export class WordCandidate {
  readonly #number: number;
  readonly #words: readonly number[];

  constructor(number: number, words: CandidateWords) {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new RangeError("A candidate's number counts from 1.");
    if (
      !Array.isArray(words) ||
      !PHRASE_LENGTHS.has(words.length) ||
      !everyElement(words, isWordIndex)
    )
      throw new Error("A candidate needs 12, 15, 18, 21 or 24 BIP39 indexes.");
    this.#number = number;
    // A copy: a search reuses its array for the next combination.
    this.#words = Object.freeze([...words]);
  }

  /** Its number among the candidates of its search, counting from 1, the same in every host. */
  get number(): number {
    return this.#number;
  }

  /** The BIP39 indexes of its words, 0 to 2047. */
  get words(): readonly number[] {
    return this.#words;
  }

  /** Its English phrase. */
  get phrase(): string {
    return phraseOfWords(this.#words);
  }

  /** Its BIP39 entropy, for a candidate list: a new array each time, which the caller wipes. */
  entropy(): Uint8Array {
    return entropyOfWords(this.#words);
  }

  /** The checksum bits at the end of its last word, as a candidate table shows them. */
  get checksumBits(): string {
    return this.#words
      .at(-1)!
      .toString(2)
      .padStart(BIP39_INDEX_BITS, "0")
      .slice(-checksumBitCount(this.#words.length));
  }

  toString(): string {
    return REDACTED_CANDIDATE;
  }

  toJSON(): string {
    return REDACTED_CANDIDATE;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED_CANDIDATE;
  }
}

/**
 * One search for forgotten words, read from the phrase as typed (parse) or taken from a search
 * that a host made itself (of). A class pays off here: it checks itself once, so that an invalid
 * search, or one of more than MAX_SEARCH_COMBINATIONS combinations, cannot exist; it tells its
 * size and the candidates it will find before it runs, as a page shows them while the person
 * types; and it keeps the known words private.
 */
export class WordCandidateSearch {
  readonly #search: WordSearch;
  readonly #combinations: number;
  /** The places, counting from 0, that may hold more than one word. */
  readonly #unknownPlaces: readonly number[];

  private constructor(search: WordSearch) {
    assertSearch(search);
    // A copy, so that the caller's arrays cannot change the search once it is checked.
    const copy: WordSearch =
      search.kind === "unknown-words"
        ? { kind: search.kind, places: search.places.map((place) => [...place]) }
        : { kind: search.kind, written: [...search.written] };
    const combinations = searchCombinations(copy);
    if (combinations > MAX_SEARCH_COMBINATIONS) throw tooManyCombinations();
    this.#search = copy;
    this.#combinations = combinations;
    this.#unknownPlaces =
      copy.kind === "unknown-words"
        ? copy.places.flatMap((place, index) => (place.length > 1 ? [index] : []))
        : [];
  }

  /**
   * Reads the phrase as typed. For "unknown-words" each place is a word, ?, a prefix with * or
   * words joined by |; for "missing-word" it is the words there are, one fewer than a phrase has.
   */
  static parse(text: string, kind: WordSearch["kind"]): WordCandidateSearch {
    if (kind === "unknown-words") return new WordCandidateSearch(parseUnknownWords(text));
    if (kind === "missing-word") return new WordCandidateSearch(parseMissingWord(text));
    throw new Error("Unknown kind of word search.");
  }

  /** Takes a search that a host made itself, after the same checks as a parsed one. */
  static of(search: WordSearch): WordCandidateSearch {
    return new WordCandidateSearch(search);
  }

  get kind(): WordSearch["kind"] {
    return this.#search.kind;
  }

  /** The words of every candidate: 12, 15, 18, 21 or 24. */
  get wordCount(): number {
    return this.#search.kind === "unknown-words"
      ? this.#search.places.length
      : this.#search.written.length + 1;
  }

  /** The combinations that the search checks, at most MAX_SEARCH_COMBINATIONS. */
  get combinations(): number {
    return this.#combinations;
  }

  /** How many candidates the search finds (expectedCandidates). */
  get expected(): ExpectedCandidates {
    return expectedCandidates(this.#search);
  }

  /**
   * The places, counting from 0, that may hold more than one word; none for a missing word, whose
   * place each candidate has on its own (placesOf).
   */
  get unknownPlaces(): number[] {
    return [...this.#unknownPlaces];
  }

  /**
   * The places, counting from 0, whose words the search chose in `candidate`: the unknown places,
   * or the place of the missing word, the first of a run of equal words (insertedPlace).
   */
  placesOf(candidate: WordCandidate): number[] {
    if (this.#search.kind === "unknown-words") return [...this.#unknownPlaces];
    return [insertedPlace(this.#search.written, candidate.words)];
  }

  /**
   * The candidates in the order of docs/CANDIDATES.md, numbered from 1. A host takes as many at a
   * time as suits it, as a page does that lets its event loop run between batches, and stops when
   * it wants.
   */
  *candidates(): Generator<WordCandidate> {
    let number = 0;
    for (const words of searchCandidates(this.#search)) {
      number += 1;
      yield new WordCandidate(number, words);
    }
  }

  /**
   * Runs the search with the host's services (WordSearchRun) and keeps what a host shows and
   * saves: the first `maxShown` candidates and every one that matched the wallet, each with its
   * number; the entropy of every candidate, up to `keep`, record N for candidate N. When there are
   * more candidates than `keep`, onListFull is called once: a host that throws there stops the
   * search; otherwise the entropies kept are wiped and the search goes on without them. The
   * entropies are wiped too when the search is stopped or fails.
   */
  async run(run: WordSearchRun = {}): Promise<WordSearchResult> {
    const maxShown = keptCount(run.maxShown, MAX_SHOWN_CANDIDATES, "maxShown");
    const keep = keptCount(run.keep, 0, "keep");
    const turn = run.turn ?? nextTask;
    const shown: ShownCandidate[] = [];
    let entropies: Uint8Array[] = [];
    let count = 0;
    let matched = 0;
    let warning: string | undefined;
    let listFull = false;
    try {
      run.signal?.throwIfAborted();
      let lastTurn = Date.now();
      for (const candidate of this.candidates()) {
        count += 1;
        if (keep > 0 && !listFull && count > keep) {
          listFull = true;
          wipeAll(entropies);
          entropies = [];
          run.onListFull?.();
        }
        const match =
          run.walletCheck === undefined ? undefined : await run.walletCheck(candidate.phrase);
        if (match?.matched === true) matched += 1;
        warning ??= match?.warning;
        if (keep > 0 && !listFull) entropies.push(candidate.entropy());
        if (count <= maxShown || match?.matched === true)
          shown.push(match === undefined ? { candidate } : { candidate, match });
        if (Date.now() - lastTurn >= TURN_MILLISECONDS) {
          await turn();
          run.signal?.throwIfAborted();
          run.onProgress?.({ count, matched });
          lastTurn = Date.now();
        }
      }
    } catch (error) {
      wipeAll(entropies);
      throw error;
    }
    return { shown, entropies, count, matched, warning, listFull };
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
