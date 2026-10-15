// AUD-028: valid public sets with equal identifiers challenge a test's random precondition.
import assert from "node:assert/strict";
import { ShareSplit } from "../../../dist/sskr/split.js";
import { ShareSet } from "../../../dist/sskr/share-set.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { urToTransport, transportToUr, shareInfo } from "../../../dist/sskr/transport.js";
import { crc32 } from "../../../dist/sskr/checksum.js";
import { KeptShares } from "../../../dist/core/backup-check.js";
import { ShareInput } from "../../../dist/sskr/share-input.js";

const phrase = "abandon ".repeat(11) + "about";
const first = await new ShareSplit(nodeSharePlatform, (seed) => seed.fill(7)).split(phrase, 2, 3);
const second = await new ShareSplit(nodeSharePlatform, (seed) => seed.fill(8)).split(phrase, 2, 3);

function byteStringStart(bytes) {
  let at = 0;
  const read = () => {
    const head = bytes[at++];
    const additional = head & 31;
    const width = additional < 24 ? 0 : 2 ** (additional - 24);
    assert.ok(width <= 4);
    let value = additional;
    if (width) {
      value = 0;
      for (let index = 0; index < width; index++) value = value * 256 + bytes[at++];
    }
    return { major: head >>> 5, value };
  };
  let head = read();
  while (head.major === 6) head = read();
  assert.equal(head.major, 2);
  assert.equal(at + head.value + 4, bytes.length);
  return at;
}
const reference = urToTransport(first[0]);
const offset = byteStringStart(reference);
const identifier = reference.slice(offset, offset + 2);
const other = urToTransport(second[0]);
const otherOffset = byteStringStart(other);
assert.notDeepEqual(other.slice(otherOffset, otherOffset + 2), identifier);
assert.notDeepEqual(reference.slice(offset + 5, -4), other.slice(otherOffset + 5, -4));
const rewritten = second.map((share) => {
  const bytes = urToTransport(share);
  bytes.set(identifier, byteStringStart(bytes));
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(bytes.length - 4, crc32(bytes.subarray(0, -4)));
  const result = transportToUr(bytes);
  shareInfo(bytes);
  bytes.fill(0);
  return result;
});
for (const set of [first, second, rewritten])
  assert.equal((await ShareSet.restore(set.slice(0, 2), nodeSharePlatform)).mnemonic, phrase);
const distinct = KeptShares.of([first[0], second[1]]).setProblem;
assert.match(distinct, /different sets/u);
const mixed = [first[0], rewritten[1]];
const kept = KeptShares.of(mixed).setProblem;
const input = ShareInput.completeSetProblem(mixed.map((ur, index) => ({ place: index + 1, ur })));
console.log(JSON.stringify({
  differentPublicSeeds: true, differentSetPayloads: true,
  allThreeOwnQuorumControlsRestore: true, distinctIdentifierControlRefused: true,
  collidingIdentifierKeptProblem: kept ?? null,
  collidingIdentifierInputProblem: input ?? null,
  randomCollisionLoop: false,
}, null, 2));
reference.fill(0); other.fill(0); identifier.fill(0);
process.exitCode = kept === undefined && input === undefined ? 1 : 0;
