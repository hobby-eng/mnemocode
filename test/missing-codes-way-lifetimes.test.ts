import { afterEach, describe, expect, it, vi } from "vitest";
import { DatesAnswer } from "../src/core/date-search.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import type { WalletCheck } from "../src/core/wallet-check.js";
import { parseDate } from "../src/core/dates.js";
import {
  DATE,
  DATE_LAST_DIGIT_FORGOTTEN,
  MASKED_ONE_DIGIT_FORGOTTEN,
  MASKED_TWO_DIGITS_FORGOTTEN,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";

afterEach(() => vi.restoreAllMocks());

describe("The lifetime of a prepared marked-code search", () => {
  it.each(["encoded", "wallet", "patterns", "list"] as const)(
    "ends the %s way without disposing borrowed codes or incomplete dates",
    async (kind) => {
      using codes = MissingCodes.read(MASKED_ONE_DIGIT_FORGOTTEN, "indexes", "seedshift");
      using dates = DatesAnswer.parse(DATE_LAST_DIGIT_FORGOTTEN, { patterns: true, wordCount: 12 });
      const search = new MissingCodesSearch(codes, () => "00000000");
      const way =
        kind === "encoded"
          ? search.byEncodedFingerprint("00000000")
          : kind === "wallet"
            ? search.byWallet(() => ({ matched: false }))
            : kind === "patterns"
              ? search.byWallet(() => ({ matched: false }), dates)
              : search.listed([]);
      way.wipe();
      way[Symbol.dispose]();
      await expect(way.plan()).rejects.toHaveProperty(
        "code",
        "core.missing-codes-search.way-wiped",
      );
      await expect(way.run()).rejects.toHaveProperty("code", "core.missing-codes-search.way-wiped");
      expect(codes.missingPlaces).toEqual([3]);
      expect(dates.combinations).toBe(10);
    },
  );

  it("owns complete dates independently and releases that snapshot with the way", () => {
    using codes = MissingCodes.read(MASKED_ONE_DIGIT_FORGOTTEN, "indexes", "seedshift");
    using dates = DatesAnswer.of([parseDate(DATE)]);
    const made = vi.spyOn(DatesAnswer, "of");
    const way = new MissingCodesSearch(codes, () => "00000000").byWallet(
      () => ({ matched: false }),
      dates,
    );
    expect(made).toHaveBeenCalledTimes(1);
    const owned = made.mock.results[0]!;
    expect(owned.type).toBe("return");
    way.wipe();
    if (owned.type === "return") expect(() => owned.value.known).toThrow("has been wiped");
    expect(dates.known).toEqual([{ year: 2026, month: 9, day: 23 }]);
  });

  it.each(["plan", "run"] as const)(
    "refuses a wallet %s completed after the prepared way was disposed",
    async (phase) => {
      using codes = MissingCodes.read(MASKED_ONE_DIGIT_FORGOTTEN, "indexes", "seedshift");
      using dates = DatesAnswer.of([parseDate(DATE)]);
      let finish: (() => void) | undefined;
      const wallet: WalletCheck = async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { matched: true };
      };
      const way = new MissingCodesSearch(codes, () => "00000000").byWallet(wallet, dates);
      const pending = phase === "plan" ? way.plan() : way.run();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      way.wipe();
      finish!();
      await expect(pending).rejects.toHaveProperty("code", "core.missing-codes-search.way-wiped");
    },
  );
});

describe("Results of an owned marked-code search", () => {
  it.each(["several", "stopped"] as const)(
    "releases every kept backup when the wallet result is %s",
    async (outcome) => {
      using codes = MissingCodes.read(MASKED_TWO_DIGITS_FORGOTTEN, "indexes", "seedshift");
      using dates = DatesAnswer.of([parseDate(DATE)]);
      const made = vi.spyOn(EncodedBackup, "of");
      const stop = new AbortController();
      let tick = 0;
      const way = new MissingCodesSearch(codes, () => "00000000").byWallet(
        () => ({ matched: true }),
        dates,
      );
      try {
        const result = await way.run({
          signal: stop.signal,
          now: () => (tick += 100),
          turn: async () => {},
          onProgress: () => {
            if (outcome === "stopped") stop.abort();
          },
        });
        expect(result.kind).toBe(outcome);
        expect(made.mock.results.length).toBeGreaterThan(1);
        for (const owner of made.mock.results)
          if (owner.type === "return") expect(() => owner.value.text()).toThrow("has been wiped");
      } finally {
        // Lets the old implementation reach its real result-cleanup regression first.
        way.wipe?.();
      }
    },
  );

  it.each(["encoded", "wallet", "patterns"] as const)(
    "hears cancellation between the final search await and %s result transfer",
    async (kind) => {
      using codes = MissingCodes.read(MASKED_ONE_DIGIT_FORGOTTEN, "indexes", "seedshift");
      using dates = DatesAnswer.parse(DATE_LAST_DIGIT_FORGOTTEN, { patterns: true, wordCount: 12 });
      using known = DatesAnswer.of([parseDate(DATE)]);
      const search = new MissingCodesSearch(codes, () => "00000000");
      using way =
        kind === "encoded"
          ? search.byEncodedFingerprint("00000000")
          : search.byWallet(() => ({ matched: true }), kind === "patterns" ? dates : known);
      const made = vi.spyOn(EncodedBackup, "of");
      const stop = new AbortController();
      let tick = 0;
      const result = await way.run({
        signal: stop.signal,
        now: () => (tick += 100),
        turn: async () => {},
        onProgress: () => queueMicrotask(() => queueMicrotask(() => stop.abort())),
      });
      expect(stop.signal.aborted).toBe(true);
      expect(result).toEqual({ kind: "stopped" });
      expect(made.mock.results.length).toBeGreaterThan(0);
      for (const owner of made.mock.results)
        if (owner.type === "return") expect(() => owner.value.text()).toThrow("has been wiped");
    },
  );

  it.each(["encoded", "list"] as const)(
    "refuses a late %s fingerprint and releases its temporary backups",
    async (kind) => {
      using codes = MissingCodes.read(`${TEST_PHRASE}|actual`, "english", "direct");
      let finish: ((value: string) => void) | undefined;
      const fingerprint = () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        });
      const search = new MissingCodesSearch(codes, fingerprint);
      const way = kind === "encoded" ? search.byEncodedFingerprint("00000000") : search.listed([]);
      const made = vi.spyOn(EncodedBackup, "of");
      const pending = way.run();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      way.wipe();
      finish!("00000000");
      await expect(pending).rejects.toHaveProperty("code", "core.missing-codes-search.way-wiped");
      for (const owner of made.mock.results)
        if (owner.type === "return") expect(() => owner.value.text()).toThrow("has been wiped");
    },
  );

  it("transfers the only matching backup so that it survives disposal of the way", async () => {
    using codes = MissingCodes.read(MASKED_ONE_DIGIT_FORGOTTEN, "indexes", "seedshift");
    using dates = DatesAnswer.of([parseDate(DATE)]);
    const way = new MissingCodesSearch(codes, () => "00000000").byWallet(
      (phrase) => ({ matched: phrase === TEST_PHRASE }),
      dates,
    );
    const result = await way.run();
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("The public control must find one backup.");
    using backup = result.backup;
    way.wipe();
    expect(backup.decode(result.dates ?? []).recoveredMnemonic).toBe(TEST_PHRASE);
    expect(result.dates).toEqual([{ year: 2026, month: 9, day: 23 }]);
  });
});
