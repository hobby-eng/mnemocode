import { errorCode } from "../core/refusal.js";

/**
 * Host service for restoring complete SSKR shares.
 *
 * The share modules are platform-neutral (split.ts, share-set.ts, joint-repair.ts). What only the
 * host has comes in through narrow interfaces: Node.js supplies them through `share-platform-node.ts`,
 * with node:crypto and the bundled SSKR WASM, and another host, such as a browser page, supplies
 * its own, as it does for the card renderers (export/platform.ts). Every share module that needs it
 * takes it as a parameter (split.ts, share-set.ts, share-input.ts, joint-repair.ts); none reads a
 * platform configured beforehand.
 */
export interface ShareCombiner {
  /**
   * Fresh owned entropy, or ShareCombineRefusalError/the matching native code for an invalid
   * quorum only. Other host/initialization failures propagate, never become failed candidates.
   */
  readonly combineShares: (records: readonly string[]) => Promise<Uint8Array>;
}

// Deliberate copy of Refusal::Combine.code() in the pinned Rust engine: hosts need the refusal
// contract without loading WASM. The native code interoperability is tested with actual quorums.
const COMBINATION_REFUSAL = "sskr.engine.combine";

/** An expected invalid-quorum/digest outcome for a host-provided SSKR combiner. */
export class ShareCombineRefusalError extends Error {
  /** Stable native-compatible code, never an operational/initialization failure. */
  readonly code = COMBINATION_REFUSAL;

  constructor() {
    super("The SSKR shares do not restore a secret.");
  }

  /** Classifies an explicit host/native combination refusal; never matches message text. */
  static is(error: unknown): boolean {
    return errorCode(error) === COMBINATION_REFUSAL;
  }
}

/** The host services needed to repair marked shares: digest checks and complete restoration. */
export interface ShareRepairPlatform extends ShareCombiner {
  /**
   * HMAC-SHA256 of `message` under `key`. Synchronous: the search calls it for every try. Returns
   * a fresh array of the 32 bytes of the MAC, which the caller owns and may wipe once it has
   * compared it; never storage that the host reuses or a view of `key` or `message`, which stay
   * the caller's and are not changed.
   */
  readonly hmacSha256: (key: Uint8Array, message: Uint8Array) => Uint8Array;
}

/** The host services needed to split a phrase and verify that the created shares restore it. */
export interface ShareSplitPlatform extends ShareCombiner {
  /**
   * Shares of one group that split `secret`, `threshold` of `count` needed, as UR records, from
   * the host's SSKR library; `seed` (SEED_BYTES of fresh randomness) seeds its random numbers.
   * The library may wipe `seed`; its caller wipes it too.
   */
  readonly createShares: (
    secret: Uint8Array,
    threshold: number,
    count: number,
    seed: Uint8Array,
  ) => Promise<string[]>;
}

/** All SSKR host services together; operations accept only the subset they use. */
export interface SharePlatform extends ShareRepairPlatform, ShareSplitPlatform {}

/**
 * Random bytes that seed one split: the SSKR WASM takes exactly 32, the seed of its ChaCha20
 * generator (sskr-wasm/rust/src/lib.rs). A deliberate copy across the languages, which the WASM
 * cannot export before it is loaded; test/sskr-vectors.test.ts keeps it in step by asking the
 * engine to take this length and refuse one byte less or more.
 */
export const SEED_BYTES = 32;

/**
 * The one group that MnemoCode writes, and so the group threshold it takes: createShares makes
 * shares of one group, which every host's bridge is asked for.
 */
export const ONE_GROUP = 1;
