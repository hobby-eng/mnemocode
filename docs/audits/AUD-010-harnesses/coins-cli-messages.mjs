// AUD-010 coins reviewer, probe "coins-cli-messages": the words with which the command line refuses
// a wallet option, end to end (src/mnemocode.ts under tsx), against what its help and the coins'
// contract say.
//
// 1. --index places the first address compared ("--index N  The first address number compared",
//    src/cli/help-pages.ts); its refusal must not call it a word index.
// 2. A valid address of another coin given with --coin must be refused as "not an address of
//    <coin>" (src/core/coins.ts: "other coins' addresses are refused, naming why"), not as damaged
//    or as mixed case.
//
// Run: node docs/audits/AUD-010-harnesses/coins-cli-messages.mjs
// Exit code: 1 when a refusal says something else, 0 otherwise.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const STORED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const BASE = ["recover-date", "--mode", "seedshift", "--input", STORED, "--format", "1", "--dates", "??-09-2026"];

let failures = 0;
function run(label, extra, expected, forbidden) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/mnemocode.ts", ...BASE, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  const ok = result.status === 1 && expected.test(output) && !(forbidden?.test(output) ?? false);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     args: ${extra.join(" ")}\n     exit ${result.status}; expected ${expected}${forbidden ? `, never ${forbidden}` : ""}\n     | ${output}`);
}

const DASH = ["--coin", "dash", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"];
run("--index -1 beside --coin-address", [...DASH, "--index", "-1"], /index/u, /word index/u);
run("--index 2147483648 beside --coin-address", [...DASH, "--index", "2147483648"], /index/u, /word index/u);
run("--index x beside --bitcoin-address", ["--bitcoin-address", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "--index", "x"], /index/u, /word index/u);
run("an Ethereum address given as XRP", ["--coin", "xrp", "--coin-address", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"], /not an address of XRP/u);
run("a Bitcoin native SegWit address given as Litecoin", ["--coin", "litecoin", "--coin-address", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"], /not an address of Litecoin/u);
run("a Dash address given as Bitcoin Cash", ["--coin", "bitcoin-cash", "--coin-address", "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"], /not an address of Bitcoin Cash/u);
run("a Bitcoin Cash CashAddr given as Bitcoin", ["--coin", "bitcoin", "--coin-address", "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6"], /not an address of Bitcoin/u);

console.log(`\n${failures === 0 ? "all refusals as expected" : `${failures} refusal(s) not as expected`}`);
process.exitCode = failures === 0 ? 0 : 1;
