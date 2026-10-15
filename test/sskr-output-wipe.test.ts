import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initSync,
  recover_sskr_shares,
  recover_sskr_shares_formatted,
  ShareEncoding,
} from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { sskrLongVector } from "../src/sskr/known-answers.js";
import { bytesOfHex } from "../src/core/bits.js";
import { writeShare } from "../src/sskr/transport.js";

const module = await readFile(
  new URL("../sskr-wasm/generated/recovery_sskr_wasm_bg.wasm", import.meta.url),
);
const wasm = initSync({ module });
const expected = bytesOfHex(sskrLongVector.entropy);
afterEach(() => vi.restoreAllMocks());

/** Read the retained return frame before another engine operation reuses it. */
function outputTail(): Uint8Array {
  const frame = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const view = new DataView(wasm.memory.buffer);
    const pointer = view.getUint32(frame, true);
    const length = view.getUint32(frame + 4, true);
    expect(length).toBe(expected.length);
    // Free-list metadata can occupy the beginning; the latter half is the entropy probe.
    return new Uint8Array(wasm.memory.buffer, pointer + length / 2, length / 2).slice();
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

describe("SSKR recovered output ownership", () => {
  const compact = sskrLongVector.shares.join("\n");
  const words = sskrLongVector.shares.map((share) => writeShare(share, "words")).join("\n");
  it.each([
    ["compact", () => recover_sskr_shares(compact)],
    ["formatted compact", () => recover_sskr_shares_formatted(compact, ShareEncoding.CompactUr)],
    ["formatted words", () => recover_sskr_shares_formatted(words, ShareEncoding.Bytewords)],
  ] as const)(
    "returns the exact public entropy and wipes the freed %s output",
    (_label, recover) => {
      const returned = recover();
      try {
        expect(returned).toEqual(expected);
        expect(outputTail()).toEqual(new Uint8Array(expected.length / 2));
      } finally {
        returned.fill(0);
      }
    },
  );

  it("also wipes and releases the intermediate when making the host copy fails", () => {
    const failure = new Error("Synthetic host copy failure.");
    // oxlint-disable-next-line typescript/unbound-method -- the observer invokes this intrinsic with its explicit receiver through call.
    const fill = Uint8Array.prototype.fill;
    let erasedBeforeFree = false;
    vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (
      this: Uint8Array,
      value,
      start,
      end,
    ) {
      const result = fill.call(this, value, start, end);
      if (this.buffer === wasm.memory.buffer && this.length === expected.length)
        erasedBeforeFree = this.every((byte) => byte === 0);
      return result;
    });
    vi.spyOn(Uint8Array.prototype, "slice").mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => recover_sskr_shares(compact)).toThrow(failure);
    vi.restoreAllMocks();
    expect(erasedBeforeFree).toBe(true);
    // The allocator may write free-list metadata after the wipe; it must not retain the entropy.
    expect(outputTail()).not.toEqual(expected.subarray(expected.length / 2));
    const next = recover_sskr_shares(compact);
    try {
      expect(next).toEqual(expected);
    } finally {
      next.fill(0);
    }
  });
});
