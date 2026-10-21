// The Node.js share platform (share-platform.ts): HMAC-SHA256 from node:crypto, and SSKR from the
// bundled WASM, loaded once its integrity is checked (runtime.ts); and Node.js randomness for a
// split. The Node.js front ends pass it to the share modules, which read no platform of their own.
// Not for other hosts: a browser page builds its own SharePlatform and passes it in.

import { createHmac, randomFillSync } from "node:crypto";
import { sskrEngine } from "./runtime.js";
import { ONE_GROUP, type SharePlatform } from "./share-platform.js";
import { CheckedSskrBridge } from "./bridge.js";

/**
 * Node.js host: OpenSSL's HMAC and the bundled, integrity-checked SSKR WASM (runtime.ts). The
 * records joined by line breaks and the threshold and count as a pair of bytes are the bridge's
 * own interface: create_sskr_shares and recover_sskr_shares in sskr-wasm/rust/src/lib.rs, the
 * Compact UR functions over create_sskr_shares_formatted and recover_sskr_shares_formatted, define
 * it, and this platform calls them.
 */
export const nodeSharePlatform: SharePlatform = {
  hmacSha256: (key, message) => createHmac("sha256", key).update(message).digest(),
  combineShares: async (records) => (await sskrEngine()).recover_sskr_shares(records.join("\n")),
  createShares: async (secret, threshold, count, seed) => {
    const groups = CheckedSskrBridge.groupSpecifications(threshold, count);
    return (await sskrEngine())
      .create_sskr_shares(secret, ONE_GROUP, groups, seed)
      .trim()
      .split("\n");
  },
};

/** Node.js randomness for a split (split.ts): OpenSSL's generator fills the buffer in place. */
export function nodeFillRandom(bytes: Uint8Array): void {
  randomFillSync(bytes);
}
