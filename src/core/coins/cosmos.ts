// Accounts of Cosmos SDK chains, such as "cosmos1…" or "inj1…": a chain's prefix and a 20-byte
// account in Bech32 (BIP173). Cosmos hashes the key with HASH160; Injective takes the Keccak account
// of Ethereum, whose coin type its wallets use.
//
// Host-neutral: it imports only coin.ts, address-types.ts, bech32.ts and @scure/base
// (test/portable-modules.test.ts).

import { bech32 } from "@scure/base";
import type { AddressType } from "./address-types.js";
import { decodeBech32 } from "./bech32.js";
import {
  asciiLowercase,
  Coin,
  DAMAGED,
  invalidAddress,
  WRONG_LENGTH,
  type CoinAddress,
  type CoinDescription,
} from "./coin.js";

/** A 160-bit account is exactly 32 five-bit groups, with no padding. */
const ACCOUNT_GROUPS = 32;

/** A Cosmos SDK chain: its account prefix and how its account commits to the key. */
class Bech32AccountCoin extends Coin {
  readonly #prefix: string;
  readonly #type: AddressType;

  constructor(
    description: CoinDescription & { readonly prefix: string; readonly type: AddressType },
  ) {
    super(description);
    this.#prefix = description.prefix;
    this.#type = description.type;
  }

  protected read(text: string): CoinAddress {
    // Bech32, never Bech32m: the same data with the other checksum is no account.
    const decoded = decodeBech32(text, bech32);
    if (!decoded) throw invalidAddress(DAMAGED);
    if (decoded.prefix !== this.#prefix) throw this.notOurs();
    // Counted in groups, so that an extra group under a valid checksum is refused for its length.
    if (decoded.words.length !== ACCOUNT_GROUPS) throw invalidAddress(WRONG_LENGTH);
    return this.address(this.#type, bech32.fromWords(decoded.words), asciiLowercase(text));
  }
}

export const COSMOS = new Bech32AccountCoin({
  id: "cosmos",
  name: "Cosmos",
  addressForms: "cosmos1…",
  coinTypes: [118],
  prefix: "cosmos",
  type: "p2pkh",
});

export const INJECTIVE = new Bech32AccountCoin({
  id: "injective",
  name: "Injective",
  addressForms: "inj1…",
  coinTypes: [60],
  prefix: "inj",
  type: "keccak",
});
