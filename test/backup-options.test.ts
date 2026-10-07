import { describe, expect, it } from "vitest";
import {
  alwaysMasked,
  capabilities,
  shareFormatOf,
  ShareSetChoice,
  UNMASKED_NOTE,
} from "../src/core/backup-options.js";

describe("what a backup can be made of", () => {
  it("says what each mode allows: no split of the Original Seedshift, nothing more with a replaced last word", () => {
    expect(capabilities("direct")).toEqual({ split: true, backupCheck: true, heirSheet: true });
    expect(capabilities("seedshift")).toEqual({ split: true, backupCheck: true, heirSheet: true });
    expect(capabilities("seedshift-legacy")).toEqual({
      split: false,
      backupCheck: true,
      heirSheet: true,
    });
    expect(capabilities("seedshift-legacy-valid")).toEqual({
      split: false,
      backupCheck: false,
      heirSheet: false,
    });
    expect(() => capabilities("toString" as never)).toThrow("Unknown transformation mode");
  });

  it("writes shares in the form of the seed phrase, standard Bytewords for English words", () => {
    expect(shareFormatOf("english")).toBe("words");
    for (const form of ["indexes", "unicode", "colors", "colors-unicode"] as const)
      expect(shareFormatOf(form)).toBe(form);
    expect(() => shareFormatOf("json" as never)).toThrow("Unknown encoded format");
  });

  it("always masks English words and word numbers, and calls the other forms weak unmasked", () => {
    expect(alwaysMasked("english")).toBe(true);
    expect(alwaysMasked("indexes")).toBe(true);
    for (const form of ["unicode", "colors", "colors-unicode"] as const)
      expect(alwaysMasked(form)).toBe(false);
    expect(UNMASKED_NOTE).toContain("weak");
  });

  it("offers the usual share sets and refuses one that SSKR cannot split", () => {
    expect(ShareSetChoice.PRESETS.map((set) => set.label)).toEqual([
      "2 of 3",
      "2 of 4",
      "3 of 4",
      "3 of 5",
      "4 of 6",
      "5 of 7",
    ]);
    expect(ShareSetChoice.PRESETS[0]!.note).toBe("3 shares, any 2 restore it");
    const own = ShareSetChoice.of(4, 7);
    expect([own.threshold, own.count]).toEqual([4, 7]);
    for (const [threshold, count] of [
      [1, 3],
      [3, 2],
      [2, 17],
      [2.5, 3],
    ])
      expect(() => ShareSetChoice.of(threshold!, count!)).toThrow("SSKR requires");
  });

  it("reads a typed set of one's own and says what fits when it cannot be used", () => {
    expect(ShareSetChoice.typedCount("07")).toBe(7);
    for (const typed of ["1", "17", "-3", "3.0", "", "two"])
      expect(() => ShareSetChoice.typedCount(typed)).toThrow("Choose 2 to 16 shares.");
    expect(ShareSetChoice.typedThreshold("3", 3)).toBe(3);
    expect(() => ShareSetChoice.typedThreshold("4", 3)).toThrow(
      "Type a number from 2 to 3, the number of shares.",
    );
  });
});
