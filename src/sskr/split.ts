// Splits a BIP39 seed phrase into the SSKR shares of one group, and checks that they give it back.
//
// Needs from the host: a SharePlatform (share-platform.ts) for its SSKR library, createShares and
// combineShares, and a function that fills a buffer with secure random bytes, for the seed of the
// split (crypto.getRandomValues in a browser, nodeFillRandom in Node.js).
// Does not: run the SSKR self-test (the Node.js wrapper in shares.ts does, before it splits), mask
// the phrase with Seedshift (the caller splits the phrase it wants kept), or write the shares in a
// form other than their UR (transport.ts writes them).

import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { validatedEnglishWords } from "../core/words.js";
import { SEED_BYTES, type SharePlatform } from "./share-platform.js";
import { validateShareSet } from "./transport.js";

/** SSKR allows at most 16 members in a group (sskr 0.13, MAX_SHARE_COUNT). */
export const MAX_SHARES = 16;
/** A threshold of 1 copies the secret into every share, unchecked (share-set.ts). */
const MIN_THRESHOLD = 2;

/**
 * A split of seed phrases into shares, bound once to the host's SSKR library and randomness. A
 * class, so that a page builds it once with its services and calls split for each phrase; it keeps
 * no secret between two splits: the entropy and the seed of each are wiped before it returns.
 */
export class ShareSplit {
  readonly #platform: SharePlatform;
  readonly #fillRandom: (bytes: Uint8Array) => void;

  constructor(platform: SharePlatform, fillRandom: (bytes: Uint8Array) => void) {
    this.#platform = platform;
    this.#fillRandom = fillRandom;
  }

  /** Refuses a threshold and share count that SSKR cannot split into. */
  static validateThreshold(threshold: number, count: number): void {
    if (
      !Number.isSafeInteger(threshold) ||
      !Number.isSafeInteger(count) ||
      threshold < MIN_THRESHOLD ||
      count < threshold ||
      count > MAX_SHARES
    )
      throw new Error(`SSKR requires 2 <= threshold <= shares <= ${MAX_SHARES}.`);
  }

  /**
   * The `count` shares of `mnemonic`, `threshold` of them needed, as UR records in member order.
   * The first `threshold` are restored before they are returned, and must give the phrase back.
   */
  async split(mnemonic: string, threshold: number, count: number): Promise<string[]> {
    ShareSplit.validateThreshold(threshold, count);
    const entropy = mnemonicToEntropy(validatedEnglishWords(mnemonic).join(" "), wordlist);
    const seed = new Uint8Array(SEED_BYTES);
    try {
      this.#fillRandom(seed);
      const records = await this.#platform.createShares(entropy, threshold, count, seed);
      if (records.length !== count)
        throw new Error("SSKR engine returned an unexpected share count.");
      const validated = validateShareSet(records);
      await this.#assertRestores(validated.slice(0, threshold), entropy);
      return validated;
    } finally {
      entropy.fill(0);
      seed.fill(0);
    }
  }

  async #assertRestores(records: readonly string[], entropy: Uint8Array): Promise<void> {
    const restored = await this.#platform.combineShares(records);
    try {
      if (
        restored.length !== entropy.length ||
        restored.some((byte, index) => byte !== entropy[index])
      )
        throw new Error("SSKR generated shares did not reconstruct the source entropy.");
    } finally {
      restored.fill(0);
    }
  }
}
