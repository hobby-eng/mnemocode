// The six kinds of single-key receiving address that the coins of core/coins.ts read, the first
// step of their standard paths, and what each commits to for one compressed secp256k1 public key:
// its HASH160, the HASH160 of its P2WPKH script, its BIP86 Taproot output key, or the last 20 bytes
// of the Keccak-256 of the uncompressed key. Only public keys enter here.
//
// Host-neutral: it imports only @noble/hashes and @noble/curves (test/portable-modules.test.ts).

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * How an address commits to a public key. p2pkh: HASH160 of the key, as legacy addresses ("1…",
 * "L…", "D…", "X…", "t1…", a Bitcoin Cash "q…"), XRP and Cosmos have it; p2sh-p2wpkh: nested SegWit,
 * "3…" or "M…"; p2wpkh: native SegWit, "bc1q…" or "ltc1q…"; p2tr: Taproot, "bc1p…"; keccak: the
 * account of Ethereum, its networks, Ethereum Classic, Tron and Injective; dash-platform: a Dash
 * Platform payment address, "dash1k…", HASH160 of the key written after DIP18's type byte.
 */
export type AddressType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr" | "keccak" | "dash-platform";

/** The first step of its standard paths: the BIP of the same number, or DIP9's 9 for Dash's. */
export const ADDRESS_PURPOSES: Readonly<Record<AddressType, number>> = {
  p2pkh: 44,
  keccak: 44,
  "p2sh-p2wpkh": 49,
  p2wpkh: 84,
  p2tr: 86,
  "dash-platform": 9,
};

/** What a person calls it, where a coin has several kinds. */
export const ADDRESS_TYPE_NAMES: Readonly<Record<AddressType, string>> = {
  p2pkh: "legacy",
  "p2sh-p2wpkh": "nested SegWit",
  p2wpkh: "native SegWit",
  p2tr: "Taproot",
  keccak: "Keccak",
  "dash-platform": "Platform payment",
};

/** RIPEMD-160 gives 160 bits: a HASH160 is 20 bytes. */
const HASH160_BYTES = 20;
/** The Ethereum yellow paper: an account is the last 20 bytes of the key's Keccak-256. */
const KECCAK_ACCOUNT_BYTES = 20;
/** BIP340: a Taproot key is written as its x coordinate alone, 32 bytes. */
const X_ONLY_KEY_BYTES = 32;

/** How many bytes an address of each type commits to: what it holds after its prefix or version. */
export const COMMITMENT_BYTES: Readonly<Record<AddressType, number>> = {
  p2pkh: HASH160_BYTES,
  "p2sh-p2wpkh": HASH160_BYTES,
  p2wpkh: HASH160_BYTES,
  p2tr: X_ONLY_KEY_BYTES,
  keccak: KECCAK_ACCOUNT_BYTES,
  "dash-platform": HASH160_BYTES,
};

/**
 * BIP141: the redeem script of nested SegWit is OP_0, a push of 20 bytes, and the key's HASH160.
 * Named without the script type, which an edition of one other coin may not carry even as a name.
 */
const WITNESS_KEY_HASH_PREFIX = [0x00, 0x14];
/** BIP341: the tag of the hash that tweaks a Taproot internal key. */
const TAP_TWEAK_TAG = "TapTweak";

/** What an address of `type` commits to for `publicKey`, a compressed secp256k1 key. */
export function commitmentOf(type: AddressType, publicKey: Uint8Array): Uint8Array {
  switch (type) {
    case "p2pkh":
    case "p2wpkh":
    case "dash-platform":
      return hash160(publicKey);
    case "p2sh-p2wpkh":
      return hash160(Uint8Array.of(...WITNESS_KEY_HASH_PREFIX, ...hash160(publicKey)));
    case "p2tr":
      return taprootOutputKey(publicKey);
    case "keccak":
      return keccakAccount(publicKey);
  }
}

/** RIPEMD-160 of SHA-256, Bitcoin's hash of keys and scripts. */
function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

/**
 * BIP86: the key-path-only Taproot output key Q = P + t·G, where P is the key with an even Y and t
 * the BIP340 tagged hash "TapTweak" of its x (BIP341). Public values only, so the faster scalar
 * multiplication that is not constant-time is fine.
 */
function taprootOutputKey(publicKey: Uint8Array): Uint8Array {
  const { Point } = secp256k1;
  const point = Point.fromBytes(publicKey);
  const internal = point.y % 2n === 0n ? point : point.negate();
  const xOnly = schnorr.utils.pointToBytes(internal);
  const tweak = bigEndian(schnorr.utils.taggedHash(TAP_TWEAK_TAG, xOnly));
  // BIP341 fails when t is not below the group order or Q is the point at infinity: about 2^-128.
  if (tweak >= Point.Fn.ORDER) throw new Error("BIP341 gives no Taproot output key for this key.");
  const output = internal.add(Point.BASE.multiplyUnsafe(tweak));
  if (output.is0()) throw new Error("BIP341 gives no Taproot output key for this key.");
  return schnorr.utils.pointToBytes(output);
}

/** The last 20 bytes of Keccak-256 of the 64 bytes of the uncompressed key, without its 04 byte. */
function keccakAccount(publicKey: Uint8Array): Uint8Array {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return keccak_256(uncompressed.subarray(1)).subarray(-KECCAK_ACCOUNT_BYTES);
}

function bigEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}
