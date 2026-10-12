// AUD-010 coins reviewer, probe "coins-dash-composition": what a host of Dash alone carries.
//
// The entry imports exactly what multi-chain-wallet-tools' Dash edition imports from MnemoCode
// (packages/recovery-backup/src/mnemocode-wallet-dash.ts: core/coin-address-evidence.ts,
// core/coins/dash.ts, core/coins/dash-self-test.ts, core/master-fingerprint.ts and the types of
// core/wallet-check.ts) and uses every export it takes, so nothing is tree-shaken away that the
// host keeps. It is bundled as test/one-coin-builds.test.ts bundles (esbuild, neutral platform,
// whitespace minified, no comments) and checked in three ways:
//
// 1. The Dash Community artifact gate of multi-chain-wallet-tools
//    (tooling/verify-dash-community-artifacts.mjs, DASH_FORBIDDEN_ARTIFACT_PATTERNS, copied here
//    verbatim with its "Bitcoin seed" exemption) must find nothing.
// 2. The bundle's inputs must hold no other coin family's module, no list of every coin, no
//    Bitcoin wallet evidence and no @scure/btc-signer.
// 3. The claim of src/core/coin-address-evidence.ts, that such a host "carries no other coin's code
//    or words": the bundle is searched for Bitcoin's Taproot and SegWit names and code, and for the
//    Ethereum-style Keccak account. Each hit is printed with its context.
//
// Run: node docs/audits/AUD-010-harnesses/coins-dash-composition.mjs
// Exit code: 1 when any of the three finds something, 0 otherwise.

import { build } from "esbuild";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

const ENTRY = `
import { CoinAddressCheck } from "./src/core/coin-address-evidence.ts";
import { DASH } from "./src/core/coins/dash.ts";
import { DASH_ADDRESS_SELF_TEST } from "./src/core/coins/dash-self-test.ts";
import { MasterFingerprintCheck, parseMasterFingerprint } from "./src/core/master-fingerprint.ts";
export const host = { CoinAddressCheck, DASH, DASH_ADDRESS_SELF_TEST, MasterFingerprintCheck, parseMasterFingerprint };
`;

const result = await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, loader: "ts", sourcefile: "dash-host-entry.ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  legalComments: "none",
  minifyWhitespace: true,
  metafile: true,
  logLevel: "silent",
});
const text = result.outputFiles[0].text;
const inputs = Object.keys(result.metafile.inputs).sort();
let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `\n     ${detail}` : ""}`);
};

console.log(`bundle: ${text.length} characters, ${inputs.length} inputs`);
for (const input of inputs.filter((name) => name.startsWith("src/"))) console.log(`  input ${input}`);
const packages = [...new Set(inputs.filter((n) => n.includes("node_modules")).map((n) => n.replace(/^.*node_modules\/(@[^/]+\/[^/]+|[^/]+)\/(.*)$/u, "$1/$2")))];
for (const p of packages) console.log(`  package file ${p}`);

console.log("\n== 1. multi-chain-wallet-tools Dash Community artifact gate (verbatim patterns) ==");
const DASH_FORBIDDEN_ARTIFACT_PATTERNS = [
  [/\bbitcoin(?:\s+cash)?\b/iu, "Bitcoin"],
  [/\blitecoin\b/iu, "Litecoin"],
  [/\bdogecoin\b/iu, "Dogecoin"],
  [/\bethereum\b/iu, "Ethereum"],
  [/bitcoin-(?:legacy|nested-segwit|native-segwit|taproot)/u, "Bitcoin adapter registration"],
  [/\bethereum\b/u, "Ethereum adapter registration"],
  [/\b(?:BIP49|BIP84|BIP86|EIP-55|P2SH-P2WPKH|P2WPKH|P2TR|Ethereum EOA)\b/u, "non-Dash protocol copy"],
  [/Multi-Chain (?:Wallet Tools|Edition)/u, "Multi-Chain branding"],
];
const neutral = text.replace(/(['"`])Bitcoin seed\1/gu, "");
for (const [pattern, label] of DASH_FORBIDDEN_ARTIFACT_PATTERNS) {
  const hit = pattern.exec(neutral);
  report(hit === null, `gate: ${label} ${pattern}`, hit ? `found ${JSON.stringify(neutral.slice(Math.max(0, hit.index - 60), hit.index + 60))}` : "");
}

console.log("\n== 2. Inputs of other coins ==");
const FORBIDDEN_INPUTS = [
  "src/core/coins/bitcoin-like.ts",
  "src/core/coins/bitcoin-cash.ts",
  "src/core/coins/evm.ts",
  "src/core/coins/cosmos.ts",
  "src/core/coins/xrp.ts",
  "src/core/coins.ts",
  "src/core/coins-self-test.ts",
  "src/core/wallet-evidence.ts",
  "src/core/wallet-evidence-self-test.ts",
  "src/bitcoin-evidence.ts",
];
for (const name of FORBIDDEN_INPUTS) report(!inputs.includes(name), `input ${name} absent`, "");
report(!inputs.some((n) => n.includes("@scure/btc-signer")), "input @scure/btc-signer absent", "");

console.log("\n== 3. Other coins' words and code (claim of src/core/coin-address-evidence.ts) ==");
const OTHER_COIN_MARKERS = [
  [/Taproot/u, "Bitcoin's Taproot (BIP341/BIP86) name"],
  [/SegWit/u, "Bitcoin's SegWit names"],
  [/BIP341/u, "Bitcoin's BIP341 in a message"],
  [/TapTweak/u, "the BIP341 TapTweak tag: Taproot output-key code"],
  [/Keccak/u, "the Keccak account name of Ethereum-style coins"],
  [/"p2tr"|"p2wpkh"|"p2sh-p2wpkh"|"keccak"/u, "Bitcoin and Ethereum address-type identifiers"],
];
for (const [pattern, label] of OTHER_COIN_MARKERS) {
  const global = new RegExp(pattern.source, "gu");
  const hits = [...text.matchAll(global)];
  report(
    hits.length === 0,
    `${label} ${pattern}: ${hits.length} occurrence(s)`,
    hits
      .slice(0, 4)
      .map((hit) => JSON.stringify(text.slice(Math.max(0, hit.index - 50), hit.index + 70)))
      .join("\n     "),
  );
}
const keccakCode = inputs.filter((n) => /@noble\/hashes\/(?:esm\/)?sha3\.js$/u.test(n));
report(keccakCode.length === 0, "Keccak-256 implementation (@noble/hashes sha3.js) not bundled", keccakCode.join(", "));

console.log(`\n${failures === 0 ? "no" : failures} failing check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
