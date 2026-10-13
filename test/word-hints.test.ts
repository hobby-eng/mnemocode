import { describe, expect, it } from "vitest";
import { EncodedForm } from "../src/core/encoded-form.js";
import { englishWordlist } from "../src/core/english-words.js";
import { LIST_FROM_LETTERS, WordList, type WordHints } from "../src/core/word-hints.js";
import { WORD_HINTS_SELF_TEST } from "../src/core/word-hints-self-test.js";
import { SHARE_WORD_HINTS } from "../src/sskr/share-input.js";
import { bytewords } from "../src/sskr/bytewords-list.js";

/** The words that `line` lists, or the kind of hint it gives instead. */
function listed(hints: WordHints, line: string): readonly string[] | string {
  const hint = hints.hint(line);
  return hint.kind === "words" ? hint.words : hint.kind;
}

/** What Tab adds to `line`, and whether the word then ends. */
function completed(hints: WordHints, line: string): [string, boolean] {
  const { letters, wordEnds } = hints.completion(line);
  return [letters, wordEnds];
}

// The cases of mhfe's src/word_hints.rs, so that both programs hint alike (owner, 2026-10-08).
describe("hints below a word being typed, as in mhfe", () => {
  const bip39 = WordList.BIP39;

  it("gives a count after one letter and the words from two", () => {
    expect(LIST_FROM_LETTERS).toBe(2);
    expect(bip39.hint("z")).toEqual({
      kind: "count",
      count: 4,
      text: "4 BIP39 words begin with this letter",
    });
    expect(bip39.hint("Z")).toEqual(bip39.hint("z"));
    expect(listed(bip39, "abandon zo")).toEqual(["zone", "zoo"]);
    expect(listed(bip39, "abandon AB")).toEqual([
      "abandon",
      "ability",
      "able",
      "about",
      "above",
      "absent",
      "absorb",
      "abstract",
      "absurd",
      "abuse",
    ]);
  });

  it("needs no hint for a whole word alone, but lists the words that it begins", () => {
    expect(listed(bip39, "zoo")).toBe("nothing");
    expect(listed(bip39, "art")).toEqual(["art", "artefact", "artist", "artwork"]);
  });

  it("tells a word that no word begins like from no word being typed", () => {
    expect(bip39.hint("x")).toEqual({ kind: "no-word", text: "No BIP39 word begins like this." });
    expect(listed(bip39, "abandon xq")).toBe("no-word");
    // Longer than any word of the list (AUD-015-UI004 of mhfe).
    expect(listed(bip39, "toolongforanyword")).toBe("no-word");
    expect(completed(bip39, "toolongforanyword")).toEqual(["", false]);
    for (const line of ["", "abandon ", "abandon ?", "ab1", "a\tb\u0001"])
      expect(listed(bip39, line), JSON.stringify(line)).toBe("nothing");
  });

  it("completes with Tab as far as the words agree", () => {
    expect(completed(bip39, "abou")).toEqual(["t", true]);
    expect(completed(bip39, "ABOU")).toEqual(["t", true]);
    expect(completed(bip39, "zoo")).toEqual(["", true]);
    expect(completed(bip39, "abs")).toEqual(["", false]);
    expect(completed(bip39, "artw")).toEqual(["ork", true]);
    expect(completed(bip39, "xq")).toEqual(["", false]);
    expect(completed(bip39, "abandon ")).toEqual(["", false]);
  });

  it("lists every word of the list that begins with two letters, from both lists", () => {
    const prefixes = [...new Set(englishWordlist.map((word) => word.slice(0, 2)))];
    for (const prefix of prefixes)
      expect(listed(bip39, prefix), prefix).toEqual(
        englishWordlist.filter((word) => word.startsWith(prefix)),
      );
    const byteword = (line: string): readonly string[] | string => listed(SHARE_WORD_HINTS, line);
    expect(byteword("ta")).toEqual(bytewords.filter((word) => word.startsWith("ta")));
  });

  it("names a count of one in the singular", () => {
    const list = new WordList({ one: "test word", many: "test words" }, ["alpha", "beta", "bravo"]);
    expect(list.hint("a")).toMatchObject({ text: "1 test word begins with this letter" });
    expect(list.hint("b")).toMatchObject({ text: "2 test words begin with this letter" });
  });

  it("refuses a list out of order, repeated or not in lower case", () => {
    const names = { one: "word", many: "words" };
    expect(() => new WordList(names, ["zoo", "abandon"])).toThrow("alphabetical order");
    expect(() => new WordList(names, ["able", "able"])).toThrow("alphabetical order");
    expect(() => new WordList(names, ["Able"])).toThrow("lower-case letters");
    expect(() => new WordList(names, ["ab1"])).toThrow("lower-case letters");
  });
});

describe("hints of a line in any form", () => {
  it("hints English codes and no codes of another form", () => {
    const hints = EncodedForm.typedWords;
    expect(listed(hints, "abandon zo")).toEqual(["zone", "zoo"]);
    // Unicode codes, also one of letters only, and the other forms are no words.
    for (const line of ["7684 5728 CA", "CAFE", "12 34", "#1A2B3C", "#1A2B3C AB"])
      expect(listed(hints, line), line).toBe("nothing");
    // A letter that no hexadecimal digit is makes it words again.
    expect(listed(hints, "ABAN")).toEqual(["abandon"]);
    expect(completed(hints, "ABAN")).toEqual(["don", true]);
    expect(completed(hints, "CAFE")).toEqual(["", false]);
  });

  it("hints Bytewords in the share being typed, after the shares before it", () => {
    const hints = SHARE_WORD_HINTS;
    expect(hints.hint("q")).toMatchObject({ text: "2 Bytewords begin with this letter" });
    expect(hints.hint("tx")).toMatchObject({ text: "No Byteword begins like this." });
    expect(listed(hints, "tuna acid;ta")).toEqual(["taco", "task", "taxi"]);
    expect(listed(hints, "#1A2B3C #4D5E6F;\nta")).toEqual(["taco", "task", "taxi"]);
    expect(completed(hints, "able tu")).toEqual(["na", true]);
    // A share in colors, codes or a UR is no Bytewords.
    for (const line of ["#1A2B3C AB", "7684 CAFE", "ur:sskr/", "able acid; ur:sskr/gd"])
      expect(listed(hints, line), line).toBe("nothing");
  });
});

describe("self-test of the hints", () => {
  it("passes", async () => {
    expect(() => WORD_HINTS_SELF_TEST.startup()).not.toThrow();
    await expect(Promise.resolve(WORD_HINTS_SELF_TEST.check.run())).resolves.toBeUndefined();
  });
});
