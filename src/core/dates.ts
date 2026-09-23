import type { DateShiftDate, DatePattern, Bip39WordCount } from './types.js';

export function maximumDates(wordCount: Bip39WordCount): number {
  return wordCount / 3;
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
    throw new Error('A date year must be an integer from 0001 through 9999.');
  }
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
    throw new Error('A date month must be an integer from 1 through 12.');
  }
  if (
    !Number.isInteger(date.day) ||
    date.day < 1 ||
    date.day > daysInMonth(date.year, date.month)
  ) {
    throw new Error('The day is outside the selected calendar month.');
  }
}

export function parseDate(value: string): DateShiftDate {
  const text = value.trim();
  const dayMonthYear = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(text);
  const yearMonthDay = /^(\d{1,4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dayMonthYear === null && yearMonthDay === null) {
    throw new Error('Invalid date. Use DD-MM-YYYY.');
  }
  const match = dayMonthYear ?? yearMonthDay!;
  const date =
    dayMonthYear === null
      ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
      : { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  assertCalendarDate(date);
  return date;
}

export function formatDate(date: DateShiftDate): string {
  assertCalendarDate(date);
  return `${String(date.day).padStart(2, '0')}-${String(date.month).padStart(2, '0')}-${String(date.year).padStart(4, '0')}`;
}

export function sortDates(dates: readonly DateShiftDate[]): DateShiftDate[] {
  return [...dates].sort(
    (left, right) => left.year - right.year || left.month - right.month || left.day - right.day,
  );
}

export function deriveShifts(dates: readonly DateShiftDate[], wordCount: Bip39WordCount): number[] {
  if (dates.length === 0) throw new Error('Enter at least one date.');
  if (dates.length > maximumDates(wordCount)) {
    throw new Error(`${wordCount}-word phrases support at most ${maximumDates(wordCount)} dates.`);
  }
  const sorted = sortDates(dates);
  sorted.forEach(assertCalendarDate);
  // Sorting makes the input date order irrelevant; years, months and days
  // remain in that fixed order when the shift sequence repeats.
  const sequence = sorted.flatMap((date) => [date.year, date.month, date.day]);
  return Array.from({ length: wordCount }, (_, index) => sequence[index % sequence.length]!);
}

export function parseDatePattern(value: string): DatePattern {
  const text = value.trim();
  const dayMonthYear = /^(\d{2}|\?{2})-(\d{2}|\?{2})-(\d{4}|\?{4})$/u.exec(text);
  const yearMonthDay = /^(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})$/u.exec(text);
  if (dayMonthYear === null && yearMonthDay === null) {
    throw new Error('Invalid date pattern. Use DD-MM-YYYY and ? for one unknown part.');
  }
  const match = dayMonthYear ?? yearMonthDay!;
  const pattern =
    dayMonthYear === null
      ? {
          year: match[1] === '????' ? null : Number(match[1]),
          month: match[2] === '??' ? null : Number(match[2]),
          day: match[3] === '??' ? null : Number(match[3]),
        }
      : {
          year: match[3] === '????' ? null : Number(match[3]),
          month: match[2] === '??' ? null : Number(match[2]),
          day: match[1] === '??' ? null : Number(match[1]),
        };
  if ([pattern.year, pattern.month, pattern.day].filter((part) => part === null).length !== 1) {
    throw new Error('A recoverable date pattern must have exactly one unknown component.');
  }
  if (pattern.year !== null && (pattern.year < 1 || pattern.year > 9999))
    throw new Error('The date year must be from 0001 through 9999.');
  if (pattern.month !== null && (pattern.month < 1 || pattern.month > 12))
    throw new Error('The date month must be from 01 through 12.');
  if (pattern.day !== null) {
    // An unknown year may be a leap year; 2000 supplies the largest February.
    const maximumDay =
      pattern.month === null ? 31 : daysInMonth(pattern.year ?? 2000, pattern.month);
    if (pattern.day < 1 || pattern.day > maximumDay)
      throw new Error('The date pattern day cannot occur in the selected calendar month.');
  }
  return pattern;
}

export function expandDatePattern(pattern: DatePattern): DateShiftDate[] {
  const dates: DateShiftDate[] = [];
  const years =
    pattern.year === null ? Array.from({ length: 9999 }, (_, index) => index + 1) : [pattern.year];
  for (const year of years) {
    const months =
      pattern.month === null
        ? Array.from({ length: 12 }, (_, index) => index + 1)
        : [pattern.month];
    for (const month of months) {
      const days =
        pattern.day === null
          ? Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1)
          : [pattern.day];
      for (const day of days) {
        const date = { year, month, day };
        try {
          assertCalendarDate(date);
          dates.push(date);
        } catch {
          /* omit impossible dates */
        }
      }
    }
  }
  return dates;
}
