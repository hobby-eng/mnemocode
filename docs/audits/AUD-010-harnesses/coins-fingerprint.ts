// AUD-010 coins reviewer, probe "coins-fingerprint": the BIP32 master fingerprint and its parsing.
//
// 1. The published fingerprint 73c5da0a of "abandon … about" (and the TREZOR one), from the
//    independent oracle of coins-oracle.ts (node:crypto only) and from the production entry points:
//    masterFingerprint (node:crypto PBKDF2), MasterFingerprintCheck with @noble/hashes' PBKDF2
//    (answers at once) and with WebCrypto's PBKDF2 (answers later), as a page passes it.
// 2. A fingerprint with leading zero digits: the first phrases of counting 128-bit entropy are
//    searched, with the oracle, for one whose fingerprint starts with "0"; production must print the
//    same eight digits.
// 3. parseMasterFingerprint and the master-fingerprint evidence refuse malformed values and accept
//    case and white-space variants; the command line refuses a place beside it.
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-fingerprint.ts
// Exit code: 0 when every expectation holds, 1 otherwise.

import { pbkdf2 as noblePbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { parseArguments } from "../../../src/cli/arguments.js";
import { walletEvidence } from "../../../src/cli/bitcoin-options.js";
import { assertWalletEvidence, masterFingerprint, matchWalletEvidence } from "../../../src/bitcoin-evidence.js";
import { MasterFingerprintCheck, parseMasterFingerprint, type Pbkdf2HmacSha512 } from "../../../src/core/master-fingerprint.js";
import { ABANDON, fingerprintOf, masterOf, seedOf } from "./coins-oracle.js";

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
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

const nobleSync: Pbkdf2HmacSha512 = (password, salt, c, dkLen) => noblePbkdf2(sha512, password, salt, { c, dkLen });
const webCrypto: Pbkdf2HmacSha512 = async (password, salt, rounds, bytes) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: encoder.encode(salt), iterations: rounds }, key, bytes * 8);
  return new Uint8Array(bits);
};

console.log("== 1. The published fingerprint ==");
for (const [passphrase, published] of [
  ["", "73c5da0a"],
  ["TREZOR", undefined],
] as const) {
  const oracle = fingerprintOf(masterOf(seedOf(ABANDON, passphrase)));
  const expected = published ?? oracle;
  record(published === undefined || oracle === published, `oracle fingerprint, passphrase ${JSON.stringify(passphrase)}`, `oracle ${oracle}, published ${published ?? "(none; oracle only)"}`);
  record(masterFingerprint(ABANDON, passphrase) === expected, `masterFingerprint (node:crypto), passphrase ${JSON.stringify(passphrase)}`, `${masterFingerprint(ABANDON, passphrase)} vs ${expected}`);
  const viaNoble = new MasterFingerprintCheck(nobleSync).fingerprint(ABANDON, passphrase);
  record(viaNoble === expected, `MasterFingerprintCheck (@noble pbkdf2), passphrase ${JSON.stringify(passphrase)}`, `${viaNoble} vs ${expected}`);
  const viaWeb = await new MasterFingerprintCheck(webCrypto).fingerprintAsync(ABANDON, passphrase);
  record(viaWeb === expected, `MasterFingerprintCheck.fingerprintAsync (WebCrypto), passphrase ${JSON.stringify(passphrase)}`, `${viaWeb} vs ${expected}`);
  const sync = attempt(() => new MasterFingerprintCheck(webCrypto).fingerprint(ABANDON, passphrase));
  record(sync.error !== undefined && /answers later/u.test(sync.error), "fingerprint() with a PBKDF2 that answers later is refused", JSON.stringify(sync));
}

console.log("\n== 2. A fingerprint with a leading zero ==");
let found: { phrase: string; fingerprint: string } | undefined;
for (let counter = 0; counter < 4096 && found === undefined; counter += 1) {
  const entropy = new Uint8Array(16);
  entropy[14] = counter >> 8;
  entropy[15] = counter & 0xff;
  const phrase = entropyToMnemonic(entropy, wordlist);
  const fingerprint = fingerprintOf(masterOf(seedOf(phrase)));
  if (fingerprint.startsWith("0")) found = { phrase, fingerprint };
}
record(found !== undefined, "a counting-entropy phrase with a leading-zero fingerprint exists", JSON.stringify(found));
if (found !== undefined) {
  const production = masterFingerprint(found.phrase);
  record(production === found.fingerprint, "production prints its eight digits", `${production} vs ${found.fingerprint}`);
  const match = matchWalletEvidence(found.phrase, { kind: "master-fingerprint", value: found.fingerprint.toUpperCase(), network: "mainnet" });
  record(match.matched === true && match.derived === found.fingerprint, "and matches it given in capitals", JSON.stringify(match));
}

console.log("\n== 3. Parsing and refusals ==");
for (const [input, expected] of [
  ["73c5da0a", "73c5da0a"],
  ["73C5DA0A", "73c5da0a"],
  [" 73c5da0a\n", "73c5da0a"],
  [" 73c5DA0a　", "73c5da0a"],
] as const) {
  const result = attempt(() => parseMasterFingerprint(input));
  record(result.value === expected, `accepts ${JSON.stringify(input)}`, JSON.stringify(result));
}
for (const input of ["73c5da0", "73c5da0a0", "73c5da0g", "0x73c5da0a", "73c5 da0a", "", "７３c5da0a", "73c5da0a​", "-73c5da0", "73c5da0a 00", "73c5da0a\u0000"]) {
  const result = attempt(() => parseMasterFingerprint(input));
  record(result.error !== undefined && /eight hexadecimal/u.test(result.error), `refuses ${JSON.stringify(input)}`, JSON.stringify(result));
}
for (const input of [null, undefined, 0x73c5da0a, ["73c5da0a"]]) {
  const result = attempt(() => parseMasterFingerprint(input as unknown as string));
  record(result.error !== undefined, `refuses the runtime value ${JSON.stringify(input) ?? "undefined"}`, JSON.stringify(result));
}
const check = new MasterFingerprintCheck(nobleSync);
record(check.match(ABANDON, "73C5DA0A").matched === true, "MasterFingerprintCheck.match 73C5DA0A", JSON.stringify(check.match(ABANDON, "73C5DA0A")));
record(check.match(ABANDON, "73c5da0b").matched === false, "MasterFingerprintCheck.match 73c5da0b", JSON.stringify(check.match(ABANDON, "73c5da0b")));
const wrong = attempt(() => check.match(ABANDON, "73c5da0"));
record(wrong.error !== undefined && /eight hexadecimal/u.test(wrong.error), "MasterFingerprintCheck.match refuses 7 digits before the seed", JSON.stringify(wrong));
for (const network of ["testnet", "regtest", undefined]) {
  const result = attempt(() => matchWalletEvidence(ABANDON, { kind: "master-fingerprint", value: "73c5da0a", network: network as "mainnet" }));
  const ok = network === "testnet" ? result.value?.matched === true : result.error !== undefined && /mainnet or testnet/u.test(result.error);
  record(ok, `master-fingerprint evidence on network ${String(network)}`, JSON.stringify(result));
}
for (const extra of [["--index", "3"], ["--account", "1"], ["--bitcoin-profile", "taproot"], ["--branch", "1"]]) {
  const result = attempt(() => walletEvidence(parseArguments(["--master-fingerprint", "73c5da0a", ...extra])));
  record(result.error !== undefined && /a master key has no place/u.test(result.error), `--master-fingerprint with ${extra.join(" ")} refused`, JSON.stringify(result));
}
{
  const result = attempt(() => {
    const evidence = walletEvidence(parseArguments(["--master-fingerprint", "73c5da0g"]));
    assertWalletEvidence(evidence!);
    return evidence;
  });
  record(result.error !== undefined && /eight hexadecimal/u.test(result.error), "--master-fingerprint 73c5da0g refused before any secret", JSON.stringify(result));
}

console.log("\n== 4. Regressions of AUD-008-API002 and AUD-008-API005 (wallet evidence) ==");
{
  const location = { network: "mainnet" as const, account: 0, branch: 0, index: 0 };
  // x = 0 has no point on secp256k1 (0^3 + 7 = 7 is not a square modulo p).
  const offCurve = attempt(() =>
    matchWalletEvidence(ABANDON, { kind: "compressed-public-key", value: "02" + "00".repeat(32), profiles: ["native-segwit"], location }),
  );
  record(offCurve.error !== undefined && /not a point/u.test(offCurve.error), "API002: a compressed key off the curve is refused, not a non-match", JSON.stringify(offCurve));
  // A WIF of the group order n: Base58Check of 0x80, n, 0x01, built here.
  const { base58check } = await import("./coins-oracle.js");
  const orderWif = base58check(Uint8Array.from(Buffer.from("80" + "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141" + "01", "hex")));
  const order = attempt(() => matchWalletEvidence(ABANDON, { kind: "wif", value: orderWif, profiles: ["native-segwit"], location }));
  record(order.error !== undefined && /no valid secp256k1 private key/u.test(order.error), "API002: a WIF of the group order is refused", JSON.stringify(order));
  for (const [label, run] of [
    ["mnemonic null", () => check.fingerprint(null as unknown as string)],
    ["passphrase 123", () => check.fingerprint(ABANDON, 123 as unknown as string)],
    ["passphrase null", () => check.fingerprint(ABANDON, null as unknown as string)],
    ["passphrase with a lone surrogate", () => check.fingerprint(ABANDON, "\ud800")],
    ["coin-address passphrase 123", () => matchWalletEvidence(ABANDON, { kind: "coin-address", coin: "dash", value: "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5", location: { account: 0, branch: 0, index: 0 } }, 123 as unknown as string)],
  ] as const) {
    const result = attempt(run);
    record(result.error !== undefined && /TypeError/u.test(result.error), `API005: ${label} refused with a TypeError`, JSON.stringify(result));
  }
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
