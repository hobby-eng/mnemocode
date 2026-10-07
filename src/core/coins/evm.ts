// Coins whose account is the last 20 bytes of the Keccak-256 of the public key, as Ethereum's is:
// Ethereum with every EVM network and Ethereum Classic, written "0x" and 40 hexadecimal digits
// (EIP-55), and Tron, which writes it in Base58Check. Injective, a Cosmos SDK chain with the same
// keys, writes it as Cosmos accounts are written (cosmos.ts).
//
// Host-neutral: it imports only base58.ts, coin.ts, @scure/base and @noble/hashes
// (test/portable-modules.test.ts).

import { keccak_256 } from "@noble/hashes/sha3.js";
import { hex, utf8 } from "@scure/base";
import { Base58Coin } from "./base58.js";
import { Coin, invalidAddress, type CoinAddress } from "./coin.js";

/** "0x" and 40 hexadecimal digits, the 20 bytes of the account. */
const HEX_ACCOUNT = /^[0-9a-f]{40}$/iu;
/** EIP-55: a letter is a capital where the matching digit of the hash is 8 or more. */
const EIP55_CAPITAL_FROM = 8;

/** A coin of Ethereum-style addresses. */
class HexCoin extends Coin {
  /** In mixed case the capitals are the EIP-55 checksum, which must hold; in one case there is none. */
  protected read(text: string): CoinAddress {
    const digits = /^0x/iu.test(text) ? text.slice(2) : undefined;
    if (digits === undefined) throw this.notOurs();
    if (!HEX_ACCOUNT.test(digits)) throw invalidAddress("it is not 40 hexadecimal digits after 0x");
    const account = hex.decode(digits.toLowerCase());
    const checksummed = eip55(account);
    if (/[a-f]/u.test(digits) && /[A-F]/u.test(digits) && digits !== checksummed)
      throw invalidAddress("its EIP-55 checksum, the mix of capital and small letters, is wrong");
    return this.address("keccak", account, `0x${checksummed}`);
  }
}

/** The 40 hexadecimal digits of `account` with the EIP-55 checksum. */
function eip55(account: Uint8Array): string {
  const lowercase = hex.encode(account);
  const hash = keccak_256(utf8.decode(lowercase));
  return [...lowercase]
    .map((character, position) => {
      const byte = hash[position >> 1]!;
      const digit = position % 2 === 0 ? byte >> 4 : byte & 0x0f;
      return digit >= EIP55_CAPITAL_FROM ? character.toUpperCase() : character;
    })
    .join("");
}

export const ETHEREUM = new HexCoin({
  id: "ethereum",
  name: "Ethereum and EVM networks",
  addressForms: "0x…",
  coinTypes: [60],
});

export const ETHEREUM_CLASSIC = new HexCoin({
  id: "ethereum-classic",
  name: "Ethereum Classic",
  addressForms: "0x…",
  // Its own coin type, and Ethereum's, from which it forked.
  coinTypes: [61, 60],
});

export const TRON = new Base58Coin({
  id: "tron",
  name: "Tron",
  addressForms: "T…",
  coinTypes: [195],
  // Tron's address prefix 0x41 before the Keccak account.
  versions: [{ prefix: [0x41], type: "keccak", testnet: false }],
});
