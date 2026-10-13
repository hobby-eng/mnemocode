// Hints for a word being typed, by the rule of mhfe (src/word_hints.rs, the owner's rule of
// 2026-10-08): from LIST_FROM_LETTERS letters on, the words of the list that begin with them;
// after one letter, how many words do; a warning when none does. Tab completes a word as far as
// the words that begin with it agree. Every front end that takes typed words shows them through
// this module: the command line's questions below the typed line (cli/typed-hints.ts) and any
// page that offers the same fields.
//
// The lists are public, so a hint tells nothing that a person who sees the screen could not look
// up; a front end shows one only where the typed text itself is shown.
//
// Host-neutral: it imports only the English BIP39 list.

import { englishWordlist } from "./english-words.js";

/** Letters typed before the words that begin with them are listed; fewer give how many there are. */
export const LIST_FROM_LETTERS = 2;

/** What a front end shows below a word being typed. */
export type WordHint =
  /** Nothing: no word is being typed, or the list has it whole and no longer word begins with it. */
  | { readonly kind: "nothing" }
  /** One letter typed: how many words of the list begin with it, as `text` says. */
  | { readonly kind: "count"; readonly count: number; readonly text: string }
  /** LIST_FROM_LETTERS letters or more: the words that begin with them, in list order. */
  | { readonly kind: "words"; readonly words: readonly string[] }
  /** No word of the list begins with what is typed, as `text` says. */
  | { readonly kind: "no-word"; readonly text: string };

/** What Tab adds to the word being typed. */
export interface WordCompletion {
  /** The letters every word that begins with the typed ones has next; empty when they differ. */
  readonly letters: string;
  /** Whether one word is left, so that the word ends and a space follows. */
  readonly wordEnds: boolean;
}

/**
 * Where the words of a typed line are hinted from: the one interface that every front end takes.
 * `line` is the text typed before the cursor; the hint and the completion are about its last word.
 */
export interface WordHints {
  hint(line: string): WordHint;
  completion(line: string): WordCompletion;
}

const NOTHING: WordHint = Object.freeze({ kind: "nothing" });
const NO_COMPLETION: WordCompletion = Object.freeze({ letters: "", wordEnds: false });

/** What a person reads a list's words as: "BIP39 word" and "BIP39 words". */
export interface WordNames {
  readonly one: string;
  readonly many: string;
}

/** Letters and hyphens, as every word of a list has them; anything else is no word being typed. */
const WORD_CHARACTERS = /^[A-Za-z-]+$/u;

/** A sorted word list that typed words are hinted from. */
export class WordList implements WordHints {
  /** The English BIP39 list: seed phrases and encoded seed phrases in English words. */
  static readonly BIP39 = new WordList({ one: "BIP39 word", many: "BIP39 words" }, englishWordlist);

  readonly #names: WordNames;
  readonly #words: readonly string[];
  /** The length of the longest word: a longer typed word begins none. */
  readonly #longest: number;

  /**
   * The list `words`, in lower case and in alphabetical order, which the search relies on; any
   * other is refused.
   */
  constructor(names: WordNames, words: readonly string[]) {
    words.forEach((word, index) => {
      if (!WORD_CHARACTERS.test(word) || word !== word.toLowerCase())
        throw new Error("A word list holds lower-case letters and hyphens only.");
      if (index > 0 && words[index - 1]! >= word)
        throw new Error("A word list must be in alphabetical order without repeats.");
    });
    this.#names = Object.freeze({ ...names });
    this.#words = Object.freeze([...words]);
    this.#longest = Math.max(0, ...words.map((word) => word.length));
  }

  /** The hint for the last word of `line`, the text typed so far. */
  hint(line: string): WordHint {
    const typed = this.#lastWord(line);
    if (typed === undefined) return NOTHING;
    const matches = typed === "" ? [] : this.#startingWith(typed);
    if (matches.length === 0) return this.#noWord();
    if (matches.length === 1 && matches[0] === typed) return NOTHING;
    if (typed.length < LIST_FROM_LETTERS) {
      const count = matches.length;
      const begins = count === 1 ? `${this.#names.one} begins` : `${this.#names.many} begin`;
      return Object.freeze({ kind: "count", count, text: `${count} ${begins} with this letter` });
    }
    return Object.freeze({ kind: "words", words: matches });
  }

  /** What Tab adds to the last word of `line` (WordCompletion). */
  completion(line: string): WordCompletion {
    const typed = this.#lastWord(line);
    if (typed === undefined || typed === "") return NO_COMPLETION;
    const matches = this.#startingWith(typed);
    const first = matches[0];
    const last = matches.at(-1);
    if (first === undefined || last === undefined) return NO_COMPLETION;
    // The list is sorted, so the first and the last word share what all of them share.
    let shared = typed.length;
    while (shared < first.length && first[shared] === last[shared]) shared += 1;
    return Object.freeze({
      letters: first.slice(typed.length, shared),
      wordEnds: matches.length === 1,
    });
  }

  #noWord(): WordHint {
    return Object.freeze({ kind: "no-word", text: `No ${this.#names.one} begins like this.` });
  }

  /**
   * The last word of `line` in lower case: after its last white space, letters and hyphens only.
   * Undefined when no word is being typed: an empty line, white space at its end, or other
   * characters, such as a ? or a code. A word longer than the longest of the list is "", which
   * begins none (AUD-015-UI004 of mhfe).
   */
  #lastWord(line: string): string | undefined {
    const word = line.split(/\s/u).at(-1) ?? "";
    if (!WORD_CHARACTERS.test(word)) return undefined;
    return word.length > this.#longest ? "" : word.toLowerCase();
  }

  /** The words that begin with `letters`, in list order. */
  #startingWith(letters: string): readonly string[] {
    const start = firstAtLeast(this.#words, letters);
    let end = start;
    while (end < this.#words.length && this.#words[end]!.startsWith(letters)) end += 1;
    return this.#words.slice(start, end);
  }
}

/** The place of the first word of the sorted `words` that is not before `letters`. */
function firstAtLeast(words: readonly string[], letters: string): number {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (words[middle]! < letters) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The hints of a line that may be written in more than one form, such as the codes of an encoded
 * seed phrase or shares: those of the list that `listOf` finds for the part of the line being
 * typed, and none where that part is written in a form without words. The part is what `partOf`
 * takes of the line: all of it, or the last of several answers, such as the share after the
 * shares before it.
 */
export class LineWordHints implements WordHints {
  readonly #listOf: (part: string) => WordList | undefined;
  readonly #partOf: (line: string) => string;

  constructor(
    listOf: (part: string) => WordList | undefined,
    partOf: (line: string) => string = (line) => line,
  ) {
    this.#listOf = listOf;
    this.#partOf = partOf;
  }

  hint(line: string): WordHint {
    const part = this.#partOf(line);
    return this.#listOf(part)?.hint(part) ?? NOTHING;
  }

  completion(line: string): WordCompletion {
    const part = this.#partOf(line);
    return this.#listOf(part)?.completion(part) ?? NO_COMPLETION;
  }
}
