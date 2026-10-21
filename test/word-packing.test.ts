// The one packer of 11-bit word indexes into bytes (packWordIndexes in core/bits.ts), which the
// entropy of a phrase (entropyOfWords) and a share in word numbers (wordIndexesToBytes) both take:
// it agrees with @scure/bip39 on every phrase length and with the bit strings of bits.ts on any
// count of words, and refuses what is no word index and bytes that the words do not fill.

import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bitsOfIndexes, bitsToBytes, packWordIndexes } from "../src/core/bits.js";
import { entropyOfWords } from "../src/core/candidates.js";
import { wordIndexesToBytes } from "../src/sskr/transport.js";
import { withHoles } from "./helpers/holes.js";

/** Each BIP39 length: its words, its entropy bytes and its checksum bits, as BIP39 gives them. */
const LENGTHS = [
  [12, 16, 4],
  [15, 20, 5],
  [18, 24, 6],
  [21, 28, 7],
  [24, 32, 8],
] as const;

/** The code of a value that is no word index. */
const NO_WORD_INDEX = "core.bip39-sizes.assert-word-indexes-refused";

/** Twelve word indexes of 0, with `wrong` in place of the sixth. */
function phraseWith(wrong: number): number[] {
  return Array.from({ length: 12 }, (_, place) => (place === 5 ? wrong : 0));
}

describe("packing word indexes into bytes", () => {
  it("packs every BIP39 length into the entropy its phrase was made from, the checksum left over", () => {
    for (const [words, bytes, checksum] of LENGTHS) {
      const entropy = Uint8Array.from(
        { length: bytes },
        (_, place) => (place * 151 + words) & 0xff,
      );
      const indexes = entropyToMnemonic(entropy, wordlist)
        .split(" ")
        .map((word) => wordlist.indexOf(word));
      expect(indexes).toHaveLength(words);
      const target = new Uint8Array(bytes);
      const last = indexes.at(-1)!;
      expect(packWordIndexes(indexes, target)).toEqual([last & (2 ** checksum - 1), checksum]);
      expect(target).toEqual(entropy);
      expect(entropyOfWords(indexes)).toEqual(entropy);
    }
  });

  it("packs any count of words into the whole bytes of their bit string, the rest left over", () => {
    for (let count = 0; count <= 40; count += 1) {
      const indexes = Array.from({ length: count }, (_, place) =>
        place % 2 === 0 ? 2047 : (place * 1031) % 2048,
      );
      const bits = bitsOfIndexes(indexes);
      const whole = bits.length - (bits.length % 8);
      const rest = bits.slice(whole);
      expect(wordIndexesToBytes(indexes)).toEqual({
        bytes: whole === 0 ? [] : Array.from(bitsToBytes(bits.slice(0, whole))),
        leftover: rest === "" ? 0 : Number.parseInt(rest, 2),
        leftoverBits: rest.length,
      });
    }
  });

  it("refuses invalid word indexes and holes in the tested positions", () => {
    for (const wrong of [2048, 4096, -1, 1.5, Number.NaN]) {
      expect(() => entropyOfWords(phraseWith(wrong))).toThrow(
        expect.objectContaining({ code: NO_WORD_INDEX }),
      );
      expect(() => wordIndexesToBytes(phraseWith(wrong))).toThrow(
        expect.objectContaining({ code: NO_WORD_INDEX }),
      );
    }
    expect(() => entropyOfWords(withHoles(phraseWith(0), 5))).toThrow(
      expect.objectContaining({ code: NO_WORD_INDEX }),
    );
    expect(() => wordIndexesToBytes(withHoles(phraseWith(0), 11))).toThrow(
      expect.objectContaining({ code: NO_WORD_INDEX }),
    );
  });

  it("wipes the bytes it wrote before an index it refuses", () => {
    // Eleven words of 2047 write fifteen bytes of 0xff before the twelfth is read.
    const late = Array.from({ length: 12 }, (_, place) => (place === 11 ? 2048 : 2047));
    const target = new Uint8Array(16);
    expect(() => packWordIndexes(late, target)).toThrow(
      expect.objectContaining({ code: NO_WORD_INDEX }),
    );
    expect(target).toEqual(new Uint8Array(16));
  });

  it("refuses the entropy of words whose count no phrase has", () => {
    for (const count of [0, 1, 11, 13, 25])
      expect(() => entropyOfWords(Array.from({ length: count }, () => 0))).toThrow(
        expect.objectContaining({ code: "core.bip39-sizes.expected-word-indexes" }),
      );
  });

  it("refuses bytes that the words do not fill, or fill with a whole word or more to spare", () => {
    // Two words are 22 bits: two bytes and 6 bits over.
    expect(packWordIndexes([2047, 2047], new Uint8Array(2))).toEqual([0b111111, 6]);
    for (const bytes of [0, 1, 3])
      expect(() => packWordIndexes([2047, 2047], new Uint8Array(bytes))).toThrow(
        expect.objectContaining({ code: "core.bits.word-indexes-fill-bytes" }),
      );
  });
});
