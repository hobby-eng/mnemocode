/**
 * Host services for SSKR shares: the digest check and the SSKR library.
 *
 * The share modules are platform-neutral (split.ts, share-set.ts, joint-repair.ts). What only the
 * host has comes in through this interface: Node.js supplies it through `share-platform-node.ts`,
 * with node:crypto and the bundled SSKR WASM, and another host, such as a browser page, supplies
 * its own, as it does for the card renderers (export/platform.ts). split.ts, share-set.ts,
 * share-input.ts and JointRepair (joint-repair.ts) take the platform as a parameter. Only the older
 * functions of joint-repair.ts, planJointRepair and measureTriesPerSecond called without one, read
 * the platform configured here, as the Node.js entry configures it (share-platform-node.ts).
 */
export interface SharePlatform {
  /** HMAC-SHA256 of `message` under `key`. Synchronous: the search calls it for every try. */
  readonly hmacSha256: (key: Uint8Array, message: Uint8Array) => Uint8Array;
  /** The secret that complete shares restore, from the host's SSKR library; throws if none. */
  readonly combineShares: (records: readonly string[]) => Promise<Uint8Array>;
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

/** Random bytes that seed one split: the SSKR WASM takes exactly 32 (sskr-wasm/rust/src/lib.rs). */
export const SEED_BYTES = 32;

let configured: SharePlatform | undefined;

export function configureSharePlatform(platform: SharePlatform): void {
  configured = platform;
}

export function sharePlatform(): SharePlatform {
  if (configured === undefined)
    throw new Error(
      "Share repair has no platform. Node.js programs import mnemocode/sskr or sskr/share-platform-node.js; other hosts pass their SharePlatform to JointRepair.",
    );
  return configured;
}
