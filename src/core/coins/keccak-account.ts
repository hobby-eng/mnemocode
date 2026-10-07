// What an Ethereum-style account commits to: the last 20 bytes of the Keccak-256 of the key.
// Ethereum, its networks, Ethereum Classic, Tron (evm.ts) and Injective (cosmos.ts) take it.
//
// Host-neutral: it imports only @noble/curves and @noble/hashes (test/portable-modules.test.ts).

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** The Ethereum yellow paper: an account is the last 20 bytes of the key's Keccak-256. */
export const KECCAK_ACCOUNT_BYTES = 20;

/** The last 20 bytes of Keccak-256 of the 64 bytes of the uncompressed key, without its 04 byte. */
export function keccakAccount(publicKey: Uint8Array): Uint8Array {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return keccak_256(uncompressed.subarray(1)).subarray(-KECCAK_ACCOUNT_BYTES);
}
