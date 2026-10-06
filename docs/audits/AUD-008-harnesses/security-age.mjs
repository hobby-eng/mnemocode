// AUD-008: bounded authentication and RNG-failure probes, without any scrypt work.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  ageStanzas,
} from "../../../dist/core/candidate-encryption.js";

const vectors = JSON.parse(readFileSync("vectors/candidates-v1.json", "utf8"));
const fromHex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
const file = fromHex(vectors.age.open.find((entry) => !entry.name.includes("passphrase")).file);
const plain = fromHex(vectors.age.plaintext);
assert.deepEqual(await decryptCandidates(file, { identity: vectors.age.identity }), plain);
const other = await createSessionIdentity();
await assert.rejects(decryptCandidates(file, { identity: other.identity }));
let refused = 1;
for (const offset of [file.length - 1, file.length - 17, Math.floor(file.length / 2)]) {
  const damaged = file.slice();
  damaged[offset] ^= 1;
  await assert.rejects(decryptCandidates(damaged, { identity: vectors.age.identity }));
  refused += 1;
}
for (const length of [0, 20, file.length - 1, file.length - 16]) {
  await assert.rejects(
    decryptCandidates(file.subarray(0, length), { identity: vectors.age.identity }),
  );
  refused += 1;
}
for (const vector of vectors.age.refuse) {
  const key = vector.name.includes("scrypt")
    ? { passphrase: vectors.age.passphrase }
    : { identity: vectors.age.identity };
  await assert.rejects(decryptCandidates(fromHex(vector.file), key), /exactly one|work factor/);
  refused += 1;
}
const first = await encryptCandidates(plain, other.recipient);
const second = await encryptCandidates(plain, other.recipient);
assert.notDeepEqual(first, second);
assert.equal(ageStanzas(first)[0][0], "X25519");
assert.deepEqual(await decryptCandidates(first, { identity: other.identity }), plain);
const originalRandom = crypto.getRandomValues;
crypto.getRandomValues = () => {
  throw new Error("synthetic unavailable RNG");
};
try {
  await assert.rejects(createSessionIdentity(), /synthetic unavailable RNG/);
  await assert.rejects(encryptCandidates(plain, other.recipient), /synthetic unavailable RNG/);
} finally {
  crypto.getRandomValues = originalRandom;
  plain.fill(0);
}
console.log(
  JSON.stringify({
    authenticatedRoundTrips: 2,
    distinctRandomEncryptions: 2,
    refused,
    rngFailuresClosed: 2,
    scryptComputations: 0,
    partialPlaintextReturned: false,
  }),
);
