import { describe, expect, it } from "vitest";
import { WordTable } from "../src/core/word-table.js";

describe("The independent BIP39 word table", () => {
  it("refuses isolated surrogates instead of treating UTF-16 code units as Unicode scalars", () => {
    for (const text of ["\uD800", "\uDBFF", "\uDC00", "\uDFFF", "", "a\n", "ab"])
      expect(() => WordTable.unicodeHex(text)).toThrow(
        expect.objectContaining({
          code: "core.words.selected-mapped-bip39-character-not-one-unicode-scalar",
        }),
      );
    // Values that are no text, given on purpose as a JavaScript host could.
    for (const value of [null, 1, ["a"], { length: 1, 0: "a" }])
      expect(() => WordTable.unicodeHex(value as never)).toThrow(
        expect.objectContaining({
          code: "core.words.selected-mapped-bip39-character-not-one-unicode-scalar",
        }),
      );
  });

  it("keeps exact scalar values on both sides of the surrogate range and in supplementary planes", () => {
    for (const [text, hex] of [
      ["\u0000", "0000"],
      ["\uD7FF", "D7FF"],
      ["\uE000", "E000"],
      ["\uFFFF", "FFFF"],
      ["\u{10000}", "10000"],
      ["\u{1F600}", "1F600"],
      ["\u{10FFFF}", "10FFFF"],
    ] as const)
      expect(WordTable.unicodeHex(text)).toBe(hex);
  });

  it("looks up the published boundary words, numbers and Traditional Chinese codes", () => {
    expect(WordTable.lookup("word", " ABANDON ")).toEqual({
      index: 1,
      english: "abandon",
      unicodeHex: "7684",
    });
    expect(WordTable.lookup("index", "02048")).toEqual({
      index: 2048,
      english: "zoo",
      unicodeHex: "6B47",
    });
    expect(WordTable.lookup("unicode", "6b47")).toEqual(WordTable.row(2048));
    expect(WordTable.text("chinese").split("\n").slice(0, 2)).toEqual(["index\tchinese", "1\t的"]);
  });

  it("keeps its dictionaries unchanged when a caller alters returned rows", () => {
    Reflect.set(WordTable.row(1), "english", "zoo");
    const rows = WordTable.rows();
    rows.length = 0;
    expect(WordTable.lookup("word", "abandon").index).toBe(1);
    expect(WordTable.lookup("unicode", "7684").english).toBe("abandon");
    expect(WordTable.rows()).toHaveLength(2048);
    expect(WordTable.unicodeCodes[0]).toBe("7684");
    expect(Object.isFrozen(WordTable.unicodeCodes)).toBe(true);
  });

  it("retains stable refusal codes at the standalone entry", () => {
    for (const selector of ["__proto__", "toString", "constructor"]) {
      try {
        Reflect.apply(WordTable.lookup.bind(WordTable), WordTable, [selector, "1"]);
        expect.fail("An inherited selector must be refused.");
      } catch (error) {
        expect(error).toHaveProperty("code", "core.words.word-table-lookup");
      }
    }
    expect(() => WordTable.row(0)).toThrow("from 1 through 2048");
    expect(() => WordTable.lookup("word", "abandon ability")).toThrow(
      "not in the English BIP39 list",
    );
  });
});
