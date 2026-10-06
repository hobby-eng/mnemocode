// AUD-008: focused malformed-argument probes. Nonzero means a reject contract failed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  dateRecoveryCandidates,
  encodeMnemonic,
  parseDate,
  parseDatePattern,
} from "../../../dist/core.js";
import { matchBitcoinEvidence } from "../../../dist/bitcoin-evidence.js";

const mnemonic = "abandon ".repeat(11) + "about";
const date = parseDate("23-09-2026");
const encoded = encodeMnemonic(mnemonic, [date]);
const patterns = [parseDatePattern("?3-09-2026")];
const failures = [];
const observations = [];
function mustReject(name, call) {
  try {
    const value = call();
    failures.push({ name, expected: "reject invalid argument", observed: value });
  } catch (error) {
    observations.push({ name, observed: "rejected", error: error.message });
  }
}
for (const mode of ["seedshift-typo", "direct", undefined, null]) {
  mustReject(`date recovery mode ${String(mode)}`, () => {
    const actual = [...dateRecoveryCandidates(encoded.shiftedIndexes, [], patterns, mode)];
    const fallback = [...dateRecoveryCandidates(encoded.shiftedIndexes, [], patterns, "seedshift")];
    return {
      combinations: actual.length,
      checksumValidCandidates: actual.flat().length,
      silentlyEqualsSeedshift: JSON.stringify(actual) === JSON.stringify(fallback),
    };
  });
}

const location = { network: "mainnet", account: 0, branch: 0, index: 0 };
// A compressed SEC point's x coordinate must be smaller than p. All-ff is larger than p.
const invalidPublic = `02${"ff".repeat(32)}`;
const prime = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
observations.push({
  name: "invalid public-key oracle",
  xAtOrAbovePrime: BigInt(`0x${invalidPublic.slice(2)}`) >= prime,
});
mustReject("non-curve compressed public key", () =>
  matchBitcoinEvidence(mnemonic, {
    kind: "compressed-public-key",
    value: invalidPublic,
    profiles: ["native-segwit"],
    location,
  }),
);

// Independent Base58Check packing: these WIFs have a valid checksum, but invalid scalars.
const sha = (bytes) => createHash("sha256").update(bytes).digest();
function wifOf(key) {
  const payload = Buffer.concat([Buffer.from([128]), key, Buffer.from([1])]);
  const bytes = Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return encoded;
}
for (const [name, key] of [
  ["zero", Buffer.alloc(32)],
  [
    "at-order",
    Buffer.from("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", "hex"),
  ],
]) {
  mustReject(`invalid WIF scalar ${name}`, () =>
    matchBitcoinEvidence(mnemonic, {
      kind: "wif",
      value: wifOf(key),
      profiles: ["native-segwit"],
      location,
    }),
  );
}

// The type WordPlace is readonly number[] and permits an empty array. Test in a child so that
// malformed inputs cannot leave the audit process looping. The CLI's parsers do not create it.
const candidatesUrl = new URL("../../../dist/core/candidates.js", import.meta.url).href;
const worker = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import { searchCandidates, searchCombinations } from ${JSON.stringify(candidatesUrl)};
  import { writeSync } from "node:fs";
  const places = Array.from({ length: 12 }, () => [0]);
  places[11] = [];
  const search = { kind: "unknown-words", places };
  writeSync(1, JSON.stringify({ entered: true, combinations: searchCombinations(search) }) + String.fromCharCode(10));
  try { console.log(JSON.stringify({ returned: searchCandidates(search).next() })); }
  catch (error) { console.log(JSON.stringify({ rejected: error.message })); }
`,
  ],
  { timeout: 1000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 4096 },
);
const boundedSearch = {
  name: "empty WordPlace direct host input",
  expected: "reject malformed search before enumeration",
  observed: {
    status: worker.status,
    signal: worker.signal,
    error: worker.error?.code,
    stdout: worker.stdout.trim(),
    stderr: worker.stderr.trim(),
  },
  scope: "direct host-facing module only; parseUnknownWords does not produce empty places",
};
if (worker.error?.code === "ETIMEDOUT" && worker.stdout.includes('"entered":true'))
  failures.push(boundedSearch);
else observations.push(boundedSearch);
console.log(
  JSON.stringify(
    { status: failures.length === 0 ? "passed" : "failed", failures, observations },
    null,
    2,
  ),
);
process.exitCode = failures.length === 0 ? 0 : 1;
