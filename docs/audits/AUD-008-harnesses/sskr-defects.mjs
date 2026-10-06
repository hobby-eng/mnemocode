/** AUD-008, HEAD 767ee995a91e98c1f9bde6b7930147e352fc5cff: public SSKR negative probes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineSskrShares, planShareRepair } from "../../../dist/sskr/shares.js";
import { checkShareBackup } from "../../../dist/cli/backup-check.js";
import { urToTransport, transportToUr, normalizeShare } from "../../../dist/sskr/transport.js";
import { readRepairableShare } from "../../../dist/sskr/repair.js";
import { bytewords } from "../../../dist/sskr/bytewords-list.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8"));
const vector = vectors.deterministic[0];
const mnemonic = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
// Independent CRC routine: checks corruption beyond the unkeyed transport checksum.
function checksum(body) {
  let value = 0xffffffff;
  for (const byte of body) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  new DataView(out.buffer).setUint32(body.length, (value ^ 0xffffffff) >>> 0);
  return out;
}
const minimal = (bytes) =>
  "ur:sskr/" + Array.from(bytes, (byte) => bytewords[byte][0] + bytewords[byte][3]).join("");
const full = (bytes) => Array.from(bytes, (byte) => bytewords[byte]).join(" ");
const mark = (text, format, at) => {
  const units = format === "ur" ? text.slice(8).match(/../gu) : text.split(" ");
  units[at] = "?";
  return format === "ur" ? "ur:sskr/" + units.join("") : units.join(" ");
};
let failed = 0;
async function check(name, work) {
  try {
    await work();
    console.log(JSON.stringify({ name, outcome: "passed" }));
  } catch (error) {
    failed += 1;
    console.log(JSON.stringify({ name, outcome: "failed", error: String(error) }));
  }
}

await check("inconsistent-surplus-share-must-be-rejected", async () => {
  const body = urToTransport(vector.shares[2]).slice(0, -4);
  body[8] ^= 1;
  const changed = transportToUr(checksum(body));
  const supplied = [vector.shares[0], vector.shares[1], changed];
  const actual = await combineSskrShares(supplied);
  const backup = await checkShareBackup(mnemonic, supplied.join(";"), "direct", "");
  let badPairRejected = false;
  try {
    await combineSskrShares([vector.shares[0], changed]);
  } catch {
    badPairRejected = true;
  }
  console.log(
    JSON.stringify({
      test: "surplus",
      original: vector.shares[2],
      changed,
      actualMatchesOriginal: actual === mnemonic,
      backup,
      badPairRejected,
    }),
  );
  await assert.rejects(
    () => combineSskrShares(supplied),
    "Every supplied member must fit the threshold polynomial.",
  );
});

const cbor = urToTransport(vector.shares[0]).slice(0, -4);
const transports = [
  { name: "legacy-untagged-bytewords", format: "words", text: full(checksum(cbor)) },
  {
    name: "current-tagged-ur",
    format: "ur",
    text: minimal(checksum(Uint8Array.of(0xd9, 0x9d, 0x75, ...cbor))),
  },
  {
    name: "legacy-tagged-ur",
    format: "ur",
    text: minimal(checksum(Uint8Array.of(0xd9, 0x01, 0x35, ...cbor))),
  },
];
for (const fixture of transports) {
  await check(fixture.name + "-one-mark", async () => {
    assert.equal(normalizeShare(fixture.text), vector.shares[0]);
    assert.equal(await combineSskrShares([fixture.text, vector.shares[1]]), mnemonic);
    const damaged = mark(fixture.text, fixture.format, 12);
    let single;
    try {
      single = readRepairableShare(damaged).ur;
    } catch (error) {
      single = String(error);
    }
    const plan = await planShareRepair([damaged, vector.shares[1]]);
    console.log(
      JSON.stringify({
        fixture: fixture.name,
        intactAccepted: true,
        damaged,
        single,
        assessment: plan.assessment,
      }),
    );
    assert.equal(readRepairableShare(damaged).ur, vector.shares[0]);
  });
}
await check("intact-legacy-share-alongside-marked-canonical-share", async () => {
  const supplied = [transports[0].text, mark(vector.shares[1], "ur", 12)];
  const plan = await planShareRepair(supplied);
  console.log(JSON.stringify({ test: "intact-legacy-among-repair", assessment: plan.assessment }));
  assert.equal(await combineSskrShares(supplied), mnemonic);
});
console.log(
  JSON.stringify({
    failed,
    note: "Failures are retained production contract failures, not harness crashes.",
  }),
);
process.exitCode = failed ? 1 : 0;
