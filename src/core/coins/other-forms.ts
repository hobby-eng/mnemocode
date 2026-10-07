// Whether a text is written as some coin's address is, valid in its own form: Bech32 or Bech32m,
// 0x and 40 hexadecimal digits, a prefixed CashAddr, or Base58Check in Bitcoin's or the XRP
// Ledger's alphabet. A coin that cannot read a text asks this before calling it damaged, so that
// an address of another coin is refused as such (Coin.parse). It names no coin.
//
// Host-neutral: it imports only base58-check.ts, bech32.ts and @scure/base
// (test/portable-modules.test.ts).

import { base58, base58xrp, bech32, bech32m } from "@scure/base";
import { checkedData } from "./base58-check.js";
import { decodeBech32 } from "./bech32.js";

/** An Ethereum-style account: 0x and the 40 hexadecimal digits of 20 bytes. */
const HEX_ACCOUNT = /^0x[0-9a-f]{40}$/iu;
/** A CashAddr with its prefix: small letters, a colon and 42 characters of Bech32's alphabet. */
const PREFIXED_CASHADDR = /^[a-z]+:[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{42}$/u;

/** Whether `text`, trimmed, is a valid string in the form of some coin's addresses. */
export function writtenAsAnAddress(text: string): boolean {
  return (
    HEX_ACCOUNT.test(text) ||
    PREFIXED_CASHADDR.test(text.toLowerCase()) ||
    decodeBech32(text, bech32) !== undefined ||
    decodeBech32(text, bech32m) !== undefined ||
    checkedData(text, base58) !== undefined ||
    checkedData(text, base58xrp) !== undefined
  );
}
