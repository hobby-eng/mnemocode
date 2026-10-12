// Bounded public-fixture probes of leaf APIs; no candidate search or vector replay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planJointRepair, JointRepair } from "../../../src/sskr/joint-repair.js";
import { everyPick } from "../../../src/sskr/repair.js";
import {
  bytewordsToUr,
  readShare,
  urToBytewords,
  urToTransport,
  assertShareCount,
} from "../../../src/sskr/transport.js";
import { MINIMAL_BYTEWORDS } from "../../../src/sskr/bytewords-list.js";
import { crc32 } from "../../../src/sskr/checksum.js";

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
async function refused(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return message(error);
  }
  throw new Error("Expected the baseline to refuse this input.");
}
const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
const canonical = vector.shares[0];
assert.equal(bytewordsToUr(urToBytewords(canonical)), canonical);
const taggedResults = [];
for (const tag of [
  [0xd9, 0x9d, 0x75],
  [0xd9, 0x01, 0x35],
]) {
  const cbor = urToTransport(canonical).subarray(0, -4);
  const tagged = new Uint8Array(tag.length + cbor.length + 4);
  tagged.set(tag);
  tagged.set(cbor, tag.length);
  new DataView(tagged.buffer).setUint32(tagged.length - 4, crc32(tagged.subarray(0, -4)));
  const ur = "ur:sskr/" + Array.from(tagged, (byte) => MINIMAL_BYTEWORDS[byte]).join("");
  assert.equal(readShare(ur).ur, canonical);
  const failure = await refused(() => bytewordsToUr(urToBytewords(ur)));
  assert.match(failure, /Invalid SSKR share byte string/u);
  taggedResults.push({ tag, acceptedAndNormalized: true, roundTripFailure: failure });
}

const emptyFunction = await refused(() => planJointRepair([]));
assert.match(emptyFunction, /^TypeError:.*map/u);
const platform = {
  hmacSha256: () => new Uint8Array(32),
  combineShares: async () => {
    throw new Error("Engine must not run in a count probe.");
  },
  createShares: async () => {
    throw new Error("Engine must not run in a count probe.");
  },
};
const emptyClass = await refused(() => new JointRepair(platform).plan([]));
assert.match(emptyClass, /^TypeError:.*map/u);
const expectedCountRefusal = await refused(() => assertShareCount(257));
let accessedBeforeCountRefusal = false;
const excessive = new Proxy(
  Array.from({ length: 257 }, () => canonical),
  {
    get(target, property, receiver) {
      if (property === "0") {
        accessedBeforeCountRefusal = true;
        throw new Error("Record accessed before count refusal.");
      }
      return Reflect.get(target, property, receiver);
    },
  },
);
const excessFailure = await refused(() => planJointRepair(excessive));
assert.equal(accessedBeforeCountRefusal, true);
assert.match(excessFailure, /Record accessed before count refusal/u);

let secondListReads = 0;
const choices = Array.from({ length: 3 }, (_, index) => index);
const second = new Proxy(choices, {
  get(target, property, receiver) {
    if (/^\d+$/u.test(String(property))) secondListReads += 1;
    return Reflect.get(target, property, receiver);
  },
});
assert.equal(everyPick([choices, second], 4), undefined);
assert.equal(secondListReads, 9);
console.log(
  JSON.stringify(
    {
      taggedResults,
      emptyFunction,
      emptyClass,
      expectedCountRefusal,
      accessedBeforeCountRefusal,
      excessFailure,
      cappedProduct: { limit: 4, secondListReads, returned: "undefined" },
    },
    null,
    2,
  ),
);
