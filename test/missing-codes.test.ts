import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeMnemonic, formatEncoded, parseDate } from "../src/core.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { MasterFingerprintCheck } from "../src/core/master-fingerprint.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { englishWordlist } from "../src/core/words.js";
import "../src/sskr/share-platform-node.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { writeShare } from "../src/sskr/transport.js";

// Public test data only: the phrase "abandon ... about", masked with one public date.
const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
const DATE = parseDate("23-09-2026");
const ENCODED = encodeMnemonic(TEST_PHRASE, [DATE]);
const fingerprints = new MasterFingerprintCheck(
  (password, salt, rounds, bytes) =>
    new Uint8Array(pbkdf2Sync(password, salt, rounds, bytes, "sha512")),
);
const encodedFingerprint = fingerprints.fingerprint(ENCODED.shiftedEnglish.join(" "));
const phraseOf = (indexes: readonly number[]) =>
  indexes.map((index) => englishWordlist[index]).join(" ");

/** The codes of ENCODED in `format`, with the elements at `places` of their text as ?. */
function marked(format: Parameters<typeof formatEncoded>[1], places: readonly number[]): string {
  const text = formatEncoded(ENCODED, format);
  if (format === "unicode" || format === "colors-unicode") {
    const codes = text.match(/.{4}/gu)!;
    for (const place of places) codes[place] = "?";
    return codes.join(" ");
  }
  const parts = text.split(" ");
  for (const place of places) parts[place] = "?";
  return parts.join(" ");
}

describe("codes marked with ? (core/missing-codes.ts)", () => {
  it("finds a missing code in every form by the encoded fingerprint", async () => {
    for (const format of ["english", "indexes", "unicode", "colors", "colors-unicode"] as const) {
      const text = marked(format, [2]);
      expect(MissingCodes.marked(text)).toBe(true);
      expect(MissingCodes.formats(text), format).toContain(format);
      const codes = MissingCodes.read(text, format, "seedshift");
      expect(codes.checksummed).toBe(true);
      const result = await codes.run({
        check: (indexes) => fingerprints.fingerprint(phraseOf(indexes)) === encodedFingerprint,
      });
      expect(result.passed, format).toBe(1);
      expect(result.found[0]!.indexes, format).toEqual(ENCODED.shiftedIndexes);
      expect(String(codes)).toBe("[MissingCodes: redacted]");
    }
  }, 60_000);

  it("holds the candidates to the checksum the codes keep, and to none for the Original Seedshift", () => {
    const text = marked("indexes", [5]);
    const kept = MissingCodes.read(text, "indexes", "seedshift");
    expect(kept.missingPlaces).toEqual([6]);
    expect(kept.combinations).toBe(2048);
    // Four checksum bits for twelve words leave one in sixteen.
    expect(kept.expected).toBe(128);
    expect([...kept.candidates()].length).toBeGreaterThan(100);
    const legacy = kept.withMode("seedshift-legacy");
    expect(legacy.checksummed).toBe(false);
    expect([...legacy.candidates()]).toHaveLength(2048);
    // Codes without Seedshift are the phrase itself, which keeps its checksum.
    const direct = kept.withMode("direct");
    expect(direct.checksummed).toBe(true);
    expect(direct.expected).toBe(128);
  });

  it("reads digits and letters that narrow a code", () => {
    const words = ENCODED.shiftedEnglish.slice();
    // A beginning of a word, and one of two words.
    words[1] = `${words[1]!.slice(0, 2)}*`;
    words[4] = `${words[4]}|zoo`;
    expect(MissingCodes.read(words.join(" "), "english", "seedshift").missingPlaces).toEqual([
      2, 5,
    ]);
    const numbers = formatEncoded(ENCODED, "indexes").split(" ");
    numbers[0] = `${numbers[0]!.slice(0, -1)}?`;
    const narrowed = MissingCodes.read(numbers.join(" "), "indexes", "seedshift");
    expect(narrowed.combinations).toBeLessThanOrEqual(10);
  });

  it("refuses marks that leave nothing to search, too much, or no code", () => {
    expect(() =>
      MissingCodes.read(formatEncoded(ENCODED, "indexes"), "indexes", "seedshift"),
    ).toThrow("No code is marked");
    const three = marked("indexes", [1, 4, 7]);
    expect(() => MissingCodes.read(three, "indexes", "seedshift")).toThrow("at most 16,777,216");
    expect(() => MissingCodes.read("1 2 ? 4", "indexes", "seedshift")).toThrow("a seed phrase has");
    expect(() =>
      MissingCodes.read(marked("indexes", [2]).replace("10", "9999"), "indexes", "direct"),
    ).toThrow("no number from 1 through 2048");
  });
});

describe("a Shamir share typed where the codes are asked (BackupReading.shareKind)", () => {
  it("tells a share, with or without marks, from the codes of a phrase", async () => {
    const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
    const numbers = writeShare(shares[0]!, "indexes").split(" ");
    expect(BackupReading.shareKind(numbers.join(" "))).toBe("share");
    const one = [...numbers];
    one[6] = "?";
    expect(BackupReading.shareKind(one.join(" "))).toBe("share");
    // Many marks on 21 numbers: a phrase of 21 words with the same marks fits as well.
    const four = [...numbers];
    for (const place of [3, 6, 9, 12]) four[place] = "?";
    expect(BackupReading.shareKind(four.join(" "))).toBe("either");
    expect(BackupReading.shareKind(marked("indexes", [5]))).toBeUndefined();
    expect(BackupReading.shareKind(formatEncoded(ENCODED, "indexes"))).toBeUndefined();
  });
});

describe("dates with what is forgotten (core/dates.ts)", () => {
  const parse = (line: string) => DatesAnswer.parse(line, { wordCount: 12, patterns: true });

  it("reads a lone ? as a whole date or a whole part, and values joined by |", () => {
    expect(parse("?").combinations).toBe(3_652_059);
    expect(parse("15-12-2025 ?").known).toHaveLength(1);
    expect(parse("?-09-2026").combinations).toBe(30);
    expect(parse("2026-?-15").combinations).toBe(12);
    expect(parse("10-1?-2010 15-?-2025").combinations).toBe(36);
    expect(parse("05|15-09-2026").combinations).toBe(2);
    expect(parse("05|15-0?-2025|2026").combinations).toBe(36);
    // The same values in another order are the same pattern: two such dates are counted as two
    // dates of one pattern, whose order does not matter, as two equal patterns always were.
    expect(parse("05|15-09-2026 15|05-09-2026").combinations).toBe(3);
  });

  it("refuses what no date can be, and dates of a phrase where nothing is searched", () => {
    expect(() => parse("? ?")).toThrow("exceeds the safety limit");
    expect(() => parse("15-12-25")).toThrow("four-digit year");
    expect(() => parse("05|1-09-2026")).toThrow();
    expect(() => DatesAnswer.parse("?", { wordCount: 12, patterns: false })).toThrow(
      "? and | stand for what is forgotten",
    );
  });
});
