// AUD-010 core probe: the AUD-009 findings of the core as a regression list, in the shape the
// fixes chose (docs/audits/AUD-009-2026-10-06.md):
//   AUD-009-FUN001 - dates and patterns are owned, frozen copies; a caller's later change, or a
//                    change through a getter's result, does not reach a checked answer or search;
//                    the limits hold in the constructor that a JavaScript host can call directly.
//   AUD-009-API001 - DatesAnswer.of refuses impossible calendar dates and empty patterns, by place.
//   AUD-009-API002 - EncodedBackup refuses sparse code arrays through of and its raw constructor.
// docs/audits/AUD-009-harnesses/core-invariants.ts is re-run separately; two of its checks push
// into pattern arrays, which are frozen now and throw TypeError, as AUD-009 recorded (10/12).
// Public fixtures only.

import { DatesAnswer, DateSearch } from "../../../src/core/date-search.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
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

const ZERO12 = [...Array(11).fill(0), 3];

// FUN001: owned and frozen.
{
  const date = { year: 2026, month: 9, day: 23 };
  const pattern: DatePattern = { key: "p", years: [2026], months: [9], days: [1, 2, 3] };
  const answer = DatesAnswer.of([date], [pattern]);
  date.year = 1990;
  (pattern.days as number[]).push(4, 5, 6);
  check(
    "FUN001: caller's later changes do not reach the answer",
    answer.known[0]!.year === 2026 && answer.combinations === 3,
    {
      year: answer.known[0]!.year,
      combinations: answer.combinations,
    },
  );
  const fromGetter = answer.patterns[0]!;
  const pushed = refusal(() => (fromGetter.days as number[]).push(7));
  const setYear = refusal(() => {
    "use strict";
    (answer.known[0] as { year: number }).year = 1;
  });
  check(
    "FUN001: dates and patterns from getters are frozen",
    pushed?.startsWith("TypeError") === true &&
      setYear?.startsWith("TypeError") === true &&
      answer.combinations === 3,
    {
      pushed,
      setYear,
    },
  );
  const indexes = [...ZERO12];
  const search = new DateSearch({
    indexes,
    dates: DatesAnswer.parse("2?-09-2026", { patterns: true, wordCount: 12 }),
    mode: "seedshift",
  });
  indexes[0] = 5000;
  // An index of 5000 would be refused at the first combination if the search read the caller's array.
  const result = await search.run({ turn: async () => {} });
  check(
    "FUN001: DateSearch keeps its own copy of the codes",
    result.combinations === 10 && result.checksumValid === 10,
    {
      combinations: result.combinations,
      checksumValid: result.checksumValid,
    },
  );
  // The private constructor, called as a JavaScript host can.
  const Raw = DatesAnswer as unknown as new (
    known: DateShiftDate[],
    patterns: DatePattern[],
    places: number[],
  ) => DatesAnswer;
  const many = Array.from({ length: 4 }, (_, index) => ({
    key: `k${index}`,
    years: [2026],
    months: [1],
    days: [index + 1, index + 2],
  }));
  check(
    "FUN001: the raw constructor holds the incomplete-date limit",
    /at most 3 incomplete/u.test(refusal(() => new Raw([], many, [1, 2, 3, 4])) ?? ""),
  );
  check(
    "FUN001: the raw constructor refuses an impossible date",
    refusal(() => new Raw([{ year: 2026, month: 2, day: 30 }], [], [])) !== undefined,
  );
  const wide: DatePattern[] = [
    {
      key: "a",
      years: Array.from({ length: 9999 }, (_, i) => i + 1),
      months: Array.from({ length: 12 }, (_, i) => i + 1),
      days: Array.from({ length: 31 }, (_, i) => i + 1),
    },
    { key: "b", years: Array.from({ length: 9999 }, (_, i) => i + 1), months: [1], days: [1] },
  ];
  check(
    "FUN001: the raw constructor holds the combination limit",
    /safety limit/u.test(refusal(() => new Raw([], wide, [1, 2])) ?? ""),
  );
}

// API001: DatesAnswer.of checks as parse checks.
{
  check(
    "API001: 30 February refused by place",
    /^Error: Date 2: /u.test(
      refusal(() =>
        DatesAnswer.of([
          { year: 2026, month: 1, day: 1 },
          { year: 2026, month: 2, day: 30 },
        ]),
      ) ?? "",
    ),
  );
  check(
    "API001: empty pattern refused by place",
    /^Error: Date 2: /u.test(
      refusal(() =>
        DatesAnswer.of(
          [{ year: 2026, month: 1, day: 1 }],
          [{ key: "e", years: [], months: [1], days: [1] }],
        ),
      ) ?? "",
    ),
  );
  check(
    "API001: leap day accepted",
    refusal(() => DatesAnswer.of([{ year: 2024, month: 2, day: 29 }])) === undefined,
  );
}

// API002: sparse codes.
{
  const sparse = new Array<number>(12);
  sparse[0] = 0;
  check(
    "API002: EncodedBackup.of refuses a sparse array",
    refusal(() => EncodedBackup.of(sparse, "indexes", "direct")) !== undefined,
  );
  const Raw = EncodedBackup as unknown as new (
    indexes: number[],
    format: string,
    mode: string,
  ) => EncodedBackup;
  check(
    "API002: the raw constructor refuses a sparse array",
    refusal(() => new Raw(sparse, "indexes", "direct")) !== undefined,
  );
  const backup = EncodedBackup.of(ZERO12, "indexes", "seedshift");
  check(
    "API002: EncodedBackup codes are frozen",
    Object.isFrozen(backup.indexes) &&
      refusal(() => (backup.indexes as number[]).push(1))?.startsWith("TypeError") === true,
  );
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
