import { wholeNumberOf, type WholeRange, rangeText } from "../core/typed-number.js";
import { optionLabel, optionSubject, optionValue } from "./option-copy.js";
import { listInWords } from "../core/places.js";
import { SHARE_SOURCE_OPTIONS } from "./share-options.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.arguments", {
  "command-does-not-accept-unnamed-value-use-appropriate": () =>
    "This command does not accept an unnamed value. Use the appropriate named option.",
  "at-least-one-value": (value0: string) => `${value0} needs at least one value.`,
  "requires-value": (value0: string) => `${value0} requires a value.`,
  "ask-secrets-cannot-combined": (value0: string) =>
    `--ask-secrets cannot be combined with ${value0}.`,
  refused: (value0: string, value1: string) => `--${value0} must be ${value1}.`,
  required: (value0: string) => `${value0} is required.`,
  "base-10-integer-from": (value0: string, value1: string) =>
    `${value0} must be a base-10 integer from ${value1}.`,
  "provide-only-one-value-setting": (value0: string) =>
    `Provide only one value for the ${value0} setting.`,
  "provide-exactly-one-value-setting": (value0: string) =>
    `Provide exactly one value for the ${value0} setting.`,
  "command-does-not-support-setting": (value0: string, value1: string) =>
    `The ${value0} command does not support the ${value1} setting.`,
  "on-off-choice-does-not-accept-separate-value": (value0: string) =>
    `${value0} is an on-or-off choice and does not accept a separate value.`,
});

export type ParsedArguments = Record<string, string | boolean | string[]>;

export function parseArguments(items: readonly string[]): ParsedArguments {
  // No prototype: every typed name is an own key of its own, "--__proto__" too, which on an
  // ordinary object would set the prototype and be lost before the unknown option is refused, and
  // no name finds one that every object inherits, such as "constructor" (AUD-014-API010).
  const parsed: ParsedArguments = Object.create(null) as ParsedArguments;
  const booleanOptions = new Set([
    "card-qr",
    "sskr",
    "show-masked-words",
    "all",
    "recovery-guide",
    "ask-secrets",
    "cards",
    "legacy-valid-last-word",
    "list",
    "missing-word",
    "list-candidates",
    "plaintext-candidates",
    "recognised",
  ]);
  for (let index = 0; index < items.length; index += 1) {
    const item = defined(items[index]);
    if (!item.startsWith("--"))
      throw ERRORS.create("command-does-not-accept-unnamed-value-use-appropriate", []);
    const key = item.slice(2);
    // Own names only: a typed "--constructor" must not find a name that every object inherits.
    const listKey = Object.hasOwn(LIST_OPTIONS, key) ? LIST_OPTIONS[key] : undefined;
    if (listKey !== undefined) {
      const dateValues: string[] = [];
      while (items[index + 1] !== undefined && !defined(items[index + 1]).startsWith("--")) {
        dateValues.push(defined(items[index + 1]));
        index += 1;
      }
      if (dateValues.length === 0)
        throw ERRORS.create("at-least-one-value", [`${optionSubject(key)}`]);
      const existing = parsed[listKey];
      parsed[listKey] =
        existing === undefined
          ? dateValues
          : [...(Array.isArray(existing) ? existing : [String(existing)]), ...dateValues];
      continue;
    }
    const next = items[index + 1];
    if (next === undefined || next.startsWith("--")) {
      if (!booleanOptions.has(key))
        throw ERRORS.create("requires-value", [`${optionSubject(key)}`]);
      parsed[key] = true;
      continue;
    }
    index += 1;
    const existing = parsed[key];
    if (existing === undefined) parsed[key] = next;
    else if (Array.isArray(existing)) existing.push(next);
    else parsed[key] = [String(existing), next];
  }
  // An on-or-off option takes no value, for every command: "--missing-word yes" would otherwise
  // be read as off, and the search asked for silently left out.
  for (const key of booleanOptions) assertFlag(parsed, key);
  return parsed;
}

/** The key of the dates of the old backup, which Re-encode reads beside the new backup's. */
export const OLD_DATES_KEY = "old-date";

/** The options that take a list of values: the flag typed, and the key they are kept under. */
const LIST_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  dates: "date",
  "old-dates": OLD_DATES_KEY,
});

/** The flag of the option kept under `key`, as it is typed: "--dates" for "date". */
export function flagOf(key: string): string {
  const flag = Object.keys(LIST_OPTIONS).find((name) => LIST_OPTIONS[name] === key) ?? key;
  return `--${flag}`;
}

/**
 * Refuses any of `options` given beside --ask-secrets, which asks for them on the private screen
 * instead: a secret is taken in one way only. Every command that asks for secrets refuses so, each
 * with its own options.
 */
export function assertAskedNotGiven(arguments_: ParsedArguments, options: readonly string[]): void {
  if (arguments_["ask-secrets"] !== true) return;
  const given = options.filter((key) => arguments_[key] !== undefined);
  if (given.length > 0)
    throw ERRORS.create("ask-secrets-cannot-combined", [`${listInWords(given.map(flagOf), "or")}`]);
}

export function value(arguments_: ParsedArguments, key: string): string | undefined {
  const result = arguments_[key];
  return typeof result === "string" ? result : undefined;
}

/**
 * The option `key`, which must be one of `choices`; undefined when it is not given. The refusal
 * names the choices from the same list: "--input-kind must be codes or share."
 */
export function choiceOption<Choice extends string>(
  arguments_: ParsedArguments,
  key: string,
  choices: readonly Choice[],
): Choice | undefined {
  const given = value(arguments_, key);
  if (given === undefined) return undefined;
  if (!(choices as readonly string[]).includes(given))
    throw ERRORS.create("refused", [`${key}`, `${listInWords(choices, "or")}`]);
  return given as Choice;
}

export function values(arguments_: ParsedArguments, key: string): string[] {
  const result = arguments_[key];
  if (Array.isArray(result)) return result;
  if (typeof result === "string") return [result];
  return [];
}

export interface IntegerOptionBounds extends WholeRange {
  defaultValue?: number;
  /** What the value is, where the option means another thing for this command (option-copy.ts). */
  label?: string;
}

/** A base-10 integer as an option takes it: no sign, exponent, point or leading zero. */
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

/** Parse a canonical base-10 integer without accepting JavaScript numeric syntax. */
export function integerOption(
  arguments_: ParsedArguments,
  key: string,
  bounds: IntegerOptionBounds,
): number {
  const raw = value(arguments_, key);
  const named = bounds.label === undefined ? optionValue(key) : `The ${bounds.label} value`;
  if (raw === undefined) {
    if (bounds.defaultValue !== undefined) return bounds.defaultValue;
    throw ERRORS.create("required", [`${named}`]);
  }
  const parsed = wholeNumberOf(raw, CANONICAL_INTEGER, bounds);
  if (parsed === undefined)
    throw ERRORS.create("base-10-integer-from", [`${named}`, `${rangeText(bounds)}`]);
  return parsed;
}

/** The options that may be given more than once; every other option takes one value. */
const REPEATABLE_OPTIONS: readonly string[] = ["date", OLD_DATES_KEY, ...SHARE_SOURCE_OPTIONS];

/**
 * Refuses an option given more than once, unless it is one of `repeatable`: every option that may
 * be repeated, or the fewer that a command takes so.
 */
export function assertSingleValues(
  arguments_: ParsedArguments,
  repeatable: readonly string[] = REPEATABLE_OPTIONS,
): void {
  for (const [key, entry] of Object.entries(arguments_)) {
    if (Array.isArray(entry) && !repeatable.includes(key))
      throw ERRORS.create("provide-only-one-value-setting", [`${optionLabel(key)}`]);
  }
}

/** Refuses each of `names` that is given without a value or more than once: each takes one text. */
export function assertTextValues(arguments_: ParsedArguments, names: readonly string[]): void {
  for (const name of names) {
    if (arguments_[name] !== undefined && typeof arguments_[name] !== "string")
      throw ERRORS.create("provide-exactly-one-value-setting", [`${optionLabel(name)}`]);
  }
}

export function assertAllowedArguments(
  arguments_: ParsedArguments,
  command: string,
  allowed: readonly string[],
): void {
  assertSingleValues(arguments_);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(arguments_).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0)
    throw ERRORS.create("command-does-not-support-setting", [
      `${command}`,
      `${optionLabel(defined(unknown[0]))}`,
    ]);
}

export function assertFlag(arguments_: ParsedArguments, key: string): void {
  if (arguments_[key] !== undefined && arguments_[key] !== true)
    throw ERRORS.create("on-off-choice-does-not-accept-separate-value", [`${optionSubject(key)}`]);
}
