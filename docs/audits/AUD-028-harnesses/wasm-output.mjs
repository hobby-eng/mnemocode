// AUD-028: inspect the pinned, unmodified WASM after recovering one public fixture.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initSync, recover_sskr_shares } from "../../../sskr-wasm/generated/recovery_sskr_wasm.js";
import { sskrLongVector } from "../../../dist/sskr/known-answers.js";

const module = await readFile(new URL("../../../sskr-wasm/generated/recovery_sskr_wasm_bg.wasm", import.meta.url));
const wasm = initSync({ module });
const expected = Uint8Array.from(sskrLongVector.entropy.match(/../gu), (part) => Number.parseInt(part, 16));
const returned = recover_sskr_shares(sskrLongVector.shares.join("\n"));
assert.deepEqual(returned, expected);
returned.fill(0);

// The generated wrapper has restored its stack pointer without erasing its return frame.
// Re-enter that same 16-byte frame only to read the last result pointer and length. Do not
// allocate/free another WASM value or overwrite the allocation being inspected.
const frame = wasm.__wbindgen_add_to_stack_pointer(-16);
let observation;
try {
  const view = new DataView(wasm.memory.buffer);
  const pointer = view.getUint32(frame, true);
  const length = view.getUint32(frame + 4, true);
  assert.equal(length, expected.length, "The retained return frame must identify this output.");
  assert.ok(pointer + length <= wasm.memory.buffer.byteLength);
  const remaining = new Uint8Array(wasm.memory.buffer, pointer, length);
  const matching = Array.from(expected, (byte, index) => remaining[index] === byte ? index : -1)
    .filter((index) => index >= 0);
  observation = {
    pinnedUnmodifiedWasm: true,
    publicFixtureBytes: expected.length,
    returnedJavaScriptWiped: returned.every((byte) => byte === 0),
    outputPointer: pointer,
    outputLength: length,
    remainingMatchesAt: matching,
    finalHalfStillMatches: remaining.subarray(length / 2).every(
      (byte, index) => byte === expected[length / 2 + index],
    ),
  };
} finally {
  wasm.__wbindgen_add_to_stack_pointer(16);
}
console.log(JSON.stringify(observation, null, 2));
process.exitCode = observation.finalHalfStillMatches ? 1 : 0;
