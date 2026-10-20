import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { bytesOfHex } from "../src/core/bits.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { writeShare } from "../src/sskr/transport.js";

const wasm = engine.initSync({
  module: await readFile(
    new URL("../sskr-wasm/generated/recovery_sskr_wasm_bg.wasm", import.meta.url),
  ),
});
const compact = SSKR_SET_VECTOR.shares.join("\n");
const words = SSKR_SET_VECTOR.shares.map((share) => writeShare(share, "words")).join("\n");
const cases = [
  ["compact", undefined, compact],
  ["formatted compact", engine.ShareEncoding.CompactUr, compact],
  ["formatted words", engine.ShareEncoding.Bytewords, words],
] as const;
afterEach(() => vi.restoreAllMocks());

function create(encoding: number | undefined): string {
  const secret = bytesOfHex(SSKR_SET_VECTOR.entropy);
  const seed = bytesOfHex(SSKR_SET_VECTOR.testOnlySeed);
  try {
    return encoding === undefined
      ? engine.create_sskr_shares(secret, 1, Uint8Array.of(2, 3), seed)
      : engine.create_sskr_shares_formatted(secret, 1, Uint8Array.of(2, 3), seed, encoding);
  } finally {
    secret.fill(0);
    seed.fill(0);
  }
}

/** Observe the allocation while it is still valid; retain no pointer after the operation. */
function observeOutput(expected: string): { wipes: Uint8Array[] } {
  const size = new TextEncoder().encode(expected).length;
  const wipes: Uint8Array[] = [];
  // oxlint-disable-next-line typescript/unbound-method -- the intrinsic uses its explicit receiver through call.
  const fill = Uint8Array.prototype.fill;
  vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (
    this: Uint8Array,
    value,
    start,
    end,
  ) {
    const result = fill.call(this, value, start, end);
    if (this.buffer === wasm.memory.buffer && this.length === size) wipes.push(this.slice());
    return result;
  });
  return { wipes };
}

describe.each(cases)("SSKR %s creation output", (_name, encoding, expected) => {
  it("preserves the public vector and clears the WASM string before release", () => {
    const seen = observeOutput(expected);
    expect(create(encoding)).toBe(expected);
    expect(seen.wipes).toEqual([new Uint8Array(new TextEncoder().encode(expected).length)]);
  });

  it("also clears the WASM string when the host decoder throws", () => {
    const failure = new Error("Synthetic host decode failure.");
    const seen = observeOutput(expected);
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => create(encoding)).toThrow(failure);
    expect(seen.wipes).toEqual([new Uint8Array(new TextEncoder().encode(expected).length)]);
    vi.restoreAllMocks();
    expect(create(encoding)).toBe(expected);
  });
});

it("leaves the next allocation usable after a native creation refusal", () => {
  const secret = bytesOfHex(SSKR_SET_VECTOR.entropy);
  const seed = bytesOfHex(SSKR_SET_VECTOR.testOnlySeed);
  try {
    expect(() =>
      engine.create_sskr_shares_formatted(secret, 1, Uint8Array.of(2, 3), seed, 2),
    ).toThrow("Unsupported SSKR share encoding.");
    expect(create(undefined)).toBe(compact);
  } finally {
    secret.fill(0);
    seed.fill(0);
  }
});
