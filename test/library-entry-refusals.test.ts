// Library entries that a host may call with values no phrase or search takes: each refuses them
// with the code that its doc comment names, before any work, whatever form or mode it serves.
import { describe, expect, it } from "vitest";
import { EncodedForm } from "../src/core/encoded-form.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { validLastWordIndexes } from "../src/core/words.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";

// Vitest types its asymmetric matchers any, which the lint gate keeps out (TS-02).
const NO_WORD_COUNT: unknown = expect.objectContaining({
  code: "core.bip39-sizes.expected-word-indexes",
});
const NO_WORD_INDEX: unknown = expect.objectContaining({
  code: "core.bip39-sizes.assert-word-indexes-refused",
});
const NO_WHOLE_COUNT: unknown = expect.objectContaining({
  code: "core.search-turns.whole-number-more",
});

/** `count` word indexes, each 0, the word "abandon". */
function abandons(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

describe("the last words of a phrase", () => {
  it("are refused for a prefix one word shorter than no BIP39 phrase", () => {
    for (const count of [0, 2, 3, 5, 12, 24])
      expect(() => validLastWordIndexes(abandons(count))).toThrow(NO_WORD_COUNT);
  });

  it("are refused for a prefix with an element that is no word index", () => {
    for (const index of [-1, 1.5, 2048, 4096])
      expect(() => validLastWordIndexes([...abandons(10), index])).toThrow(NO_WORD_INDEX);
  });

  it("are the 128 of twelve words, about among them, and the 8 of 24 words, art among them", () => {
    const twelve = validLastWordIndexes(abandons(11));
    expect(twelve).toHaveLength(128);
    // about, word 4 of the BIP39 list, ends the public phrase of zero entropy.
    expect(twelve).toContain(3);
    const longest = validLastWordIndexes(abandons(23));
    expect(longest).toHaveLength(8);
    // art, word 103 of the BIP39 list, ends the public phrase of 24 words.
    expect(longest).toContain(102);
  });
});

describe("the elements of a phrase in a form", () => {
  it("are refused in every form for indexes that are no phrase", () => {
    for (const format of ENCODED_FORMATS) {
      const form = EncodedForm.of(format);
      expect(() => form.elements([1, 2])).toThrow(NO_WORD_COUNT);
      expect(() => form.elements([...abandons(11), 2048])).toThrow(NO_WORD_INDEX);
    }
  });
});

describe("an unmasking of shares", () => {
  it("is refused when it is built with a count of matches that is no whole number of 0 or more", () => {
    for (const count of [-1, 0.5, Number.NaN]) {
      expect(() => new ShareUnmasking({ mode: "direct", keep: count })).toThrow(NO_WHOLE_COUNT);
      expect(() => new ShareUnmasking({ mode: "direct", maxShown: count })).toThrow(NO_WHOLE_COUNT);
    }
  });
});
