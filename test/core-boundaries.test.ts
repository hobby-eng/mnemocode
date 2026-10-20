import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";
import {
  encodeMnemonic,
  decodeIndexes,
  parseDate,
  formatDate,
  deriveShifts,
  maximumDates,
  type Bip39WordCount,
  type DateShiftDate,
} from "../src/core.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { mnemocodeVectors } from "./helpers/vectors.js";
// Independent BIP39 construction: integer entropy + SHA256 checksum, no library encoder.
function phrase(entropy: bigint, bits: number): string {
  const hex = entropy.toString(16).padStart(bits / 4, "0");
  const cs = bits / 32;
  const digest = createHash("sha256").update(Buffer.from(hex, "hex")).digest();
  let all = (entropy << BigInt(cs)) | BigInt(digest[0]! >>> (8 - cs));
  const out: string[] = [];
  for (let i = 0; i < (bits + cs) / 11; i++) {
    out.unshift(wordlist[Number(all & 2047n)]!);
    all >>= 11n;
  }
  return out.join(" ");
}
function shifted(entropy: bigint, bits: number, dates: readonly DateShiftDate[]): bigint {
  const sorted = [...dates].sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  const steps = sorted.flatMap((d) => [d.year, d.month, d.day]);
  const tail = bits % 11;
  const chunks = (bits - tail) / 11;
  let result = 0n;
  for (let i = 0; i < chunks; i++) {
    const offset = BigInt(bits - 11 * (i + 1));
    const part = (entropy >> offset) & 2047n;
    result = (result << 11n) | ((part + BigInt(steps[i % steps.length]!)) & 2047n);
  }
  return (
    (result << BigInt(tail)) |
    ((entropy + BigInt(steps[chunks % steps.length]!)) & ((1n << BigInt(tail)) - 1n))
  );
}
const vector = mnemocodeVectors();
describe("Core independent entropy and calendar boundaries", () => {
  it.each([128, 160, 192, 224, 256])(
    "exhausts every entropy tail for %i bits against independent modular arithmetic and SHA256",
    (bits) => {
      const width = bits % 11;
      const mask = (1n << BigInt(width)) - 1n;
      const full = (1n << BigInt(bits)) - 1n;
      const schedules = [
        ["31-12-9999"],
        ["01-01-0001", "29-02-2000", "31-12-2048"],
        ["31-12-9999", "31-12-9999"],
      ];
      for (const texts of schedules) {
        const dates = texts.map(parseDate);
        const seen = new Set<string>();
        for (let tail = 0; tail < 2 ** width; tail++) {
          const source = (full ^ mask) | BigInt(tail);
          const input = phrase(source, bits);
          const encoded = encodeMnemonic(input, dates);
          const expected = phrase(shifted(source, bits, dates), bits);
          expect(encoded.shiftedEnglish.join(" ")).toBe(expected);
          seen.add(expected);
          expect(decodeIndexes(encoded.shiftedIndexes, dates).recoveredMnemonic).toBe(input);
        }
        expect(seen.size).toBe(2 ** width);
      }
    },
  );
  const DAY = "core.dates.day-outside-selected-calendar-month";
  const MONTH = "core.dates.assert-calendar-date-refused-2";
  const YEAR = "core.dates.assert-calendar-date-refused";
  it.each([
    ["29-02-1900", DAY],
    ["29-02-2100", DAY],
    ["31-04-2026", DAY],
    ["00-01-2026", DAY],
    ["01-00-2026", MONTH],
    ["01-13-2026", MONTH],
    ["01-01-0000", YEAR],
    // A fifth digit of the year is no DD-MM-YYYY.
    ["01-01-10000", "core.dates.use-four-digit-year-example-23-09-2026"],
  ])("rejects impossible date %s", (value, code) =>
    expect(() => parseDate(value)).toThrow(expect.objectContaining({ code })),
  );
  it.each(["29-02-2000", "29-02-2400", "01-01-0001", "31-12-9999"])(
    "retains valid boundary %s",
    (value) => expect(formatDate(parseDate(value))).toBe(value),
  );
  it.each<Bip39WordCount>([12, 15, 18, 21, 24])(
    "enforces date limit for %i words and does not mutate order",
    (count) => {
      const dates = Array.from({ length: maximumDates(count) }, (_, i) => ({
        year: 9999 - i,
        month: 12,
        day: 31,
      }));
      const snapshot = JSON.stringify(dates);
      expect(deriveShifts(dates, count)).toHaveLength(count);
      expect(JSON.stringify(dates)).toBe(snapshot);
      expect(() => deriveShifts([...dates, dates[0]!], count)).toThrow(/at most/u);
      expect(() => deriveShifts([], count)).toThrow(
        expect.objectContaining({ code: "core.dates.no-date" }),
      );
    },
  );
  it.each([
    [{ year: NaN, month: 1, day: 1 }, YEAR],
    [{ year: 2026.5, month: 1, day: 1 }, YEAR],
    [{ year: 2026, month: 2, day: 29 }, DAY],
    [{ year: 2026, month: 1.5, day: 1 }, MONTH],
  ])("validates structured API dates %j", (date, code) =>
    expect(() => deriveShifts([date], 12)).toThrow(expect.objectContaining({ code })),
  );
  it("pins both word lists and the known zero-entropy master fingerprint", () => {
    for (const [list, metadata] of [
      [wordlist, vector.wordlist],
      [chinese, vector.traditionalChineseWordlist],
    ] as const) {
      expect(list.length).toBe(metadata.length);
      expect(createHash("sha256").update(list.join("\n")).digest("hex")).toBe(
        metadata.sha256_newline_joined,
      );
    }
    expect(masterFingerprint(phrase(0n, 128))).toBe(vector.vectors[0]!.sourceFingerprint);
    expect(vector.vectors[0]!.sourceFingerprint).toBe("73c5da0a");
  });
});
