// Bech32 and Bech32m strings outside SegWit, as Cosmos SDK accounts and Dash Platform addresses
// (DIP18) are written: with BIP173's own limits, where a SegWit decoder holds a string to 90
// characters.
//
// Host-neutral: it imports only @scure/base (test/portable-modules.test.ts).

import type { Bech32, Bech32Decoded } from "@scure/base";

/** BIP173: the human-readable part has 1 to 83 characters. */
const MAX_PREFIX_LENGTH = 83;
/**
 * BIP173 and BIP350: both checksums are BCH codes of length 1023. A longer string, counted whole,
 * is refused, as a string whose checksum fails.
 */
const MAX_LENGTH = 1023;

/**
 * The human-readable part, in small letters, and the five-bit groups of data of `text`, read with
 * `checksum`, the bech32 or bech32m of @scure/base; undefined when it is not a string of that
 * checksum within BIP173's limits.
 */
export function decodeBech32(text: string, checksum: Bech32): Bech32Decoded | undefined {
  const decoded = checksum.decodeUnsafe(text, MAX_LENGTH);
  return decoded && decoded.prefix.length <= MAX_PREFIX_LENGTH ? decoded : undefined;
}
