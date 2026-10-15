// Observe the real public read result without replacing any implementation result or plan.
import assert from "node:assert/strict";
import { ShareRestore } from "../../../dist/sskr/share-restore.js";
import { ShareInput } from "../../../dist/sskr/share-input.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";

const original = Object.getOwnPropertyDescriptor(ShareRestore.prototype, "read");
const read = original.value;
const captured = [];
Object.defineProperty(ShareRestore.prototype, "read", {
  ...original,
  value: async function (...args) {
    const result = await Reflect.apply(read, this, args);
    if (result.kind === "marked") captured.push(result.plan);
    return result;
  },
});
let failures = 0;
try {
  for (const refuses of [true, false]) {
    const input = new ShareInput({ decodeEntry: "The public fixture decoder" });
    const first = captured.length;
    const fault = new Error("Synthetic host limit is unavailable.");
    let reads = 0;
    input.add([
      sskrSetVector.colors[0].replace("#37B8CA", "?"),
      sskrSetVector.colors[1],
    ]);
    try {
      const restore = new ShareRestore(nodeSharePlatform);
      const pending = restore.restore({
        input,
        mode: "direct",
        confirmed: true,
        limits: {
          get shares() {
            reads += 1;
            if (refuses) throw fault;
            return Number.MAX_SAFE_INTEGER;
          },
        },
      });
      if (refuses) await assert.rejects(pending, (error) => error === fault);
      else assert.equal((await pending).kind, "phrases");
      assert.ok(reads > 0, "the real request limit accessor must be reached");
      assert.equal(captured.length - first, 1, "one actual marked plan must be observed");
      await assert.rejects(captured[first].search(), { code: "sskr.joint-repair.plan-wiped" });
      console.log("PASS " + (refuses ? "host limit refusal" : "healthy restore") + ": plan disposed");
    } catch (error) {
      failures += 1;
      console.log("FAIL " + (refuses ? "host limit refusal" : "healthy restore") + ": " + error.message);
    } finally {
      for (const plan of captured.slice(first)) plan.wipe();
      input.wipe();
    }
  }
} finally {
  Object.defineProperty(ShareRestore.prototype, "read", original);
}
console.log(JSON.stringify({ cases: 2, failures }));
if (failures > 0) process.exitCode = 1;
