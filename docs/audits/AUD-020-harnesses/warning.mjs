// Public BIP39 fixture: an ordinary match, with no fingerprint collision search.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { walletCheckOf } = await import(pathToFileURL(`${root}/dist/bitcoin-evidence.js`));
const { FINGERPRINT_WARNING } = await import(pathToFileURL(`${root}/dist/core/wallet-check.js`));
const phrase = "abandon ".repeat(11) + "about";
const fingerprint = "73c5da0a";
const check = walletCheckOf(
  { kind: "master-fingerprint", value: fingerprint, network: "mainnet" },
  "",
);
const match = await check(phrase);
assert.equal(match.matched, true);
assert.equal(match.warning, FINGERPRINT_WARNING);

const result = spawnSync(
  process.execPath,
  [
    `${root}/dist/mnemocode.js`,
    "re-encode",
    "--input",
    phrase,
    "--old-mode",
    "direct",
    "--old-format",
    "english",
    "--format",
    "3",
    "--master-fingerprint",
    fingerprint,
  ],
  { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 },
);
assert.equal(result.status, 0, result.stderr);
assert.ok(result.stderr.includes("The fingerprint matches: the seed phrase is confirmed."));
assert.ok(!result.stderr.includes(FINGERPRINT_WARNING));
console.log(
  JSON.stringify({
    libraryMatched: match.matched,
    libraryReturnsFilterWarning: match.warning === FINGERPRINT_WARNING,
    cliExitCode: result.status,
    cliClaimsConfirmed: result.stderr.includes("seed phrase is confirmed"),
    cliShowsFilterWarning: result.stderr.includes(FINGERPRINT_WARNING),
    independentCollisionGenerated: false,
  }),
);
