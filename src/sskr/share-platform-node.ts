// The Node.js share platform (share-platform.ts): HMAC-SHA256 from node:crypto, and SSKR from the
// bundled WASM, loaded once its integrity is checked (runtime.ts); and Node.js randomness for a
// split. Importing it also configures the platform that the older functions of joint-repair.ts
// read when they are called without one (planJointRepair, measureTriesPerSecond).
// Not for other hosts: a browser page builds its own SharePlatform and passes it in.

import { createHmac, randomFillSync } from "node:crypto";
import { sskrEngine } from "./runtime.js";
import { configureSharePlatform, type SharePlatform } from "./share-platform.js";

/** The one group that MnemoCode writes, and the group threshold it takes. */
const ONE_GROUP = 1;

/** Node.js host: OpenSSL's HMAC and the bundled, integrity-checked SSKR WASM (runtime.ts). */
export const nodeSharePlatform: SharePlatform = {
  hmacSha256: (key, message) => createHmac("sha256", key).update(message).digest(),
  combineShares: async (records) => (await sskrEngine()).recover_sskr_shares(records.join("\n")),
  createShares: async (secret, threshold, count, seed) =>
    (await sskrEngine())
      .create_sskr_shares(secret, ONE_GROUP, Uint8Array.of(threshold, count), seed)
      .trim()
      .split("\n"),
};

/** Node.js randomness for a split (split.ts): OpenSSL's generator fills the buffer in place. */
export function nodeFillRandom(bytes: Uint8Array): void {
  randomFillSync(bytes);
}

configureSharePlatform(nodeSharePlatform);
