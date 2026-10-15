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
  | { readonly kind: "unknown-words"; readonly places: readonly WordPlace[] }
  | { readonly kind: "missing-word"; readonly written: readonly number[] };

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
 * place is counted from 1 and named only by its number in a refusal.
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
  const words = written.split("|");
  const indexes = words.map((word) => ENGLISH_INDEX.get(word));
  if (indexes.some((index) => index === undefined))
    throw ERRORS.create("unknown-english-bip39-word-at", [`${where}`]);
  return [...new Set(indexes as number[])].sort((a, b) => a - b);
}

/** Reads a phrase with unknown words at known places; at least one place must be unknown. */
export function parseUnknownWords(text: string): WordSearch {
  const written = englishTokens(text);
  if (!isBip39WordCount(written.length))
    throw ERRORS.create("enter-places-words-prefix-b", [`${WORD_COUNTS_TEXT}`]);
  const places = written.map((word, index) => wordPlaceOf(word, index + 1));
  if (places.every((place) => place.length === 1))
    throw ERRORS.create("mark-each-forgotten-word-prefix-b", []);
  return { kind: "unknown-words", places };
}

/** Reads a phrase with one word missing at an unknown place: one word fewer than a valid length. */
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
    everyElement(
      place,
      (index, at) => isWordIndex(index) && (at === 0 || (index as number) > place[at - 1]),
    )
  );
}

/** Why a search is refused whose kind a JavaScript host made up. */
const UNKNOWN_SEARCH_KIND = "Unknown kind of word search.";

/**
 * Refuses a search that the parsers above could not have made: another host may build its own,
 * and an empty place, for one, would never end (AUD-008-API003).
 */
function assertSearch(search: WordSearch): void {
  if (search.kind === "missing-word") {
    if (!Array.isArray(search.written) || !isBip39WordCount(search.written.length + 1))
      throw ERRORS.create("missing-word-search-one-word-fewer-than-valid", []);
    if (!areWordIndexes(search.written)) throw ERRORS.create("written-word-not-bip39-index", []);
    return;
  }
  if (search.kind !== "unknown-words") throw ERRORS.create("unknown-search-kind", []);
  if (!Array.isArray(search.places) || !isBip39WordCount(search.places.length))
    throw ERRORS.create("word-search-places", [`${WORD_COUNTS_TEXT}`]);
  if (!everyElement(search.places, isPlace))
    throw ERRORS.create("every-place-one-more-bip39-indexes-ascending-order", []);
}

/** The combinations a search checks: the work it takes, which MAX_SEARCH_COMBINATIONS bounds. */
export function searchCombinations(search: WordSearch): number {
  assertSearch(search);
  if (search.kind === "missing-word") return (search.written.length + 1) * BIP39_DICTIONARY_SIZE;
  return search.places.reduce((product, place) => product * place.length, 1);
}

/**
 * Refuses a search of more combinations than MAX_SEARCH_COMBINATIONS, with `narrow`, what makes it
 * smaller in the words of its search: the word search and the search of marked codes say it so.
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
 */
export function expectedCandidates(search: WordSearch): ExpectedCandidates {
  const combinations = searchCombinations(search);
  const wordCount =
    search.kind === "unknown-words" ? search.places.length : search.written.length + 1;
  const passing = combinations * checksumPassShare(wordCount);
  const exact =
    search.kind === "unknown-words" &&
    defined(search.places.at(-1)).length === BIP39_DICTIONARY_SIZE;
  // At least one: the right phrase is always among the candidates, and the time of a search is
  // planned by this count.
  return { count: exact ? passing : Math.max(1, Math.round(passing)), exact };
}

/**
 * Whether `words`, a phrase of BIP39 word indexes, ends with the checksum of its entropy. A host
 * may pass anything at run time, so the indexes are checked first (assertPhraseIndexes): an index
 * out of range is no phrase at all, not one of a valid or wrong checksum.
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
 * that the counter ends (AUD-012-API001).
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
 * The candidates of a search, in the order of docs/CANDIDATES.md: the combinations whose checksum
 * is valid. A yielded array may be reused for the next one; copy it to keep it.
 */
export function* searchCandidates(search: WordSearch): Generator<CandidateWords> {
  assertSearchable(searchCombinations(search));
  const combinations =
    search.kind === "unknown-words"
      ? combinationsOf(search.places)
      : missingWordCombinations(search.written);
  for (const words of combinations) if (checksumFits(words)) yield words;
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
  readonly candidate: WordCandidate;
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

/** A private working copy; it is scrubbed when its iterator ends or its owner is wiped. */
type WorkingSearch =
  | { readonly kind: "unknown-words"; readonly places: number[][] }
  | { readonly kind: "missing-word"; readonly written: number[] };

function wipeWorkingSearch(search: WorkingSearch): void {
  if (search.kind === "unknown-words") {
    for (const place of search.places) place.fill(0);
  } else search.written.fill(0);
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
  readonly #values: SecretValue<readonly WordPlace[]>;
  readonly #active = new Set<() => void>();
  readonly #kind: WordSearch["kind"];
  readonly #wordCount: number;
  readonly #combinations: number;
  /** The places, counting from 0, that may hold more than one word. */
  readonly #unknownPlaces: readonly number[];

  private constructor(search: WordSearch) {
    super("WordCandidateSearch");
    assertSearch(search);
    // A copy, so that the caller's arrays cannot change the search once it is checked.
    const copy: WorkingSearch =
      search.kind === "unknown-words"
        ? { kind: search.kind, places: search.places.map((place) => [...place]) }
        : { kind: search.kind, written: [...search.written] };
    try {
      const combinations = searchCombinations(copy);
      assertSearchable(combinations);
      this.#values = SecretValue.numberLists(
        copy.kind === "unknown-words" ? copy.places : [copy.written],
      );
      this.#kind = copy.kind;
      this.#wordCount =
        copy.kind === "unknown-words" ? copy.places.length : copy.written.length + 1;
      this.#combinations = combinations;
      this.#unknownPlaces = copy.kind === "unknown-words" ? unknownPlacesOf(copy.places) : [];
    } finally {
      wipeWorkingSearch(copy);
    }
  }

  /**
   * Reads the phrase as typed. For "unknown-words" each place is a word, ?, a prefix with * or
   * words joined by |; for "missing-word" it is the words there are, one fewer than a phrase has.
   */
  static parse(text: string, kind: WordSearch["kind"]): WordCandidateSearch {
    if (kind === "unknown-words") return new WordCandidateSearch(parseUnknownWords(text));
    if (kind === "missing-word") return new WordCandidateSearch(parseMissingWord(text));
    throw ERRORS.create("unknown-search-kind", []);
  }

  /** Takes a search that a host made itself, after the same checks as a parsed one. */
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
    return expectedCandidates(this.#snapshot());
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
    if (this.#kind === "unknown-words") return [...this.#unknownPlaces];
    return [insertedPlace(defined(this.#values.value[0]), candidate.words)];
  }

  #snapshot(): WordSearch {
    const values = this.#values.value;
    return this.#kind === "unknown-words"
      ? { kind: this.#kind, places: values }
      : { kind: this.#kind, written: defined(values[0]) };
  }

  /**
   * The candidates in the order of docs/CANDIDATES.md, numbered from 1. A host takes as many at a
   * time as suits it, as a page does that lets its event loop run between batches, and stops when
   * it wants. Each candidate transfers to the caller, who wipes it. Disposal clears this
   * iterator's working state and refuses its next read, without wiping transferred candidates.
   */
  *candidates(): Generator<WordCandidate> {
    const values = this.#values.value.map((place) => [...place]);
    const search: WorkingSearch =
      this.#kind === "unknown-words"
        ? { kind: this.#kind, places: values }
        : { kind: this.#kind, written: defined(values[0]) };
    const source = searchCandidates(search);
    const close = (): void => {
      source.return(undefined);
      wipeWorkingSearch(search);
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
   * results transfer their shown candidates to the caller, who wipes them after use.
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
