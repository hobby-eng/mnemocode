// AUD-010 coins reviewer, probe "coins-refusal-reason": a valid single-key address of one supported
// coin, given as another coin, must be refused as "not an address of <that coin> (<its forms>)",
// as src/core/coins.ts promises ("other coins' addresses are refused, naming why") and as
// Coin.parse documents ("refused, naming why, when it belongs to another coin"); the self-test
// asserts that reason for a Bitcoin address given as Litecoin (bitcoin-like-self-test.ts).
//
// Every address here is computed by the independent oracle of coins-oracle.ts from the public
// phrase, and each is first shown to be accepted by its own coin. The overlaps that the README and
// the coins' comments name (Bitcoin's 1… for Bitcoin Cash, Bitcoin's 3… for Litecoin, the shared
// 0x form of Ethereum and Ethereum Classic) are skipped.
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-refusal-reason.ts
// Exit code: 1 when a pair is refused for another reason (such as "its checksum or format is
// wrong", which tells the person the address is damaged), 0 otherwise.

import { coinById, COINS, type CoinId } from "../../../src/core/coins.js";
import { ABANDON, addressOf, derive, seedOf, type CoinSpec } from "./coins-oracle.js";

const seed = seedOf(ABANDON);
const SOURCES: readonly [string, CoinId, string, CoinSpec][] = [
  ["Bitcoin legacy", "bitcoin", "m/44'/0'/0'/0/0", { kind: "p2pkh", version: [0x00] }],
  ["Bitcoin nested SegWit", "bitcoin", "m/49'/0'/0'/0/0", { kind: "p2sh-p2wpkh", version: [0x05] }],
  ["Bitcoin native SegWit", "bitcoin", "m/84'/0'/0'/0/0", { kind: "p2wpkh", hrp: "bc" }],
  ["Bitcoin Taproot", "bitcoin", "m/86'/0'/0'/0/0", { kind: "p2tr", hrp: "bc" }],
  ["Bitcoin Cash CashAddr", "bitcoin-cash", "m/44'/145'/0'/0/0", { kind: "cashaddr" }],
  ["Cosmos", "cosmos", "m/44'/118'/0'/0/0", { kind: "cosmos", hrp: "cosmos" }],
  ["Dash Core", "dash", "m/44'/5'/0'/0/0", { kind: "p2pkh", version: [0x4c] }],
  ["Dash Platform", "dash", "m/9'/5'/17'/0'/0'/0", { kind: "dash-platform", hrp: "dash" }],
  ["Dogecoin", "dogecoin", "m/44'/3'/0'/0/0", { kind: "p2pkh", version: [0x1e] }],
  ["Ethereum", "ethereum", "m/44'/60'/0'/0/0", { kind: "evm" }],
  ["Injective", "injective", "m/44'/60'/0'/0/0", { kind: "injective" }],
  ["Litecoin L", "litecoin", "m/44'/2'/0'/0/0", { kind: "p2pkh", version: [0x30] }],
  ["Litecoin M", "litecoin", "m/49'/2'/0'/0/0", { kind: "p2sh-p2wpkh", version: [0x32] }],
  ["Litecoin ltc1q", "litecoin", "m/84'/2'/0'/0/0", { kind: "p2wpkh", hrp: "ltc" }],
  ["Tron", "tron", "m/44'/195'/0'/0/0", { kind: "tron" }],
  ["XRP", "xrp", "m/44'/144'/0'/0/0", { kind: "xrp" }],
  ["Zcash", "zcash", "m/44'/133'/0'/0/0", { kind: "p2pkh", version: [0x1c, 0xb8] }],
];
const DOCUMENTED_OVERLAPS = new Set(["Bitcoin legacy->bitcoin-cash", "Bitcoin nested SegWit->litecoin", "Ethereum->ethereum-classic"]);

let failures = 0;
let checks = 0;
const wrongReasons = new Map<string, string[]>();
for (const [label, own, path, spec] of SOURCES) {
  const address = addressOf(derive(seed, path), spec);
  checks += 1;
  const ownText = coinById(own).parse(address).text;
  if (ownText !== address) {
    failures += 1;
    console.log(`FAIL ${label} ${address} is not accepted by its own coin: ${ownText}`);
  }
  for (const target of COINS) {
    if (target.id === own || DOCUMENTED_OVERLAPS.has(`${label}->${target.id}`)) continue;
    checks += 1;
    let reason: string;
    try {
      reason = `accepted as ${target.parse(address).text}`;
    } catch (error) {
      reason = (error as Error).message;
    }
    if (reason.includes(`it is not an address of ${target.name}`)) continue;
    failures += 1;
    const pairs = wrongReasons.get(reason) ?? [];
    pairs.push(`${label} (${address}) given as ${target.id}`);
    wrongReasons.set(reason, pairs);
  }
}
for (const [reason, pairs] of wrongReasons) {
  console.log(`FAIL ${pairs.length} pair(s) refused with: ${JSON.stringify(reason)}; expected "...it is not an address of <coin> (<forms>)."`);
  for (const pair of pairs) console.log(`     ${pair}`);
}
console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
