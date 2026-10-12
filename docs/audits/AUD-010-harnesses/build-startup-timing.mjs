// AUD-010 build reviewer: how long the startup self-test takes, on the compiled dist/ (the code the
// command line runs before every command), in fresh Node.js processes, so that each first call
// includes what a real start pays.
//
// Each of RUNS fresh processes imports dist/core/self-test.js, the four features the command line
// builds in (cli/self-test.ts FEATURES) and the Node.js render platform, then times:
//   - MnemoCodeSelfTest.core() alone (core checks and the library's feature startups), first call;
//   - each feature's startup, first call;
//   - MnemoCodeSelfTest.core(FEATURES), second call (warm);
// and each library startup function on its own, in a separate fresh process per run.
// The workspace rule (AGENTS.md): milliseconds per check, about a second for all. Fails (exit 1)
// when a first-call core(FEATURES) total exceeds LIMIT_MS or any single piece exceeds PIECE_MS.
import { spawnSync } from "node:child_process";

const RUNS = 5;
const LIMIT_MS = 1000;
const PIECE_MS = 250;
const pieces = `
const { MnemoCodeSelfTest } = await import("./dist/core/self-test.js");
const features = [
  ["Wallet evidence", (await import("./dist/core/wallet-evidence-self-test.js")).WALLET_EVIDENCE_SELF_TEST],
  ["Coin addresses", (await import("./dist/core/coins-self-test.js")).COIN_ADDRESS_SELF_TEST],
  ["Heir sheet", (await import("./dist/export/heir-sheet-self-test.js")).HEIR_SHEET_SELF_TEST],
  ["Share cards", (await import("./dist/export/sskr-render-self-test.js")).SHARE_CARDS_SELF_TEST],
];
await import("./dist/export/platform-node.js");
const time = (run) => { const start = performance.now(); run(); return performance.now() - start; };
const row = { library: time(() => MnemoCodeSelfTest.core()) };
for (const [name, feature] of features) row[name] = time(() => feature.startup());
row.firstTotal = Object.values(row).reduce((a, b) => a + b, 0);
row.warmAll = time(() => MnemoCodeSelfTest.core(features.map(([, f]) => f)));
console.log(JSON.stringify(row));
`;
const library = `
const time = (run) => { const start = performance.now(); run(); return performance.now() - start; };
const row = {};
const parts = [
  ["checkMasterFingerprintStartup", "./dist/core/master-fingerprint-self-test.js"],
  ["checkDateSearchStartup", "./dist/core/date-search-self-test.js"],
  ["checkBackupReadingStartup", "./dist/core/backup-reading-self-test.js"],
  ["checkWordSearchStartup", "./dist/core/candidates-self-test.js"],
  ["checkCandidateListStartup", "./dist/core/candidate-list-self-test.js"],
  ["checkShareRepairStartup", "./dist/sskr/repair-self-test.js"],
];
for (const [name, path] of parts) row[name] = time((await import(path))[name]);
console.log(JSON.stringify(row));
`;
function run(script) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}
const format = (row) =>
  Object.entries(row)
    .map(([name, ms]) => `${name} ${ms.toFixed(1)} ms`)
    .join("; ");
let failures = 0;
const totals = [];
for (let index = 1; index <= RUNS; index++) {
  const row = run(pieces);
  totals.push(row.firstTotal);
  console.log(`run ${index}: ${format(row)}`);
  if (row.firstTotal > LIMIT_MS) failures += 1;
  for (const [name, ms] of Object.entries(row))
    if (name !== "firstTotal" && name !== "library" && ms > PIECE_MS) failures += 1;
}
for (let index = 1; index <= 3; index++) {
  const row = run(library);
  console.log(`library startups, run ${index}: ${format(row)}`);
  for (const ms of Object.values(row)) if (ms > PIECE_MS) failures += 1;
}
totals.sort((a, b) => a - b);
console.log(
  `first-call startup total over ${RUNS} fresh processes: min ${totals[0].toFixed(1)} ms, median ${totals[Math.floor(RUNS / 2)].toFixed(1)} ms, max ${totals.at(-1).toFixed(1)} ms (limit ${LIMIT_MS} ms, piece limit ${PIECE_MS} ms)`,
);
console.log(failures === 0 ? "PASS build-startup-timing" : `FAIL build-startup-timing: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
