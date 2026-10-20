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
import { BIP39_DICTIONARY_SIZE, englishTokens, englishWordlist, ENGLISH_INDEX } from "./words.js";
import {
  checksumBits,
  checksumPassShare,
  areWordIndexes,
  assertPhraseIndexes,
  assertWordIndexes,
  isWordIndex,
  isBip39WordCount,
  WORD_COUNTS_TEXT,
  WORD_COUNTS_LESS_ONE_TEXT,
} from "./bip39-sizes.js";
import { BITS_PER_BYTE, wipeAll } from "./bits.js";
import {
  stillRunning,
  keptCount,
  SearchTurns,
  type SearchProgress,
  type SearchRun,
} from "./search-turns.js";
import { askWallet, type WalletCheck, type WalletMatch } from "./wallet-check.js";
import { Redacted } from "./redacted.js";
import { counting } from "./search-plan.js";
import { SecretValue } from "./secret-value.js";
import { WordCandidate, entropyOfWords, type CandidateWords } from "./word-candidate.js";
import { defined } from "./defined.js";
import { ErrorCatalog } from "./error-catalog.js";

export {
  WordCandidate,
  entropyOfWords,
  phraseOfWords,
  type CandidateWords,
} from "./word-candidate.js";

const ERRORS = new ErrorCatalog("core.candidates", {
  "no-bip39-word-starts-letters-at": (value0: string) =>
    `No BIP39 word starts with the letters at ${value0}.`,
  "unknown-english-bip39-word-at": (value0: string) => `Unknown English BIP39 word at ${value0}.`,
  "enter-places-words-prefix-b": (value0: string) =>
    `Enter ${value0} places: words, ?, a prefix with *, or a|b.`,
  "mark-each-forgotten-word-prefix-b": () =>
    "Mark each forgotten word with ?, a prefix with *, or a|b.",
  "enter-words-you-their-order": (value0: string) =>
    `Enter the ${value0} words you have, in their order.`,
  "unknown-english-bip39-word-at-place": (value0: string) =>
    `Unknown English BIP39 word at place ${value0}.`,
  "missing-word-search-one-word-fewer-than-valid": () =>
    "A missing-word search needs one word fewer than a valid phrase length.",
  "written-word-not-bip39-index": () => "A written word is not a BIP39 index.",
  "unknown-search-kind": () => UNKNOWN_SEARCH_KIND,
  "word-search-places": (value0: string) => `A word search needs ${value0} places.`,
  "every-place-one-more-bip39-indexes-ascending-order": () =>
    "Every place needs one or more BIP39 indexes in ascending order.",
  "search-more-than-combinations": (value0: string, value1: string) =>
    `This search has more than ${value0} combinations: ${value1}.`,
  "every-place-search-at-least-one-word": () => "Every place of a search needs at least one word.",
});

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
/** How candidates that are not shown are told apart: by the wallet. */
const CHECK_AGAINST_WALLET = "check them against the wallet's fingerprint or an address";
/** How candidates that are not shown become fewer. */
const GIVE_LETTERS = "give a few letters of the words";

/**
 * What a host says of `count` candidates that it does not show: that they do not fit on its
 * screen, or that they are too many to show (MAX_SHOWN_CANDIDATES). `save` is the host's own
 * advice for saving them as a list, such as an option of its command; without it they are too
 * many to save as well.
 */
export function unshownCandidatesNotice(count: number, save?: string): string {
  const counted = counting(count);
  if (count <= MAX_SHOWN_CANDIDATES)
    return `${counted} candidates do not fit on this screen: ${CHECK_AGAINST_WALLET}, or ${GIVE_LETTERS}.`;
  return save !== undefined
    ? `${counted} candidates are too many to show: ${save}, or ${CHECK_AGAINST_WALLET}.`
    : `${counted} candidates are too many to show or to save: ${CHECK_AGAINST_WALLET}, or ${GIVE_LETTERS}.`;
}

/** The words a place may hold, as ascending indexes in the BIP39 English list; one if known. */
export type WordPlace = readonly number[];

/** A search: unknown words at known places, or one word missing at an unknown place. */
export type WordSearch =
  | {
      /** Unknown words at known places (parseUnknownWords). */
      readonly kind: "unknown-words";
      /** The places of the phrase in order, one a word (12, 15, 18, 21 or 24), with their words. */
      readonly places: readonly WordPlace[];
    }
  | {
      /** One word missing at an unknown place (parseMissingWord). */
      readonly kind: "missing-word";
      /**
       * The words there are, in order, as indexes in the BIP39 English list: one fewer than a
       * phrase has.
       */
      readonly written: readonly number[];
    };

/** How many candidates a search finds: exactly, where the checksum tells it, or about. */
export interface ExpectedCandidates {
  /** The candidates; when not exact, their expected number rounded to a whole one. */
  readonly count: number;
  /** Whether `count` is exact, as it is when the last place may hold any word. */
  readonly exact: boolean;
}

/**
 * Every word, for a place marked with ? or one that cannot be read at all. Frozen: the searches
 * hand this one list out, and a host that changed it there would change every later search.
 */
export const EVERY_WORD: WordPlace = Object.freeze(
  Array.from({ length: BIP39_DICTIONARY_SIZE }, (_, index) => index),
);

/**
 * The words that one written place allows: a word, ?, a prefix with *, or words joined by |; the
 * place is counted from 1 and named only by its number in a refusal: of a prefix that no word
 * starts with (core.candidates.no-bip39-word-starts-letters-at), and of a word that is not English
 * BIP39 (unknown-english-bip39-word-at).
 */
export function wordPlaceOf(written: string, position: number): WordPlace {
  const where = `place ${position}`;
  if (written === "?") return EVERY_WORD;
  if (written.endsWith("*")) {
    const prefix = written.slice(0, -1);
    const indexes = EVERY_WORD.filter((index) =>
      defined(englishWordlist[index]).startsWith(prefix),
    );
    // The letters are part of a secret word: the message names only their place.
    if (prefix === "" || /[*?|]/u.test(prefix) || indexes.length === 0)
      throw ERRORS.create("no-bip39-word-starts-letters-at", [`${where}`]);
    return indexes;
  }
  const indexes = written.split("|").map((word) => {
    const found = ENGLISH_INDEX.get(word);
    if (found === undefined) throw ERRORS.create("unknown-english-bip39-word-at", [`${where}`]);
    return found;
  });
  return [...new Set(indexes)].sort((a, b) => a - b);
}

/**
 * Reads a phrase with unknown words at known places; at least one place must be unknown. Refuses
 * another count of places (core.candidates.enter-places-words-prefix-b), a phrase with no place
 * marked (mark-each-forgotten-word-prefix-b) and a place that no word fits, named by its number
 * (wordPlaceOf: no-bip39-word-starts-letters-at, unknown-english-bip39-word-at).
 */
export function parseUnknownWords(text: string): WordSearch {
  const written = englishTokens(text);
  if (!isBip39WordCount(written.length))
    throw ERRORS.create("enter-places-words-prefix-b", [`${WORD_COUNTS_TEXT}`]);
  const places = written.map((word, index) => wordPlaceOf(word, index + 1));
  if (places.every((place) => place.length === 1))
    throw ERRORS.create("mark-each-forgotten-word-prefix-b", []);
  return { kind: "unknown-words", places };
}

/**
 * Reads a phrase with one word missing at an unknown place: one word fewer than a valid length.
 * Refuses another count of words (core.candidates.enter-words-you-their-order) and a word that is
 * not English BIP39, naming its place (unknown-english-bip39-word-at-place).
 */
export function parseMissingWord(text: string): WordSearch {
  const written = englishTokens(text);
  if (!isBip39WordCount(written.length + 1))
    throw ERRORS.create("enter-words-you-their-order", [`${WORD_COUNTS_LESS_ONE_TEXT}`]);
  const indexes = written.map((word, index) => {
    const found = ENGLISH_INDEX.get(word);
    if (found === undefined)
      throw ERRORS.create("unknown-english-bip39-word-at-place", [`${index + 1}`]);
    return found;
  });
  return { kind: "missing-word", written: indexes };
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
    everyElement(place, (index, at) => isWordIndex(index) && (at === 0 || index > place[at - 1]))
  );
}

/** Why a search is refused whose kind a JavaScript host made up. */
const UNKNOWN_SEARCH_KIND = "Unknown kind of word search.";

/**
 * The combinations a search checks: the work it takes, which MAX_SEARCH_COMBINATIONS bounds.
 * Refuses a search that the parsers above could not have made (checkedSearch), all
 * core.candidates: a missing word with another count of words
 * (missing-word-search-one-word-fewer-than-valid) or a word that is no BIP39 index
 * (written-word-not-bip39-index), another kind (unknown-search-kind), another count of places
 * (word-search-places), and a place without words or with indexes that are not BIP39 ones in
 * ascending order (every-place-one-more-bip39-indexes-ascending-order).
 */
export function searchCombinations(search: WordSearch): number {
  const { kind, lists } = checkedSearch(search);
  return kind.combinations(lists);
}

/**
 * Refuses a search of more combinations than MAX_SEARCH_COMBINATIONS
 * (core.candidates.search-more-than-combinations), with `narrow`, what makes it smaller in the
 * words of its search: the word search and the search of marked codes say it so.
 */
export function assertSearchable(combinations: number, narrow: string = NARROW_WORD_SEARCH): void {
  if (combinations > MAX_SEARCH_COMBINATIONS)
    throw ERRORS.create("search-more-than-combinations", [
      `${counting(MAX_SEARCH_COMBINATIONS)}`,
      `${narrow}`,
    ]);
}

/** The places, counted from 0, that a search tries several words in. */
export function unknownPlacesOf(places: readonly WordPlace[]): number[] {
  return places.flatMap((place, index) => (place.length > 1 ? [index] : []));
}

/**
 * How many candidates a search finds, told before it runs. When the last place may hold any word,
 * exactly one in 2^(words / 3) of its words passes the checksum for each combination of the other
 * places, so the count is exact; otherwise a combination passes once in 2^(words / 3) on average.
 * Refuses what searchCombinations refuses (core.candidates.unknown-search-kind and the others it
 * names).
 */
export function expectedCandidates(search: WordSearch): ExpectedCandidates {
  const { kind, lists } = checkedSearch(search);
  return expectedOf(kind, lists);
}

/** expectedCandidates of the word lists of a search of `kind`, already checked. */
function expectedOf(kind: SearchKind, lists: WordLists): ExpectedCandidates {
  const passing = kind.combinations(lists) * checksumPassShare(kind.wordCount(lists));
  const exact = kind.exact(lists);
  // At least one: the right phrase is always among the candidates, and the time of a search is
  // planned by this count.
  return { count: exact ? passing : Math.max(1, Math.round(passing)), exact };
}

/**
 * Whether `words`, a phrase of BIP39 word indexes, ends with the checksum of its entropy. A host
 * may pass anything at run time, so the indexes are checked first (assertPhraseIndexes): an index
 * out of range is no phrase at all, not one of a valid or wrong checksum. Refuses another count of
 * words (core.bip39-sizes.expected-word-indexes) and a value that is no word index
 * (assert-word-indexes-refused).
 */
export function checksumValid(words: CandidateWords): boolean {
  // One copy, checked and computed alike: a host's list may answer differently when read again.
  const copy = Array.from(words);
  assertPhraseIndexes(copy);
  return checksumFits(copy);
}

/**
 * Whether the last bits of the last word are the BIP39 checksum of the entropy before them. The
 * fast path of the searches, for indexes they made themselves; checksumValid checks a caller's.
 */
function checksumFits(words: CandidateWords): boolean {
  const checksumLength = checksumBits(words.length);
  const entropy = entropyOfWords(words);
  const expected = defined(sha256(entropy)[0]) >>> (BITS_PER_BYTE - checksumLength);
  entropy.fill(0);
  return (defined(words.at(-1)) & ((1 << checksumLength) - 1)) === expected;
}

/**
 * Every combination of the places, in lexicographic order of their words with the last place
 * changing fastest, as a mixed-radix counter. The word search and the search of marked codes both
 * count through it. It yields one array, changed in place for the next combination: a caller that
 * keeps a combination copies it. The places are checked first: each holds at least one word, so
 * that the counter ends (AUD-012-API001); a place without one is refused
 * (core.candidates.every-place-search-at-least-one-word), and so is a word that is no BIP39 index
 * (core.bip39-sizes.assert-word-indexes-refused).
 */
export function placeCombinations(places: readonly WordPlace[]): Generator<readonly number[]> {
  // Copied first, then checked: Array.from turns holes into undefined, which is refused.
  const owned = Array.from(places, (place) => {
    if (!Array.isArray(place) || place.length === 0)
      throw ERRORS.create("every-place-search-at-least-one-word", []);
    const words = Array.from<unknown>(place);
    assertWordIndexes(words);
    return Object.freeze(words);
  });
  return combinationsOf(owned);
}

/** The counter of placeCombinations, on places already checked. */
function* combinationsOf(places: readonly WordPlace[]): Generator<readonly number[]> {
  const counters = places.map(() => 0);
  const words = places.map((place) => defined(place[0]));
  try {
    for (;;) {
      yield words;
      let place = places.length - 1;
      while (place >= 0 && counters[place] === defined(places[place]).length - 1) {
        counters[place] = 0;
        words[place] = defined(defined(places[place])[0]);
        place -= 1;
      }
      if (place < 0) return;
      counters[place] = defined(counters[place]) + 1;
      words[place] = defined(defined(places[place])[defined(counters[place])]);
    }
  } finally {
    words.fill(0);
    counters.fill(0);
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
      const words = [...written.slice(0, place), word, ...written.slice(place)];
      try {
        yield words;
      } finally {
        words.fill(0);
      }
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
 * The word lists of a search, as SecretValue.numberLists holds them: the places of unknown words,
 * or the written words of a missing-word search as one list.
 */
type WordLists = readonly (readonly number[])[];

/**
 * What differs between the kinds of word search, held by each kind (SEARCH_KINDS): every rule of
 * the search asks the kind, so that a new kind is one more variant there and nothing else. Each
 * works on the search's word lists (WordLists), checked by assertLists.
 */
interface SearchKind {
  /** Reads the phrase as typed, as parseUnknownWords and parseMissingWord read it. */
  readonly parse: (text: string) => WordSearch;
  /**
   * The word lists of `search`, a search of this kind that a host may have made itself, borrowed;
   * refused where it has no list of the field of this kind, as assertLists refuses them.
   */
  readonly listsOf: (search: WordSearch) => WordLists;
  /**
   * Refuses lists that the parsers could not have made: another host may build its own search,
   * and an empty place, for one, would never end (AUD-008-API003).
   */
  readonly assertLists: (lists: WordLists) => void;
  /** The words of every candidate: 12, 15, 18, 21 or 24. */
  readonly wordCount: (lists: WordLists) => number;
  /** The combinations that the search checks. */
  readonly combinations: (lists: WordLists) => number;
  /** Whether expectedCandidates is exact: the last place may hold any word. */
  readonly exact: (lists: WordLists) => boolean;
  /** Every combination, in the order of docs/CANDIDATES.md; a yielded array may be reused. */
  readonly combinationsOf: (lists: WordLists) => Generator<readonly number[]>;
  /** The places, from 0, that may hold more than one word; none where each candidate has its own. */
  readonly unknownPlaces: (lists: WordLists) => number[];
  /**
   * The places, from 0, whose words the search chose in `words`, a candidate of it, where each
   * candidate has places of its own; absent where they are the unknown places of every candidate.
   */
  readonly placesOf?: (lists: WordLists, words: CandidateWords) => number[];
}

/** The one list of the written words of a missing-word search. */
function writtenOf(lists: WordLists): readonly number[] {
  return defined(lists[0]);
}

/**
 * Whether a field of a host's search holds a list at all, before its elements are checked; not a
 * type guard, so that the field keeps its declared type.
 */
function isList(value: unknown): boolean {
  return Array.isArray(value);
}

/** Each kind of word search, its rules with it. */
const SEARCH_KINDS = Object.freeze({
  "unknown-words": {
    parse: parseUnknownWords,
    listsOf: (search) => {
      if (!("places" in search) || !isList(search.places))
        throw ERRORS.create("word-search-places", [`${WORD_COUNTS_TEXT}`]);
      return search.places;
    },
    assertLists: (places) => {
      if (!isBip39WordCount(places.length))
        throw ERRORS.create("word-search-places", [`${WORD_COUNTS_TEXT}`]);
      if (!everyElement(places, isPlace))
        throw ERRORS.create("every-place-one-more-bip39-indexes-ascending-order", []);
    },
    wordCount: (places) => places.length,
    combinations: (places) => places.reduce((product, place) => product * place.length, 1),
    // Exactly one in 2^(words / 3) of the last place's words passes for each other combination.
    exact: (places) => defined(places.at(-1)).length === BIP39_DICTIONARY_SIZE,
    combinationsOf,
    unknownPlaces: unknownPlacesOf,
  },
  "missing-word": {
    parse: parseMissingWord,
    listsOf: (search) => {
      if (!("written" in search) || !isList(search.written))
        throw ERRORS.create("missing-word-search-one-word-fewer-than-valid", []);
      return [search.written];
    },
    assertLists: (lists) => {
      const written = lists[0];
      if (lists.length !== 1 || written === undefined || !isBip39WordCount(written.length + 1))
        throw ERRORS.create("missing-word-search-one-word-fewer-than-valid", []);
      if (!areWordIndexes(written)) throw ERRORS.create("written-word-not-bip39-index", []);
    },
    wordCount: (lists) => writtenOf(lists).length + 1,
    combinations: (lists) => (writtenOf(lists).length + 1) * BIP39_DICTIONARY_SIZE,
    // The inserted word is the last only at the last place: a combination passes on average.
    exact: () => false,
    combinationsOf: (lists) => missingWordCombinations(writtenOf(lists)),
    unknownPlaces: () => [],
    placesOf: (lists, words) => [insertedPlace(writtenOf(lists), words)],
  },
} satisfies Readonly<Record<WordSearch["kind"], SearchKind>>);

/** Whether `kind` names a kind of word search; a JavaScript host may pass any value. */
function isSearchKind(kind: unknown): kind is WordSearch["kind"] {
  return typeof kind === "string" && Object.hasOwn(SEARCH_KINDS, kind);
}

/** The rules of `kind`; refuses a kind that a host made up (core.candidates.unknown-search-kind). */
function searchKindOf(kind: unknown): SearchKind {
  if (!isSearchKind(kind)) throw ERRORS.create("unknown-search-kind", []);
  return SEARCH_KINDS[kind];
}

/**
 * The kind of `search` with its word lists, borrowed, refused unless the parsers above could have
 * made them: a kind that a host made up (core.candidates.unknown-search-kind), and what the kind's
 * assertLists refuses.
 */
function checkedSearch(search: WordSearch): {
  readonly name: WordSearch["kind"];
  readonly kind: SearchKind;
  readonly lists: WordLists;
} {
  const name = search.kind;
  const kind = searchKindOf(name);
  const lists = kind.listsOf(search);
  kind.assertLists(lists);
  return { name, kind, lists };
}

/**
 * The candidates of a search, in the order of docs/CANDIDATES.md: the combinations whose checksum
 * is valid. A yielded array may be reused for the next one; copy it to keep it. Asked for its
 * first candidate, it refuses what searchCombinations refuses (core.candidates.unknown-search-kind
 * and the others it names) and a search of more combinations than MAX_SEARCH_COMBINATIONS
 * (search-more-than-combinations).
 */
export function* searchCandidates(search: WordSearch): Generator<CandidateWords> {
  const { kind, lists } = checkedSearch(search);
  assertSearchable(kind.combinations(lists));
  yield* candidatesOf(kind, lists);
}

/** The combinations of a search of `kind` whose checksum is valid, its word lists checked. */
function* candidatesOf(kind: SearchKind, lists: WordLists): Generator<CandidateWords> {
  for (const words of kind.combinationsOf(lists)) if (checksumFits(words)) yield words;
}

/**
 * The wallet's answers about candidates as they are compared: how many matched, and the first
 * warning of the check, such as that a fingerprint is only a filter. A class, because a search
 * adds the answers one by one; the word search and a host's short list of phrases both count so.
 */
export class MatchTally {
  #matched = 0;
  #warning: string | undefined;

  /** Adds what the wallet check said of one candidate; nothing where none was compared. */
  add(match: WalletMatch | undefined): void {
    if (match?.matched === true) this.#matched += 1;
    this.#warning ??= match?.warning;
  }

  /** The candidates that matched the wallet. */
  get matched(): number {
    return this.#matched;
  }

  /** The first warning of the wallet check. */
  get warning(): string | undefined {
    return this.#warning;
  }
}

/**
 * How far a word search has come (SearchProgress): the candidates so far, each a phrase whose
 * checksum holds, and those that the wallet matched.
 */
export interface WordSearchProgress extends SearchProgress {
  /** The candidates so far that the wallet check matched; 0 without a wallet check. */
  readonly matched: number;
}

/** How a word search runs, with the host's services; `M` is what its wallet check answers. */
export interface WordSearchRun<M extends WalletMatch = WalletMatch> extends SearchRun {
  /** Compares each candidate with the wallet; without it no candidate is compared. */
  readonly walletCheck?: WalletCheck<M> | undefined;
  /** How many candidates are kept to be shown, besides those that matched; MAX_SHOWN_CANDIDATES. */
  readonly maxShown?: number | undefined;
  /** How many entropies are kept for a candidate list; 0, the default, keeps none. */
  readonly keep?: number | undefined;
  /** Called once when the candidates are more than `keep`; throw to stop the search. */
  readonly onListFull?: (() => void) | undefined;
  /** Called at each turn with the candidates so far and those that matched. */
  readonly onProgress?: ((progress: WordSearchProgress) => void) | undefined;
}

/** A caller-owned candidate kept to be shown; the caller wipes it after display. */
export interface ShownCandidate<M extends WalletMatch = WalletMatch> {
  /** The candidate, numbered from 1 in the order found; the caller wipes it. */
  readonly candidate: WordCandidate;
  /** What the wallet check said of it; absent without a wallet check. */
  readonly match?: M;
}

/** What a word search found. */
export interface WordSearchResult<M extends WalletMatch = WalletMatch> {
  /** Caller-owned candidates: the first `maxShown` and every later match; wipe each after use. */
  readonly shown: readonly ShownCandidate<M>[];
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
  /**
   * Whether the host stopped the search (SearchRun.signal): then the counts and candidates cover
   * only those checked before the stop, and no entropy is kept, since no list of a part is
   * complete (CORE-22).
   */
  readonly stopped: boolean;
}

/** Scrubs a private working copy of word lists, when its iterator ends or its owner is wiped. */
function wipeLists(lists: number[][]): void {
  for (const list of lists) list.fill(0);
}

/**
 * One search for forgotten words, read from the phrase as typed (parse) or taken from a search
 * that a host made itself (of). A class pays off here: it checks itself once, so that an invalid
 * search, or one of more than MAX_SEARCH_COMBINATIONS combinations, cannot exist; it tells its
 * size and the candidates it will find before it runs, as a page shows them while the person
 * types; and it keeps the known words in owned bytes. Input arrays are borrowed and copied.
 * The search must stay live until its asynchronous work settles. wipe/dispose refuse later
 * secret reads and publication with core.secret-value.wiped; yielded/returned candidates are
 * transferred to their caller and remain independently live.
 */
export class WordCandidateSearch extends Redacted implements Disposable {
  readonly #values: SecretValue<WordLists>;
  readonly #active = new Set<() => void>();
  readonly #kind: WordSearch["kind"];
  /** The rules of the search's kind (SEARCH_KINDS). */
  readonly #rules: SearchKind;
  readonly #wordCount: number;
  readonly #combinations: number;
  /** The places, counting from 0, that may hold more than one word. */
  readonly #unknownPlaces: readonly number[];

  private constructor(search: WordSearch) {
    super("WordCandidateSearch");
    const { name, kind, lists } = checkedSearch(search);
    // A copy, so that the caller's arrays cannot change the search once it is checked; the copy
    // is checked again, as it is what the search holds.
    const copy = lists.map((list) => [...list]);
    try {
      kind.assertLists(copy);
      const combinations = kind.combinations(copy);
      assertSearchable(combinations);
      this.#values = SecretValue.numberLists(copy);
      this.#kind = name;
      this.#rules = kind;
      this.#wordCount = kind.wordCount(copy);
      this.#combinations = combinations;
      this.#unknownPlaces = kind.unknownPlaces(copy);
    } finally {
      wipeLists(copy);
    }
  }

  /**
   * Reads the phrase as typed. For "unknown-words" each place is a word, ?, a prefix with * or
   * words joined by |; for "missing-word" it is the words there are, one fewer than a phrase has.
   * Refuses what parseUnknownWords or parseMissingWord refuses, another kind
   * (core.candidates.unknown-search-kind), and a search of more than MAX_SEARCH_COMBINATIONS
   * combinations (search-more-than-combinations).
   */
  static parse(text: string, kind: WordSearch["kind"]): WordCandidateSearch {
    return new WordCandidateSearch(searchKindOf(kind).parse(text));
  }

  /**
   * Takes a search that a host made itself, after the same checks as a parsed one: refuses what
   * searchCombinations refuses (core.candidates.unknown-search-kind and the others it names) and a
   * search of more combinations than MAX_SEARCH_COMBINATIONS (search-more-than-combinations).
   */
  static of(search: WordSearch): WordCandidateSearch {
    return new WordCandidateSearch(search);
  }

  /** The search kind; remains available as metadata after disposal. */
  get kind(): WordSearch["kind"] {
    return this.#kind;
  }

  /** The words of every candidate: 12, 15, 18, 21 or 24. */
  get wordCount(): number {
    return this.#wordCount;
  }

  /** The combinations that the search checks, at most MAX_SEARCH_COMBINATIONS. */
  get combinations(): number {
    return this.#combinations;
  }

  /** How many candidates the search finds (expectedCandidates). */
  get expected(): ExpectedCandidates {
    return expectedOf(this.#rules, this.#values.value);
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
    this.#values.assertLive();
    const placesOf = this.#rules.placesOf;
    // The unknown places are kept apart, so that a candidate's need no decoding of the search.
    if (placesOf === undefined) return [...this.#unknownPlaces];
    return placesOf(this.#values.value, candidate.words);
  }

  /**
   * The candidates in the order of docs/CANDIDATES.md, numbered from 1. A host takes as many at a
   * time as suits it, as a page does that lets its event loop run between batches, and stops when
   * it wants. Each candidate transfers to the caller, who wipes it. Disposal clears this
   * iterator's working state and refuses its next read (core.secret-value.wiped), without wiping
   * transferred candidates.
   */
  *candidates(): Generator<WordCandidate> {
    const lists = this.#values.value.map((list) => [...list]);
    const source = candidatesOf(this.#rules, lists);
    const close = (): void => {
      source.return(undefined);
      wipeLists(lists);
    };
    this.#active.add(close);
    try {
      let number = 0;
      for (const words of source) {
        this.#values.assertLive();
        number += 1;
        yield new WordCandidate(number, words);
        this.#values.assertLive();
      }
    } finally {
      close();
      this.#active.delete(close);
    }
  }

  /**
   * Runs the search with the host's services (WordSearchRun) and keeps what a host shows and
   * saves: the first `maxShown` candidates and every one that matched the wallet, each with its
   * number; the entropy of every candidate, up to `keep`, record N for candidate N. When there are
   * more candidates than `keep`, onListFull is called once: a host that throws there stops the
   * search; otherwise the entropies kept are wiped and the search goes on without them. The
   * entropies are wiped too when the search is stopped or fails. Unshown candidates are wiped
   * immediately; failures/disposal wipe all unpublished candidates. Successful and stopped
   * results transfer their shown candidates to the caller, who wipes them after use. Refuses a
   * `maxShown` or `keep` that is no whole number of 0 or more (core.search-turns.whole-number-more)
   * and an answer of the wallet check that breaks the WalletMatch contract (askWallet:
   * core.wallet-check.malformed-wallet-answer and the others it names); what walletCheck or
   * onListFull throws passes on.
   */
  async run<M extends WalletMatch = WalletMatch>(
    run: WordSearchRun<M> = {},
  ): Promise<WordSearchResult<M>> {
    this.#values.assertLive();
    const maxShown = keptCount(run.maxShown, MAX_SHOWN_CANDIDATES, "maxShown");
    const keep = keptCount(run.keep, 0, "keep");
    const shown: ShownCandidate<M>[] = [];
    let entropies: Uint8Array[] = [];
    let count = 0;
    const tally = new MatchTally();
    let listFull = false;
    let stopped = false;
    let current: WordCandidate | undefined;
    const cleanup = (): void => {
      current?.wipe();
      for (const { candidate } of shown) candidate.wipe();
      wipeAll(entropies);
    };
    this.#active.add(cleanup);
    try {
      const turns = SearchTurns.of(run);
      for (const candidate of this.candidates()) {
        current = candidate;
        let kept = false;
        try {
          if (turns.stopped) {
            stopped = true;
            break;
          }
          const match =
            run.walletCheck === undefined
              ? undefined
              : await askWallet(run.walletCheck, candidate.phrase);
          this.#values.assertLive();
          // An answer that came after a stop is neither counted nor shown (AUD-015-API001).
          if (!stillRunning(run)) {
            stopped = true;
            break;
          }
          count += 1;
          if (keep > 0 && !listFull && count > keep) {
            listFull = true;
            wipeAll(entropies);
            entropies = [];
            run.onListFull?.();
            this.#values.assertLive();
          }
          tally.add(match);
          if (keep > 0 && !listFull) entropies.push(candidate.entropy());
          if (count <= maxShown || match?.matched === true) {
            shown.push(match === undefined ? { candidate } : { candidate, match });
            kept = true;
          } else candidate.wipe();
          // Every checked candidate is a phrase whose BIP39 checksum holds.
          const turn = await turns.due();
          this.#values.assertLive();
          if (turn === "stopped") {
            stopped = true;
            break;
          }
          if (turn === "turned")
            run.onProgress?.({ checked: count, found: count, matched: tally.matched });
          this.#values.assertLive();
        } finally {
          if (!kept) candidate.wipe();
          current = undefined;
        }
      }
      this.#values.assertLive();
      // A stop after the final turn still makes the result partial, with no complete list.
      if (!stillRunning(run)) stopped = true;
      if (stopped) {
        wipeAll(entropies);
        entropies = [];
      }
      const { matched, warning } = tally;
      return { shown, entropies, count, matched, warning, listFull, stopped };
    } catch (error) {
      cleanup();
      throw error;
    } finally {
      this.#active.delete(cleanup);
    }
  }

  /** Wipes retained bytes and active working state; already transferred candidates stay live. */
  wipe(): void {
    this.#values.wipeAndClose(this.#active);
  }

  /** Ends the search lifetime; asynchronous work must settle before the caller leaves its scope. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
