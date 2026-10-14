import { describe, expect, it } from "vitest";
import { encodeMnemonic, formatEncoded, parseDate, representMnemonic } from "../src/core.js";
import {
  areWordIndexes,
  checksumPassShare,
  lastWordEntropyValues,
  BIP39_WORD_COUNTS,
} from "../src/core/bip39-sizes.js";
import { checksumValid, WordCandidate, WordCandidateSearch } from "../src/core/candidates.js";
import { writtenAsAnAddress } from "../src/core/coins/other-forms.js";
import { NO_DATE } from "../src/core/dates.js";
import { DatesAnswer, DateSearch, type WalletCheck } from "../src/core/date-search.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { zeroEntropyPhrase } from "../src/core/english-words.js";
import { formatConflictOf, modeConflictOf } from "../src/core/backup-reading.js";
import { DATE_COUNT_WORDS, Masking } from "../src/core/masking.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import type { MaskingMode } from "../src/core/types.js";
import { MALFORMED_WALLET_ANSWER, type WalletMatch } from "../src/core/wallet-check.js";
import { withHoles } from "./helpers/holes.js";

// AUD-014 remediation of the core: the public reproductions of the audit's findings, each with
// its well-formed controls, and the checks of the consolidated rules (recommendations 1 to 9).
// Public test data only: the all-zero-entropy phrase and a synthetic date.

const PHRASE = zeroEntropyPhrase(12);
const DATE = parseDate("23-09-2026");
/** The phrase masked with MnemoCode Seedshift and DATE, as BIP39 indexes. */
const MASKED = encodeMnemonic(PHRASE, [DATE]).shiftedIndexes;

/** What a faulty JavaScript host's wallet check may answer, typed as a WalletCheck would be. */
function answering(answer: unknown): WalletCheck {
  return () => answer as WalletMatch;
}

/** Answers that are no WalletMatch: none, null, a string "false", a number, no matched field. */
const MALFORMED_ANSWERS: readonly [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ['{ matched: "false" }', { matched: "false" }],
  ["{ matched: 1 }", { matched: 1 }],
  ["{}", {}],
];

describe("AUD-014-API001: a wallet check's answer must be a WalletMatch", () => {
  function dateSearch(walletCheck?: WalletCheck): DateSearch {
    return new DateSearch({
      indexes: MASKED,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
      keep: 1,
      ...(walletCheck === undefined ? {} : { walletCheck }),
    });
  }

  it.each(MALFORMED_ANSWERS)("the date search refuses %s", async (_, answer) => {
    await expect(dateSearch(answering(answer)).run()).rejects.toThrow(MALFORMED_WALLET_ANSWER);
  });

  it("the date search counts only matched === true, and lists every phrase without a check", async () => {
    expect((await dateSearch(answering({ matched: false })).run()).matchCount).toBe(0);
    expect((await dateSearch(answering({ matched: true })).run()).matchCount).toBe(1);
    // An answer that may come later, as a page's derivation does.
    expect((await dateSearch(async () => ({ matched: true })).run()).matchCount).toBe(1);
    const listed = await dateSearch().run();
    expect(listed.matchCount).toBe(1);
    expect(listed.shown[0]?.mnemonic).toBe(PHRASE);
  });

  const wordSearch = () => WordCandidateSearch.parse(`${"abandon ".repeat(11)}?`, "unknown-words");

  it.each(MALFORMED_ANSWERS)("the word search refuses %s", async (_, answer) => {
    await expect(wordSearch().run({ walletCheck: answering(answer) })).rejects.toThrow(
      MALFORMED_WALLET_ANSWER,
    );
  });

  it("the word search counts only matched === true", async () => {
    const byPhrase: WalletCheck = (mnemonic) => ({ matched: mnemonic === PHRASE });
    const result = await wordSearch().run({ walletCheck: byPhrase });
    expect(result.count).toBe(128);
    expect(result.matched).toBe(1);
    expect((await wordSearch().run({ walletCheck: answering({ matched: false }) })).matched).toBe(
      0,
    );
    expect((await wordSearch().run()).matched).toBe(0);
  });

  /** The marked codes of the phrase without Seedshift, its last code unread. */
  const markedSearch = () =>
    new MissingCodesSearch(
      MissingCodes.read(`${"abandon ".repeat(11)}?`, "english", "direct"),
      () => "00000000",
    );

  it.each(MALFORMED_ANSWERS)("the search of marked codes refuses %s", async (_, answer) => {
    await expect(markedSearch().byWallet(answering(answer)).run()).rejects.toThrow(
      MALFORMED_WALLET_ANSWER,
    );
  });

  it("the search of marked codes finds only the codes that matched === true", async () => {
    const byPhrase: WalletCheck = (mnemonic) => ({ matched: mnemonic === PHRASE });
    const found = await markedSearch().byWallet(byPhrase).run();
    expect(found.kind).toBe("found");
    if (found.kind === "found") expect(found.backup.text()).toBe(PHRASE);
    expect(
      (
        await markedSearch()
          .byWallet(answering({ matched: false }))
          .run()
      ).kind,
    ).toBe("none");
  });
});

describe("AUD-014-API005: dates without Seedshift are refused, never dropped", () => {
  it("refuses dates in Masking.encode and undo, and in EncodedBackup.decode, without Seedshift", () => {
    const direct = Masking.of("direct");
    expect(() => direct.encode(PHRASE, [DATE])).toThrow(DATE_COUNT_WORDS.codes.direct);
    expect(() => direct.undo(MASKED, [DATE])).toThrow(DATE_COUNT_WORDS.codes.direct);
    expect(() => direct.held(PHRASE, [DATE])).toThrow(DATE_COUNT_WORDS.codes.direct);
    const backup = EncodedBackup.read(PHRASE, "english", "direct");
    expect(() => backup.decode([DATE])).toThrow(DATE_COUNT_WORDS.codes.direct);
    expect(() => backup.candidates([DATE])).toThrow(DATE_COUNT_WORDS.codes.direct);
  });

  it("keeps the well-formed calls and the refusal of a masking without dates", () => {
    const direct = Masking.of("direct");
    expect(direct.encode(PHRASE, []).shiftedEnglish.join(" ")).toBe(PHRASE);
    expect(EncodedBackup.read(PHRASE, "english", "direct").decode([]).recoveredMnemonic).toBe(
      PHRASE,
    );
    const seedshift = Masking.of("seedshift");
    expect(seedshift.encode(PHRASE, [DATE]).shiftedIndexes).toEqual(MASKED);
    expect(seedshift.undo(MASKED, [DATE])[0]?.recoveredMnemonic).toBe(PHRASE);
    // The shifts refuse a masking without dates in their own words, as before.
    expect(() => seedshift.encode(PHRASE, [])).toThrow(NO_DATE);
    expect(() => seedshift.undo(MASKED, [])).toThrow(NO_DATE);
  });
});

describe("AUD-014-API006: MissingCodes refuses a mode that names none when it is built", () => {
  const marked = `${"abandon ".repeat(11)}?`;

  it("refuses an unknown mode in read and in withMode", () => {
    expect(() => MissingCodes.read(marked, "english", "unknown" as MaskingMode)).toThrow(
      "Unsupported Seedshift mode.",
    );
    const codes = MissingCodes.read(marked, "english", "direct");
    expect(() => codes.withMode("unknown" as MaskingMode)).toThrow("Unsupported Seedshift mode.");
  });

  it("keeps every mode that names one, and the guards of the places", () => {
    for (const mode of Masking.MODES)
      expect(MissingCodes.read(marked, "english", mode).mode).toBe(mode);
    expect(() => MissingCodes.read(PHRASE, "english", "direct")).toThrow(/No code is marked/u);
  });
});

describe("AUD-014-API007: JSON writes every form from the indexes", () => {
  it("writes the same words and Unicode codes as the text forms, whatever is stored", () => {
    const raw = representMnemonic(PHRASE);
    const stale = { ...raw, shiftedEnglish: ["zoo"], unicodeCodePoints: ["0000"] };
    const json = JSON.parse(formatEncoded(stale, "json")) as {
      english: string[];
      unicodeCodePoints: string;
    };
    expect(json.english.join(" ")).toBe(formatEncoded(stale, "english"));
    expect(json.english).toHaveLength(12);
    expect(json.unicodeCodePoints).toBe(formatEncoded(stale, "unicode"));
  });

  it("keeps the JSON of a healthy result, its fields and its dates", () => {
    const result = encodeMnemonic(PHRASE, [DATE]);
    const json = JSON.parse(formatEncoded(result, "json")) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      "algorithm",
      "dates",
      "shifts",
      "english",
      "indexes",
      "unicodeCodePoints",
    ]);
    expect(json.english).toEqual(result.shiftedEnglish);
    expect(json.unicodeCodePoints).toBe(result.unicodeCodePoints.join(""));
    expect(json.dates).toEqual(["23-09-2026"]);
    expect(json.shifts).toEqual(result.shifts);
  });
});

describe("AUD-014 recommendations 1 and 2: one rule for index lists and counts", () => {
  it("tests a list of word indexes, holes and bounds included", () => {
    expect(areWordIndexes([0, 2047])).toBe(true);
    expect(areWordIndexes([0, 2048])).toBe(false);
    expect(areWordIndexes([0, -1])).toBe(false);
    expect(areWordIndexes([0, 1.5])).toBe(false);
    expect(areWordIndexes(withHoles([0, 0, 1], 1))).toBe(false);
  });

  it("keeps the refusals of a candidate and of a missing-word search in their own words", () => {
    const words = [...Array<number>(11).fill(0), 3];
    expect(new WordCandidate(1, words).phrase).toBe(PHRASE);
    expect(() => new WordCandidate(0, words)).toThrow(
      new RangeError("A candidate's number counts from 1."),
    );
    expect(() => new WordCandidate(1.5, words)).toThrow(RangeError);
    const sparse = [...words];
    withHoles(sparse, 4);
    expect(() => new WordCandidate(1, sparse)).toThrow(
      "A candidate needs 12, 15, 18, 21 or 24 BIP39 indexes.",
    );
    expect(() => new WordCandidate(1, [...words.slice(0, -1), 2048])).toThrow(
      "A candidate needs 12, 15, 18, 21 or 24 BIP39 indexes.",
    );
    const written = Array<number>(11).fill(0);
    expect(WordCandidateSearch.of({ kind: "missing-word", written }).wordCount).toBe(12);
    expect(() =>
      WordCandidateSearch.of({ kind: "missing-word", written: [...written.slice(1), 2048] }),
    ).toThrow("A written word is not a BIP39 index.");
  });

  it("refuses a progress step below 1 with its message", async () => {
    const search = new DateSearch({
      indexes: MASKED,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
    });
    await expect(search.run({ progressEvery: 0 })).rejects.toThrow(
      new RangeError("progressEvery must be a whole number of 1 or more."),
    );
    expect((await search.run({ progressEvery: 1 })).matchCount).toBe(1);
  });
});

describe("AUD-014 recommendation 3: CashAddr's size from Bech32's groups", () => {
  it("recognizes a prefixed CashAddr of a 160-bit hash, and no other length", () => {
    // The CashAddr specification's example for 1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu.
    const cashaddr = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
    expect(writtenAsAnAddress(cashaddr)).toBe(true);
    expect(writtenAsAnAddress(cashaddr.slice(0, -1))).toBe(false);
    expect(writtenAsAnAddress(`${cashaddr}q`)).toBe(false);
  });
});

describe("AUD-014 recommendation 4: the last word's entropy, one rule", () => {
  it("gives the values the last word's entropy takes, and the checksum's pass share", () => {
    expect(BIP39_WORD_COUNTS.map(lastWordEntropyValues)).toEqual([128, 64, 32, 16, 8]);
    expect(BIP39_WORD_COUNTS.map(checksumPassShare)).toEqual([
      1 / 16,
      1 / 32,
      1 / 64,
      1 / 128,
      1 / 256,
    ]);
  });

  it("keeps every mode's search costs and last-word modulus", () => {
    // Fixed expected values: 2048 without a shift of the entropy alone, 2^(11 - bits) with one.
    const table = Masking.MODES.map((mode) => {
      const masking = Masking.of(mode);
      return [
        mode,
        BIP39_WORD_COUNTS.map((words) => masking.lastShiftModulus(words)),
        BIP39_WORD_COUNTS.map((words) => masking.checksPerCombination(words)),
      ];
    });
    expect(table).toEqual([
      ["direct", [2048, 2048, 2048, 2048, 2048], [0, 0, 0, 0, 0]],
      ["seedshift", [128, 64, 32, 16, 8], [1, 1, 1, 1, 1]],
      [
        "seedshift-legacy",
        [2048, 2048, 2048, 2048, 2048],
        [1 / 16, 1 / 32, 1 / 64, 1 / 128, 1 / 256],
      ],
      ["seedshift-legacy-valid", [1, 1, 1, 1, 1], [128, 64, 32, 16, 8]],
    ]);
  });
});

describe("AUD-014 recommendation 5: one rule for a record's metadata against a host's", () => {
  it("names a conflict only where both are given and differ", () => {
    expect(modeConflictOf("seedshift", "direct")).toBe(
      "The record was made with MnemoCode Seedshift, not with no Seedshift.",
    );
    expect(modeConflictOf("seedshift", "seedshift")).toBeUndefined();
    expect(modeConflictOf(undefined, "direct")).toBeUndefined();
    expect(modeConflictOf("direct", undefined)).toBeUndefined();
    expect(formatConflictOf("english", "colors")).toBe(
      "The record holds english codes, not colors.",
    );
    expect(formatConflictOf("english", "english")).toBeUndefined();
    expect(formatConflictOf(undefined, "colors")).toBeUndefined();
  });
});

describe("AUD-014 recommendations 7 and 9: counts kept once, one match kept", () => {
  it("tells the same combinations each time", () => {
    const answer = DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true });
    expect(answer.combinations).toBe(10);
    expect(answer.combinations).toBe(10);
  });

  /** The masked codes with their third code unread, and the day of the date forgotten. */
  const markedWithDates = () => {
    const words = encodeMnemonic(PHRASE, [DATE]).shiftedEnglish.map((word, index) =>
      index === 2 ? "?" : word,
    );
    return {
      search: new MissingCodesSearch(
        MissingCodes.read(words.join(" "), "english", "seedshift"),
        () => "00000000",
      ),
      dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
    };
  };

  it("gives the one set that matched with its dates, and only a count for several", async () => {
    const { search, dates } = markedWithDates();
    const byPhrase: WalletCheck = (mnemonic) => ({ matched: mnemonic === PHRASE });
    const found = await search.byWallet(byPhrase, dates).run();
    expect(found.kind).toBe("found");
    if (found.kind === "found") {
      expect(found.backup.indexes).toEqual(MASKED);
      expect(found.foundDates).toBe("23-09-2026");
    }
    const several = await search.byWallet(answering({ matched: true }), dates).run();
    expect(several.kind).toBe("several");
    // Seedshift gives a valid phrase for every date, so each candidate of the codes passes.
    if (several.kind === "several")
      expect(several.count).toBe([...search.codes.candidates()].length);
  });
});

describe("AUD-014 observations: a stop during the host's answer, and the checksum of a host's indexes", () => {
  /** A wallet check that matches and stops the search while it answers, as a host may. */
  function stoppingCheck(controller: AbortController): WalletCheck {
    return async () => {
      controller.abort(new Error("stopped while answering"));
      return { matched: true };
    };
  }

  it("publishes nothing that the date search found after the host stopped it", async () => {
    const controller = new AbortController();
    const published: string[] = [];
    const search = new DateSearch({
      indexes: MASKED,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
      keep: 1,
      walletCheck: stoppingCheck(controller),
    });
    // A stop is a result, not an error (CORE-22): stopped, with nothing published or kept.
    const result = await search.run({
      signal: controller.signal,
      onMatch: (match) => published.push(match.mnemonic),
    });
    expect(result).toMatchObject({ stopped: true, matchCount: 0, shown: [], kept: [] });
    expect(published).toEqual([]);
  });

  it("stops the word search and the search of marked codes the same way", async () => {
    const words = new AbortController();
    const found = await WordCandidateSearch.parse(`${"abandon ".repeat(11)}?`, "unknown-words").run(
      { walletCheck: stoppingCheck(words), signal: words.signal },
    );
    expect(found).toMatchObject({ stopped: true, count: 0, matched: 0, shown: [], entropies: [] });
    const codes = new AbortController();
    const result = await new MissingCodesSearch(
      MissingCodes.read(`${"abandon ".repeat(11)}?`, "english", "direct"),
      () => "00000000",
    )
      .byWallet(stoppingCheck(codes))
      .run({ signal: codes.signal });
    expect(result).toEqual({ kind: "stopped" });
  });

  it("refuses an index that names no word instead of answering for its checksum", () => {
    const words = [...Array<number>(11).fill(0), 3];
    expect(checksumValid(words)).toBe(true);
    const outOfRange = [2048, ...words.slice(1)];
    expect(() => checksumValid(outOfRange)).toThrow("Every BIP39 index");
    expect(() => checksumValid(words.slice(1))).toThrow("word indexes");
  });
});
