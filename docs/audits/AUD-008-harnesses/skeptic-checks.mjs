/** AUD-008: independent coordinator challenges using public zero-entropy fixtures. */
import assert from "node:assert/strict";
import { ECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as publicApi from "../../../dist/index.js";
import { normalizeShare, urToTransport, transportToUr } from "../../../dist/sskr/transport.js";
import { bytewords } from "../../../dist/sskr/bytewords-list.js";
import { combineSskrShares, planShareRepair } from "../../../dist/sskr/shares.js";
import { checkShareBackup } from "../../../dist/cli/backup-check.js";

const mnemonic = entropyToMnemonic(new Uint8Array(16), wordlist);
assert.equal(typeof publicApi.dateRecoveryCandidates, "function");
assert.equal(typeof publicApi.masterFingerprint, "function");
assert.equal(publicApi.searchCandidates, undefined);
console.log(
  "Boundary scope: date recovery/fingerprint are public; word search is a reusable direct module.",
);

assert.equal(
  publicApi.masterFingerprint(mnemonic, null),
  publicApi.masterFingerprint(mnemonic, "null"),
);
assert.notEqual(
  publicApi.masterFingerprint(mnemonic, null),
  publicApi.masterFingerprint(mnemonic, ""),
);
console.log(
  "Confirmed explicit null is coerced into a distinct BIP39 wallet, not the omitted default.",
);

const invalidPoint = "02" + "ff".repeat(32);
assert.throws(() => ECDH.convertKey(Buffer.from(invalidPoint, "hex"), "secp256k1"));
const match = publicApi.matchBitcoinEvidence(mnemonic, {
  kind: "compressed-public-key",
  value: invalidPoint,
  profiles: ["native-segwit"],
  location: { network: "mainnet", account: 0, branch: 0, index: 0 },
});
assert.equal(match.matched, false);
console.log(
  "OpenSSL rejects the point; the recovery comparator instead returns a normal non-match.",
);

const fixture = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
const expected = entropyToMnemonic(Buffer.from(fixture.entropy, "hex"), wordlist);
// Independent bitwise CRC calculation, rather than the production checksum helper.
function withChecksum(body) {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = new Uint8Array(body.length + 4);
  result.set(body);
  new DataView(result.buffer).setUint32(body.length, (crc ^ 0xffffffff) >>> 0);
  return result;
}
const body = urToTransport(fixture.shares[2]).slice(0, -4);
body[9] ^= 2;
const altered = transportToUr(withChecksum(body));
assert.equal(await combineSskrShares([fixture.shares[0], fixture.shares[1], altered]), expected);
assert.equal(
  await checkShareBackup(
    expected,
    [fixture.shares[0], fixture.shares[1], altered].join(";"),
    "direct",
    "",
  ),
  "restores",
);
await assert.rejects(() => combineSskrShares([fixture.shares[0], altered]));
console.log(
  "A different surplus-share mutation also passes backup checking although its pair fails.",
);

const firstBody = urToTransport(fixture.shares[0]).slice(0, -4);
const legacyWords = Array.from(withChecksum(firstBody), (byte) => bytewords[byte]).join(" ");
assert.equal(normalizeShare(legacyWords), fixture.shares[0]);
assert.equal(await combineSskrShares([legacyWords, fixture.shares[1]]), expected);
const tokens = fixture.shares[1].slice(8).match(/../gu);
tokens[12] = "?";
const marked = "ur:sskr/" + tokens.join("");
const plan = await planShareRepair([legacyWords, marked]);
assert.equal(plan.assessment.verdict, "no-fit");
console.log(
  "An intact accepted legacy share prevents joint recovery with a marked canonical share.",
);
console.log(
  "Challenge assertions confirm baseline observations; this is not a post-fix regression gate.",
);
