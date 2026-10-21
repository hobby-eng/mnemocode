import { describe, expect, it, vi } from "vitest";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { recoverLegacyValidLastWords } from "../src/core/words.js";
import { DATE, replacedAt, TEST_PHRASE } from "./helpers/test-phrase.js";
import { parseDate } from "../src/core/dates.js";

const ENDINGS = recoverLegacyValidLastWords(TEST_PHRASE).map(({ word }) => word);

describe("Actual candidate-list size after an underestimated search plan", () => {
  it.each([17, 100, 128])(
    "refuses %s actual candidates instead of returning a partial list",
    async (count) => {
      expect(ENDINGS).toHaveLength(128);
      const codes = MissingCodes.read(
        replacedAt(TEST_PHRASE, { 12: ENDINGS.slice(0, count).join("|") }),
        "english",
        "direct",
      );
      const fingerprint = vi.fn(() => "00000000");
      const search = new MissingCodesSearch(codes, fingerprint);
      expect(codes.combinations).toBe(count);
      expect(codes.expected).toBeLessThanOrEqual(16);
      expect(search.fits("list")).toBe(true);
      await expect(search.listed([]).run()).rejects.toMatchObject({
        code: "core.missing-codes-search.list-overflow",
      });
      expect(fingerprint).not.toHaveBeenCalled();
    },
  );

  it("returns every candidate when the actual number equals the list limit", async () => {
    const endings = ENDINGS.slice(0, MissingCodesSearch.MAX_LISTED);
    const codes = MissingCodes.read(
      replacedAt(TEST_PHRASE, { 12: endings.join("|") }),
      "english",
      "direct",
    );
    const listed = await new MissingCodesSearch(codes, () => "00000000").listed([]).run();
    expect(listed.kind).toBe("list");
    if (listed.kind !== "list") throw new Error("The boundary control must list its candidates.");
    expect(listed.rows.map(({ phrase }) => phrase)).toEqual(
      endings.map((word) => replacedAt(TEST_PHRASE, { 12: word })),
    );
  });

  it("also bounds multiple phrases decoded from one set of legacy valid-last-word codes", async () => {
    // 24 words: each set gives 8 phrases, so that 3 sets, which the estimate takes for far fewer,
    // give 24.
    const prefix = "abandon ".repeat(23);
    const endings = recoverLegacyValidLastWords(`${prefix}art`).map(({ word }) => word);
    const codes = MissingCodes.read(
      prefix + endings.slice(0, 3).join("|"),
      "english",
      "seedshift-legacy-valid",
    );
    const fingerprint = vi.fn(() => "00000000");
    const search = new MissingCodesSearch(codes, fingerprint);
    expect(search.fits("list")).toBe(true);
    await expect(search.listed([parseDate(DATE)]).run()).rejects.toMatchObject({
      code: "core.missing-codes-search.list-overflow",
    });
    expect(fingerprint).toHaveBeenCalledTimes(MissingCodesSearch.MAX_LISTED);
  });

  it("offers no list where one set of codes gives more phrases than it holds (AUD-037-FUN002)", () => {
    const codes = MissingCodes.read(
      replacedAt(TEST_PHRASE, { 12: ENDINGS.slice(0, 2).join("|") }),
      "english",
      "seedshift-legacy-valid",
    );
    const search = new MissingCodesSearch(codes, () => "00000000");
    expect(search.fits("list")).toBe(false);
    expect(() => search.listed([parseDate(DATE)])).toThrow(
      expect.objectContaining({ code: "core.missing-codes-search.operation-refused" }),
    );
  });

  it("returns stopped when the host cancels during a fingerprint before a list overflows", async () => {
    const codes = MissingCodes.read(
      replacedAt(TEST_PHRASE, { 12: ENDINGS.slice(0, 16).join("|") }),
      "english",
      "direct",
    );
    const stop = new AbortController();
    const fingerprint = vi.fn(() => {
      stop.abort();
      return "00000000";
    });
    const way = new MissingCodesSearch(codes, fingerprint).listed([]);
    expect(await way.run({ signal: stop.signal })).toEqual({ kind: "stopped" });
    expect(fingerprint).toHaveBeenCalledTimes(1);
  });
});
