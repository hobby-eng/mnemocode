// AUD-010-ARC001: the search of codes marked with ? as a library class, which the command line and
// a page drive alike: the ways that fit, the plan of each, and what each finds.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  legacyChecksumValidResult,
  parseDate,
  representMnemonic,
} from "../src/core.js";
import { defined } from "../src/core/defined.js";
import { DatesAnswer } from "../src/core/date-search.js";
import {
  foundAmongOthers,
  MISSING_CODES_TEXTS,
  MissingCodesSearch,
  type PhraseFingerprint,
} from "../src/core/missing-codes-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import type { WalletCheck } from "../src/core/wallet-check.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

// Public test data only: the phrase "abandon ... about", masked with one public date.
const DATE = "23-09-2026";
const ENCODED = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);
const ENCODED_PHRASE = ENCODED.shiftedEnglish.join(" ");

/** A stand-in for the host's fingerprint, which answers later as a page's WebCrypto does. */
const fingerprint: PhraseFingerprint = async (mnemonic) =>
  createHash("sha256").update(mnemonic).digest("hex").slice(0, 8);
/** The wallet of the test phrase, known by its phrase. */
const wallet: WalletCheck = async (mnemonic) => ({ matched: mnemonic === TEST_PHRASE, path: "m" });

/** The codes of `result` as word numbers, with those at `places` (from 0) marked with ?. */
function marked(codes: string, places: readonly number[]): string {
  const parts = codes.split(" ");
  for (const place of places) parts[place] = "?";
  return parts.join(" ");
}

/**
 * The masked codes with the last digit of the second and the third forgotten: 10 and 24 become
 * 1? and 2?, a hundred combinations of which a few keep the checksum, few enough to list.
 */
const FEW = "2027 1? 2? 2027 10 24 2027 10 24 2027 10 377";
/**
 * The masked codes with the last digit of the third forgotten: one candidate keeps the checksum.
 */
const ONE = "2027 10 2? 2027 10 24 2027 10 24 2027 10 377";

const MASKED_TEXT = formatEncoded(ENCODED, "indexes");

describe("MissingCodesSearch (core/missing-codes-search.ts)", () => {
  it("offers the ways that fit the codes, and says what cannot be read", () => {
    const one = new MissingCodesSearch(
      MissingCodes.read(marked(MASKED_TEXT, [2]), "indexes", "seedshift"),
      fingerprint,
    );
    expect(one.unreadable).toBe("Code 3 cannot be read: 2,048 combinations, about 128 candidates.");
    expect(one.many).toBe(true);
    expect(one.ways.map(({ way }) => way)).toEqual(["encoded", "wallet"]);
    expect(one.fits("list")).toBe(false);
    // A forgotten digit leaves few candidates, which a list shows.
    const few = new MissingCodesSearch(MissingCodes.read(FEW, "indexes", "seedshift"), fingerprint);
    expect(few.ways.map(({ way }) => way)).toEqual(["encoded", "wallet", "list"]);
    // Without Seedshift the encoded fingerprint is the wallet's own: it is not offered, but fits.
    const plain = MissingCodes.read(
      marked(formatEncoded(representMnemonic(TEST_PHRASE), "indexes"), [2]),
      "indexes",
      "direct",
    );
    const direct = new MissingCodesSearch(plain, fingerprint);
    expect(direct.ways.map(({ way }) => way)).toEqual(["wallet"]);
    expect(direct.fits("encoded")).toBe(true);
    expect(direct.needsDates).toBe(false);
    // The Original Seedshift keeps no checksum: no fingerprint of the codes tells them.
    const legacy = new MissingCodesSearch(
      MissingCodes.read(marked(MASKED_TEXT, [2]), "indexes", "seedshift-legacy"),
      fingerprint,
    );
    expect(legacy.fits("encoded")).toBe(false);
    // The last digit of three codes forgotten, few enough to search.
    const digits = MASKED_TEXT.split(" ").map((code, place) =>
      [1, 5, 8].includes(place) ? `${code.slice(0, -1)}?` : code,
    );
    const three = MissingCodes.read(digits.join(" "), "indexes", "seedshift");
    expect(MissingCodesSearch.placesText(three)).toBe("Codes 2, 6 and 9");
    // A missing fingerprint, which no type allows, fed on purpose as a JavaScript host could.
    expect(() => new MissingCodesSearch(plain, undefined as never)).toThrow(TypeError);
  });

  it("finds the codes by the encoded fingerprint, without dates", async () => {
    const search = new MissingCodesSearch(
      MissingCodes.read(marked(MASKED_TEXT, [2]), "indexes", "seedshift"),
      fingerprint,
    );
    const way = search.byEncodedFingerprint(await fingerprint(ENCODED_PHRASE));
    const plan = await way.plan();
    expect(plan).toMatchObject({ size: "128 candidates", count: 128, ask: false });
    // A limit below the candidates asks first.
    expect((await way.plan(100)).ask).toBe(true);
    const progress: number[] = [];
    const found = await way.run({ onProgress: ({ checked }) => progress.push(checked) });
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.backup.indexes).toEqual(ENCODED.shiftedIndexes);
    expect(found.dates).toBeUndefined();
    const none = await search.byEncodedFingerprint("00000000").run();
    expect(none).toEqual({ kind: "none", message: MISSING_CODES_TEXTS.noneByFingerprint });
    // A fingerprint as a person types it, in capitals and with spaces, is read as every one is
    // (scan finding S004); one that is no fingerprint is refused when the way is made.
    const typed = ` ${(await fingerprint(ENCODED_PHRASE)).toUpperCase()} `;
    expect((await search.byEncodedFingerprint(typed).run()).kind).toBe("found");
    expect(() => search.byEncodedFingerprint("not hex")).toThrow("eight hexadecimal characters");
  });

  it("finds the codes and the forgotten digit of the date together by the wallet", async () => {
    const search = new MissingCodesSearch(
      MissingCodes.read(ONE, "indexes", "seedshift"),
      fingerprint,
    );
    const dates = DatesAnswer.parse("23-09-202?", { wordCount: 12, patterns: true });
    const way = search.byWallet(wallet, dates);
    const plan = await way.plan();
    expect(plan.size).toBe("1 candidate with 10 date combinations each");
    expect(plan.count).toBe(10);
    const found = await way.run();
    expect(found).toMatchObject({ kind: "found", foundDates: DATE });
    if (found.kind !== "found") return;
    expect(found.backup.indexes).toEqual(ENCODED.shiftedIndexes);
    expect(found.dates).toEqual([parseDate(DATE)]);
    // With the dates complete, the codes alone are searched.
    const known = DatesAnswer.parse(DATE, { wordCount: 12, patterns: true });
    expect(await search.byWallet(wallet, known).run()).toMatchObject({
      kind: "found",
      dates: [parseDate(DATE)],
    });
    // Another wallet: none, and the message says what to check.
    const other: WalletCheck = () => ({ matched: false });
    expect(await search.byWallet(other, known).run()).toEqual({
      kind: "none",
      message: MISSING_CODES_TEXTS.noneByWallet,
    });
  });
});

describe("MissingCodesSearch (core/missing-codes-search.ts)", () => {
  it("counts two sets of dates of one set of codes as two sets, either first (AUD-037-FUN001)", async () => {
    const search = new MissingCodesSearch(
      MissingCodes.read(ONE, "indexes", "seedshift"),
      fingerprint,
    );
    const dates = (): DatesAnswer =>
      DatesAnswer.parse("23-09-202?", { wordCount: 12, patterns: true });
    // The phrases that the wallet is asked about, a year of the date after another.
    const asked: string[] = [];
    await search
      .byWallet(async (mnemonic) => {
        asked.push(mnemonic);
        return { matched: false };
      }, dates())
      .run();
    const others = asked.filter((phrase) => phrase !== TEST_PHRASE);
    expect(others).toHaveLength(9);
    // A wallet check that another date passes too, by chance, before the true one or after it.
    for (const chance of [others[0], others.at(-1)]) {
      const two: WalletCheck = async (mnemonic) => ({
        matched: mnemonic === TEST_PHRASE || mnemonic === chance,
        path: "m",
      });
      expect(await search.byWallet(two, dates()).run()).toEqual({
        kind: "several",
        count: 2,
        message: "2 sets of codes and dates fit; the wallet tells which is yours.",
      });
    }
  });

  it("offers a list only where the phrases of every set of codes fit in it (AUD-037-FUN002)", () => {
    // Each set of codes in the Original Seedshift with a valid last word gives a phrase for every
    // value of the last word's entropy: 128 for 12 words, 8 for 24.
    const offered = (phrase: string): boolean => {
      const encoded = legacyChecksumValidResult(encodeMnemonicLegacy(phrase, [parseDate(DATE)]));
      const codes = formatEncoded(encoded, "indexes").split(" ");
      codes[3] = `${defined(codes[3]).slice(0, -1)}?`;
      const read = MissingCodes.read(codes.join(" "), "indexes", "seedshift-legacy-valid");
      return new MissingCodesSearch(read, fingerprint).fits("list");
    };
    expect(offered(TEST_PHRASE)).toBe(false);
    expect(offered(`${"abandon ".repeat(23)}art`)).toBe(true);
    // Its texts count the sets of codes as candidates, and say the phrases they give.
    const encoded = legacyChecksumValidResult(encodeMnemonicLegacy(TEST_PHRASE, [parseDate(DATE)]));
    const codes = formatEncoded(encoded, "indexes").split(" ");
    codes[3] = `${defined(codes[3]).slice(0, -1)}?`;
    using read = MissingCodes.read(codes.join(" "), "indexes", "seedshift-legacy-valid");
    const search = new MissingCodesSearch(read, fingerprint);
    expect(search.unreadable).toBe(
      "Code 4 cannot be read: 10 combinations, about 1 candidate, which gives about 128 phrases.",
    );
    expect(search.whyNot("list")).toMatch(
      /^A list holds at most 16 phrases; these codes give about [\d,]+ phrases\.$/u,
    );
  });

  it("names the phrases where more fit than a list holds, which the estimate offered (AUD-037-FUN002)", async () => {
    // 24 words: each set of codes gives 8 phrases. With the last digit of codes 1 and 12 unread,
    // the estimate is one set, 8 phrases, but 3 sets fit, which give 24.
    const encoded = legacyChecksumValidResult(
      encodeMnemonicLegacy(`${"abandon ".repeat(23)}art`, [parseDate(DATE)]),
    );
    const codes = formatEncoded(encoded, "indexes").split(" ");
    for (const place of [0, 11]) codes[place] = `${defined(codes[place]).slice(0, -1)}?`;
    using read = MissingCodes.read(codes.join(" "), "indexes", "seedshift-legacy-valid");
    const search = new MissingCodesSearch(read, fingerprint);
    expect(search.unreadable).toBe(
      "Codes 1 and 12 cannot be read: 100 combinations, about 1 candidate, which gives about 8 phrases.",
    );
    expect(search.fits("list")).toBe(true);
    const listing = search.listed([parseDate(DATE)]).run();
    await expect(listing).rejects.toMatchObject({
      code: "core.missing-codes-search.list-overflow",
    });
    await expect(listing).rejects.toThrow(/^More than 16 phrases fit these codes and dates\./u);
  });

  it("finds one phrase that several sets of codes and dates give, and says so", async () => {
    // The last code unread and the day of the last date forgotten: that date moves only the last
    // words, so that other last codes with other days give the same phrase, which no wallet tells
    // apart.
    const known = ["01-01-2001", "01-01-2002", "01-01-2003"];
    const encoded = encodeMnemonic(TEST_PHRASE, [...known, "09-12-2030"].map(parseDate));
    const search = new MissingCodesSearch(
      MissingCodes.read(marked(formatEncoded(encoded, "indexes"), [11]), "indexes", "seedshift"),
      fingerprint,
    );
    const dates = DatesAnswer.parse([...known, "0?-12-2030"].join(" "), {
      wordCount: 12,
      patterns: true,
    });
    const found = await search.byWallet(wallet, dates).run();
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    // Each of the other eight days with its own last code gives the same phrase.
    expect(found.others).toBe(8);
    expect(foundAmongOthers(8)).toMatch(/^9 sets of codes and dates give this phrase;/u);
  });

  it("lists every candidate with its phrase and fingerprint where they are few", async () => {
    const search = new MissingCodesSearch(
      MissingCodes.read(FEW, "indexes", "seedshift"),
      fingerprint,
    );
    const listed = await search.listed([parseDate(DATE)]).run();
    expect(listed.kind).toBe("list");
    if (listed.kind !== "list") return;
    // Of the hundred combinations, five keep the checksum of MnemoCode Seedshift.
    expect(listed.rows).toHaveLength(5);
    const right = listed.rows.find((row) => row.phrase === TEST_PHRASE)!;
    expect(right.codes).toBe(MASKED_TEXT);
    expect(right.fingerprint).toBe(await fingerprint(TEST_PHRASE));
    const many = new MissingCodesSearch(
      MissingCodes.read(marked(MASKED_TEXT, [2]), "indexes", "seedshift"),
      fingerprint,
    );
    expect(() => many.listed([])).toThrow("at most 16 candidates");
  });

  it("says when several sets fit, which the wallet tells apart", async () => {
    // Every candidate fits a check that takes them all.
    const search = new MissingCodesSearch(
      MissingCodes.read(FEW, "indexes", "seedshift"),
      fingerprint,
    );
    const everyone: WalletCheck = () => ({ matched: true });
    const known = DatesAnswer.parse(DATE, { wordCount: 12, patterns: true });
    expect(await search.byWallet(everyone, known).run()).toEqual({
      kind: "several",
      count: 5,
      message: "5 sets of codes fit; the wallet tells which is yours.",
    });
  });

  it("stops at the host's signal", async () => {
    const search = new MissingCodesSearch(
      MissingCodes.read(marked(MASKED_TEXT, [2]), "indexes", "seedshift"),
      fingerprint,
    );
    const stop = new AbortController();
    stop.abort();
    // A stop is a result, not an error (CORE-22).
    expect(await search.byEncodedFingerprint("00000000").run({ signal: stop.signal })).toEqual({
      kind: "stopped",
    });
  });
});
