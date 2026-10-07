import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { QUESTION_SECONDS } from "../src/core/search-turns.js";
import {
  DatesAnswer,
  DateSearch,
  HARD_MAX_COMBINATIONS,
  MAX_SHOWN_MATCHES,
  walletNeeded,
  type DateMatch,
  type DateSearchProgress,
  type WalletCheck,
} from "../src/core/date-search.js";

// The host-neutral date search on its own, as another host such as the Deriver uses it: no
// terminal, no Node.js service, the wallet check and the event loop's turns passed in.

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
/** The test phrase masked with MnemoCode Seedshift and 23-09-2026, as BIP39 indexes. */
const MASKED = encodeMnemonic(TEST_PHRASE, [parseDate("23-09-2026")]).shiftedIndexes;
/** A wallet check that knows the test phrase, as a fingerprint check would, at the master key. */
const testWallet: WalletCheck = (mnemonic) => ({ matched: mnemonic === TEST_PHRASE, path: "m" });

function dates(line: string): DatesAnswer {
  return DatesAnswer.parse(line, { wordCount: 12, patterns: true });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatesAnswer", () => {
  it("holds complete dates and dates with ?, and never changes", () => {
    const answer = dates("23-09-2026 ?3-09-2026");
    expect(answer.count).toBe(2);
    expect(answer.hasForgottenDigits).toBe(true);
    expect(answer.combinations).toBe(3);
    // A caller that changes what it was given changes a copy only.
    answer.known.pop();
    answer.patterns.pop();
    expect(answer.known).toEqual([parseDate("23-09-2026")]);
    expect(answer.patterns).toHaveLength(1);
    expect(dates("23-09-2026").hasForgottenDigits).toBe(false);
  });

  it("keeps its dates, part of a secret, out of text, JSON and a printed object", () => {
    const answer = dates("23-09-2026 ?3-09-2026");
    expect(String(answer)).toBe("[DatesAnswer: redacted]");
    expect(JSON.stringify({ answer })).toBe('{"answer":"[DatesAnswer: redacted]"}');
    expect(inspect(answer)).toBe("[DatesAnswer: redacted]");
  });

  it("tells whether a phrase takes its dates: one for every three words", () => {
    const four = DatesAnswer.of([1, 2, 3, 4].map((day) => parseDate(`0${day}-01-2020`)));
    expect(four.fitsPhrase(12)).toBe(true);
    expect(DatesAnswer.of([...four.known, parseDate("05-01-2020")]).fitsPhrase(12)).toBe(false);
    expect(four.fitsPhrase(11)).toBe(false);
  });

  it("holds dates read elsewhere to the same limits", () => {
    const pattern = (text: string) => dates(text).patterns[0]!;
    const known = [parseDate("23-09-2026")];
    expect(DatesAnswer.of(known).combinations).toBe(1);
    expect(DatesAnswer.of(known, [pattern("2?-09-2026")]).combinations).toBe(10);
    expect(() => DatesAnswer.of([])).toThrow("Type at least one date.");
    const four = ["?1-01-2020", "?2-01-2020", "?3-01-2020", "?4-01-2020"].map(pattern);
    expect(() => DatesAnswer.of([], four)).toThrow("at most 3 incomplete dates.");
    // Two dates not remembered at all: more than the 2^31 combinations a search may have.
    const wide = ["?", "?"].map(pattern);
    expect(() => DatesAnswer.of([], wide)).toThrow("exceeds the safety limit");
  });

  it("counts up to one more than the hard limit", () => {
    const answer = dates("??-??-2026 ??-??-2027");
    expect(answer.combinations).toBe(365 * 365);
    expect(answer.combinations).toBeLessThan(HARD_MAX_COMBINATIONS);
  });

  it("names the places of the dates with ?, as a page's note shows them while they are typed", () => {
    expect(dates("23-09-2026 ?3-09-2026").incompletePlaces).toEqual([2]);
    expect(dates("23-09-2026 ?3-09-2026").forgottenDigitsNote).toBe(
      "Date 2 has forgotten digits: 3 combinations.",
    );
    const three = dates("?3-09-2026 01-01-2020 2?-09-2026 1?-01-2020");
    expect(three.incompletePlaces).toEqual([1, 3, 4]);
    expect(three.forgottenDigitsNote).toBe(
      "Dates 1, 3 and 4 have forgotten digits: 300 combinations.",
    );
    expect(dates("23-09-2026").forgottenDigitsNote).toBeUndefined();
    // Dates read elsewhere count those with ? after the complete ones.
    const pattern = dates("2?-09-2026").patterns[0]!;
    expect(DatesAnswer.of([parseDate("23-09-2026")], [pattern]).incompletePlaces).toEqual([2]);
  });

  it("says why a phrase cannot take the dates", () => {
    const five = DatesAnswer.of([1, 2, 3, 4, 5].map((day) => parseDate(`0${day}-01-2020`)));
    expect(five.tooManyFor(12)).toBe("12-word phrases support at most 4 dates.");
    expect(five.tooManyFor(15)).toBeUndefined();
    // Before the shares tell the words of their phrase, nothing is said.
    expect(five.tooManyFor(undefined)).toBeUndefined();
  });
});

describe("walletNeeded", () => {
  it("needs the wallet where every date gives a valid phrase", () => {
    expect(walletNeeded("seedshift")).toBe(true);
    expect(walletNeeded("seedshift-legacy-valid")).toBe(true);
    expect(walletNeeded("seedshift-legacy")).toBe(false);
    expect(walletNeeded("direct")).toBe(false);
  });
});

describe("DateSearch", () => {
  it("times the host's wallet check, which may answer later", async () => {
    const check = vi.fn(async (mnemonic: string) => ({ matched: mnemonic === TEST_PHRASE }));
    const seconds = await DateSearch.secondsPerCheck(check);
    expect(seconds).toBeGreaterThanOrEqual(0);
    // A few checks of the public test phrase, never of a secret.
    expect(check).toHaveBeenCalledTimes(3);
    expect(new Set(check.mock.calls.map(([mnemonic]) => mnemonic))).toEqual(new Set([TEST_PHRASE]));
  });

  it("refuses a search that its phrase, dates or mode cannot make", () => {
    const answer = dates("2?-09-2026");
    expect(
      () => new DateSearch({ indexes: MASKED.slice(1), dates: answer, mode: "seedshift" }),
    ).toThrow("Expected 12, 15, 18, 21, or 24 word indexes.");
    expect(
      () =>
        new DateSearch({
          indexes: MASKED,
          dates: answer,
          mode: "direct" as unknown as "seedshift",
        }),
    ).toThrow("Unsupported Seedshift mode.");
    const five = DatesAnswer.of([1, 2, 3, 4, 5].map((day) => parseDate(`0${day}-01-2020`)));
    expect(() => new DateSearch({ indexes: MASKED, dates: five, mode: "seedshift" })).toThrow(
      "12-word phrases support at most 4 dates.",
    );
    const plain = { known: answer.known, patterns: answer.patterns } as unknown as DatesAnswer;
    expect(() => new DateSearch({ indexes: MASKED, dates: plain, mode: "seedshift" })).toThrow(
      "The dates must be a DatesAnswer.",
    );
    expect(
      () => new DateSearch({ indexes: MASKED, dates: answer, mode: "seedshift", keep: -1 }),
    ).toThrow("keep must be a whole number of 0 or more.");
  });

  it("refuses a progress step that is no whole number of 1 or more, and shows no codes", async () => {
    const search = new DateSearch({
      indexes: MASKED,
      dates: dates("2?-09-2026"),
      mode: "seedshift",
    });
    for (const progressEvery of [0, -1, 1.5, Number.NaN])
      await expect(search.run({ progressEvery })).rejects.toThrow(
        "progressEvery must be a whole number of 1 or more.",
      );
    expect(String(search)).toBe("[DateSearch: redacted]");
    expect(JSON.stringify({ search })).toBe('{"search":"[DateSearch: redacted]"}');
    expect(inspect(search)).toBe("[DateSearch: redacted]");
  });

  it("tells its size and its wallet checks before it runs", () => {
    const answer = dates("2?-09-2026");
    const search = (mode: "seedshift" | "seedshift-legacy" | "seedshift-legacy-valid") =>
      new DateSearch({ indexes: MASKED, dates: answer, mode, walletCheck: testWallet });
    expect(search("seedshift").combinations).toBe(10);
    // 12 words carry 4 checksum bits.
    expect(search("seedshift").checks()).toBe(1);
    expect(search("seedshift-legacy").checks()).toBe(1 / 16);
    expect(search("seedshift-legacy-valid").checks()).toBe(128);
    expect(
      search("seedshift").estimatedSeconds({ perCheck: 0.002, perCombination: 0 }),
    ).toBeCloseTo(0.02);
    // Decoding counts for every combination; a wallet check for every checksum-valid phrase.
    expect(
      search("seedshift-legacy").estimatedSeconds({ perCheck: 0.016, perCombination: 0.001 }),
    ).toBeCloseTo(0.02);
    // Without a wallet check only the decoding costs time.
    expect(
      new DateSearch({ indexes: MASKED, dates: answer, mode: "seedshift" }).estimatedSeconds({
        perCheck: 1,
        perCombination: 0.5,
      }),
    ).toBe(5);
  });

  it("measures its pace in the host: the decoding, and the wallet check if there is one", async () => {
    const answer = dates("2?-09-2026");
    expect(DateSearch.secondsPerCombination("seedshift", answer)).toBeGreaterThan(0);
    const listing = new DateSearch({ indexes: MASKED, dates: answer, mode: "seedshift" });
    expect((await listing.pace()).perCheck).toBe(0);
    const checked = new DateSearch({
      indexes: MASKED,
      dates: answer,
      mode: "seedshift",
      walletCheck: testWallet,
    });
    const pace = await checked.pace();
    expect(pace.perCheck).toBeGreaterThan(0);
    expect(pace.perCombination).toBeGreaterThan(0);
    // Eight dates fit the phrase that the decoding is timed with, as long as a phrase gets.
    const eight = DatesAnswer.parse(
      "01-01-2020 02-01-2020 03-01-2020 04-01-2020 05-01-2020 06-01-2020 07-01-2020 0?-01-2021",
      { wordCount: 24, patterns: true },
    );
    expect(DateSearch.secondsPerCombination("seedshift", eight)).toBeGreaterThan(0);
  });

  it("is asked for first when it takes longer than twelve hours, or tries more than a limit", () => {
    expect(QUESTION_SECONDS).toBe(12 * 3_600);
    const search = new DateSearch({
      indexes: MASKED,
      dates: dates("2?-09-2026"),
      mode: "seedshift",
      walletCheck: testWallet,
    });
    const at = (perCheck: number, perCombination = 0) => ({ perCheck, perCombination });
    // Ten wallet checks: twelve hours at 4,320 seconds a check, not more.
    expect(search.needsQuestion(at(QUESTION_SECONDS / 10))).toBe(false);
    expect(search.needsQuestion(at(QUESTION_SECONDS / 10 + 1))).toBe(true);
    // The decoding counts too.
    expect(search.needsQuestion(at(QUESTION_SECONDS / 10, 1))).toBe(true);
    // A limit given by the person counts combinations instead.
    expect(search.needsQuestion(at(QUESTION_SECONDS), 10)).toBe(false);
    expect(search.needsQuestion(at(0), 9)).toBe(true);
    // Without a wallet check only a decoding as slow as twelve hours asks.
    const listing = new DateSearch({
      indexes: MASKED,
      dates: dates("2?-09-2026"),
      mode: "seedshift",
    });
    expect(listing.needsQuestion(at(QUESTION_SECONDS))).toBe(false);
    expect(listing.needsQuestion(at(0, QUESTION_SECONDS / 10 + 1))).toBe(true);
  });

  it("finds the dates with the wallet, and calls back with its progress and each match", async () => {
    const progress: DateSearchProgress[] = [];
    const matches: DateMatch[] = [];
    const search = new DateSearch({
      indexes: MASKED,
      dates: dates("2?-09-2026"),
      mode: "seedshift",
      walletCheck: testWallet,
      keep: 5,
    });
    const result = await search.run({
      progressEvery: 4,
      onProgress: (step) => progress.push(step),
      onMatch: (match) => matches.push(match),
    });
    expect(result).toEqual({
      combinations: 10,
      checksumValid: 10,
      matchCount: 1,
      shown: [{ dates: "23-09-2026", mnemonic: TEST_PHRASE, evidence: "m" }],
      kept: [TEST_PHRASE],
    });
    expect(matches).toEqual(result.shown);
    expect(progress.map((step) => step.checked)).toEqual([4, 8, 10]);
    expect(progress.at(-1)).toEqual({
      checked: 10,
      combinations: 10,
      checksumValid: 10,
      matchCount: 1,
    });
  });

  it("takes a wallet check that answers later, as a page's WebCrypto does", async () => {
    const later: WalletCheck = async (mnemonic) => testWallet(mnemonic);
    const result = await new DateSearch({
      indexes: MASKED,
      dates: dates("2?-09-2026"),
      mode: "seedshift",
      walletCheck: later,
    }).run();
    expect(result.shown).toEqual([{ dates: "23-09-2026", mnemonic: TEST_PHRASE, evidence: "m" }]);
  });

  it("without a wallet keeps every checksum-valid phrase, shown up to its limit", async () => {
    const matches: DateMatch[] = [];
    const answer = dates("??-09-2026");
    const result = await new DateSearch({
      indexes: MASKED,
      dates: answer,
      mode: "seedshift",
      maxShown: 2,
    }).run({ onMatch: (match) => matches.push(match) });
    // MnemoCode Seedshift gives a valid phrase for every date.
    expect(result).toMatchObject({ combinations: 30, checksumValid: 30, matchCount: 30, kept: [] });
    expect(result.shown).toHaveLength(2);
    expect(matches).toHaveLength(30);
    expect(result.shown[0]).toEqual({ dates: "01-09-2026", mnemonic: expect.any(String) });
    // The Original Seedshift with a valid last word tries every last word whose checksum fits: 128
    // for 12 words. One combination only, as each of them takes a while to decode.
    const valid = await new DateSearch({
      indexes: MASKED,
      dates: dates("23-09-2026"),
      mode: "seedshift-legacy-valid",
    }).run();
    expect(valid).toMatchObject({ combinations: 1, checksumValid: 128, matchCount: 128 });
    expect(MAX_SHOWN_MATCHES).toBe(100);
    expect(valid.shown).toHaveLength(MAX_SHOWN_MATCHES);
  });

  it("stops at the host's signal, before it starts or at its next turn", async () => {
    const search = new DateSearch({
      indexes: MASKED,
      dates: dates("??-09-2026"),
      mode: "seedshift",
      walletCheck: testWallet,
    });
    const stopped = new AbortController();
    stopped.abort(new Error("stopped before"));
    await expect(search.run({ signal: stopped.signal })).rejects.toThrow("stopped before");

    // Every combination takes longer than a turn's time here, so the search turns before each.
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const controller = new AbortController();
    let turns = 0;
    const checked: number[] = [];
    await expect(
      search.run({
        signal: controller.signal,
        progressEvery: 1,
        onProgress: (step) => checked.push(step.checked),
        turn: async () => {
          turns += 1;
          if (turns === 3) controller.abort(new Error("stopped by the host"));
        },
      }),
    ).rejects.toThrow("stopped by the host");
    expect(checked).toEqual([1, 2]);
  });
});
