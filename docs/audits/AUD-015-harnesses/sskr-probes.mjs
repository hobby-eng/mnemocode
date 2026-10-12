// AUD-015: public deterministic SSKR fixture, one gated split, malformed format arguments and
// owned transport allocation references. No vector replay, memory dump, PDF or native rebuild.
import { readFileSync } from "node:fs";
import { ShareSplit } from "../../../dist/sskr/split.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { crc32 } from "../../../dist/sskr/checksum.js";
import { SHARE_UNITS } from "../../../dist/sskr/share-units.js";
import { MEMBER_BYTE, NIBBLE_BITS } from "../../../dist/sskr/share-layout.js";
import {
  Share,
  readShare,
  shareFormatMirroring,
  urToTransport,
  urToBytewords,
  bytewordsToUr,
} from "../../../dist/sskr/transport.js";

const checks = [];
const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
const phraseA = `${"abandon ".repeat(11)}about`;
const phraseB = `${"zoo ".repeat(11)}wrong`;
let openGate;
let entered;
const gate = new Promise((resolve) => {
  openGate = resolve;
});
const started = new Promise((resolve) => {
  entered = resolve;
});
const platform = {
  ...nodeSharePlatform,
  createShares: async (...args) => {
    entered();
    await gate;
    return nodeSharePlatform.createShares(...args);
  },
};
const split = new ShareSplit(platform, (bytes) => bytes.fill(0));
const request = { mnemonic: phraseA, mode: "direct", dates: [], threshold: 2, count: 3 };
const pending = split.splitBackup(request);
await started;
request.mnemonic = phraseB;
openGate();
const result = await pending;
checks.push({
  name: "split backup binds original to the captured request",
  originalIsA: result.original === phraseA,
  heldIsA: result.held === phraseA,
  originalEqualsHeld: result.original === result.held,
  passed: result.original === phraseA && result.held === phraseA,
});

for (const form of ["typo", null, 5]) {
  let refused = false;
  let returned;
  try {
    returned = shareFormatMirroring(form);
  } catch {
    refused = true;
  }
  checks.push({
    name: "mirror format refuses invalid input",
    form,
    returnedType: typeof returned,
    passed: refused,
  });
}
for (const form of ["english", "indexes", "unicode", "colors", "colors-unicode"])
  checks.push({
    name: "mirror format positive control",
    form,
    passed: shareFormatMirroring(form) === (form === "english" ? "words" : form),
  });

// Capture only arrays made by Uint8Array.from during synchronous transport reads. Caller-owned
// output from urToTransport is deliberately preserved and wiped by this harness afterwards.
function ownedArrays(name, body, returnsBuffer = false) {
  const original = Uint8Array.from;
  const arrays = [];
  let value;
  let refusal;
  Uint8Array.from = function (...args) {
    const bytes = Reflect.apply(original, this, args);
    arrays.push(bytes);
    return bytes;
  };
  try {
    value = body();
  } catch (error) {
    refusal = error.message;
  } finally {
    Uint8Array.from = original;
  }
  const callerOwned = returnsBuffer && value instanceof Uint8Array ? value : undefined;
  const internal = arrays.filter((bytes) => bytes !== callerOwned);
  checks.push({
    name,
    allocations: arrays.length,
    internalNonzero: internal.filter((bytes) => bytes.some((byte) => byte !== 0)).length,
    callerOutputPreserved: callerOwned?.some((byte) => byte !== 0),
    refusal,
    passed:
      arrays.length > 0 &&
      internal.every((bytes) => bytes.every((byte) => byte === 0)) &&
      (!returnsBuffer || callerOwned?.some((byte) => byte !== 0) === true),
  });
  for (const bytes of arrays) bytes.fill(0);
}
const ur = vector.shares[0];
ownedArrays("UR reader releases decoded transport", () => readShare(ur));
ownedArrays("Share releases decoded transport after metadata", () => Share.read(ur));
const bytewords = urToBytewords(ur);
ownedArrays("Bytewords reader releases decoded transport", () => bytewordsToUr(bytewords));
ownedArrays("urToTransport preserves its caller-owned result", () => urToTransport(ur), true);

const invalid = urToTransport(ur);
// This fixture has one short CBOR head, then the payload; set a reserved metadata bit and repair
// CRC32 so rejection reaches the intended metadata guard instead of an unrelated checksum guard.
invalid[1 + MEMBER_BYTE] |= 1 << NIBBLE_BITS;
new DataView(invalid.buffer, invalid.byteOffset, invalid.byteLength).setUint32(
  invalid.length - 4,
  crc32(invalid.subarray(0, -4)),
);
const invalidUr = SHARE_UNITS.ur.text(Array.from(invalid));
invalid.fill(0);
ownedArrays("urToTransport releases a refused transport", () => urToTransport(invalidUr));

console.log(JSON.stringify({ checks }, null, 2));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
