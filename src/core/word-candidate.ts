// A caller-owned word candidate, with mutable byte storage for its retained word indexes.
import { BIP39_INDEX_BITS, phraseOfIndexes } from "./words.js";
import { areWordIndexes, entropyBytes, isBip39WordCount, WORD_COUNTS_TEXT } from "./bip39-sizes.js";
import { BITS_PER_BYTE, lastWordChecksumBits } from "./bits.js";
import { Redacted } from "./redacted.js";
import { SecretValue } from "./secret-value.js";
import { inWholeRange, wholeNumbersFrom } from "./typed-number.js";
import { defined } from "./defined.js";
import { ErrorCatalog } from "./error-catalog.js";

// Keep the established error codes when importing the candidate through candidates.ts.
const ERRORS = new ErrorCatalog("core.candidates", {
  "candidate-s-number-counts-from-1": {
    kind: "range",
    text: () => "A candidate's number counts from 1.",
  },
  "candidate-bip39-indexes": (value0: string) => `A candidate needs ${value0} BIP39 indexes.`,
});
const CANDIDATE_NUMBERS = wholeNumbersFrom(1);

/** A candidate's complete phrase as BIP39 English word indexes, 0 to 2047. */
export type CandidateWords = readonly number[];

/**
 * The BIP39 entropy that the words carry, without their checksum bits. A deliberate fast path of
 * bits.ts's bitsOfIndexes and bitsToBytes, packed in a number rather than a string because the
 * word search calls it for every combination; test/candidates.test.ts keeps it in step with
 * @scure/bip39's own checksum. The returned bytes belong to the caller, who wipes them.
 */
export function entropyOfWords(words: CandidateWords): Uint8Array {
  const entropy = new Uint8Array(entropyBytes(words.length));
  let buffer = 0;
  let bits = 0;
  let filled = 0;
  for (const word of words) {
    buffer = (buffer << BIP39_INDEX_BITS) | word;
    bits += BIP39_INDEX_BITS;
    while (bits >= BITS_PER_BYTE && filled < entropy.length) {
      bits -= BITS_PER_BYTE;
      entropy[filled++] = (buffer >>> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  return entropy;
}

/** The English phrase of word indexes; the returned string cannot be erased by its owner. */
export const phraseOfWords: (words: CandidateWords) => string = phraseOfIndexes;

/**
 * One caller-owned candidate, numbered from 1. Constructor input is borrowed and copied; words
 * and entropy return independent snapshots. wipe/dispose end secret reads with
 * core.secret-value.wiped, without recalling views already returned to the caller.
 */
export class WordCandidate extends Redacted implements Disposable {
  readonly #number: number;
  readonly #words: SecretValue<CandidateWords>;

  /**
   * Candidate `number`, counted from 1, with a copy of `words`, a phrase's BIP39 indexes; refuses
   * another number (core.candidates.candidate-s-number-counts-from-1, a RangeError) and words that
   * are no phrase's count of indexes from 0 through 2047 (core.candidates.candidate-bip39-indexes).
   */
  constructor(number: number, words: CandidateWords) {
    super("WordCandidate");
    if (!inWholeRange(number, CANDIDATE_NUMBERS))
      throw ERRORS.create("candidate-s-number-counts-from-1", []);
    if (!Array.isArray(words))
      throw ERRORS.create("candidate-bip39-indexes", [`${WORD_COUNTS_TEXT}`]);
    // Check the same snapshot that is retained, including a host array with changing getters.
    const copy = Array.from<unknown>(words);
    try {
      if (!isBip39WordCount(copy.length) || !areWordIndexes(copy))
        throw ERRORS.create("candidate-bip39-indexes", [`${WORD_COUNTS_TEXT}`]);
      this.#number = number;
      this.#words = SecretValue.numbers(copy);
    } finally {
      copy.fill(0);
    }
  }

  /** Its number among its search's candidates, counted from 1; remains readable after disposal. */
  get number(): number {
    return this.#number;
  }

  /** A fresh snapshot of BIP39 indexes, 0 to 2047; refused after wipe/dispose. */
  get words(): CandidateWords {
    return this.#words.value;
  }

  /** Its English phrase; refused after wipe/dispose. */
  get phrase(): string {
    return phraseOfWords(this.#words.value);
  }

  /** New caller-owned entropy bytes, which the caller wipes; refused after wipe/dispose. */
  entropy(): Uint8Array {
    return entropyOfWords(this.#words.value);
  }

  /** The checksum bits of its last word; refused after wipe/dispose. */
  get checksumBits(): string {
    const words = this.#words.value;
    return lastWordChecksumBits(defined(words.at(-1)), words.length);
  }

  /** Overwrites retained bytes as far as the runtime allows; idempotent. */
  wipe(): void {
    this.#words.wipe();
  }

  /** Ends the candidate's scope; the caller may also call wipe() in finally. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
