import { describe, expect, it } from "vitest";
import { sskrEngine } from "../src/sskr/runtime.js";
import { bytewordsToUr, normalizeShare, urToBytewords } from "../src/sskr/transport.js";

/** The bridge's share encodings (sskr-wasm/rust/src/lib.rs). */
const ENCODING_COMPACT_UR = 0;
const ENCODING_BYTEWORDS = 1;

describe("SSKR shares written in Bytewords", () => {
  it("match the words the SSKR bridge writes for the same shares", async () => {
    const engine = await sskrEngine();
    // Public test data: a counting secret and a fixed seed, so both encodings get the same shares.
    const secret = () => Uint8Array.from({ length: 16 }, (_, index) => index);
    const seed = () => new Uint8Array(32).fill(7);
    const groups = Uint8Array.of(2, 3);
    const urs = engine
      .create_sskr_shares_formatted(secret(), 1, groups, seed(), ENCODING_COMPACT_UR)
      .split("\n");
    const words = engine
      .create_sskr_shares_formatted(secret(), 1, groups, seed(), ENCODING_BYTEWORDS)
      .split("\n");
    expect(urs).toHaveLength(3);
    expect(urs.map(urToBytewords)).toEqual(words);
  });

  it("read back to the same share, also through the input of sskr-combine", async () => {
    const engine = await sskrEngine();
    const urs = engine
      .create_sskr_shares(new Uint8Array(32).fill(1), 1, Uint8Array.of(3, 5), new Uint8Array(32))
      .split("\n");
    for (const ur of urs) {
      const words = urToBytewords(ur);
      expect(words.split(" ")[0]).toBe("tuna");
      expect(bytewordsToUr(words)).toBe(ur);
      expect(normalizeShare(words)).toBe(ur);
    }
  });
});
