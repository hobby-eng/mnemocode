// AUD-028: bounded public SSKR fixtures through the supported host-neutral entry points.
import assert from "node:assert/strict";
import { ShareSet } from "../../../dist/sskr/share-set.js";
import { ShareUnmasking } from "../../../dist/sskr/share-unmasking.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";
import { DatesAnswer } from "../../../dist/core/date-search.js";
import { parseDate } from "../../../dist/core/dates.js";

const restored = await ShareSet.restore(sskrSetVector.shares.slice(0, 2), nodeSharePlatform);
assert.equal(restored.mnemonic, sskrSetVector.phrase);
const original = restored.toRepairedSet();
const source = original.mnemonic;
const replacement = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const mutable = { ...original };
let release;
let entered;
const gate = new Promise((resolve) => { release = resolve; });
const ready = new Promise((resolve) => { entered = resolve; });
let checked;
const pending = new ShareUnmasking({
  mode: "direct",
  walletCheck: async (mnemonic) => {
    checked = mnemonic;
    entered();
    await gate;
    return { matched: mnemonic === source };
  },
}).unmask([mutable]);
await ready;
mutable.mnemonic = replacement;
release();
const changed = await pending;
const normal = await new ShareUnmasking({
  mode: "direct", walletCheck: (mnemonic) => ({ matched: mnemonic === source }),
}).unmask([original]);
const mismatch = await new ShareUnmasking({
  mode: "direct", walletCheck: () => ({ matched: false }),
}).unmask([original]);
assert.equal(normal.kind, "phrases");
assert.equal(normal.phrases[0].mnemonic, source);
assert.equal(mismatch.kind, "phrases");
assert.equal(mismatch.phrases.length, 0);
let datesRefused = false;
try {
  await new ShareUnmasking({
    mode: "direct", dates: DatesAnswer.of([parseDate("23-09-2026")]),
  }).unmask([original]);
} catch (error) {
  datesRefused = typeof error?.code === "string";
}

const result = {
  genuinePublicShareMetadata: true,
  immutableControlMatched: normal.phrases[0].mnemonic === source,
  mismatchControlEmpty: mismatch.phrases.length === 0,
  checkedOriginal: checked === source,
  publishedOriginal: changed.kind === "phrases" && changed.phrases[0]?.mnemonic === source,
  publishedUncheckedReplacement:
    changed.kind === "phrases" && changed.phrases[0]?.mnemonic === replacement,
  listedUncheckedReplacement: changed.kind === "phrases" && changed.listed.includes(replacement),
  directDatesRefused: datesRefused,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.publishedOriginal && result.directDatesRefused ? 0 : 1;
