import { ErrorCatalog, suppliedMessage } from "./error-catalog.js";

const ERRORS = new ErrorCatalog("core.typed-number", {
  "typed-whole-number-refused": suppliedMessage,
});
// A whole number in a range, as a person types it in answer to a question, which every question
// for a number reads the same way (in the menu, in the questions of the commands and on a page),
// and as a command-line option gives it, in its own stricter syntax (cli/arguments.ts).
//
// Host-neutral and without packages (test/portable-modules.test.ts).

/**
 * Decimal digits only: no sign, point, exponent or white space inside; leading zeros allowed. The
 * one rule of a whole number as written, which a word number follows too (AUD-037-ARC002).
 */
export const DECIMAL_DIGITS = /^\d+$/u;

/**
 * The whole numbers from `min` through `max`, both included: a rule of the library, such as how
 * many addresses are compared, which each host reads in its own syntax (an option, an answer).
 */
export interface WholeRange {
  /** The least whole number of the range, itself included. */
  readonly min: number;
  /** The greatest, itself included; Number.MAX_SAFE_INTEGER for a count (wholeNumbersFrom). */
  readonly max: number;
}

/** The whole numbers of `min` or more, as far as JavaScript counts them exactly: a count. */
export function wholeNumbersFrom(min: number): WholeRange {
  return { min, max: Number.MAX_SAFE_INTEGER };
}

/** Whether `value` is a whole number in `range`. */
export function inWholeRange(value: unknown, range: WholeRange): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/**
 * `text` as a whole number in `range` when it is written as `syntax` allows, otherwise undefined:
 * each host has its syntax (an answer may have leading zeros, an option may not), all one range.
 */
export function wholeNumberOf(text: string, syntax: RegExp, range: WholeRange): number | undefined {
  const number = syntax.test(text) ? Number(text) : Number.NaN;
  return inWholeRange(number, range) ? number : undefined;
}

/**
 * `range` in words: "1 through 2048", as a refusal names it, or "1 to 2048", as a question and the
 * help name it.
 */
export function rangeText(range: WholeRange, word: "through" | "to" = "through"): string {
  return `${range.min} ${word} ${range.max}`;
}

/**
 * The refusal of a value that is no whole number of `range`: "<subject> must be an integer from
 * 1 through 12." `written` names the range where it is written otherwise, such as 0001 for a year.
 */
export function integerRefusal(
  subject: string,
  range: WholeRange,
  written = rangeText(range),
): string {
  return `${subject} must be an integer from ${written}.`;
}

/**
 * A typed whole number in `range`; otherwise refused with `refusal`, by default one that names the
 * range: "Type a number from 0 through 2147483647."
 */
export function typedWholeNumber(
  answer: string,
  range: WholeRange,
  refusal = `Type a number from ${rangeText(range)}.`,
): number {
  const number = wholeNumberOf(answer, DECIMAL_DIGITS, range);
  if (number === undefined) throw ERRORS.create("typed-whole-number-refused", [refusal]);
  return number;
}
