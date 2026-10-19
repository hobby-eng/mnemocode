// The SSKR engine leaves no copy of a secret or of a share in its WebAssembly memory once a call
// returns, whatever its dependencies copy while it works (AUD-037-SEC005, AUD-037-SEC006): the
// whole memory of the shipped engine is searched after a split and after a restore. Public test
// data only: a secret of counting bytes and a seed of sevens.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  create_sskr_shares_formatted,
  initSync,
  recover_sskr_shares_formatted,
  ShareEncoding,
} from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { urToTransport } from "../src/sskr/transport.js";

const engine = initSync({
  module: readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"),
});
/** Sixteen bytes that occur nowhere else: 0xA0, 0xA3, 0xA6, … */
const SECRET = Uint8Array.from({ length: 16 }, (_, index) => 0xa0 + index * 3);
const SEED_BYTES = 32;
/** The bytes of the CRC-32 that ends a share's transport. */
const CHECKSUM_BYTES = 4;

/**
 * The fewest bytes of a secret or a share searched for together: a freed block keeps all but its
 * first bytes, which the allocator overwrites with its own pointers, so a part is looked for too.
 */
const WINDOW_BYTES = 8;

/** Where any WINDOW_BYTES of `needle` in a row occur in the engine's whole memory. */
function occurrences(needle: Uint8Array): number[] {
  const memory = new Uint8Array(engine.memory.buffer);
  const found = new Set<number>();
  for (let start = 0; start + WINDOW_BYTES <= needle.length; start += 1) {
    const window = needle.subarray(start, start + WINDOW_BYTES);
    for (let at = memory.indexOf(window[0]!); at !== -1; at = memory.indexOf(window[0]!, at + 1))
      if (window.every((byte, offset) => memory[at + offset] === byte)) found.add(at - start);
  }
  return [...found].sort((left, right) => left - right);
}

/** The shares of SECRET in `encoding`, one per line, two of three needed, from a fixed seed. */
function split(encoding: ShareEncoding): string {
  return create_sskr_shares_formatted(
    SECRET.slice(),
    1,
    Uint8Array.of(2, 3),
    new Uint8Array(SEED_BYTES).fill(7),
    encoding,
  );
}

/** The value of a share, the part of it that a quorum turns into the secret. */
function shareValue(record: string): Uint8Array {
  const transport = urToTransport(record);
  return transport.slice(transport.length - CHECKSUM_BYTES - SECRET.length, -CHECKSUM_BYTES);
}

describe("the memory of the SSKR engine after a call", () => {
  it("holds no share and no secret after a split, in either encoding", () => {
    // The same seed makes the same shares in both encodings: their values are those of the URs.
    const values = split(ShareEncoding.CompactUr).split("\n").map(shareValue);
    for (const encoding of [ShareEncoding.CompactUr, ShareEncoding.Bytewords]) {
      split(encoding);
      expect(occurrences(SECRET), "secret").toEqual([]);
      for (const [place, value] of values.entries())
        expect(occurrences(value), `share ${place + 1}`).toEqual([]);
    }
  });

  it("holds no share and no secret after a restore", () => {
    const records = split(ShareEncoding.CompactUr).split("\n");
    const restored = recover_sskr_shares_formatted(
      records.slice(0, 2).join("\n"),
      ShareEncoding.CompactUr,
    );
    expect(Array.from(restored)).toEqual(Array.from(SECRET));
    expect(occurrences(SECRET), "secret").toEqual([]);
    for (const record of records) expect(occurrences(shareValue(record)), record).toEqual([]);
  });
});
