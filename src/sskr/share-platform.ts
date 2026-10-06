/**
 * Host services for repairing shares (joint-repair.ts).
 *
 * The repair itself is platform-neutral. The digest check and the SSKR library come from the
 * host: Node.js supplies them through `share-platform-node.ts`, with node:crypto and the bundled
 * SSKR WASM, and another host, such as a browser page, supplies its own, as it does for the card
 * renderers (export/platform.ts).
 */
export interface SharePlatform {
  /** HMAC-SHA256 of `message` under `key`. Synchronous: the search calls it for every try. */
  readonly hmacSha256: (key: Uint8Array, message: Uint8Array) => Uint8Array;
  /** The secret that complete shares restore, from the host's SSKR library; throws if none. */
  readonly combineShares: (records: readonly string[]) => Promise<Uint8Array>;
}

let configured: SharePlatform | undefined;

export function configureSharePlatform(platform: SharePlatform): void {
  configured = platform;
}

export function sharePlatform(): SharePlatform {
  if (configured === undefined)
    throw new Error(
      "Share repair has no platform. Node.js programs import mnemocode/sskr or sskr/share-platform-node.js; other hosts call configureSharePlatform first.",
    );
  return configured;
}
