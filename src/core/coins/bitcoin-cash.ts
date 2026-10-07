// Bitcoin Cash: CashAddr addresses, with or without their "bitcoincash:" prefix, and the legacy
// Base58Check form "1…" that it shares with Bitcoin. Its wallets use its own coin type or, as the
// chain it forked from, Bitcoin's.
//
// Host-neutral: it imports only base58.ts, coin.ts, address-types.ts and @scure/base
// (test/portable-modules.test.ts).

import { bech32 } from "@scure/base";
import { COMMITMENT_BYTES } from "./address-types.js";
import { Base58Coin } from "./base58.js";
import {
  asciiLowercase,
  asciiUppercase,
  DAMAGED,
  invalidAddress,
  type CoinAddress,
} from "./coin.js";

/** The prefix of CashAddr addresses on Bitcoin Cash's main network. */
const CASHADDR_PREFIX = "bitcoincash";
/** CashAddr writes five-bit groups in Bech32's alphabet (BIP173). */
const CASHADDR_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/** Eight five-bit groups of checksum follow the data. */
const CHECKSUM_GROUPS = 8;
/** The version byte of a P2PKH address with a 160-bit hash; any other is a script or a size. */
const P2PKH_160_VERSION = 0;
/** The generators of the CashAddr checksum, a BCH code over five-bit groups. */
const POLYMOD_GENERATORS = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
];
/** The checksum is kept in 40 bits; the top five leave before each group enters. */
const POLYMOD_TOP_SHIFT = 35n;
const POLYMOD_KEPT_BITS = 0x07ffffffffn;

class BitcoinCashCoin extends Base58Coin {
  protected override read(text: string): CoinAddress {
    return text.startsWith("1") ? this.readBase58(text) : this.#readCashAddr(text);
  }

  /** A CashAddr address in either case; only P2PKH with a 160-bit hash ("q…") is single-key. */
  #readCashAddr(text: string): CoinAddress {
    const lowercase = asciiLowercase(text);
    if (lowercase !== text && asciiUppercase(text) !== text)
      throw invalidAddress("it mixes capital and small letters, which CashAddr does not allow");
    const separator = lowercase.indexOf(":");
    if (separator >= 0 && lowercase.slice(0, separator) !== CASHADDR_PREFIX) throw this.notOurs();
    const payload = lowercase.slice(separator + 1);
    const groups = [...payload].map((character) => CASHADDR_ALPHABET.indexOf(character));
    if (groups.includes(-1)) throw this.notOurs();
    // The prefix enters the checksum as the low five bits of each character, then a zero.
    const prefixGroups = [...CASHADDR_PREFIX].map((character) => character.charCodeAt(0) & 0x1f);
    if (groups.length <= CHECKSUM_GROUPS || polymod([...prefixGroups, 0, ...groups]) !== 0n)
      throw invalidAddress(DAMAGED);
    // Strict: the padding must be zero and shorter than a group.
    const data = bech32.fromWordsUnsafe(groups.slice(0, -CHECKSUM_GROUPS));
    if (!data) throw invalidAddress(DAMAGED);
    const [version, ...hash] = data;
    if (version !== P2PKH_160_VERSION || hash.length !== COMMITMENT_BYTES.p2pkh)
      throw invalidAddress("only single-key addresses (bitcoincash:q…) can be checked");
    return this.address("p2pkh", Uint8Array.from(hash), `${CASHADDR_PREFIX}:${payload}`);
  }
}

/** The CashAddr checksum function: zero for a valid address. */
function polymod(groups: readonly number[]): bigint {
  let checksum = 1n;
  for (const group of groups) {
    const top = checksum >> POLYMOD_TOP_SHIFT;
    checksum = ((checksum & POLYMOD_KEPT_BITS) << 5n) ^ BigInt(group);
    POLYMOD_GENERATORS.forEach((generator, bit) => {
      if ((top >> BigInt(bit)) & 1n) checksum ^= generator;
    });
  }
  return checksum ^ 1n;
}

export const BITCOIN_CASH = new BitcoinCashCoin({
  id: "bitcoin-cash",
  name: "Bitcoin Cash",
  addressForms: "bitcoincash:q… or 1…",
  coinTypes: [145, 0],
  // The legacy form "1…", the same as Bitcoin's.
  versions: [{ prefix: [0x00], type: "p2pkh", testnet: false }],
});
