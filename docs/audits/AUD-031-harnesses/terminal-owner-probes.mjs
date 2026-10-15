// Only the terminal writer is substituted; the real answer and hint modules run unchanged.
import assert from "node:assert/strict";
import { TypedAnswer } from "../../../dist/cli/typed-answer.js";
import { WordList } from "../../../dist/core/word-hints.js";

const descriptor = Object.getOwnPropertyDescriptor(process.stderr, "columns");
const write = process.stderr.write;
let failures = 0;
try {
  Object.defineProperty(process.stderr, "columns", { configurable: true, value: 80 });
  for (const refuses of [false, true]) {
    const answer = new TypedAnswer(64, true, 0, WordList.BIP39);
    const fault = Object.assign(new Error("Synthetic terminal output failure."), { code: "EIO" });
    let writes = 0;
    let fail = false;
    process.stderr.write = () => {
      writes += 1;
      if (fail) throw fault;
      return true;
    };
    try {
      answer.insert(0x61);
      await answer.hintWhen(async () => true);
      const before = writes;
      fail = refuses;
      if (refuses) assert.throws(() => answer.wipe(), (error) => error === fault);
      else answer.wipe();
      assert.ok(writes > before, "cleanup must reach the terminal writer");
      assert.ok(!answer.text().includes("a"), "the original answer byte remains after cleanup");
      console.log("PASS " + (refuses ? "throwing writer" : "healthy writer") + ": answer erased");
    } catch (error) {
      failures += 1;
      console.log("FAIL " + (refuses ? "throwing writer" : "healthy writer") + ": " + error.message);
    } finally {
      fail = false;
      answer.wipe();
      process.stderr.write = write;
    }
  }
} finally {
  process.stderr.write = write;
  if (descriptor === undefined) delete process.stderr.columns;
  else Object.defineProperty(process.stderr, "columns", descriptor);
}
console.log(JSON.stringify({ cases: 2, failures }));
if (failures > 0) process.exitCode = 1;
