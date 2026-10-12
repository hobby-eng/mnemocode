// AUD-010 build reviewer: can the startup self-test FAIL for each new feature of ab57e8d?
//
// The workspace rule (AGENTS.md, "Self-tests and tests come with every coin and feature"): every
// coin and feature has quick known answers that run at every start, and they must be able to
// fail. Each case below breaks one feature in memory (build-mutation-hook.mjs changes one module
// of dist/ as it loads; nothing on disk changes) and, in a fresh process, runs:
//   - the startup self-test exactly as the command line composes it (cli/self-test.ts:
//     MnemoCodeSelfTest.core with wallet evidence, coins, heir sheet and share cards), and
//   - the feature's row of the full self-test,
// and prints whether each detected the break. The baseline (no change) must pass both.
//
// Exits 1 when the baseline fails, when a mutation is not applied exactly once, or when a
// mutation of a new feature passes the startup self-test (the rule is not met for it).
import { spawnSync } from "node:child_process";

const MUTATIONS = [
  { id: "baseline", feature: "none" },
  {
    id: "dogecoin-coin-type",
    feature: "coin Dogecoin (BIP44 coin type 3 -> 4)",
    file: "/dist/core/coins/bitcoin-like.js",
    search: "coinTypes: [3],",
    replace: "coinTypes: [4],",
  },
  {
    id: "zcash-version",
    feature: "coin Zcash (t1 version 1CB8 -> 1CB9)",
    file: "/dist/core/coins/bitcoin-like.js",
    search: "prefix: [0x1c, 0xb8]",
    replace: "prefix: [0x1c, 0xb9]",
  },
  {
    id: "ethereum-classic-coin-type",
    feature: "coin Ethereum Classic (coin types [61, 60] -> [62, 63])",
    file: "/dist/core/coins/evm.js",
    search: "coinTypes: [61, 60],",
    replace: "coinTypes: [62, 63],",
  },
  {
    id: "tron-coin-type",
    feature: "coin Tron (coin type 195 -> 196)",
    file: "/dist/core/coins/evm.js",
    search: "coinTypes: [195],",
    replace: "coinTypes: [196],",
  },
  {
    id: "injective-coin-type",
    feature: "coin Injective (coin type 60 -> 61)",
    file: "/dist/core/coins/cosmos.js",
    search: 'coinTypes: [60],\n    prefix: "inj",',
    replace: 'coinTypes: [61],\n    prefix: "inj",',
  },
  {
    id: "dash-p2pkh-version",
    feature: "coin Dash, BIP44 P2PKH address (version 0x4c -> 0x4d)",
    file: "/dist/core/coins/dash.js",
    search: "prefix: [0x4c]",
    replace: "prefix: [0x4d]",
  },
  {
    id: "litecoin-coin-type",
    feature: "coin Litecoin (coin type 2 -> 4), a coin WITH a startup answer",
    file: "/dist/core/coins/bitcoin-like.js",
    search: "coinTypes: [2],",
    replace: "coinTypes: [4],",
  },
  {
    id: "address-scan-first-only",
    feature: "address scan (--scan-gap): only the first address of the range compared",
    file: "/dist/core/address-scan.js",
    search: "index < range.first + range.count;",
    replace: "index < range.first + 1;",
  },
  {
    id: "valid-last-words-drop-one",
    feature: "validLastWordIndexes: the last entropy value left out",
    file: "/dist/core/words.js",
    search: "tail < 2 ** tailBits;",
    replace: "tail < 2 ** tailBits - 1;",
  },
  {
    id: "decode-question-mark-digit",
    feature: "decode with ?: a ? for a digit fits nothing",
    file: "/dist/core/missing-codes.js",
    search: 'if (pattern[index] !== "?" && pattern[index] !== written[index])',
    replace: 'if (pattern[index] !== "*" && pattern[index] !== written[index])',
  },
  {
    id: "share-card-codes-per-card",
    feature: "share cards print the share's codes: 3 codes per card -> 4",
    file: "/dist/export/sskr-render.js",
    search: "const CODES_PER_CARD = 3;",
    replace: "const CODES_PER_CARD = 4;",
  },
  {
    id: "date-recovery-no-dedupe",
    feature: "date recovery tries each shift vector once: the dedupe removed",
    file: "/dist/core/date-recovery.js",
    search: "if (seen.has(shifts)) {",
    replace: "if (false) {",
  },
  {
    id: "date-recovery-drop-all",
    feature: "date recovery: every shift vector after the first skipped",
    file: "/dist/core/date-recovery.js",
    search: "if (seen.has(shifts)) {",
    replace: "if (seen.size > 0) {",
  },
  {
    id: "backup-check-always-restores",
    feature: "backup check (core/backup-check.ts): every backup reported as restoring",
    file: "/dist/core/backup-check.js",
    search: "return Object.freeze(found === undefined",
    replace: "return Object.freeze(true",
  },
];

const CHILD = `
const { MnemoCodeSelfTest } = await import("./dist/core/self-test.js");
const { WALLET_EVIDENCE_SELF_TEST } = await import("./dist/core/wallet-evidence-self-test.js");
const { COIN_ADDRESS_SELF_TEST } = await import("./dist/core/coins-self-test.js");
const { HEIR_SHEET_SELF_TEST } = await import("./dist/export/heir-sheet-self-test.js");
const { SHARE_CARDS_SELF_TEST } = await import("./dist/export/sskr-render-self-test.js");
const { checkDateSearch } = await import("./dist/core/date-search-self-test.js");
const { checkBackupReading } = await import("./dist/core/backup-reading-self-test.js");
const { checkBackupCheck } = await import("./dist/core/backup-check-self-test.js");
const { masterFingerprint } = await import("./dist/bitcoin-evidence.js");
await import("./dist/export/platform-node.js");
const features = [WALLET_EVIDENCE_SELF_TEST, COIN_ADDRESS_SELF_TEST, HEIR_SHEET_SELF_TEST, SHARE_CARDS_SELF_TEST];
const outcome = async (run) => { try { await run(); return "passed"; } catch (error) { return "FAILED: " + (error?.message ?? String(error)).split("\\n").at(-1); } };
const fingerprint = (mnemonic) => masterFingerprint(mnemonic);
const report = {
  applied: globalThis.aud010Applied,
  startup: await outcome(() => MnemoCodeSelfTest.core(features)),
  full: {
    "Wallet evidence": await outcome(() => WALLET_EVIDENCE_SELF_TEST.check.run()),
    "Coin addresses": await outcome(() => COIN_ADDRESS_SELF_TEST.check.run()),
    "Dates": await outcome(() => checkDateSearch(fingerprint)),
    "Backup reading": await outcome(() => checkBackupReading(fingerprint)),
    "Backup check": await outcome(() => checkBackupCheck()),
    "Share cards": await outcome(() => SHARE_CARDS_SELF_TEST.check.run()),
  },
};
console.log(JSON.stringify(report));
`;

let failures = 0;
for (const mutation of MUTATIONS) {
  const environment = { ...process.env };
  if (mutation.id === "baseline") delete environment.AUD010_MUTATION;
  else environment.AUD010_MUTATION = JSON.stringify(mutation);
  const result = spawnSync(
    process.execPath,
    ["--import", "./docs/audits/AUD-010-harnesses/build-mutation-hook.mjs", "--input-type=module", "-e", CHILD],
    { encoding: "utf8", env: environment, timeout: 300_000 },
  );
  if (result.status !== 0) {
    failures += 1;
    console.log(`FAIL ${mutation.id}: child exit ${result.status}: ${result.stderr.trim().split("\n").slice(-3).join(" | ")}`);
    continue;
  }
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1));
  const fullFailed = Object.entries(report.full).filter(([, value]) => value !== "passed");
  const fullText = fullFailed.length === 0 ? "every row passed" : fullFailed.map(([n, v]) => `${n} ${v}`).join("; ");
  console.log(`${mutation.id} [${mutation.feature}]`);
  console.log(`  changed modules: ${report.applied}; startup: ${report.startup}`);
  console.log(`  full self-test rows: ${fullText}`);
  if (mutation.id === "baseline") {
    if (report.applied !== 0 || report.startup !== "passed" || fullFailed.length > 0) {
      failures += 1;
      console.log("  FAIL: the unchanged build must pass");
    }
    continue;
  }
  if (report.applied !== 1) {
    failures += 1;
    console.log("  FAIL: the mutation was not applied exactly once");
  } else if (report.startup === "passed") {
    failures += 1;
    console.log(`  MISSED AT STARTUP: no startup known answer fails for this break${fullFailed.length === 0 ? "; the full self-test misses it too" : ""}`);
  } else console.log("  detected at startup");
}
console.log(failures === 0 ? "PASS build-startup-mutations" : `FAIL build-startup-mutations: ${failures} case(s)`);
process.exitCode = failures === 0 ? 0 : 1;
