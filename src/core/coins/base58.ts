// Base58Check addresses, as Bitcoin writes them: a version prefix and a 20-byte hash, followed by
// the first four bytes of their double SHA-256, in Bitcoin's alphabet or a coin's own. The coins
// that write all their addresses so are instances of Base58Coin; the families that write some in
// another form extend it.
//
// Host-neutral: it imports only coin.ts, address-types.ts, @scure/base and @noble/hashes
// (test/portable-modules.test.ts).

import { sha256 } from "@noble/hashes/sha2.js";
import { base58, type BytesCoder } from "@scure/base";
import { COMMITMENT_BYTES, type AddressType } from "./address-types.js";
import {
  Coin,
  DAMAGED,
  invalidAddress,
  WRONG_LENGTH,
  type CoinAddress,
  type CoinDescription,
} from "./coin.js";

/** One version prefix of a coin's addresses, and what it names. */
export interface Base58Version {
  readonly prefix: readonly number[];
  readonly type: AddressType;
  /** A Bitcoin test network address, on coin type 1. */
  readonly testnet: boolean;
}

export interface Base58CoinDescription extends CoinDescription {
  /** In the order they are tried: the first prefix that the decoded bytes start with names them. */
  readonly versions: readonly Base58Version[];
  /** The coin's Base58 alphabet; Bitcoin's when it has none of its own. */
  readonly alphabet?: BytesCoder;
}

/** Base58Check: four bytes of double SHA-256 close the data. */
const CHECKSUM_BYTES = 4;

/** A coin whose addresses, or some of them, are Base58Check. */
export class Base58Coin extends Coin {
  readonly #versions: readonly Base58Version[];
  readonly #alphabet: BytesCoder;

  constructor(description: Base58CoinDescription) {
    super(description);
    this.#versions = description.versions;
    this.#alphabet = description.alphabet ?? base58;
  }

  protected read(text: string): CoinAddress {
    return this.readBase58(text);
  }

  /** `text` as a Base58Check address of one of the coin's versions. */
  protected readBase58(text: string): CoinAddress {
    const data = checkedData(text, this.#alphabet);
    if (data === undefined) throw invalidAddress(DAMAGED);
    const version = this.#versions.find(({ prefix }) =>
      prefix.every((byte, position) => data[position] === byte),
    );
    if (version === undefined) throw this.notOurs();
    const hash = data.subarray(version.prefix.length);
    if (hash.length !== COMMITMENT_BYTES[version.type]) throw invalidAddress(WRONG_LENGTH);
    // Base58 writes given bytes in one way only, so the address as typed is its standard form.
    return this.address(version.type, hash, text, version.testnet);
  }
}

/** The data of a Base58Check string, or undefined when it is not one or its checksum fails. */
function checkedData(text: string, alphabet: BytesCoder): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = alphabet.decode(text);
  } catch {
    return undefined;
  }
  if (bytes.length < CHECKSUM_BYTES) return undefined;
  const data = bytes.subarray(0, bytes.length - CHECKSUM_BYTES);
  const checksum = sha256(sha256(data)).subarray(0, CHECKSUM_BYTES);
  return checksum.every((byte, position) => bytes[data.length + position] === byte)
    ? data
    : undefined;
}
