import { createHmac } from "node:crypto";
import { sskrEngine } from "./runtime.js";
import { configureSharePlatform, type SharePlatform } from "./share-platform.js";

/** Node.js host: OpenSSL's HMAC and the bundled, integrity-checked SSKR WASM (runtime.ts). */
export const nodeSharePlatform: SharePlatform = {
  hmacSha256: (key, message) => createHmac("sha256", key).update(message).digest(),
  combineShares: async (records) => (await sskrEngine()).recover_sskr_shares(records.join("\n")),
};

configureSharePlatform(nodeSharePlatform);
