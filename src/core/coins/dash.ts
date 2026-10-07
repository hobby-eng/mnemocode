// Dash: Dash Core addresses "X…" in Base58Check on BIP44 paths, and Dash Platform payment addresses
// "dash1k…" (testnet "tdash1k…") in Bech32m after DIP18's type byte, on DIP17 paths with hardened
// key classes. Orchard shielded addresses and other Platform types are refused with their reason.
//
// Host-neutral: it imports only base58.ts, bech32.ts, coin.ts, address-types.ts and @scure/base
// (test/portable-modules.test.ts).

import { bech32m } from "@scure/base";
import { ADDRESS_TYPE_NAMES, COMMITMENT_BYTES, type AddressType } from "./address-types.js";
import { Base58Coin } from "./base58.js";
import { decodeBech32 } from "./bech32.js";
import {
  asciiLowercase,
  DAMAGED,
  invalidAddress,
  startsWithAny,
  WRONG_LENGTH,
  type CoinAddress,
} from "./coin.js";

/** DIP18's human-readable parts on the main and the test network. */
const PLATFORM_MAINNET = "dash";
const PLATFORM_TESTNET = "tdash";
/** DIP18's type bytes: the payment address of one DIP17 key, and an Orchard shielded address. */
const PLATFORM_P2PKH = 0xb0;
const PLATFORM_ORCHARD = 0x10;
/**
 * The type byte and the hash are 21 bytes, 168 bits: 34 five-bit groups, 170 bits, whose last two
 * are padding and zero (BIP173). Only that encoding is the address; another group at the end, or
 * padding bits set, would read as the same bytes.
 */
const PAYMENT_GROUPS = 34;
const PADDING_MASK = 0b11;

class DashCoin extends Base58Coin {
  /** "Core (BIP44)", or "Platform payment (DIP17)", with "testnet, " before it on testnet. */
  override describe(type: AddressType, testnet: boolean): string {
    if (type !== "dash-platform") return "Core (BIP44)";
    return `${testnet ? "testnet, " : ""}${ADDRESS_TYPE_NAMES[type]} (DIP17)`;
  }

  protected override read(text: string): CoinAddress {
    return startsWithAny(text, [`${PLATFORM_MAINNET}1`, `${PLATFORM_TESTNET}1`])
      ? this.#readPlatform(text)
      : this.readBase58(text);
  }

  #readPlatform(text: string): CoinAddress {
    const decoded = decodeBech32(text, bech32m);
    if (!decoded) throw invalidAddress(DAMAGED);
    let testnet: boolean;
    if (decoded.prefix === PLATFORM_MAINNET) testnet = false;
    else if (decoded.prefix === PLATFORM_TESTNET) testnet = true;
    else throw this.notOurs();
    const [type, ...hash] = bytesOf(decoded.words);
    if (type === PLATFORM_P2PKH) {
      if (hash.length !== COMMITMENT_BYTES["dash-platform"]) throw invalidAddress(WRONG_LENGTH);
      const last = decoded.words[decoded.words.length - 1]!;
      if (decoded.words.length !== PAYMENT_GROUPS || (last & PADDING_MASK) !== 0)
        throw invalidAddress(DAMAGED);
      return this.address("dash-platform", Uint8Array.from(hash), asciiLowercase(text), testnet);
    }
    if (type === PLATFORM_ORCHARD)
      throw invalidAddress(
        "it is shielded; use a Dash Core X… or Platform dash1k… address of the same wallet",
      );
    throw invalidAddress("it is not the Platform payment address of a single key");
  }
}

/**
 * The whole bytes that five-bit groups hold, the bits left over ignored: what the address's type
 * byte and length are read from, before its encoding is checked.
 */
function bytesOf(groups: readonly number[]): number[] {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const group of groups) {
    // At most seven bits wait and five arrive: twelve bits hold them.
    accumulator = ((accumulator << 5) | group) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  return bytes;
}

export const DASH = new DashCoin({
  id: "dash",
  name: "Dash",
  addressForms: "X… or dash1k…",
  coinTypes: [5],
  versions: [{ prefix: [0x4c], type: "p2pkh", testnet: false }],
});
