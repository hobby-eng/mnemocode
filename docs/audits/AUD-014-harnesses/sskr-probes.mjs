// AUD-014: a single public counting-entropy SSKR vector, small negative/race/cleanup probes.
// No full vector replay, generated artifact modification, PDF, or unbounded search.
import { readFile } from "node:fs/promises";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { ShareSet } from "../../../dist/sskr/share-set.js";
import { ShareInput } from "../../../dist/sskr/share-input.js";
import { ShareRestore } from "../../../dist/sskr/share-restore.js";
import { JointRepair } from "../../../dist/sskr/joint-repair.js";
import { ReadingSpace } from "../../../dist/sskr/repair.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { sskrEngine } from "../../../dist/sskr/runtime.js";
import { Share, readShare, writeShare, urToTransport } from "../../../dist/sskr/transport.js";
import { crc32 } from "../../../dist/sskr/checksum.js";
import { MINIMAL_BYTEWORDS } from "../../../dist/sskr/bytewords-list.js";

const vector = JSON.parse(await readFile("vectors/sskr-v1.json", "utf8")).deterministic[0];
const entropy = Uint8Array.from(Buffer.from(vector.entropy, "hex"));
const expected = entropyToMnemonic(entropy, wordlist);
entropy.fill(0);
const [first, second, third] = vector.shares;
const checks = [];
async function check(name, body) {
  try {
    const result = await body();
    checks.push({ name, ...result });
  } catch (error) {
    checks.push({ name, passed: false, refusal: error.message });
  }
}

await check("canonical public quorum control", async () => ({
  passed: (await ShareSet.restore([first, second], nodeSharePlatform)).mnemonic === expected,
}));

const cbor = urToTransport(first).subarray(0, -4);
const extended = Uint8Array.of(0x58, cbor[0] - 0x40, ...cbor.subarray(1));
const bytes = new Uint8Array(extended.length + 4);
bytes.set(extended);
new DataView(bytes.buffer).setUint32(extended.length, crc32(extended));
const nonminimal = "ur:sskr/" + Array.from(bytes, (byte) => MINIMAL_BYTEWORDS[byte]).join("");
await check("accepted nonminimal CBOR still restores the public quorum", async () => {
  const accepted = readShare(nonminimal).ur;
  try {
    return {
      passed: (await ShareSet.restore([accepted, second], nodeSharePlatform)).mnemonic === expected,
    };
  } catch (error) {
    return { passed: false, transportAccepted: true, refusal: error.message };
  }
});

const units = writeShare(third, "colors-unicode").match(/.{4}/gu);
units[4] = "?";
units.splice(12, 2, "?");
await check("mixed single-code and whole-color marks have a repair reading", async () => {
  const plan = await new JointRepair(nodeSharePlatform).plan([first, second, units.join("")]);
  try {
    return {
      passed: plan.assessment.verdict !== "no-fit",
      verdict: plan.assessment.verdict,
      notes: plan.assessment.notes,
    };
  } finally {
    plan.wipe();
  }
});

const engine = await sskrEngine();
for (const encoding of [2, 256, 257, Number.NaN]) {
  await check(`bridge rejects unsupported encoding ${String(encoding)}`, async () => {
    try {
      const made = engine.create_sskr_shares_formatted(
        new Uint8Array(16),
        1,
        Uint8Array.of(2, 3),
        new Uint8Array(32),
        encoding,
      );
      return { passed: false, accepted: true, looksLikeUr: made.startsWith("ur:sskr/") };
    } catch (error) {
      return { passed: true, refusal: error.message };
    }
  });
}

await check("empty ShareInput returns structured trouble", async () => {
  const outcome = await new ShareRestore(nodeSharePlatform).read(
    new ShareInput({ decodeEntry: "The Decode tab" }),
  );
  return { passed: outcome.kind === "trouble", kind: outcome.kind };
});

let release;
let started;
const pending = new Promise((resolve) => {
  release = resolve;
});
const begun = new Promise((resolve) => {
  started = resolve;
});
let blocked = false;
const platform = {
  ...nodeSharePlatform,
  combineShares: async (records) => {
    if (!blocked) {
      blocked = true;
      started();
      await pending;
    }
    return nodeSharePlatform.combineShares(records);
  },
};
const input = new ShareInput({ decodeEntry: "The Decode tab" });
input.add([first, second, third]);
const restoring = new ShareRestore(platform).read(input);
await begun;
input.leaveOut(1);
input.add([first]);
release();
await check("complete result binds share places to its captured input", async () => {
  const outcome = await restoring;
  return {
    passed: outcome.kind === "trouble" || JSON.stringify(outcome.places) === "[1,2,3]",
    kind: outcome.kind,
    places: outcome.places,
    expectedPlaces: [1, 2, 3],
  };
});

await check("share writer rejects unknown format", async () => {
  try {
    const written = Share.read(first).write("typo");
    return { passed: false, resultType: typeof written };
  } catch (error) {
    return { passed: true, refusal: error.message };
  }
});

const references = [];
const solve = ReadingSpace.solve;
ReadingSpace.solve = function (...args) {
  const space = solve.apply(this, args);
  if (space) references.push(...space.secretArrays());
  return space;
};
await check("unpublished marked plan is wiped after report HMAC failure", async () => {
  const marked = writeShare(second, "indexes").split(" ");
  marked[5] = "?";
  const shares = new ShareInput({ decodeEntry: "The Decode tab" });
  shares.add([first, marked.join(" ")]);
  try {
    await new ShareRestore({
      ...nodeSharePlatform,
      hmacSha256: () => {
        throw new Error("Synthetic HMAC unavailable");
      },
    }).read(shares);
    return { passed: false, unexpectedSuccess: true };
  } catch (error) {
    const nonzero = references.filter((array) => array.some((byte) => byte !== 0)).length;
    return {
      passed: references.length > 0 && nonzero === 0,
      observedArrays: references.length,
      nonzeroArrays: nonzero,
      refusal: error.message,
    };
  } finally {
    for (const array of references) array.fill(0);
    ReadingSpace.solve = solve;
  }
});

console.log(JSON.stringify({ checks }, null, 2));
if (checks.some((one) => !one.passed)) process.exitCode = 1;
