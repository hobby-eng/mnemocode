// AUD-010 core probe: hard limits and input bounds of the date search, the word search, the
// missing-code search and the candidate list, at 0, 1, the limit and the limit + 1, with
// fractional, NaN, infinite and sparse inputs, through the production classes. Also the candidate
// list sizes that docs/CANDIDATES.md states, against an independent Padmé (Nikitin et al.,
// PETS 2019). Public fixtures only: all-zero entropy, synthetic dates and patterns.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  DatesAnswer,
  DateSearch,
  HARD_MAX_COMBINATIONS,
  MAX_INCOMPLETE_DATES,
  MAX_SHOWN_MATCHES,
} from "../../../src/core/date-search.js";
import {
  MAX_SEARCH_COMBINATIONS,
  WordCandidateSearch,
  type WordSearch,
} from "../../../src/core/candidates.js";
import {
  decodeCandidateList,
  encodeCandidateList,
  MAX_CANDIDATE_RECORDS,
  MAX_PASSPHRASE_BYTES,
  padmeLength,
  TooManyForList,
} from "../../../src/core/candidate-list.js";
import { MAX_FOUND_CODES, MissingCodes } from "../../../src/core/missing-codes.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
import { parseRecord, serializeRecord } from "../../../src/record.js";
import type { DatePattern, DateShiftDate } from "../../../src/core/types.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return undefined;
}
async function asyncRefusal(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return String(error);
  }
  return undefined;
}
function refused(label: string, run: () => unknown, pattern?: RegExp): void {
  const message = refusal(run);
  check(label, message !== undefined && (pattern === undefined || pattern.test(message)), {
    message: message ?? "accepted",
  });
}
function accepted(label: string, run: () => unknown): void {
  const message = refusal(run);
  check(label, message === undefined, { message: message ?? "accepted" });
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ZERO12 = [...Array(11).fill(0), 3]; // abandon x11 about
const DATE: DateShiftDate = { year: 2026, month: 9, day: 23 };

// ---- DatesAnswer: counts, the hard limit, calendar and input types.
{
  const rules12 = { patterns: true, wordCount: 12 };
  accepted(`parse: ${MAX_INCOMPLETE_DATES} dates with ? for 12 words`, () =>
    DatesAnswer.parse("1?-01-2020 2?-02-2020 0?-03-2020", rules12),
  );
  refused(
    `parse: ${MAX_INCOMPLETE_DATES + 1} dates with ? (24 words)`,
    () =>
      DatesAnswer.parse("1?-01-2020 2?-02-2020 0?-03-2020 0?-04-2020", {
        patterns: true,
        wordCount: 24,
      }),
    /at most 3 incomplete/u,
  );
  refused(
    "parse: 5 dates for 12 words",
    () => DatesAnswer.parse("01-01-2001 01-01-2002 01-01-2003 01-01-2004 01-01-2005", rules12),
    /at most 4 dates/u,
  );
  refused("parse: no date", () => DatesAnswer.parse("  ", rules12));
  refused("parse: ? where patterns are not allowed", () =>
    DatesAnswer.parse("1?-01-2020", { patterns: false, wordCount: 12 }),
  );
  refused("parse: two-digit year", () => DatesAnswer.parse("23-09-26", rules12));
  refused("parse: 29-02-2025 (not a leap year)", () => DatesAnswer.parse("29-02-2025", rules12));
  accepted("parse: 29-02-2024 (leap year)", () => DatesAnswer.parse("29-02-2024", rules12));
  refused("parse: year 0000", () => DatesAnswer.parse("01-01-0000", rules12));
  accepted("parse: year 0001 and 9999", () => DatesAnswer.parse("01-01-0001 31-12-9999", rules12));
  refused("of: no date", () => DatesAnswer.of([]));
  refused("of: sparse known dates", () => DatesAnswer.of([, DATE] as unknown as DateShiftDate[]));
  refused("of: sparse patterns", () => DatesAnswer.of([DATE], [,] as unknown as DatePattern[]));
  for (const [name, date] of [
    ["fractional day", { year: 2026, month: 9, day: 23.5 }],
    ["NaN month", { year: 2026, month: Number.NaN, day: 1 }],
    ["infinite year", { year: Number.POSITIVE_INFINITY, month: 1, day: 1 }],
    ["string year", { year: "2026", month: 1, day: 1 }],
    ["day 0", { year: 2026, month: 1, day: 0 }],
    ["31 April", { year: 2026, month: 4, day: 31 }],
  ] as const)
    refused(`of: ${name}`, () => DatesAnswer.of([date as unknown as DateShiftDate]));
  const pattern = (
    key: string,
    years: number[],
    months: number[],
    days: number[],
  ): DatePattern => ({ key, years, months, days });
  for (const [name, bad] of [
    ["empty years", pattern("a", [], [1], [1])],
    ["NaN day", pattern("a", [2026], [1], [Number.NaN])],
    ["fractional month", pattern("a", [2026], [1.5], [1])],
    ["sparse days", pattern("a", [2026], [1], [, 1] as unknown as number[])],
    ["month 13", pattern("a", [2026], [13], [1])],
    ["no calendar date (31 February)", pattern("a", [2026], [2], [30, 31])],
  ] as const)
    refused(`of: pattern with ${name}`, () => DatesAnswer.of([], [bad]));
  refused(
    "of: same key, other dates",
    () => DatesAnswer.of([], [pattern("k", [2026], [1], [1, 2]), pattern("k", [2026], [1], [3])]),
    /key of an earlier/u,
  );
  // 2^31 exactly: 1024 years x 4 months x 16 days = 65,536 and 512 x 4 x 16 = 32,768, other keys.
  const a = pattern("a", range(1, 1024), range(1, 4), range(1, 16));
  const b = pattern("b", range(1, 512), range(1, 4), range(1, 16));
  const atLimit = DatesAnswer.of([], [a, b]);
  check(
    "of: exactly HARD_MAX_COMBINATIONS combinations is accepted",
    atLimit.combinations === HARD_MAX_COMBINATIONS,
    {
      combinations: atLimit.combinations,
      limit: HARD_MAX_COMBINATIONS,
    },
  );
  refused(
    "of: one year more (2^31 + 65,536 combinations) is refused",
    () => DatesAnswer.of([], [a, pattern("b", range(1, 513), range(1, 4), range(1, 16))]),
    /safety limit/u,
  );
  const answer = DatesAnswer.parse("1?-01-2020", rules12);
  check(
    "DatesAnswer redacts itself",
    String(answer) === "[DatesAnswer: redacted]" &&
      JSON.stringify(answer) === '"[DatesAnswer: redacted]"',
  );
  check(
    "DatesAnswer known/patterns are copies",
    (() => {
      const copy = answer.patterns;
      copy.pop();
      return (
        answer.patterns.length === 1 &&
        Object.isFrozen(answer.patterns[0]) &&
        Object.isFrozen(answer.patterns[0]!.days)
      );
    })(),
  );
}

// ---- DateSearch: codes, mode, dates and run options.
{
  const dates = DatesAnswer.parse("23-09-2026 1?-01-2020", { patterns: true, wordCount: 12 });
  const make = (options: Record<string, unknown>) =>
    new DateSearch({ indexes: ZERO12, dates, mode: "seedshift", ...options } as never);
  for (const [name, indexes] of [
    ["11 codes", ZERO12.slice(1)],
    ["13 codes", [...ZERO12, 0]],
    ["sparse codes", [, ...ZERO12.slice(1)]],
    ["code 2048", [2048, ...ZERO12.slice(1)]],
    ["code -1", [-1, ...ZERO12.slice(1)]],
    ["code 1.5", [1.5, ...ZERO12.slice(1)]],
    ["code NaN", [Number.NaN, ...ZERO12.slice(1)]],
  ] as const)
    refused(`DateSearch: ${name}`, () => make({ indexes }));
  refused("DateSearch: mode direct", () => make({ mode: "direct" }));
  refused("DateSearch: unknown mode", () => make({ mode: "seedshift-v2" }));
  refused("DateSearch: dates not a DatesAnswer", () =>
    make({ dates: { known: [DATE], patterns: [], count: 1, fitsPhrase: () => true } }),
  );
  refused(
    "DateSearch: 5 dates for 12 words",
    () =>
      make({
        dates: DatesAnswer.parse("01-01-2001 01-01-2002 01-01-2003 01-01-2004 1?-01-2020", {
          patterns: true,
        }),
      }),
    /at most 4/u,
  );
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    for (const option of ["maxShown", "keep"])
      refused(`DateSearch: ${option} ${value}`, () => make({ [option]: value }), /RangeError/u);
  accepted("DateSearch: maxShown 0 and keep 0", () => make({ maxShown: 0, keep: 0 }));
  const search = make({ maxShown: 1, keep: 2 });
  const result = await search.run({ turn: async () => {} });
  check(
    "DateSearch: maxShown 1 shows one, keep 2 keeps two, counts all",
    result.shown.length === 1 &&
      result.kept.length === 2 &&
      result.matchCount === 10 &&
      result.combinations === 10,
    {
      shown: result.shown.length,
      kept: result.kept.length,
      matchCount: result.matchCount,
      combinations: result.combinations,
    },
  );
  check("DateSearch: default maxShown", MAX_SHOWN_MATCHES === 100);
  for (const every of [0, 1.5, Number.NaN, -1])
    check(
      `DateSearch.run: progressEvery ${every} refused`,
      ((await asyncRefusal(() => search.run({ progressEvery: every }))) ?? "").startsWith(
        "RangeError",
      ),
    );
  const progress: number[] = [];
  await search.run({
    progressEvery: 3,
    onProgress: ({ checked }) => progress.push(checked),
    turn: async () => {},
  });
  check(
    "DateSearch.run: progress every 3 and after the last",
    JSON.stringify(progress) === "[3,6,9,10]",
    { progress },
  );
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  check(
    "DateSearch.run: aborted before the first combination",
    (await asyncRefusal(() => search.run({ signal: controller.signal }))) === "Error: stop",
  );
  check(
    "DateSearch redacts itself",
    String(search) === "[DateSearch: redacted]" &&
      JSON.stringify(search) === '"[DateSearch: redacted]"',
  );
}

// ---- WordCandidateSearch: the 2^24 bound and malformed searches from a host.
{
  const all = range(0, 2047);
  const fixed = (count: number) => Array.from({ length: count }, () => [0]);
  const places = (extra: number[]) => [all, all, extra, ...fixed(9)];
  const at = WordCandidateSearch.of({ kind: "unknown-words", places: places([0, 1, 2, 3]) });
  check(
    "WordCandidateSearch.of: exactly 2^24 combinations accepted",
    at.combinations === MAX_SEARCH_COMBINATIONS,
    { combinations: at.combinations },
  );
  refused(
    "WordCandidateSearch.of: 2^24 + 2^22 combinations refused",
    () => WordCandidateSearch.of({ kind: "unknown-words", places: places([0, 1, 2, 3, 4]) }),
    /more than 16,777,216/u,
  );
  refused("parse: three ? of 12 words refused", () =>
    WordCandidateSearch.parse(`? ? ? ${"abandon ".repeat(8)}about`, "unknown-words"),
  );
  for (const [name, search] of [
    ["empty place", { kind: "unknown-words", places: [[], ...fixed(11)] }],
    ["descending place", { kind: "unknown-words", places: [[2, 1], ...fixed(11)] }],
    ["duplicate in place", { kind: "unknown-words", places: [[1, 1], ...fixed(11)] }],
    ["sparse place", { kind: "unknown-words", places: [[, 1], ...fixed(11)] }],
    ["sparse places", { kind: "unknown-words", places: [, ...fixed(11)] }],
    ["index 2048", { kind: "unknown-words", places: [[2048], all, ...fixed(10)] }],
    ["fractional index", { kind: "unknown-words", places: [[0.5], all, ...fixed(10)] }],
    ["11 places", { kind: "unknown-words", places: [all, ...fixed(10)] }],
    ["missing-word with 12 written", { kind: "missing-word", written: Array(12).fill(0) }],
    ["missing-word sparse", { kind: "missing-word", written: [, ...Array(10).fill(0)] }],
    ["unknown kind", { kind: "other", places: [] }],
  ] as const)
    refused(`WordCandidateSearch.of: ${name}`, () =>
      WordCandidateSearch.of(search as unknown as WordSearch),
    );
  const missing = WordCandidateSearch.parse(`${"abandon ".repeat(10)}about`, "missing-word");
  check(
    "missing-word of 11 written words: 12 x 2048 combinations",
    missing.combinations === 12 * 2048,
    { combinations: missing.combinations },
  );
  for (const value of [-1, 1.5, Number.NaN])
    check(
      `WordCandidateSearch.run: keep ${value} refused`,
      ((await asyncRefusal(() => missing.run({ keep: value }))) ?? "").startsWith("RangeError"),
    );
}

// ---- MissingCodes: MAX_FOUND_CODES by default.
{
  const words = `? ${"abandon ".repeat(10)}about`;
  const codes = MissingCodes.read(words, "english", "seedshift-legacy");
  const result = await codes.run({ check: () => true, turn: async () => {} });
  check(
    "MissingCodes.run: keeps MAX_FOUND_CODES by default and counts all",
    result.found.length === MAX_FOUND_CODES && result.passed === 2048,
    {
      found: result.found.length,
      passed: result.passed,
      limit: MAX_FOUND_CODES,
    },
  );
}

// ---- EncodedBackup and the MNC1 record.
{
  refused("EncodedBackup.of: sparse codes", () =>
    EncodedBackup.of(new Array<number>(12), "indexes", "direct"),
  );
  refused("EncodedBackup.of: unknown mode", () =>
    EncodedBackup.of(ZERO12, "indexes", "seedshift-v2" as never),
  );
  refused("EncodedBackup.of: unknown format", () =>
    EncodedBackup.of(ZERO12, "json" as never, "direct"),
  );
  refused(
    "EncodedBackup.of: checksum missing for seedshift",
    () => EncodedBackup.of([...ZERO12.slice(0, 11), 4], "indexes", "seedshift"),
    /MissingChecksum|lack the BIP39 checksum/u,
  );
  accepted("EncodedBackup.of: legacy codes without checksum", () =>
    EncodedBackup.of([...ZERO12.slice(0, 11), 4], "indexes", "seedshift-legacy"),
  );
  const record = serializeRecord("seedshift", "indexes", " 1 2 3 ");
  check("record: payload trimmed, header exact", record === "MNC1:seedshift:indexes:1 2 3", {
    record,
  });
  refused("record: version 01", () => parseRecord("MNC01:direct:indexes:1"));
  refused("record: version 2", () => parseRecord("MNC2:direct:indexes:1"));
  refused("record: unknown format", () => parseRecord("MNC1:direct:json:1"));
  refused("record: unknown mode", () => parseRecord("MNC1:seedshift-v2:indexes:1"));
  refused("record: empty payload", () => parseRecord("MNC1:direct:indexes:"));
  check("record: no header is a raw representation", parseRecord("1 2 3") === undefined);
}

// ---- Candidate list: counts, lengths, passphrases, Padmé and the sizes the documents state.
{
  const record = (length = 16) => ({ entropy: new Uint8Array(length) });
  refused("list: 0 records", () => encodeCandidateList({ records: [] }));
  accepted("list: 1 record", () =>
    decodeCandidateList(encodeCandidateList({ records: [record()] })),
  );
  refused("list: sparse records", () => encodeCandidateList({ records: [, record()] as never }));
  refused("list: mixed entropy lengths", () =>
    encodeCandidateList({ records: [record(16), record(32)] }),
  );
  refused("list: entropy of 17 bytes", () => encodeCandidateList({ records: [record(17)] }));
  accepted(`list: passphrase of ${MAX_PASSPHRASE_BYTES} bytes`, () =>
    encodeCandidateList({ records: [record()], passphrase: "x".repeat(MAX_PASSPHRASE_BYTES) }),
  );
  refused(`list: passphrase of ${MAX_PASSPHRASE_BYTES + 1} bytes`, () =>
    encodeCandidateList({ records: [record()], passphrase: "x".repeat(MAX_PASSPHRASE_BYTES + 1) }),
  );
  refused("list: passphrase with a lone surrogate", () =>
    encodeCandidateList({ records: [record()], passphrase: "a\uD800b" }),
  );
  const full = Array.from({ length: MAX_CANDIDATE_RECORDS }, () => record(16));
  const fullBytes = encodeCandidateList({ records: full });
  const decoded = decodeCandidateList(fullBytes);
  check(
    `list: ${MAX_CANDIDATE_RECORDS} records (the limit) round trip`,
    decoded.records.length === MAX_CANDIDATE_RECORDS,
    { bytes: fullBytes.length },
  );
  refused(`list: ${MAX_CANDIDATE_RECORDS + 1} records`, () =>
    encodeCandidateList({ records: [...full, record(16)] }),
  );
  const full24 = encodeCandidateList({
    records: Array.from({ length: MAX_CANDIDATE_RECORDS }, () => record(32)),
  });
  check(
    "list: sizes stated in docs/CANDIDATES.md (8,650,752 and 17,301,504 bytes)",
    fullBytes.length === 8_650_752 && full24.length === 17_301_504,
    {
      twelveWords: fullBytes.length,
      twentyFourWords: full24.length,
    },
  );
  // Forged header count MAX + 1 and count 0.
  const one = encodeCandidateList({ records: [record()] });
  const forged = Uint8Array.from(one);
  new DataView(forged.buffer).setUint32(7, MAX_CANDIDATE_RECORDS + 1);
  refused("list decode: header count MAX + 1", () => decodeCandidateList(forged), /record count/u);
  new DataView(forged.buffer).setUint32(7, 0);
  refused("list decode: header count 0", () => decodeCandidateList(forged), /record count/u);
  refused("list decode: truncated", () => decodeCandidateList(one.subarray(0, one.length - 1)));
  const flipped = Uint8Array.from(one);
  flipped[12] ^= 1;
  refused("list decode: CRC mismatch", () => decodeCandidateList(flipped), /CRC-32/u);
  const padded = new Uint8Array(one.length + 8);
  padded.set(one);
  refused("list decode: extra padding", () => decodeCandidateList(padded), /padding/u);
  const flags = Uint8Array.from(one);
  flags[5] = 4;
  refused("list decode: unknown flag", () => decodeCandidateList(flags), /flags/u);
  check(
    "TooManyForList names the limit",
    new TooManyForList("narrow it").message ===
      "More than 524,288 candidates, more than one list holds: narrow it.",
    {
      message: new TooManyForList("narrow it").message,
    },
  );
  // Independent Padmé: E = floor(log2 L), S = floor(log2 E) + 1, round up the low E - S bits.
  const padme = (length: number) => {
    const e = Math.floor(Math.log2(length));
    const s = Math.floor(Math.log2(e)) + 1;
    const mask = 2 ** (e - s) - 1;
    return Math.ceil(length / (mask + 1)) * (mask + 1);
  };
  let firstDiff: number | undefined;
  let worst = 0;
  for (let length = 2; length <= 1 << 20; length += 1) {
    if (padmeLength(length) !== padme(length)) {
      firstDiff ??= length;
    }
    worst = Math.max(worst, padmeLength(length) / length - 1);
  }
  for (const length of [2 ** 24 - 1, 2 ** 24, 2 ** 24 + 1, 155_000_000])
    if (padmeLength(length) !== padme(length)) firstDiff ??= length;
  check(
    "Padmé equals the independent formula for 2..2^20 and large sizes; overhead at most 12 %",
    firstDiff === undefined && worst <= 0.12,
    {
      firstDiff,
      worstOverheadPercent: Math.round(worst * 10000) / 100,
    },
  );
  refused("Padmé: length 1", () => padmeLength(1));
  refused("Padmé: length 2.5", () => padmeLength(2.5));
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
void entropyToMnemonic;
void wordlist;
