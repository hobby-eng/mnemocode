// AUD-010 coins reviewer, probe "coins-parsing": what Coin.parse (src/core/coins.ts, the check a
// host runs on an address as typed) accepts and refuses: white space at the ends, damaged
// checksums, other networks and prefixes, mixed case, EIP-55 case, scripts and shielded
// addresses, published invalid BIP350 strings, wrong lengths and padding, and every coin's valid
// address given as every other coin. Valid strings of other networks are built by the independent
// oracle of coins-oracle.ts, so that a refusal is not a typo of this probe.
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-parsing.ts
// Exit code: 0 when every expectation holds, 1 otherwise. Every compared value is printed.

import { coinById, COINS, type CoinId } from "../../../src/core/coins.js";
import {
  ABANDON,
  addressOf,
  base58check,
  bech32Encode,
  cashAddress,
  convertBits,
  derive,
  hash160,
  pointOf,
  seedOf,
  segwitAddress,
  type CoinSpec,
} from "./coins-oracle.js";

let failures = 0;
let checks = 0;
function record(ok: boolean, label: string, detail: string): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     ${detail}`);
}

/** What parse gives: its standard text, or the message it is refused with. */
function outcome(coin: string, text: string): { text?: string; refused?: string } {
  try {
    return { text: coinById(coin).parse(text).text };
  } catch (error) {
    return { refused: (error as Error).message };
  }
}

function accepts(coin: string, text: string, expected: string, label: string): void {
  const result = outcome(coin, text);
  record(result.text === expected, `${coin} accepts ${label}`, `input ${JSON.stringify(text)} -> ${JSON.stringify(result)}; expected text ${JSON.stringify(expected)}`);
}

function refuses(coin: string, text: string, because: RegExp, label: string): void {
  const result = outcome(coin, text);
  const ok = result.refused !== undefined && because.test(result.refused);
  record(ok, `${coin} refuses ${label}`, `input ${JSON.stringify(text)} -> ${JSON.stringify(result)}; expected refusal matching ${because}`);
}

const seed = seedOf(ABANDON);
const node0 = (path: string) => derive(seed, path);
const FIRST: Record<CoinId, string> = {
  bitcoin: addressOf(node0("m/84'/0'/0'/0/0"), { kind: "p2wpkh", hrp: "bc" }),
  "bitcoin-cash": addressOf(node0("m/44'/145'/0'/0/0"), { kind: "cashaddr" }),
  cosmos: addressOf(node0("m/44'/118'/0'/0/0"), { kind: "cosmos", hrp: "cosmos" }),
  dash: addressOf(node0("m/44'/5'/0'/0/0"), { kind: "p2pkh", version: [0x4c] }),
  dogecoin: addressOf(node0("m/44'/3'/0'/0/0"), { kind: "p2pkh", version: [0x1e] }),
  ethereum: addressOf(node0("m/44'/60'/0'/0/0"), { kind: "evm" }),
  "ethereum-classic": addressOf(node0("m/44'/61'/0'/0/0"), { kind: "evm" }),
  injective: addressOf(node0("m/44'/60'/0'/0/0"), { kind: "injective" }),
  litecoin: addressOf(node0("m/44'/2'/0'/0/0"), { kind: "p2pkh", version: [0x30] }),
  tron: addressOf(node0("m/44'/195'/0'/0/0"), { kind: "tron" }),
  xrp: addressOf(node0("m/44'/144'/0'/0/0"), { kind: "xrp" }),
  zcash: addressOf(node0("m/44'/133'/0'/0/0"), { kind: "p2pkh", version: [0x1c, 0xb8] }),
};
const BITCOIN_ALL: Record<string, string> = {
  legacy: addressOf(node0("m/44'/0'/0'/0/0"), { kind: "p2pkh", version: [0x00] }),
  nested: addressOf(node0("m/49'/0'/0'/0/0"), { kind: "p2sh-p2wpkh", version: [0x05] }),
  native: FIRST.bitcoin,
  taproot: addressOf(node0("m/86'/0'/0'/0/0"), { kind: "p2tr", hrp: "bc" }),
};
const PLATFORM = addressOf(node0("m/9'/5'/17'/0'/0'/0"), { kind: "dash-platform", hrp: "dash" });
const pub0 = pointOf(node0("m/44'/0'/0'/0/0").key);

console.log("== 1. White space at the ends is removed; inside it is refused ==");
for (const coin of COINS.map((c) => c.id)) {
  const address = FIRST[coin];
  accepts(coin, `  ${address} \t\r\n`, address, "spaces, tab, CR LF around");
  accepts(coin, ` ${address}　`, address, "no-break space and ideographic space around");
  accepts(coin, `\u0085${address} `, address, "NEL and line separator around");
  refuses(coin, `${address.slice(0, 6)} ${address.slice(6)}`, /./u, "a space inside");
  refuses(coin, `​${address}`, /./u, "a zero-width space (no White_Space) before");
}

console.log("\n== 2. A changed last character (checksum) is refused ==");
for (const coin of COINS.map((c) => c.id)) {
  const address = FIRST[coin];
  if (coin === "ethereum" || coin === "ethereum-classic") continue;
  const last = address.at(-1)!;
  // A replacement from the same alphabet keeps the format and breaks only the checksum.
  const replacement = /[0-9]/u.test(last) ? (last === "2" ? "3" : "2") : last === "q" ? "p" : last === "r" ? "s" : "q";
  refuses(coin, address.slice(0, -1) + replacement, /checksum or format/u, `last character ${last} -> ${replacement}`);
}
refuses("dash", PLATFORM.slice(0, -1) + (PLATFORM.at(-1) === "q" ? "p" : "q"), /checksum or format/u, "Platform address with its last character changed");

console.log("\n== 3. EIP-55 case ==");
const eth = FIRST.ethereum;
const flipped = (() => {
  const digits = [...eth.slice(2)];
  const at = digits.findIndex((c) => /[a-fA-F]/u.test(c));
  digits[at] = digits[at] === digits[at]!.toUpperCase() ? digits[at]!.toLowerCase() : digits[at]!.toUpperCase();
  return "0x" + digits.join("");
})();
refuses("ethereum", flipped, /EIP-55/u, "one letter's case flipped");
refuses("ethereum-classic", flipped, /EIP-55/u, "one letter's case flipped");
accepts("ethereum", eth.toLowerCase(), eth, "all lower case (no checksum)");
refuses("ethereum", eth.slice(2), /not an address of Ethereum/u, "without 0x");
refuses("ethereum", eth + "00", /40 hexadecimal/u, "42 digits");
refuses("ethereum", eth.slice(0, -1), /40 hexadecimal/u, "39 digits");
refuses("ethereum", "0x" + "g".repeat(40), /40 hexadecimal/u, "non-hex digits");

console.log("\n== 4. Mixed case in Bech32, Bech32m and CashAddr ==");
/** `text` with the first small letter from position `from` on made a capital. */
const mixed = (text: string, from: number) => {
  const at = [...text].findIndex((c, i) => i >= from && /[a-z]/u.test(c));
  return text.slice(0, at) + text[at]!.toUpperCase() + text.slice(at + 1);
};
refuses("bitcoin", mixed(BITCOIN_ALL.native, 10), /./u, "Bech32 native SegWit with one capital");
refuses("bitcoin", mixed(BITCOIN_ALL.taproot, 10), /./u, "Bech32m Taproot with one capital");
refuses("bitcoin-cash", mixed(FIRST["bitcoin-cash"], 15), /mixes capital and small letters/u, "CashAddr with one capital");
refuses("cosmos", mixed(FIRST.cosmos, 10), /./u, "Cosmos with one capital");
refuses("dash", mixed(PLATFORM, 10), /./u, "Platform address with one capital");
accepts("bitcoin", BITCOIN_ALL.taproot.toUpperCase(), BITCOIN_ALL.taproot, "Taproot all in capitals");
accepts("cosmos", FIRST.cosmos.toUpperCase(), FIRST.cosmos, "Cosmos all in capitals");

console.log("\n== 5. Other networks and prefixes, built by the oracle ==");
const h = hash160(pub0);
refuses("bitcoin", segwitAddress("bcrt", 0, h), /./u, "regtest bcrt1q");
refuses("bitcoin", segwitAddress("ltc", 0, h), /./u, "Litecoin ltc1q of the same key");
refuses("litecoin", segwitAddress("tb", 0, h), /./u, "Bitcoin testnet tb1q");
refuses("litecoin", segwitAddress("tltc", 0, h), /./u, "Litecoin testnet tltc1q");
refuses("litecoin", segwitAddress("ltc", 1, pointOf(node0("m/86'/2'/0'/0/0").key).subarray(1)), /only single-key/u, "Litecoin Taproot ltc1p");
refuses("bitcoin-cash", cashAddress("bchtest", 0, h), /not an address of Bitcoin Cash/u, "bchtest: CashAddr");
refuses("bitcoin-cash", cashAddress("bitcoincash", 8, h), /only single-key/u, "CashAddr P2SH (version byte 8)");
refuses("bitcoin-cash", cashAddress("bitcoincash", 1, Uint8Array.from([...h, 0, 0, 0, 0])), /only single-key/u, "CashAddr P2PKH with a 192-bit hash (version byte 1)");
refuses("bitcoin-cash", "bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq", /only single-key/u, "CashAddr spec P2SH vector");
refuses("cosmos", bech32Encode("osmo", convertBits(h, 8, 5, true), "bech32"), /not an address of Cosmos/u, "osmo1 of the same hash");
refuses("cosmos", bech32Encode("cosmosvaloper", convertBits(h, 8, 5, true), "bech32"), /not an address of Cosmos/u, "cosmosvaloper1");
refuses("cosmos", bech32Encode("cosmos", convertBits(h, 8, 5, true), "bech32m"), /checksum or format/u, "cosmos1 with a Bech32m checksum");
refuses("cosmos", bech32Encode("cosmos", convertBits(Uint8Array.from([...h, ...h.subarray(0, 12)]), 8, 5, true), "bech32"), /wrong length/u, "cosmos1 of 32 bytes");
refuses("injective", FIRST.cosmos, /not an address of Injective/u, "a Cosmos address");
refuses("cosmos", FIRST.injective, /not an address of Cosmos/u, "an Injective address");
refuses("dash", bech32Encode("dash", convertBits(Uint8Array.from([0xb0, ...h]), 8, 5, true), "bech32"), /checksum or format/u, "dash1 with a Bech32 (not m) checksum");
refuses("dash", bech32Encode("dash", [...convertBits(Uint8Array.from([0xb0, ...h]), 8, 5, true), 0], "bech32m"), /checksum or format|wrong length/u, "dash1 with an extra zero group");
{
  const groups = convertBits(Uint8Array.from([0xb0, ...h]), 8, 5, true);
  groups[groups.length - 1]! |= 1;
  refuses("dash", bech32Encode("dash", groups, "bech32m"), /checksum or format/u, "dash1 with a padding bit set");
}
refuses("dash", bech32Encode("dash", convertBits(Uint8Array.from([0x10, ...new Uint8Array(43)]), 8, 5, true), "bech32m"), /shielded/u, "DIP18 Orchard type byte 0x10");
refuses("dash", bech32Encode("dash", convertBits(Uint8Array.from([0x80, ...h]), 8, 5, true), "bech32m"), /not the Platform payment address/u, "DIP18 other type byte 0x80");
accepts("dash", addressOf(node0("m/9'/1'/17'/0'/0'/0"), { kind: "dash-platform", hrp: "tdash" }), addressOf(node0("m/9'/1'/17'/0'/0'/0"), { kind: "dash-platform", hrp: "tdash" }), "a testnet tdash1k address");
refuses("dash", base58check(Uint8Array.from([0x8c, ...h])), /not an address of Dash/u, "a Dash testnet y… address");
refuses("dash", base58check(Uint8Array.from([0x10, ...h])), /not an address of Dash/u, "a Dash P2SH 7… address");
refuses("zcash", base58check(Uint8Array.from([0x1c, 0xbd, ...h])), /not an address of Zcash/u, "a Zcash P2SH t3… address");
refuses("zcash", "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly", /shielded/u, "a Sapling zs1… string");
refuses("zcash", "u1qqqqqqqq", /shielded/u, "a unified u1… string");
refuses("bitcoin", base58check(Uint8Array.from([0x00, ...h, 0])), /wrong length/u, "Base58Check P2PKH with a 21-byte hash");
refuses("tron", base58check(Uint8Array.from([0x41, ...h.subarray(0, 19)])), /wrong length/u, "Tron with a 19-byte account");
refuses("xrp", base58check(Uint8Array.from([0x00, ...h])), /./u, "Bitcoin's 1… in Bitcoin's alphabet given as XRP");

console.log("\n== 6. Scripts and BIP350's invalid strings ==");
refuses("bitcoin", "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", /only single-key/u, "BIP173 P2WSH example");
refuses("bitcoin", segwitAddress("bc", 1, new Uint8Array(40)), /only single-key/u, "witness v1 with a 40-byte program");
refuses("bitcoin", segwitAddress("bc", 2, new Uint8Array(16)), /only single-key/u, "witness v2 with 16 bytes");
refuses("bitcoin", bech32Encode("bc", [0, ...convertBits(h, 8, 5, true)], "bech32m"), /checksum or format/u, "v0 with a Bech32m checksum");
refuses("bitcoin", bech32Encode("bc", [1, ...convertBits(new Uint8Array(32), 8, 5, true)], "bech32"), /checksum or format/u, "v1 with a Bech32 checksum");
refuses("bitcoin", segwitAddress("bc", 0, new Uint8Array(16)), /checksum or format/u, "v0 with a 16-byte program");
refuses("bitcoin", segwitAddress("bc", 1, new Uint8Array(1)), /checksum or format/u, "v1 with a 1-byte program");
for (const invalid of [
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd",
  "tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf",
  "BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL",
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh",
  "tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47",
  "bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4",
  "BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R",
  "bc1pw5dgrnzv",
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav",
  "BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P",
  "tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq",
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf",
  "tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j",
  "bc1gmk9yu",
])
  refuses("bitcoin", invalid, /./u, `BIP350 invalid ${invalid}`);

console.log("\n== 7. Every coin's valid address given as every other coin ==");
// Overlaps that the README and the coins' comments name: Bitcoin Cash's legacy 1… is Bitcoin's;
// Litecoin reads the 3… nested SegWit form it used before M…; Ethereum and Ethereum Classic share
// the 0x form.
const DOCUMENTED_OVERLAPS = new Set([
  "bitcoin legacy -> bitcoin-cash",
  "bitcoin nested -> litecoin",
  "ethereum -> ethereum-classic",
  "ethereum-classic -> ethereum",
]);
const sources: [string, string][] = [
  ...Object.entries(BITCOIN_ALL).map(([kind, address]) => [`bitcoin ${kind}`, address] as [string, string]),
  ...COINS.filter((c) => c.id !== "bitcoin").map((c) => [c.id, FIRST[c.id]] as [string, string]),
  ["dash platform", PLATFORM],
];
const reasons: string[] = [];
for (const [source, address] of sources)
  for (const target of COINS.map((c) => c.id)) {
    if (source.split(" ")[0] === target) continue;
    const result = outcome(target, address);
    const pair = `${source} -> ${target}`;
    if (result.text !== undefined) {
      record(DOCUMENTED_OVERLAPS.has(pair), `cross-coin ${pair}`, `accepted as ${result.text}; documented overlap: ${DOCUMENTED_OVERLAPS.has(pair)}`);
    } else {
      checks += 1;
      reasons.push(`${pair}: ${result.refused}`);
    }
  }
const damaged = reasons.filter((line) => /checksum or format is wrong/u.test(line));
console.log(`refused cross-coin pairs: ${reasons.length}; of them reported as "checksum or format is wrong" rather than "not an address of": ${damaged.length}`);
for (const line of damaged) console.log(`     ${line}`);

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
