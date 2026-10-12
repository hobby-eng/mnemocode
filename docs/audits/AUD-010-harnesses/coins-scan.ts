// AUD-010 coins reviewer, probe "coins-scan": the address scan and the lifetime of seeds and keys.
//
// A. --scan-gap through the command line's own parsing (parseArguments, walletEvidence,
//    assertWalletEvidence of src/cli/ and src/bitcoin-evidence.ts).
// B. The number of addresses through the library (CoinAddressCheck, WalletEvidenceCheck).
// C. A match at the last index of the range, none one past it, and the indexes actually derived.
// D. `addresses` refused on the kinds that are not scanned.
// E. Every HDKey that a comparison creates has its private key wiped, every private-key copy taken
//    with the privateKey getter is zero, and the seed the host's PBKDF2 returned is zero, after a
//    match, after no match, and after an error thrown in the middle of a derivation or a comparison.
//
// Expected addresses come from the independent oracle of coins-oracle.ts.
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-scan.ts
// Exit code: 0 when every expectation holds, 1 otherwise. Every compared value is printed.

import { pbkdf2Sync } from "node:crypto";
import { HDKey } from "@scure/bip32";
import { parseArguments } from "../../../src/cli/arguments.js";
import { walletEvidence } from "../../../src/cli/bitcoin-options.js";
import { assertWalletEvidence } from "../../../src/bitcoin-evidence.js";
import { CoinAddressCheck } from "../../../src/core/coin-address-evidence.js";
import { DASH } from "../../../src/core/coins/dash.js";
import { CoinAddress } from "../../../src/core/coins/coin.js";
import { coinById } from "../../../src/core/coins.js";
import { WalletEvidenceCheck, type WalletEvidence } from "../../../src/core/wallet-evidence.js";
import { ABANDON, addressOf, base58check, derive, seedOf, type CoinSpec } from "./coins-oracle.js";

let failures = 0;
let checks = 0;
function record(ok: boolean, label: string, detail: string): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     ${detail}`);
}
function attempt<T>(run: () => T): { value?: T; error?: string } {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const seed = seedOf(ABANDON);
const at = (path: string, spec: CoinSpec) => addressOf(derive(seed, path), spec);
const DASH_X0 = at("m/44'/5'/0'/0/0", { kind: "p2pkh", version: [0x4c] });

console.log("== A. --scan-gap through the command line ==");
const cli = (extra: string[]) =>
  attempt(() => {
    const evidence = walletEvidence(parseArguments(["--coin", "dash", "--coin-address", DASH_X0, ...extra]));
    if (evidence !== undefined) assertWalletEvidence(evidence);
    return evidence;
  });
for (const [gap, expected] of [
  ["1", 1],
  ["20", 20],
  ["1000", 1000],
] as const) {
  const result = cli(["--scan-gap", gap]);
  const addresses = (result.value as { addresses?: number } | undefined)?.addresses;
  record(addresses === expected, `--scan-gap ${gap} accepted`, `addresses ${addresses}, error ${result.error}`);
}
for (const gap of ["0", "1001", "1.5", "-1", "abc", "", "1e3", "0x10", "+5", "020", " 20", "20 ", "１０"]) {
  const result = cli(["--scan-gap", gap]);
  record(
    result.error !== undefined && /integer from 1 through 1000/u.test(result.error),
    `--scan-gap ${JSON.stringify(gap)} refused`,
    `error ${JSON.stringify(result.error)}, value ${JSON.stringify(result.value)}`,
  );
}
{
  const result = cli([]);
  record((result.value as { addresses?: number })?.addresses === 20, "no --scan-gap: 20 addresses", JSON.stringify(result));
  const top = cli(["--index", "2147483640"]);
  record((top.value as { addresses?: number })?.addresses === 8, "no --scan-gap at index 2147483640: 8 addresses", JSON.stringify(top));
  const over = cli(["--index", "2147483647", "--scan-gap", "2"]);
  record(over.error !== undefined && /would pass index 2147483647/u.test(over.error), "--index 2147483647 --scan-gap 2 refused", JSON.stringify(over));
  const last = cli(["--index", "2147483647", "--scan-gap", "1"]);
  record(last.error === undefined, "--index 2147483647 --scan-gap 1 accepted", JSON.stringify(last));
}
for (const kind of [
  ["--master-fingerprint", "73c5da0a"],
  ["--master-xpub", "xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCRLiTVG3uxBxgKvRgbubRhqSKXnGGb1aoaqLrpMBDrVxga8"],
  ["--account-xpub", "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj"],
]) {
  const result = attempt(() => walletEvidence(parseArguments([...kind, "--scan-gap", "5"])));
  record(result.error !== undefined && /--scan-gap applies to/u.test(result.error), `--scan-gap with ${kind[0]} refused`, JSON.stringify(result));
}

console.log("\n== B. The number of addresses through the library ==");
const node = (password: string, salt: string, rounds: number, bytes: number) =>
  Uint8Array.from(pbkdf2Sync(password, salt, rounds, bytes, "sha512"));
const coinCheck = new CoinAddressCheck(node);
const walletCheck = new WalletEvidenceCheck(node);
const first = { account: 0, branch: 0, index: 0 };
for (const value of [0, 1, 20, 1000, 1001, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "20", null, 2 ** 53]) {
  const valid = value === 1 || value === 20 || value === 1000;
  const viaCoin = attempt(() => coinCheck.match(ABANDON, { coin: DASH, value: DASH_X0, location: first, addresses: value as number }));
  const viaWallet = attempt(() =>
    walletCheck.match(ABANDON, { kind: "coin-address", coin: "dash", value: DASH_X0, location: first, addresses: value as number }),
  );
  const viaBitcoin = attempt(() =>
    walletCheck.match(ABANDON, {
      kind: "address",
      value: at("m/84'/0'/0'/0/0", { kind: "p2wpkh", hrp: "bc" }),
      profiles: ["native-segwit"],
      location: { network: "mainnet", ...first },
      addresses: value as number,
    }),
  );
  for (const [entry, result] of [
    ["CoinAddressCheck", viaCoin],
    ["WalletEvidenceCheck coin-address", viaWallet],
    ["WalletEvidenceCheck address", viaBitcoin],
  ] as const) {
    const ok = valid
      ? (result.value as { matched?: boolean } | undefined)?.matched === true
      : result.error !== undefined && /integer from 1 through 1000/u.test(result.error);
    record(ok, `${entry} addresses=${String(value)} ${valid ? "matches" : "refused"}`, JSON.stringify(result));
  }
}

console.log("\n== C. A match at the last index, none past it, and the indexes derived ==");
{
  const bc19 = at("m/84'/0'/0'/0/19", { kind: "p2wpkh", hrp: "bc" });
  const inRange = coinCheck.match(ABANDON, { coin: coinById("bitcoin"), value: bc19, location: first, addresses: 20 });
  record(inRange.path === "m/84'/0'/0'/0/19", "BIP84 index 19 found among 20 from 0", JSON.stringify(inRange));
  const short = coinCheck.match(ABANDON, { coin: coinById("bitcoin"), value: bc19, location: first, addresses: 19 });
  record(short.matched === false, "BIP84 index 19 not found among 19 from 0", JSON.stringify(short));
  const p4 = at("m/9'/5'/17'/0'/0'/4", { kind: "dash-platform", hrp: "dash" });
  const platform = coinCheck.match(ABANDON, { coin: DASH, value: p4, location: first, addresses: 5 });
  record(platform.path === "m/9'/5'/17'/0'/0'/4", "Platform index 4 found among 5 from 0", JSON.stringify(platform));
  const platformShort = coinCheck.match(ABANDON, { coin: DASH, value: p4, location: first, addresses: 4 });
  record(platformShort.matched === false, "Platform index 4 not found among 4 from 0", JSON.stringify(platformShort));
  const x1004 = at("m/44'/5'/0'/0/1004", { kind: "p2pkh", version: [0x4c] });
  const far = coinCheck.match(ABANDON, { coin: DASH, value: x1004, location: { ...first, index: 5 }, addresses: 1000 });
  record(far.path === "m/44'/5'/0'/0/1004", "Dash index 1004 found among 1000 from 5", JSON.stringify(far));
  const farShort = coinCheck.match(ABANDON, { coin: DASH, value: x1004, location: { ...first, index: 5 }, addresses: 999 });
  record(farShort.matched === false, "Dash index 1004 not found among 999 from 5", JSON.stringify(farShort));
  const evm = at("m/44'/60'/2'/1/30", { kind: "evm" });
  const etc = coinCheck.match(ABANDON, { coin: coinById("ethereum-classic"), value: evm, location: { account: 2, branch: 1, index: 11 }, addresses: 20 });
  record(etc.path === "m/44'/60'/2'/1/30", "ETC on coin type 60, index 30 = last of 20 from 11", JSON.stringify(etc));
}
// The children derived below each branch for an address that matches nowhere.
const original = HDKey.prototype._deriveChild;
{
  const derived: string[] = [];
  HDKey.prototype._deriveChild = function (this: HDKey, index: number, I?: Uint8Array) {
    const child = original.call(this, index, I);
    derived.push(`${child.depth}:${index}`);
    return child;
  };
  // Bitcoin Cash has two coin types, so two branches are scanned.
  const elsewhere = base58check(Uint8Array.from([0x00, ...new Uint8Array(20)]));
  const result = coinCheck.match(ABANDON, { coin: coinById("bitcoin-cash"), value: elsewhere, location: { account: 0, branch: 0, index: 3 }, addresses: 20 });
  HDKey.prototype._deriveChild = original;
  const leaves = derived.filter((entry) => entry.startsWith("5:")).map((entry) => Number(entry.slice(2)));
  const expected = [...Array.from({ length: 20 }, (_, i) => i + 3), ...Array.from({ length: 20 }, (_, i) => i + 3)];
  record(
    result.matched === false && JSON.stringify(leaves) === JSON.stringify(expected),
    "no match: indexes 3..22 derived once per branch (2 branches), none past 22",
    `matched ${result.matched}; ${leaves.length} address keys, first ${leaves[0]}, last ${leaves.at(-1)}, max ${Math.max(...leaves)}; branch steps ${derived.filter((e) => !e.startsWith("5:")).length}`,
  );
}

console.log("\n== D. `addresses` refused on kinds that are not scanned ==");
const NOT_SCANNED: WalletEvidence[] = [
  { kind: "master-fingerprint", value: "73c5da0a", network: "mainnet" },
  {
    kind: "master-xpub",
    value: "xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCRLiTVG3uxBxgKvRgbubRhqSKXnGGb1aoaqLrpMBDrVxga8",
    network: "mainnet",
  },
  {
    kind: "account-xpub",
    value: "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
    profiles: ["native-segwit"],
    location: { network: "mainnet", ...first },
  },
];
for (const evidence of NOT_SCANNED) {
  const plain = attempt(() => walletCheck.match(ABANDON, evidence));
  record((plain.value as { matched?: boolean } | undefined)?.matched === true, `${evidence.kind} without addresses matches`, JSON.stringify(plain));
  for (const addresses of [1, 20]) {
    const withCount = { ...evidence, addresses } as unknown as WalletEvidence;
    const asserted = attempt(() => assertWalletEvidence(withCount));
    const matched = attempt(() => walletCheck.match(ABANDON, withCount));
    record(
      asserted.error !== undefined && matched.error !== undefined && /compared with several addresses/u.test(matched.error),
      `${evidence.kind} with addresses=${addresses} refused`,
      `assert: ${JSON.stringify(asserted)}; match: ${JSON.stringify(matched)}`,
    );
  }
}

console.log("\n== E. Seeds and keys wiped on success, on no match and on error ==");
interface Watch {
  readonly keys: HDKey[];
  readonly copies: Uint8Array[];
  readonly seeds: Uint8Array[];
}
const originalSeed = HDKey.fromMasterSeed;
const privateKeyGetter = Object.getOwnPropertyDescriptor(HDKey.prototype, "privateKey")!.get!;
/** Runs `run` while every HDKey made, every private-key copy taken and every seed given are kept. */
function watched(run: (pbkdf2: typeof node, watch: Watch) => unknown, failAtDerivation?: number): { result: unknown; watch: Watch } {
  const watch: Watch = { keys: [], copies: [], seeds: [] };
  let derivations = 0;
  HDKey.fromMasterSeed = function (s: Uint8Array, v?: never) {
    const key = originalSeed.call(HDKey, s, v);
    watch.keys.push(key);
    return key;
  } as typeof HDKey.fromMasterSeed;
  HDKey.prototype._deriveChild = function (this: HDKey, index: number, I?: Uint8Array) {
    derivations += 1;
    if (derivations === failAtDerivation) throw new Error(`probe: derivation ${derivations} fails`);
    const key = original.call(this, index, I);
    watch.keys.push(key);
    return key;
  };
  Object.defineProperty(HDKey.prototype, "privateKey", {
    configurable: true,
    get(this: HDKey) {
      const copy = privateKeyGetter.call(this) as Uint8Array | null;
      if (copy !== null) watch.copies.push(copy);
      return copy;
    },
  });
  const pbkdf2 = (password: string, salt: string, rounds: number, bytes: number) => {
    const out = node(password, salt, rounds, bytes);
    watch.seeds.push(out);
    return out;
  };
  let result: unknown;
  try {
    result = { value: run(pbkdf2, watch) };
  } catch (error) {
    result = { error: (error as Error).message };
  } finally {
    HDKey.fromMasterSeed = originalSeed;
    HDKey.prototype._deriveChild = original;
    Object.defineProperty(HDKey.prototype, "privateKey", { configurable: true, get: privateKeyGetter });
  }
  return { result, watch };
}
function expectWiped(label: string, outcome: { result: unknown; watch: Watch }, expectError: boolean): void {
  const { result, watch } = outcome;
  // Read the internal field without the getter, after the getter was restored.
  const live = watch.keys.filter((key) => (key as unknown as { _privateKey?: Uint8Array })._privateKey !== undefined);
  const copies = watch.copies.filter((copy) => copy.some((byte) => byte !== 0));
  const seeds = watch.seeds.filter((s) => s.some((byte) => byte !== 0));
  const errored = (result as { error?: string }).error !== undefined;
  record(
    live.length === 0 && copies.length === 0 && seeds.length === 0 && errored === expectError && watch.keys.length > 0 && watch.seeds.length > 0,
    label,
    `result ${JSON.stringify(result)}; keys made ${watch.keys.length}, still holding a private key ${live.length}; private-key copies ${watch.copies.length}, non-zero ${copies.length}; seeds ${watch.seeds.length}, non-zero ${seeds.length}`,
  );
}
const bc3 = at("m/84'/0'/0'/0/3", { kind: "p2wpkh", hrp: "bc" });
const p2 = at("m/9'/5'/17'/0'/0'/2", { kind: "dash-platform", hrp: "dash" });
const wifKey = derive(seed, "m/84'/0'/0'/0/2").key;
const wif = base58check(Uint8Array.from([0x80, ...Buffer.from(wifKey.toString(16).padStart(64, "0"), "hex"), 0x01]));
const scenarios: [string, (pbkdf2: typeof node) => unknown, number | undefined, boolean][] = [
  ["coin-address Dash Platform, match at index 2 of 20", (p) => new CoinAddressCheck(p).match(ABANDON, { coin: DASH, value: p2, location: first, addresses: 20 }), undefined, false],
  ["coin-address Dash Platform, no match among 20", (p) => new CoinAddressCheck(p).match(ABANDON, { coin: DASH, value: p2, location: { ...first, account: 1 }, addresses: 20 }), undefined, false],
  ["coin-address, error at derivation 3 (inside the path)", (p) => new CoinAddressCheck(p).match(ABANDON, { coin: DASH, value: p2, location: first, addresses: 20 }), 3, true],
  ["coin-address, error at derivation 7 (inside the scan)", (p) => new CoinAddressCheck(p).match(ABANDON, { coin: DASH, value: p2, location: first, addresses: 20 }), 7, true],
  ["Bitcoin address, auto profiles, match at BIP84 index 3", (p) => new WalletEvidenceCheck(p).match(ABANDON, { kind: "address", value: bc3, profiles: ["legacy", "nested-segwit", "native-segwit", "taproot"], location: { network: "mainnet", ...first }, addresses: 20 }), undefined, false],
  ["Bitcoin address, error at derivation 30 (second profile)", (p) => new WalletEvidenceCheck(p).match(ABANDON, { kind: "address", value: bc3, profiles: ["legacy", "nested-segwit", "native-segwit", "taproot"], location: { network: "mainnet", ...first }, addresses: 20 }), 30, true],
  ["WIF, match at BIP84 index 2", (p) => new WalletEvidenceCheck(p).match(ABANDON, { kind: "wif", value: wif, profiles: ["native-segwit"], location: { network: "mainnet", ...first }, addresses: 20 }), undefined, false],
  ["WIF, no match among 2", (p) => new WalletEvidenceCheck(p).match(ABANDON, { kind: "wif", value: wif, profiles: ["native-segwit"], location: { network: "mainnet", ...first }, addresses: 2 }), undefined, false],
  ["account xpub, match", (p) => new WalletEvidenceCheck(p).match(ABANDON, NOT_SCANNED[2]!), undefined, false],
  ["account xpub, error at derivation 2", (p) => new WalletEvidenceCheck(p).match(ABANDON, NOT_SCANNED[2]!), 2, true],
  ["master fingerprint, match", (p) => new WalletEvidenceCheck(p).match(ABANDON, NOT_SCANNED[0]!), undefined, false],
];
for (const [label, run, failAt, expectError] of scenarios) expectWiped(label, watched(run, failAt), expectError);
{
  // An error thrown by the comparison itself, not by a derivation.
  const isAddressOf = CoinAddress.prototype.isAddressOf;
  let calls = 0;
  CoinAddress.prototype.isAddressOf = function (this: CoinAddress, key: Uint8Array) {
    calls += 1;
    if (calls === 3) throw new Error("probe: comparison 3 fails");
    return isAddressOf.call(this, key);
  };
  expectWiped(
    "coin-address, error in the third comparison",
    watched((p) => new CoinAddressCheck(p).match(ABANDON, { coin: DASH, value: p2, location: first, addresses: 20 })),
    true,
  );
  CoinAddress.prototype.isAddressOf = isAddressOf;
}
{
  // The asynchronous form, with a PBKDF2 that answers later.
  const later = async () => {
    const keys: HDKey[] = [];
    const seeds: Uint8Array[] = [];
    HDKey.prototype._deriveChild = function (this: HDKey, index: number, I?: Uint8Array) {
      const key = original.call(this, index, I);
      keys.push(key);
      return key;
    };
    HDKey.fromMasterSeed = function (s: Uint8Array, v?: never) {
      const key = originalSeed.call(HDKey, s, v);
      keys.push(key);
      return key;
    } as typeof HDKey.fromMasterSeed;
    const check = new CoinAddressCheck(async (...args) => {
      const out = node(...args);
      seeds.push(out);
      return out;
    });
    const result = await check.matchAsync(ABANDON, { coin: DASH, value: p2, location: first, addresses: 20 });
    HDKey.prototype._deriveChild = original;
    HDKey.fromMasterSeed = originalSeed;
    const live = keys.filter((key) => (key as unknown as { _privateKey?: Uint8Array })._privateKey !== undefined);
    record(
      result.matched && live.length === 0 && seeds.length === 1 && seeds[0]!.every((b) => b === 0),
      "matchAsync: match, keys and seed wiped",
      `result ${JSON.stringify(result)}; keys ${keys.length}, live ${live.length}; seed zero ${seeds[0]?.every((b) => b === 0)}`,
    );
  };
  await later();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
