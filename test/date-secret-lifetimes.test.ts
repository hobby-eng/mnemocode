import { describe, expect, it, vi } from "vitest";
import { DatesAnswer, DateSearch, type WalletMatch } from "../src/core/date-search.js";
import { parseDate } from "../src/core.js";
import { WIPED_CODE } from "./helpers/owner-lifetime.js";
import { DATE, MASKED_INDEXES, TEST_PHRASE } from "./helpers/test-phrase.js";

describe("Owned date-answer lifetimes", () => {
  it.each([
    ["01-01-2000 ?3-09-2026", 2],
    ["?3-09-2026 01-01-2000", 1],
  ] as const)(
    "copies typed date positions without borrowing their lifetime (%s)",
    (line, place) => {
      const answer = DatesAnswer.parse(line, { patterns: true });
      using copy = answer.copy();
      answer.wipe();
      answer[Symbol.dispose]();
      expect(copy.known).toEqual([parseDate("01-01-2000")]);
      expect(copy.forgottenDigitsNote).toBe(`Date ${place} has forgotten digits: 3 combinations.`);
      expect(copy.combinations).toBe(3);
      expect(() => answer.known).toThrow("has been wiped");
      expect(() => answer.patterns).toThrow("has been wiped");
      expect(() => answer.copy()).toThrow("has been wiped");
    },
  );

  it("preserves custom pattern keys and snapshots admitted numeric lists", () => {
    const years = [2026];
    const pattern = { key: "\uFEFFcustom pattern", years, months: [9], days: [23, 24] };
    using answer = DatesAnswer.of([parseDate(DATE)], [pattern]);
    years[0] = 2000;
    pattern.days.push(25);
    expect(answer.patterns).toEqual([
      { key: "\uFEFFcustom pattern", years: [2026], months: [9], days: [23, 24] },
    ]);
    expect(answer.combinations).toBe(2);
  });

  it("keeps distinct opaque UTF-16 keys through reading, copying and search construction", () => {
    const patterns = ["\uD800", "\uD801", "\uDC00"].map((key, index) => ({
      key,
      years: [2026],
      months: [9],
      days: [23 + index],
    }));
    using answer = DatesAnswer.of([], patterns);
    expect(answer.patterns).toEqual(patterns);
    using copy = answer.copy();
    expect(copy.patterns).toEqual(patterns);
    using search = new DateSearch({ indexes: MASKED_INDEXES, dates: answer, mode: "seedshift" });
    expect(search.combinations).toBe(1);
  });
});

describe("Owned date-search lifetimes", () => {
  it("keeps its date snapshot live after the caller wipes the original answer", async () => {
    const dates = DatesAnswer.of([parseDate(DATE)]);
    using search = new DateSearch({ indexes: MASKED_INDEXES, dates, mode: "seedshift" });
    dates.wipe();
    const result = await search.run();
    expect(result.stopped).toBe(false);
    expect(result.shown[0]?.mnemonic).toBe(TEST_PHRASE);
  });

  it("disposes its own state while leaving the caller's dates live", async () => {
    using dates = DatesAnswer.of([parseDate(DATE)]);
    const search = new DateSearch({ indexes: MASKED_INDEXES, dates, mode: "seedshift" });
    search[Symbol.dispose]();
    search.wipe();
    expect(dates.known).toEqual([parseDate(DATE)]);
    await expect(search.run()).rejects.toHaveProperty("code", WIPED_CODE);
  });

  it("publishes no wallet result when its owner was wiped during the awaited check", async () => {
    using dates = DatesAnswer.of([parseDate(DATE)]);
    let finish: ((result: WalletMatch) => void) | undefined;
    let entered: (() => void) | undefined;
    const checking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    using search = new DateSearch({
      indexes: MASKED_INDEXES,
      dates,
      mode: "seedshift",
      walletCheck: () => {
        entered!();
        return new Promise<WalletMatch>((resolve) => {
          finish = resolve;
        });
      },
    });
    const onMatch = vi.fn();
    const pending = search.run({ onMatch });
    await checking;
    search.wipe();
    finish!({ matched: true });
    await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
    expect(onMatch).not.toHaveBeenCalled();
  });
});
