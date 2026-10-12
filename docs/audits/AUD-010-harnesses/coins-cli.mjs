// AUD-010 coins reviewer, probe "coins-cli": --coin, --coin-address and --scan-gap end to end,
// through the real command line (src/mnemocode.ts under tsx, which starts itself again under the
// Node.js permission model as a user's run does), with the README's public example: the stored
// phrase "wool abuse actual … congress" is "abandon … about" shifted with 23-09-2026.
//
// Run: node docs/audits/AUD-010-harnesses/coins-cli.mjs
// Exit code: 0 when every run gives the expected exit code and output, 1 otherwise.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const STORED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const BASE = ["recover-date", "--mode", "seedshift", "--input", STORED, "--format", "1", "--dates", "??-09-2026"];

let failures = 0;
function run(label, extra, expectedCode, patterns) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/mnemocode.ts", ...BASE, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  const missing = patterns.filter((pattern) => !pattern.test(output));
  const ok = result.status === expectedCode && missing.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     args: ${extra.join(" ")}\n     exit ${result.status} (expected ${expectedCode}); missing ${missing.map(String).join(", ") || "nothing"}`);
  for (const line of output.split("\n")) console.log(`     | ${line}`);
}

const MATCHED = /23-09-2026\tabandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\tmatched at /u;
run("Dash Platform index 1 found among 2", ["--coin", "dash", "--coin-address", "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw", "--scan-gap", "2"], 0, [MATCHED, /matched at m\/9'\/5'\/17'\/0'\/0'\/1$/mu, /found 1 match/u]);
run("Dash Platform index 1 not found at index 0 alone", ["--coin", "dash", "--coin-address", "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw", "--scan-gap", "1"], 0, [/found 0 matches/u]);
run("Dash Platform index 1 found from --index 1, one address", ["--coin", "dash", "--coin-address", "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw", "--index", "1", "--scan-gap", "1"], 0, [/matched at m\/9'\/5'\/17'\/0'\/0'\/1$/mu]);
run("README Ethereum example", ["--coin", "ethereum", "--coin-address", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"], 0, [/matched at m\/44'\/60'\/0'\/0\/0$/mu]);
run("Ethereum Classic on Ethereum's coin type", ["--coin", "ethereum-classic", "--coin-address", "0x9858effd232b4033e47d90003d41ec34ecaeda94"], 0, [/matched at m\/44'\/60'\/0'\/0\/0$/mu]);
run("Bitcoin Cash legacy on Bitcoin's coin type", ["--coin", "bitcoin-cash", "--coin-address", "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"], 0, [/matched at m\/44'\/0'\/0'\/0\/0$/mu]);
run("Bitcoin native SegWit change address via --coin bitcoin, --branch 1", ["--coin", "bitcoin", "--coin-address", "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el", "--branch", "1", "--scan-gap", "1"], 0, [/matched at m\/84'\/0'\/0'\/1\/0$/mu]);
run("Bitcoin last of 20: BIP84 index 19", ["--bitcoin-address", "bc1q27yd7vz8m5kz230wuyncfe3pyazez6ah58yzy0", "--bitcoin-profile", "native-segwit"], 0, [/matched at m\/84'\/0'\/0'\/0\/19$/mu]);
run("Bitcoin index 19 not among 19", ["--bitcoin-address", "bc1q27yd7vz8m5kz230wuyncfe3pyazez6ah58yzy0", "--bitcoin-profile", "native-segwit", "--scan-gap", "19"], 0, [/found 0 matches/u]);
for (const gap of ["0", "1001", "1.5", "-1", "abc"])
  run(`--scan-gap ${gap} refused`, ["--coin", "dash", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5", "--scan-gap", gap], 1, [/must be a base-10 integer from 1 through 1000/u]);
run("--scan-gap with --master-fingerprint refused", ["--master-fingerprint", "73c5da0a", "--scan-gap", "5"], 1, [/--scan-gap applies to/u]);
run("--network beside --coin-address refused", ["--coin", "dash", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5", "--network", "testnet"], 1, [/--network is for Bitcoin evidence/u]);
run("--coin without --coin-address refused", ["--coin", "dash", "--master-fingerprint", "73c5da0a"], 1, [/--coin names the coin of --coin-address/u]);
run("--coin-address without --coin refused", ["--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"], 1, [/--coin-address needs --coin/u]);
run("unknown --coin refused", ["--coin", "monero", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"], 1, [/Unknown coin "monero"/u]);
run("--index 2147483647 --scan-gap 2 refused", ["--coin", "dash", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5", "--index", "2147483647", "--scan-gap", "2"], 1, [/would pass index 2147483647/u]);
run("a shielded Zcash address refused with its reason", ["--coin", "zcash", "--coin-address", "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly"], 1, [/it is shielded/u]);

console.log(`\n${failures === 0 ? "all runs as expected" : `${failures} run(s) not as expected`}`);
process.exitCode = failures === 0 ? 0 : 1;
