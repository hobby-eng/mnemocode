// Observe owned temporary buffers using public counting entropy and synthetic text only.
import assert from "node:assert/strict";
import { encodeCandidateList, decodeCandidateList } from "../../../src/core/candidate-list.js";

const entropy = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const originalEntropy = [...entropy];
const originalEncode = TextEncoder.prototype.encode;
const captured = [];
let serialized;
try {
  TextEncoder.prototype.encode = function (text) {
    const bytes = originalEncode.call(this, text);
    captured.push(bytes);
    return bytes;
  };
  serialized = encodeCandidateList({ passphrase: "GLOBAL", records: [{ entropy, passphrase: "PUBLIC" }] });
} finally {
  TextEncoder.prototype.encode = originalEncode;
}
assert.deepEqual([...entropy], originalEntropy);
assert.deepEqual([...decodeCandidateList(serialized).records[0].entropy], originalEntropy);
const encoder = {
  captured: captured.length,
  wiped: captured.filter((bytes) => bytes.every((byte) => byte === 0)).length,
  unwiped: captured.filter((bytes) => bytes.some((byte) => byte !== 0)).length,
  borrowedEntropyPreserved: true,
  serializedRoundTripPreserved: true,
};

const plain = encodeCandidateList({ records: [{ entropy }] });
const offset = Buffer.from(plain).indexOf(Buffer.from(entropy));
assert.ok(offset >= 0);
plain[offset] ^= 1; // Damage the known payload, preserving parsing until the CRC refusal.
const originalFrom = Uint8Array.from;
const decoderCopies = [];
try {
  Uint8Array.from = function (...args) {
    const bytes = Reflect.apply(originalFrom, this, args);
    decoderCopies.push(bytes);
    return bytes;
  };
  assert.throws(() => decodeCandidateList(plain), /CRC-32 does not match/u);
} finally {
  Uint8Array.from = originalFrom;
}
assert.equal(decoderCopies.length, 1);
assert.ok(decoderCopies[0].every((byte) => byte === 0));
console.log(JSON.stringify({ encoder, decoderRefusal: { copies: 1, wiped: true },
  limits: "No heap attack or total erasure claim. Instrumentation retains only synthetic buffer references in this disposable process." }, null, 2));
