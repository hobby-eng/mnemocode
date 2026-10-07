import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { EncodedBackupCheck, ShareBackupCheck } from "../src/core/backup-check.js";
import { NoProtection, PassphraseProtection } from "../src/core/candidate-encryption.js";
import { encodeCandidateList } from "../src/core/candidate-list.js";
import { parseUnknownWords, WordCandidateSearch } from "../src/core/candidates.js";
import { colorsToIndexes, colorsToUnicode, indexesToColors } from "../src/core/colors.js";
import { DatesAnswer, DateSearch } from "../src/core/date-search.js";
import { datePatternCombinations } from "../src/core/dates.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { Masking } from "../src/core/masking.js";
import { encodeMnemonicLegacy, legacyChecksumValidResult } from "../src/core/seedshift.js";
import type { DatePattern } from "../src/core/types.js";
import { resolvePresentationFor } from "../src/export/card-copy.js";
import { resolveIdentityFor } from "../src/export/card-identities.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { JointRepair } from "../src/sskr/joint-repair.js";
import { RepairReport } from "../src/sskr/repair-report.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareExport, ShareSet } from "../src/sskr/share-set.js";
import { ShareSplit } from "../src/sskr/split.js";
import { writeShare } from "../src/sskr/transport.js";
import { pageOperators } from "./helpers/pdf-content.js";

// Public data only: the all-zero entropy's phrase, synthetic dates, and the public SSKR vectors.
const PHRASE = `${"abandon ".repeat(11)}about`;
const TEXTS = { decodeEntry: "Decode" };
const DATE = { year: 2026, month: 9, day: 23 };
const SHARES = (
  JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    readonly deterministic: readonly { readonly shares: readonly string[] }[];
  }
).deterministic[0]!.shares;
/** A class whose constructor TypeScript calls private, as a JavaScript host can still call it. */
type Constructible<T> = new (...args: unknown[]) => T;

describe("AUD-009-FUN001: objects own the dates they were given", () => {
  it("keeps a complete date as built, whatever the caller does with its own object", () => {
    const date = { year: 2026, month: 9, day: 23 };
    const answer = DatesAnswer.of([date]);
    date.day = 24;
    expect(answer.known).toEqual([{ year: 2026, month: 9, day: 23 }]);
    // What the getter hands out is frozen: changing it fails and changes nothing.
    expect(() => Object.assign(answer.known[0]!, { day: 25 })).toThrow(TypeError);
    expect(answer.known[0]!.day).toBe(23);
  });

  it("keeps a pattern within the limit it was checked against", () => {
    const answer = DatesAnswer.parse("??-??-2026", { patterns: true, wordCount: 12 });
    const search = new DateSearch({
      indexes: [...Array<number>(11).fill(0), 3],
      dates: answer,
      mode: "seedshift",
    });
    const before = search.combinations;
    expect(() => (answer.patterns[0]!.years as number[]).push(2025)).toThrow(TypeError);
    expect(() => (answer.patterns[0]!.days as number[]).push(1)).toThrow(TypeError);
    // A pattern given to `of` is copied, so the caller's array may grow without effect.
    const pattern = { key: "2026-09-??", years: [2026], months: [9], days: [1, 2, 3] };
    const own = DatesAnswer.of([], [pattern]);
    pattern.days.push(4, 5, 6);
    expect(own.combinations).toBe(3);
    expect(search.combinations).toBe(before);
  });

  it("approves a share backup only when its dates really give the phrase back", async () => {
    const date = { year: 2026, month: 9, day: 23 };
    const masked = Masking.of("seedshift").encode(PHRASE, [date]).shiftedEnglish.join(" ");
    const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(
      masked,
      2,
      3,
    );
    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "seedshift", threshold: 2, dates: [date] },
      nodeSharePlatform,
      TEXTS,
    );
    const backup = shares.slice(0, 2).join(";");
    expect((await check.check({ backup, dates: "23-09-2026" })).verdict).toBe("restores");
    // The caller changes its date object afterwards: the check still holds the date of the result.
    date.day = 24;
    expect((await check.check({ backup, dates: "24-09-2026" })).verdict).not.toBe("restores");
    expect((await check.check({ backup, dates: "23-09-2026" })).verdict).toBe("restores");
  });
});

describe("AUD-009-API001: DatesAnswer.of holds dates to the rules of parse", () => {
  it("refuses a day the calendar does not have, naming its place", () => {
    expect(() => DatesAnswer.of([{ year: 2026, month: 2, day: 31 }])).toThrow(/^Date 1: /u);
    expect(() =>
      DatesAnswer.of([
        { year: 2026, month: 9, day: 23 },
        { year: 2026, month: 13, day: 1 },
      ]),
    ).toThrow(/^Date 2: /u);
  });

  it("refuses a pattern that no date fits", () => {
    expect(() => DatesAnswer.of([], [{ key: "empty", years: [], months: [1], days: [1] }])).toThrow(
      /^Date 1: .*valid year/u,
    );
    expect(() =>
      DatesAnswer.of([], [{ key: "2026-02-3?", years: [2026], months: [2], days: [30, 31] }]),
    ).toThrow(/real calendar date/u);
    expect(() =>
      DatesAnswer.of([], [{ key: "bad", years: [2026], months: [0], days: [1] }]),
    ).toThrow(/valid month/u);
  });

  it("accepts a leap day and an ordinary pattern", () => {
    expect(DatesAnswer.of([{ year: 2024, month: 2, day: 29 }]).known).toHaveLength(1);
    const answer = DatesAnswer.of(
      [{ year: 2026, month: 9, day: 23 }],
      [{ key: "2026-09-??", years: [2026], months: [9], days: [1, 2] }],
    );
    expect(answer.combinations).toBe(2);
  });
});

describe("AUD-009-API002: EncodedBackup.of refuses index arrays with holes", () => {
  it("refuses sparse, partly sparse, undefined and out-of-range indexes", () => {
    const dense = Array.from({ length: 12 }, () => 0);
    const partly = [...dense];
    delete partly[5];
    for (const indexes of [
      new Array<number>(12),
      partly,
      [...dense.slice(0, 11), undefined as unknown as number],
      [...dense.slice(0, 11), 2048],
    ])
      expect(() => EncodedBackup.of(indexes, "indexes", "direct")).toThrow(/integer from 0/u);
  });

  it("still reads dense codes in every mode", () => {
    const encoded = Masking.of("seedshift").encode(PHRASE, [{ year: 2026, month: 9, day: 23 }]);
    expect(EncodedBackup.of(encoded.shiftedIndexes, "indexes", "seedshift").indexes).toEqual(
      encoded.shiftedIndexes,
    );
    expect(
      EncodedBackup.of(
        Array.from({ length: 12 }, () => 0),
        "indexes",
        "seedshift-legacy",
      ).mode,
    ).toBe("seedshift-legacy");
  });
});

// The follow-up of AUD-009: the other ways in which a library object could hold, or hand out,
// what its caller can still change, and the other lists whose holes were skipped.

describe("AUD-009 follow-up: every DatesAnswer holds the limits it was checked against", () => {
  const days = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

  it("refuses patterns with one key that allow other dates, which were counted wrongly", () => {
    // The count took the last pattern of a key, and the search skipped every combination whose
    // later date came first: here it counted 1 and tried none.
    expect(() =>
      DatesAnswer.of(
        [],
        [
          { key: "k", years: [2026], months: [9], days: [23] },
          { key: "k", years: [2020], months: [1], days: [1] },
        ],
      ),
    ).toThrow(/^Date 2: its pattern has the key of an earlier one that allows other dates\.$/u);
    // The same dates in another order are the same pattern.
    const same = DatesAnswer.of(
      [],
      [
        { key: "k", years: [2026], months: [9], days: [1, 2] },
        { key: "k", years: [2026], months: [9], days: [2, 1] },
      ],
    );
    expect(same.combinations).toBe([...datePatternCombinations(same.patterns)].length);
  });

  it("counts a value given twice once, so that the search tries what it counted", () => {
    const twice: DatePattern = { key: "d", years: [2026, 2026], months: [9, 9], days: [23, 23] };
    const answer = DatesAnswer.of([], [twice, twice, twice]);
    // Before: 120 combinations counted and 512 tried.
    expect(answer.combinations).toBe(1);
    expect([...datePatternCombinations(answer.patterns)]).toHaveLength(1);
    expect(answer.patterns[0]!.days).toEqual([23]);
  });

  it("refuses a hole in the dates, which was counted as a date", () => {
    expect(() => DatesAnswer.of(new Array<typeof DATE>(2))).toThrow(
      /^Date 1: a date must have a year, a month and a day\.$/u,
    );
  });

  it("checks a date as it keeps it, also when a getter answers differently each time", () => {
    let reads = 0;
    const date = {
      year: 2026,
      month: 9,
      get day() {
        reads += 1;
        return reads === 1 ? 23 : 31;
      },
    };
    expect(DatesAnswer.of([date]).known).toEqual([DATE]);
  });

  it("holds the limits when its private constructor is called, as JavaScript can", () => {
    const Raw = DatesAnswer as unknown as Constructible<DatesAnswer>;
    const wide = { key: "????-??-??", years: days(9999), months: days(12), days: days(31) };
    // Before: an answer of 10,000,001 combinations, whose search started.
    expect(() => new Raw([], [wide, wide, wide], [1, 2, 3])).toThrow(/exceeds the safety limit/u);
    const one = { key: "2026-09-2?", years: [2026], months: [9], days: [20, 21] };
    expect(() => new Raw([], [one, one, one, one], [1, 2, 3, 4])).toThrow(
      /at most 3 incomplete dates/u,
    );
  });
});

describe("AUD-009 follow-up: codes are checked before an object holds them", () => {
  const zeros = () => Array.from({ length: 12 }, () => 0);

  it("refuses holes and codes outside the list when a date search is built", () => {
    const dates = DatesAnswer.parse("2?-09-2026", { patterns: true, wordCount: 12 });
    const partly = zeros();
    delete partly[3];
    for (const indexes of [new Array<number>(12), partly, [...zeros().slice(1), 2048]])
      expect(() => new DateSearch({ indexes, dates, mode: "seedshift" })).toThrow(
        "Every BIP39 index must be an integer from 0 through 2047.",
      );
  });

  it("checks the codes in EncodedBackup's constructor, which JavaScript can call", () => {
    const Raw = EncodedBackup as unknown as Constructible<EncodedBackup>;
    expect(() => new Raw(new Array<number>(12), "indexes", "direct")).toThrow(/integer from 0/u);
    expect(() => new Raw(zeros(), "indexes", "seedshift")).toThrow(/lack the BIP39 checksum/u);
    expect(() => new Raw(zeros(), "bad", "direct")).toThrow("Unsupported encoded format.");
  });

  it("writes no colors for indexes with holes, which were left out without a word", () => {
    const partly = zeros();
    delete partly[3];
    // Before: no colors at all, and 7 colors of wrong digits.
    expect(() => indexesToColors(new Array<number>(12))).toThrow(/integer from 0/u);
    expect(() => indexesToColors(partly)).toThrow(/integer from 0/u);
    const colors = indexesToColors(zeros());
    const holed = [...colors];
    delete holed[2];
    expect(() => colorsToUnicode(holed)).toThrow(/#RRGGBB/u);
    expect(() => colorsToIndexes(holed)).toThrow(/#RRGGBB/u);
    expect(colorsToIndexes(colors)).toEqual(zeros());
  });

  it("refuses an index above 2047 in a legacy result, which shifted every later bit", () => {
    const result = encodeMnemonicLegacy(PHRASE, [DATE]);
    const wide = { ...result, shiftedIndexes: [...result.shiftedIndexes.slice(0, 11), 4096] };
    expect(() => legacyChecksumValidResult(wide)).toThrow(/integer from 0/u);
    expect(legacyChecksumValidResult(result).shiftedIndexes).toHaveLength(12);
  });

  it("refuses a candidate list with a hole, whose header counted a record it lacked", () => {
    const entropy = new Uint8Array(16);
    const records = [{ entropy }, { entropy }, { entropy }];
    delete (records as unknown[])[1];
    expect(() => encodeCandidateList({ records })).toThrow(
      /Every candidate must be BIP39 entropy/u,
    );
  });
});

describe("AUD-009 follow-up: a backup check says restores only after a real recovery", () => {
  it("refuses a share check in a mode that shares are never made in", async () => {
    // Before: without the dates of the result, these modes compared nothing, and any shares
    // that restore passed, here as the backup of a phrase they do not hold.
    const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(
      PHRASE,
      2,
      3,
    );
    expect(shares).toHaveLength(3);
    for (const mode of ["seedshift-legacy", "seedshift-legacy-valid", "nonsense"])
      expect(
        () =>
          new ShareBackupCheck(
            { mnemonic: `${"zoo ".repeat(11)}wrong`, mode: mode as "seedshift", threshold: 2 },
            nodeSharePlatform,
            TEXTS,
          ),
      ).toThrow("Shares are made without Seedshift or with MnemoCode Seedshift.");
  });

  it("refuses a hole among the dates of the result", () => {
    const encoded = Masking.of("seedshift").encode(PHRASE, [DATE]);
    const dates = new Array<typeof DATE>(1);
    expect(
      () =>
        new EncodedBackupCheck({
          mnemonic: PHRASE,
          format: "indexes",
          mode: "seedshift",
          codes: encoded.shiftedIndexes,
          dates,
        }),
    ).toThrow("A date must have a year, a month and a day.");
    expect(
      () =>
        new ShareBackupCheck(
          { mnemonic: PHRASE, mode: "seedshift", threshold: 2, dates },
          nodeSharePlatform,
          TEXTS,
        ),
    ).toThrow("A date must have a year, a month and a day.");
  });
});

describe("AUD-009 follow-up: nothing a library object hands out changes it", () => {
  it("keeps the list of every word behind ? out of reach of the search it was given to", () => {
    const typed = `${"abandon ".repeat(11)}?`;
    const search = parseUnknownWords(typed);
    if (search.kind !== "unknown-words") throw new Error("Expected unknown words.");
    // Before: the pop took zoo from every later search with ?.
    expect(() => (search.places[11] as number[]).pop()).toThrow(TypeError);
    expect(WordCandidateSearch.parse(typed, "unknown-words").combinations).toBe(2048);
  });

  it("keeps what a candidate file's protection says of it", () => {
    for (const [protection, encrypted] of [
      [new NoProtection(), false],
      [new PassphraseProtection("synthetic list passphrase"), true],
    ] as const) {
      expect(() => Object.assign(protection, { encrypted: !encrypted })).toThrow(TypeError);
      expect(protection.encrypted).toBe(encrypted);
    }
  });

  it("keeps the shares of an export as settled, and refuses places with holes", async () => {
    const set = (await ShareSet.restore(SHARES.slice(0, 2), nodeSharePlatform)).toRepairedSet();
    const written = ShareExport.of(set, [1, 2]);
    expect(() => (written.shown as unknown[]).pop()).toThrow(TypeError);
    expect(() => Object.assign(written.shown[0]!, { number: 9 })).toThrow(TypeError);
    expect(() => (written.leftOut as number[]).push(9)).toThrow(TypeError);
    expect(written.saved.map((share) => share.number)).toEqual([1, 2]);
    expect(written.leftOutMessages()).toEqual([]);
    const partly = [1, 2];
    delete partly[1];
    for (const places of [partly, [1], [1, 0]])
      expect(() => ShareExport.of(set, places)).toThrow(
        "Each share needs its place among those typed, a whole number from 1.",
      );
  });

  it("keeps the assessment and the places that a repair report was built with", async () => {
    const colors = writeShare(SHARES[1]!, "colors").split(" ");
    colors[5] = "?";
    const plan = await new JointRepair(nodeSharePlatform).plan([SHARES[0]!, colors.join(" ")]);
    const assessment = { ...plan.assessment, helps: [...plan.assessment.helps] };
    const places = [1, 4];
    // A pace so slow that any search is asked for first.
    const report = new RepairReport(assessment, 1e-9, places);
    const lines = report.lines();
    expect(report.needsQuestion()).toBe(true);
    Object.assign(assessment, { combinations: 0, verdict: "no-fit" });
    places[1] = 7;
    // Before: the question was skipped once the caller's object said 0 combinations.
    expect(report.needsQuestion()).toBe(true);
    expect(report.combinations).toBe(plan.assessment.combinations);
    expect(report.lines()).toEqual(lines);
    expect(Object.isFrozen(report.assessment)).toBe(true);
    expect(Object.isFrozen(report.assessment.shares[0]!.forms)).toBe(true);
  });

  it("renders every card of a share set with the texts it was given at first", async () => {
    const presentation = {
      studioName: "Synthetic Studio",
      slogan: "Synthetic slogan",
      subtitle: "Synthetic subtitle",
      footer: "Synthetic footer",
      referenceLabel: "Ref.",
    };
    // Every detail given, so that no random choice tells two renders apart.
    const profile = {
      name: "Alex Morgan",
      role: "Architect",
      company: "Synthetic Works",
      email: "contact@synthetic.example",
      phone: "+44 20 7946 0281",
      website: "synthetic.example",
      location: "International",
    };
    const settings = { style: "it", presentation, profile } as const;
    // The drawing of the page; the bytes of the file differ from one render to the next.
    const drawn = async (cards: ShareCardSet) =>
      pageOperators(await PDFDocument.load(await cards.renderShare(0)), 0);
    const cards = new ShareCardSet([SHARES[0]!], settings);
    const first = await drawn(cards);
    presentation.studioName = "Another Studio";
    // Before: the later render showed the caller's new studio name.
    expect(await drawn(cards)).toBe(first);
    // The name is printed: a set built with the new one draws another page.
    expect(await drawn(new ShareCardSet([SHARES[0]!], settings))).not.toBe(first);
  });

  it("hands out the details settled for an export frozen, as every page shares them", () => {
    const settings = {};
    expect(Object.isFrozen(resolvePresentationFor(settings))).toBe(true);
    expect(Object.isFrozen(resolveIdentityFor(settings))).toBe(true);
    expect(resolveIdentityFor(settings)).toBe(resolveIdentityFor(settings));
  });
});
