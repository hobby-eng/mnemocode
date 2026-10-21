import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingCodes } from "../src/core/missing-codes.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { WIPED_CODE } from "./helpers/owner-lifetime.js";
import { LAST_WORD_FORGOTTEN, TEST_INDEXES } from "./helpers/test-phrase.js";

afterEach(() => vi.restoreAllMocks());

describe("The lifetime of a marked-code search", () => {
  it("owns an independent snapshot, closes active iterators and refuses new secret reads", () => {
    const codes = MissingCodes.read(LAST_WORD_FORGOTTEN, "english", "direct");
    using copy = codes.withMode("direct");
    const candidates = codes.candidates();
    const first = candidates.next();
    expect(first.done).toBe(false);
    const notStarted = codes.candidates();
    codes.wipe();
    codes[Symbol.dispose]();
    expect(candidates.next().done).toBe(true);
    expect(() => notStarted.next()).toThrow("has been wiped");
    expect(() => codes.candidates()).toThrow("has been wiped");
    expect(() => codes.withMode("direct")).toThrow("has been wiped");
    expect(() => codes.missingPlaces).toThrow("has been wiped");
    expect(copy.missingPlaces).toEqual([12]);
    expect(copy.candidates().next().done).toBe(false);
    expect(first.value).toEqual(TEST_INDEXES);
  });

  it.each(["check", "turn", "progress"] as const)(
    "wipes already-kept backups when the host's %s callback fails",
    async (where) => {
      const codes = MissingCodes.read(LAST_WORD_FORGOTTEN, "english", "direct");
      const made = vi.spyOn(EncodedBackup, "of");
      const failure = new Error("Synthetic host callback failure.");
      let checked = 0;
      let tick = 0;
      try {
        await expect(
          codes.run({
            check: () => {
              checked += 1;
              if (where === "check" && checked === 2) throw failure;
              return true;
            },
            now: () => (tick += 1000),
            turn: async () => {
              if (where === "turn") throw failure;
            },
            onProgress: () => {
              if (where === "progress") throw failure;
            },
          }),
        ).rejects.toBe(failure);
        const kept = made.mock.results.filter((result) => result.type === "return");
        expect(kept.length).toBeGreaterThan(0);
        for (const result of kept)
          if (result.type === "return") expect(() => result.value.text()).toThrow("has been wiped");
      } finally {
        // Optional only so that the pre-owner implementation reaches the failure-cleanup check.
        codes.wipe?.();
      }
    },
  );

  it("refuses a check completed after the codes were disposed and clears earlier results", async () => {
    using codes = MissingCodes.read(LAST_WORD_FORGOTTEN, "english", "direct");
    const made = vi.spyOn(EncodedBackup, "of");
    let finish: ((value: boolean) => void) | undefined;
    let checked = 0;
    const pending = codes.run({
      check: async () => {
        checked += 1;
        if (checked === 1) return true;
        return new Promise<boolean>((resolve) => {
          finish = resolve;
        });
      },
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    codes.wipe();
    finish!(true);
    await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
    const first = made.mock.results[0]!;
    expect(first.type).toBe("return");
    if (first.type === "return") expect(() => first.value.text()).toThrow("has been wiped");
  });
});
