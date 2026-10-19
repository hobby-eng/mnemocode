import { describe, expect, it } from "vitest";
import { WordList } from "../src/core/word-hints.js";
import { repairCandidates } from "../src/sskr/repair.js";
import { sskrVectors } from "./helpers/vectors.js";

const NAMES = { one: "word", many: "words" };
const SHARE = sskrVectors().official.shares[0]!;
const COLORS = sskrVectors().official.firstShareColors;

describe("bounded single-share repair budgets", () => {
  it.each([-1, 0.5, NaN, Infinity, 9, 31, 32, 40])(
    "refuses the unsupported free-bit budget %s before reading even an intact share",
    (budget) => {
      expect(() => repairCandidates(SHARE, budget)).toThrow(
        expect.objectContaining({ code: "sskr.repair.free-bits-budget" }),
      );
    },
  );

  it("refuses a 40-bit listing instead of returning a truncated subset without its original", () => {
    const marked = COLORS.map((color, index) => ([4, 5, 6].includes(index) ? "?" : color)).join(
      " ",
    );
    expect(() => repairCandidates(marked, 40)).toThrow(
      expect.objectContaining({ code: "sskr.repair.free-bits-budget" }),
    );
  });

  it("keeps the original public share in supported zero, default and eight-bit repairs", () => {
    const marked = COLORS.map((color, index) => (index === 4 ? "?" : color)).join(" ");
    for (const budget of [0, undefined, 8])
      expect(repairCandidates(marked, budget).map((share) => share.ur)).toEqual([SHARE]);
  });
});

describe("an admitted word-list snapshot", () => {
  it.each([0, 1])(
    "refuses a missing word at slot %s rather than admitting a sparse list",
    (slot) => {
      const words = ["abandon", "ability"];
      Reflect.deleteProperty(words, String(slot));
      expect(() => new WordList(NAMES, words)).toThrow(
        expect.objectContaining({
          code: "core.word-hints.word-list-holds-lower-case-letters-hyphens-only",
        }),
      );
    },
  );

  it("refuses a non-string word with its stable refusal rather than a native TypeError", () => {
    expect(() => {
      Reflect.construct(WordList, [NAMES, ["abandon", undefined]]);
    }).toThrow(
      expect.objectContaining({
        code: "core.word-hints.word-list-holds-lower-case-letters-hyphens-only",
      }),
    );
  });

  it("reads a changing getter once and retains exactly the validated word", () => {
    let reads = 0;
    const words = ["abandon"];
    Object.defineProperty(words, 0, {
      get: () => (++reads === 1 ? "abandon" : "zoo"),
    });
    const list = new WordList(NAMES, words);
    expect(reads).toBe(1);
    expect(list.hint("a")).toEqual({
      kind: "count",
      count: 1,
      text: "1 word begins with this letter",
    });
    expect(list.completion("aba")).toEqual({ letters: "ndon", wordEnds: true });
  });

  it("keeps a dense admitted snapshot independent from later caller mutation", () => {
    const words = ["abandon", "ability"];
    const list = new WordList(NAMES, words);
    words[0] = "zoo";
    expect(list.hint("ab")).toEqual({ kind: "words", words: ["abandon", "ability"] });
    expect(new WordList(NAMES, []).hint("a").kind).toBe("no-word");
  });
});
