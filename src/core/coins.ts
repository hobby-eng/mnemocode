// The coins whose single-key receiving addresses a recovered phrase can be compared with: twelve
// coins on their standard paths. Bitcoin on BIP44 (legacy), BIP49 (nested SegWit), BIP84 (native
// SegWit) and BIP86 (Taproot), mainnet or testnet; Litecoin likewise without Taproot; BIP44 for
// the others; and Dash Platform payment addresses on DIP17. Multisignature and script addresses,
// shielded Zcash and Dash addresses and other coins' addresses are refused, naming why.
//
// This is the part's entry: the list of coins, a coin by its identifier, and the check of an
// address as typed, which a host runs at once, before any secret is asked. The comparison with a
// phrase is core/wallet-evidence.ts's "coin-address" evidence. Each coin family is a module of
// core/coins/. A coin of a family that is there is added in three places: its entry in the
// family's module, its identifier in CoinId (core/coins/coin.ts), which keeps evidence typed, and
// its place in COINS below.
//
// Host-neutral: it imports only core/coins/, @scure/base, @noble/hashes and @noble/curves
// (test/portable-modules.test.ts).

import { BITCOIN_CASH } from "./coins/bitcoin-cash.js";
import { BITCOIN, DOGECOIN, LITECOIN, ZCASH } from "./coins/bitcoin-like.js";
import { asciiLowercase, trimWhiteSpace, type Coin } from "./coins/coin.js";
import { COSMOS, INJECTIVE } from "./coins/cosmos.js";
import { DASH } from "./coins/dash.js";
import { ETHEREUM, ETHEREUM_CLASSIC, TRON } from "./coins/evm.js";
import { XRP } from "./coins/xrp.js";

export type { AddressType } from "./coins/address-types.js";
export { assertAddressLocation } from "./coins/coin.js";
export type { AddressLocation, Coin, CoinAddress, CoinDescription, CoinId } from "./coins/coin.js";

/** Every coin, in the alphabetical order of their names, the order a host offers them in. */
export const COINS: readonly Coin[] = Object.freeze([
  BITCOIN,
  BITCOIN_CASH,
  COSMOS,
  DASH,
  DOGECOIN,
  ETHEREUM,
  ETHEREUM_CLASSIC,
  INJECTIVE,
  LITECOIN,
  TRON,
  XRP,
  ZCASH,
]);

/** The coin of an identifier such as "bitcoin-cash", in either case; refused when unknown. */
export function coinById(id: string): Coin {
  const wanted = asciiLowercase(trimWhiteSpace(String(id)));
  const coin = COINS.find((candidate) => candidate.id === wanted);
  if (coin === undefined)
    throw new Error(
      `Unknown coin "${id}"; the coins are ${COINS.map((known) => known.id).join(", ")}.`,
    );
  return coin;
}

/**
 * An address as typed, in its standard form, when it is a single-key receiving address of `coin`;
 * refused, naming why, otherwise. A host checks an answer with it at once: no secret is needed.
 */
export function parseCoinAddress(coin: string, text: string): string {
  return coinById(coin).parse(text).text;
}
