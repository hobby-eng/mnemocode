import { describe, expect, it } from "vitest";
import { sskrEngine } from "../src/sskr/runtime.js";
import {
  bytewordsToUr,
  normalizeShare,
  readShare,
  urToBytewords,
  writeShare,
} from "../src/sskr/transport.js";

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

describe("SSKR shares written in the form of the seed phrase", () => {
  const FORMS = ["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const;

  it("read back to the same share in every form, and say which form it was", async () => {
    const engine = await sskrEngine();
    // Public test data: every secret length, from a 12-word to a 24-word phrase.
    for (const length of [16, 20, 24, 28, 32]) {
      const urs = engine
        .create_sskr_shares(
          new Uint8Array(length).fill(3),
          1,
          Uint8Array.of(2, 3),
          new Uint8Array(32),
        )
        .split("\n");
      for (const ur of urs)
        for (const format of FORMS) {
          const written = writeShare(ur, format);
          expect(readShare(written), `${format}: ${written}`).toEqual({ ur, format });
        }
    }
  });

  it("look like the form: word numbers up to 2048, Unicode codes of BIP39 words", async () => {
    const engine = await sskrEngine();
    const [ur] = engine
      .create_sskr_shares(new Uint8Array(16).fill(5), 1, Uint8Array.of(2, 3), new Uint8Array(32))
      .split("\n");
    const numbers = writeShare(ur!, "indexes").split(" ").map(Number);
    expect(numbers.every((number) => number >= 1 && number <= 2048)).toBe(true);
    for (const code of writeShare(ur!, "unicode").split(" "))
      expect(code).toMatch(/^[0-9A-F]{4}$/u);
  });

  it("remove the constant prefix in these public fixtures, without requiring unique starts", async () => {
    const engine = await sskrEngine();
    // Two sets of the same public secret; the seeds are fixed, so the shares are too.
    const sets = [new Uint8Array(32), new Uint8Array(32).fill(9)].map((seed) =>
      engine
        .create_sskr_shares(new Uint8Array(16).fill(5), 1, Uint8Array.of(2, 3), seed)
        .split("\n"),
    );
    const starts = sets.flat().map((ur) => writeShare(ur, "indexes").split(" ")[0]);
    expect(new Set(starts).size).toBeGreaterThan(1);
    const unicodeStarts = sets.flat().map((ur) => writeShare(ur, "unicode").split(" ")[0]);
    expect(new Set(unicodeStarts).size).toBeGreaterThan(1);
  });

  it("refuse a share with one number changed: the checksum no longer fits", async () => {
    const engine = await sskrEngine();
    const [ur] = engine
      .create_sskr_shares(new Uint8Array(16).fill(5), 1, Uint8Array.of(2, 3), new Uint8Array(32))
      .split("\n");
    const numbers = writeShare(ur!, "indexes").split(" ");
    numbers[8] = numbers[8] === "1" ? "2" : "1";
    expect(() => readShare(numbers.join(" "))).toThrow();
  });
});
