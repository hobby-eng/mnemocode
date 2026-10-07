import type { DateShiftDate, DatePattern, Bip39WordCount } from "./types.js";

export function maximumDates(wordCount: Bip39WordCount): number {
  return wordCount / 3;
}

/** The refusal of more dates than a phrase of `wordCount` words takes (maximumDates). */
export function tooManyDatesMessage(wordCount: Bip39WordCount): string {
  return `${wordCount}-word phrases support at most ${maximumDates(wordCount)} dates.`;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function assertCalendarDate(date: DateShiftDate): void {
  if (!Number.isInteger(date.year) || date.year < 1 || date.year > 9999) {
    throw new Error("A date year must be an integer from 0001 through 9999.");
  }
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
    throw new Error("A date month must be an integer from 1 through 12.");
  }
  if (
    !Number.isInteger(date.day) ||
    date.day < 1 ||
    date.day > daysInMonth(date.year, date.month)
  ) {
    throw new Error("The day is outside the selected calendar month.");
  }
}

export function parseDate(value: string): DateShiftDate {
  const text = value.trim();
  const dayMonthYear = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(text);
  // A year always has four digits, so 23-09-26 is an error and never the year 23.
  const yearMonthDay = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dayMonthYear === null && yearMonthDay === null) {
    throw new Error("Invalid date. Use DD-MM-YYYY with a four-digit year, for example 23-09-2026.");
  }
  const match = dayMonthYear ?? yearMonthDay!;
  const date =
    dayMonthYear === null
      ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
      : { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  assertCalendarDate(date);
  return date;
}

/**
 * A copy of `date` that nothing can change, checked as parseDate checks a typed date: an object
 * that keeps a date must not share it with its caller, who could change it after it was checked
 * (AUD-009-FUN001), and a day the calendar does not have is refused (AUD-009-API001).
 */
export function ownedDate(date: DateShiftDate): DateShiftDate {
  // A hole of a sparse list reaches here as undefined.
  if (typeof date !== "object" || date === null)
    throw new Error("A date must have a year, a month and a day.");
  // Copied first and the copy checked: a getter could give one value to a check and another later.
  const copy = { year: date.year, month: date.month, day: date.day };
  assertCalendarDate(copy);
  return Object.freeze(copy);
}

/** The values of one part of a pattern, copied and frozen; refused when none can be a date. */
function ownedPart(values: readonly number[], minimum: number, maximum: number, name: string) {
  // Array.from turns holes into undefined, which the check below refuses; some() would skip them.
  const copy = Array.from(values ?? []);
  if (
    copy.length === 0 ||
    !copy.every((value) => Number.isInteger(value) && value >= minimum && value <= maximum)
  )
    throw new Error(`The date pattern cannot match a valid ${name}.`);
  // Each value once: datePatternCombinationCount counts distinct dates, and a value given twice
  // would make the search try more combinations than it counted.
  return Object.freeze([...new Set(copy)]);
}

/**
 * A copy of `pattern` that nothing can change, held to the rules of parseDatePattern: every part
 * has values a date can have, and at least one real calendar date fits (AUD-009-FUN001, API001).
 */
export function ownedPattern(pattern: DatePattern): DatePattern {
  const owned: DatePattern = Object.freeze({
    key: String(pattern.key),
    years: ownedPart(pattern.years, 1, 9999, "year"),
    months: ownedPart(pattern.months, 1, 12, "month"),
    days: ownedPart(pattern.days, 1, 31, "day"),
  });
  if (datePatternCandidateCount(owned) === 0)
    throw new Error("The date pattern cannot match a real calendar date.");
  return owned;
}

export function formatDate(date: DateShiftDate): string {
  assertCalendarDate(date);
  return `${String(date.day).padStart(2, "0")}-${String(date.month).padStart(2, "0")}-${String(date.year).padStart(4, "0")}`;
}

export function sortDates(dates: readonly DateShiftDate[]): DateShiftDate[] {
  return [...dates].sort(
    (left, right) => left.year - right.year || left.month - right.month || left.day - right.day,
  );
}

export function deriveShifts(dates: readonly DateShiftDate[], wordCount: Bip39WordCount): number[] {
  if (dates.length === 0) throw new Error("Enter at least one date.");
  if (dates.length > maximumDates(wordCount)) throw new Error(tooManyDatesMessage(wordCount));
  const sorted = sortDates(dates);
  sorted.forEach(assertCalendarDate);
  // Sorting makes the input date order irrelevant; years, months and days
  // remain in that fixed order when the shift sequence repeats.
  const sequence = sorted.flatMap((date) => [date.year, date.month, date.day]);
  return Array.from({ length: wordCount }, (_, index) => sequence[index % sequence.length]!);
}

/**
 * A date of which nothing is remembered, typed in its place as a lone ?, as a code that cannot be
 * read is: every date that is supported.
 */
export const WHOLE_DATE = "?";
/** What a date of which nothing is remembered stands for. */
const WHOLE_DATE_PATTERN = "??-??-????";

/**
 * Whether a typed date is one to search: a ? for a forgotten digit, a few values of a part joined
 * by |, such as 05|15, or a lone ? for a date not remembered at all.
 */
export function isDatePattern(value: string): boolean {
  const text = value.trim();
  return text === WHOLE_DATE || /[?|]/u.test(text);
}

/**
 * The masks of one part of a date: its values joined by |, each with ? for a forgotten digit; a
 * lone ? is the whole part, such as the month of 15-?-2025.
 */
function partMasks(part: string, width: number): string[] | undefined {
  const masks = part.split("|").map((mask) => (mask === "?" ? "?".repeat(width) : mask));
  return masks.every((mask) => new RegExp(`^[0-9?]{${width}}$`, "u").test(mask))
    ? masks
    : undefined;
}

export function parseDatePattern(value: string): DatePattern {
  const typed = value.trim();
  const text = typed === WHOLE_DATE ? WHOLE_DATE_PATTERN : typed;
  const parts = text.split("-");
  // DD-MM-YYYY or YYYY-MM-DD, each part with its values joined by |.
  const dayMonthYear =
    parts.length === 3
      ? [partMasks(parts[0]!, 2), partMasks(parts[1]!, 2), partMasks(parts[2]!, 4)]
      : [];
  const yearMonthDay =
    parts.length === 3
      ? [partMasks(parts[0]!, 4), partMasks(parts[1]!, 2), partMasks(parts[2]!, 2)]
      : [];
  const read =
    dayMonthYear.every(Boolean) && dayMonthYear.length === 3
      ? { day: dayMonthYear[0]!, month: dayMonthYear[1]!, year: dayMonthYear[2]! }
      : yearMonthDay.every(Boolean) && yearMonthDay.length === 3
        ? { year: yearMonthDay[0]!, month: yearMonthDay[1]!, day: yearMonthDay[2]! }
        : undefined;
  if (read === undefined)
    throw new Error(
      "Invalid date pattern. Use DD-MM-YYYY with ? for each forgotten digit, a few values joined by | such as 05|15, or a lone ? for a whole date.",
    );
  if (!isDatePattern(typed))
    throw new Error("A recovery pattern must contain a ? digit, or values joined by |.");
  // The same values in another order are the same pattern: one key, so that it is searched once.
  const keyOf = (masks: readonly string[]) => [...new Set(masks)].sort().join("|");
  const pattern: DatePattern = {
    key: `${keyOf(read.year)}-${keyOf(read.month)}-${keyOf(read.day)}`,
    years: matchingDateParts(read.year, 1, 9999),
    months: matchingDateParts(read.month, 1, 12),
    days: matchingDateParts(read.day, 1, 31),
  };
  if (pattern.years.length === 0) throw new Error("The date pattern cannot match a valid year.");
  if (pattern.months.length === 0) throw new Error("The date pattern cannot match a valid month.");
  if (pattern.days.length === 0) throw new Error("The date pattern cannot match a valid day.");
  if (datePatternCandidateCount(pattern) === 0)
    throw new Error("The date pattern cannot match a real calendar date.");
  return pattern;
}

/** The values from `minimum` to `maximum` that one of `masks` allows, each once, in order. */
function matchingDateParts(masks: readonly string[], minimum: number, maximum: number): number[] {
  const expressions = masks.map((mask) => ({
    width: mask.length,
    expression: new RegExp(`^${mask.replaceAll("?", "[0-9]")}$`, "u"),
  }));
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => index + minimum).filter(
    (part) =>
      expressions.some(({ width, expression }) =>
        expression.test(String(part).padStart(width, "0")),
      ),
  );
}

export function* datePatternCandidates(pattern: DatePattern): Generator<DateShiftDate> {
  for (const year of pattern.years) {
    for (const month of pattern.months) {
      const maximumDay = daysInMonth(year, month);
      for (const day of pattern.days) {
        if (day <= maximumDay) yield { year, month, day };
      }
    }
  }
}

export function datePatternCandidateCount(pattern: DatePattern): number {
  let count = 0;
  for (const year of pattern.years)
    for (const month of pattern.months) {
      const maximumDay = daysInMonth(year, month);
      count += pattern.days.filter((day) => day <= maximumDay).length;
    }
  return count;
}

export function datePatternCombinationCount(
  patterns: readonly DatePattern[],
  stopAfter = Number.MAX_SAFE_INTEGER,
): number {
  const groups = new Map<string, { readonly pattern: DatePattern; count: number }>();
  for (const pattern of patterns) {
    const group = groups.get(pattern.key);
    groups.set(pattern.key, { pattern, count: (group?.count ?? 0) + 1 });
  }
  let total = 1n;
  const limit = BigInt(stopAfter);
  for (const { pattern, count } of groups.values()) {
    const candidateCount = datePatternCandidateCount(pattern);
    if (candidateCount === 0) return 0;
    let combinations = 1n;
    for (let index = 1; index <= count; index += 1) {
      combinations = (combinations * BigInt(candidateCount + index - 1)) / BigInt(index);
    }
    total *= combinations;
    if (total > limit) return stopAfter + 1;
  }
  return Number(total);
}

export function* datePatternCombinations(
  patterns: readonly DatePattern[],
  index = 0,
  selected: readonly DateShiftDate[] = [],
): Generator<readonly DateShiftDate[]> {
  if (index === patterns.length) {
    yield selected;
    return;
  }
  let previousMatchingIndex = -1;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (patterns[candidateIndex]!.key === patterns[index]!.key) {
      previousMatchingIndex = candidateIndex;
      break;
    }
  }
  const previousMatchingDate =
    previousMatchingIndex === -1 ? undefined : selected[previousMatchingIndex];
  for (const date of datePatternCandidates(patterns[index]!)) {
    if (previousMatchingDate !== undefined && compareDates(date, previousMatchingDate) < 0)
      continue;
    yield* datePatternCombinations(patterns, index + 1, [...selected, date]);
  }
}

function compareDates(left: DateShiftDate, right: DateShiftDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export function expandDatePattern(pattern: DatePattern): DateShiftDate[] {
  return [...datePatternCandidates(pattern)];
}
