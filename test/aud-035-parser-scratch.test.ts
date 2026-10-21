import { describe, expect, it, vi } from "vitest";
import { EncodedForm } from "../src/core/encoded-form.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { detectInputFormats } from "../src/core/representations.js";
import { TEST_INDEXES, TEST_NUMBERS, TEST_PHRASE } from "./helpers/test-phrase.js";

describe("private parser scratch lifetime (AUD-029-SEC001)", () => {
  it.each(["read", "detect"] as const)("retires accepted indexes after %s", (operation) => {
    const parser = vi.spyOn(EncodedForm.prototype, "read");
    try {
      const text = TEST_NUMBERS;
      if (operation === "read") {
        using owner = EncodedBackup.read(text, "indexes", "direct");
        expect(owner.decode([]).recoveredMnemonic).toBe(TEST_PHRASE);
      } else expect(detectInputFormats(text)).toContain("indexes");
      const arrays = parser.mock.results.flatMap((row) =>
        row.type === "return" ? [row.value] : [],
      );
      expect(arrays.length).toBeGreaterThan(0);
      for (const array of arrays) expect(array).toEqual(Array(array.length).fill(0));
    } finally {
      for (const row of parser.mock.results) if (row.type === "return") row.value.fill(0);
      parser.mockRestore();
    }
  });

  it.each(["read", "detect"] as const)("retires wrong-count indexes after %s", (operation) => {
    const parser = vi.spyOn(EncodedForm.prototype, "read");
    try {
      const text = `${"1 ".repeat(10)}4`;
      if (operation === "read")
        expect(() => EncodedBackup.read(text, "indexes", "direct")).toThrow(
          expect.objectContaining({ code: "core.encoded-backup.encoded-seed-phrase" }),
        );
      else expect(detectInputFormats(text)).toEqual([]);
      const arrays = parser.mock.results.flatMap((row) =>
        row.type === "return" ? [row.value] : [],
      );
      expect(arrays.length).toBeGreaterThan(0);
      for (const array of arrays) expect(array).toEqual(Array(array.length).fill(0));
    } finally {
      for (const row of parser.mock.results) if (row.type === "return") row.value.fill(0);
      parser.mockRestore();
    }
  });

  it("preserves caller-owned indexes after admission and owner disposal", () => {
    const indexes = Array<number>(12).fill(0);
    indexes[11] = 3;
    try {
      using owner = EncodedBackup.of(indexes, "indexes", "direct");
      expect(owner.decode([]).recoveredMnemonic).toBe(TEST_PHRASE);
      owner.wipe();
      expect(indexes).toEqual(TEST_INDEXES);
    } finally {
      indexes.fill(0);
    }
  });

  it("retires a private shorter prefix without changing the longer backup or recovered phrase", () => {
    const indexes = [...Array<number>(11).fill(0), 3, 2047, 5, 9];
    using owner = EncodedBackup.of(indexes, "indexes", "direct");
    const factory = vi.spyOn(EncodedBackup, "of");
    try {
      const shorter = owner.shorterPhrases([]);
      expect(shorter).toHaveLength(1);
      expect(shorter[0]!.result.recoveredMnemonic).toBe(TEST_PHRASE);
      expect(shorter[0]!.result.recoveredIndexes).toEqual(TEST_INDEXES);
      expect(owner.indexes).toEqual(indexes);
      expect(factory.mock.calls).toHaveLength(1);
      expect(factory.mock.calls[0]![0]).toEqual(Array<number>(12).fill(0));
    } finally {
      for (const [prefix] of factory.mock.calls)
        for (let place = 0; place < prefix.length; place += 1) Reflect.set(prefix, place, 0);
      factory.mockRestore();
      indexes.fill(0);
    }
  });
});
