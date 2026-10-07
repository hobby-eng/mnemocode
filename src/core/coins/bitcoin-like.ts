// Coins that write addresses as Bitcoin does: Base58Check with a version prefix, and for Bitcoin and
// Litecoin also SegWit in Bech32 or Bech32m (BIP173, BIP350). Bitcoin, Litecoin, Dogecoin and the
// transparent addresses of Zcash.
//
// Host-neutral: it imports only base58.ts, coin.ts, address-types.ts and @scure/base
// (test/portable-modules.test.ts).

import { bech32, bech32m } from "@scure/base";
import {
  ADDRESS_PURPOSES,
  ADDRESS_TYPE_NAMES,
  COMMITMENT_BYTES,
  type AddressType,
} from "./address-types.js";
import { Base58Coin, type Base58CoinDescription } from "./base58.js";
import {
  asciiLowercase,
  DAMAGED,
  invalidAddress,
  startsWithAny,
  type CoinAddress,
} from "./coin.js";

/** The human-readable parts of a coin's SegWit addresses, and whether it has Taproot. */
interface SegwitPrefixes {
  readonly mainnet: string;
  /** Bitcoin's testnet and signet; a coin without one leaves it out. */
  readonly testnet?: string;
  readonly taproot: boolean;
}

/** BIP173: a SegWit address has at most 90 characters. */
const SEGWIT_MAX_LENGTH = 90;
/** BIP141: witness versions 0 to 16, with programs of 2 to 40 bytes; version 0 has 20 or 32. */
const MAX_WITNESS_VERSION = 16;
const MIN_PROGRAM_BYTES = 2;
const MAX_PROGRAM_BYTES = 40;
const V0_PROGRAM_BYTES: ReadonlySet<number> = new Set([20, 32]);

/** A Bitcoin-like coin with SegWit addresses besides its Base58Check ones. */
class SegwitCoin extends Base58Coin {
  readonly #segwit: SegwitPrefixes;

  constructor(description: Base58CoinDescription & { readonly segwit: SegwitPrefixes }) {
    super(description);
    this.#segwit = description.segwit;
  }

  /** Such as "testnet, nested SegWit (BIP49)". */
  override describe(type: AddressType, testnet: boolean): string {
    const network = testnet ? "testnet, " : "";
    return `${network}${ADDRESS_TYPE_NAMES[type]} (BIP${ADDRESS_PURPOSES[type]})`;
  }

  protected override read(text: string): CoinAddress {
    const { mainnet, testnet } = this.#segwit;
    const prefixes = testnet === undefined ? [mainnet] : [mainnet, testnet];
    return startsWithAny(
      text,
      prefixes.map((prefix) => `${prefix}1`),
    )
      ? this.#readSegwit(text)
      : this.readBase58(text);
  }

  #readSegwit(text: string): CoinAddress {
    const decoded = decodeSegwit(text);
    if (decoded === undefined) throw invalidAddress(DAMAGED);
    const { prefix, version, program } = decoded;
    // BIP173 allows an address all in capitals, as in QR codes; the decoder refused mixed case.
    let testnet: boolean;
    if (prefix === this.#segwit.mainnet) testnet = false;
    else if (prefix === this.#segwit.testnet) testnet = true;
    else throw this.notOurs();
    // The single-key programs: version 0 with the key's HASH160, version 1 with a Taproot key.
    let type: AddressType;
    if (version === 0 && program.length === COMMITMENT_BYTES.p2wpkh) type = "p2wpkh";
    else if (version === 1 && program.length === COMMITMENT_BYTES.p2tr && this.#segwit.taproot)
      type = "p2tr";
    else
      throw invalidAddress(
        "only single-key addresses (bc1q with 42 characters, bc1p or ltc1q) can be checked",
      );
    return this.address(type, program, asciiLowercase(text), testnet);
  }
}

/** A SegWit address's lower-case prefix, witness version and program, or undefined (BIP173, BIP350). */
function decodeSegwit(
  text: string,
): { readonly prefix: string; readonly version: number; readonly program: Uint8Array } | undefined {
  const withBech32 = bech32.decodeUnsafe(text, SEGWIT_MAX_LENGTH);
  const decoded = withBech32 || bech32m.decodeUnsafe(text, SEGWIT_MAX_LENGTH);
  if (!decoded) return undefined;
  const [version, ...groups] = decoded.words;
  if (version === undefined || version > MAX_WITNESS_VERSION) return undefined;
  // BIP350: version 0 carries a Bech32 checksum, every later version a Bech32m one.
  if ((version === 0) !== Boolean(withBech32)) return undefined;
  // Strict: the padding must be zero and shorter than a group.
  const program = bech32.fromWordsUnsafe(groups);
  if (!program || program.length < MIN_PROGRAM_BYTES || program.length > MAX_PROGRAM_BYTES)
    return undefined;
  if (version === 0 && !V0_PROGRAM_BYTES.has(program.length)) return undefined;
  return { prefix: decoded.prefix, version, program };
}

/**
 * Prefixes of Zcash shielded addresses: Sapling (Bech32), unified (Bech32m) and Sprout (Base58),
 * on mainnet and testnet. Their keys need Zcash's own curves and key tree (ZIP-32), so they are
 * refused with that reason rather than compared in vain.
 */
const ZCASH_SHIELDED_PREFIXES = ["zs1", "ztestsapling1", "u1", "utest1", "zc", "zt"];

/** Zcash, whose transparent addresses are Bitcoin's with a two-byte version. */
class ZcashCoin extends Base58Coin {
  override describe(): string {
    return "transparent";
  }

  protected override read(text: string): CoinAddress {
    if (startsWithAny(text, ZCASH_SHIELDED_PREFIXES))
      throw invalidAddress("it is shielded; use a transparent t1… address of the same wallet");
    return this.readBase58(text);
  }
}

// Version bytes from each coin's chain parameters. A "3…" address is taken as nested SegWit, the
// only single-key address of that form.
export const BITCOIN = new SegwitCoin({
  id: "bitcoin",
  name: "Bitcoin",
  addressForms: "1…, 3…, bc1q… or bc1p…",
  coinTypes: [0],
  versions: [
    { prefix: [0x00], type: "p2pkh", testnet: false },
    { prefix: [0x05], type: "p2sh-p2wpkh", testnet: false },
    { prefix: [0x6f], type: "p2pkh", testnet: true },
    { prefix: [0xc4], type: "p2sh-p2wpkh", testnet: true },
  ],
  segwit: { mainnet: "bc", testnet: "tb", taproot: true },
});

export const LITECOIN = new SegwitCoin({
  id: "litecoin",
  name: "Litecoin",
  addressForms: "L…, M…, 3… or ltc1q…",
  coinTypes: [2],
  // "L…" and "M…", and the "3…" that Litecoin used before "M…".
  versions: [
    { prefix: [0x30], type: "p2pkh", testnet: false },
    { prefix: [0x32], type: "p2sh-p2wpkh", testnet: false },
    { prefix: [0x05], type: "p2sh-p2wpkh", testnet: false },
  ],
  segwit: { mainnet: "ltc", taproot: false },
});

export const DOGECOIN = new Base58Coin({
  id: "dogecoin",
  name: "Dogecoin",
  addressForms: "D…",
  coinTypes: [3],
  versions: [{ prefix: [0x1e], type: "p2pkh", testnet: false }],
});

export const ZCASH = new ZcashCoin({
  id: "zcash",
  name: "Zcash",
  addressForms: "t1…",
  coinTypes: [133],
  versions: [{ prefix: [0x1c, 0xb8], type: "p2pkh", testnet: false }],
});
