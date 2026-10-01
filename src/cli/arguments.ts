import { optionLabel, optionSubject, optionValue } from "./option-copy.js";

export type ParsedArguments = Record<string, string | boolean | string[]>;

export function parseArguments(items: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {};
  const booleanOptions = new Set([
    "card-qr",
    "sskr",
    "all",
    "ask-secrets",
    "cards",
    "legacy-valid-last-word",
    "list",
  ]);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!item.startsWith("--"))
      throw new Error(
        "This command does not accept an unnamed value. Use the appropriate named option.",
      );
    const key = item.slice(2);
    if (key === "dates" || key === "events") {
      const dateValues: string[] = [];
      while (items[index + 1] !== undefined && !items[index + 1]!.startsWith("--")) {
        dateValues.push(items[index + 1]!);
        index += 1;
      }
      if (dateValues.length === 0)
        throw new Error(`${optionSubject(key)} needs at least one value.`);
      const target = key === "dates" ? "date" : "event";
      const existing = parsed[target];
      parsed[target] =
        existing === undefined
          ? dateValues
          : [...(Array.isArray(existing) ? existing : [String(existing)]), ...dateValues];
      continue;
    }
    const next = items[index + 1];
    if (next === undefined || next.startsWith("--")) {
      if (!booleanOptions.has(key)) throw new Error(`${optionSubject(key)} requires a value.`);
      parsed[key] = true;
      continue;
    }
    index += 1;
    const existing = parsed[key];
    if (existing === undefined) parsed[key] = next;
    else if (Array.isArray(existing)) existing.push(next);
    else parsed[key] = [String(existing), next];
  }
  return parsed;
}

export function value(arguments_: ParsedArguments, key: string): string | undefined {
  const result = arguments_[key];
  return typeof result === "string" ? result : undefined;
}

export function values(arguments_: ParsedArguments, key: string): string[] {
  const result = arguments_[key];
  if (Array.isArray(result)) return result;
  if (typeof result === "string") return [result];
  return [];
}

export interface IntegerOptionBounds {
  defaultValue?: number;
  min: number;
  max: number;
}

/** Parse a canonical base-10 integer without accepting JavaScript numeric syntax. */
export function integerOption(
  arguments_: ParsedArguments,
  key: string,
  bounds: IntegerOptionBounds,
): number {
  const raw = value(arguments_, key);
  if (raw === undefined) {
    if (bounds.defaultValue !== undefined) return bounds.defaultValue;
    throw new Error(`${optionValue(key)} is required.`);
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new Error(
      `${optionValue(key)} must be a base-10 integer from ${bounds.min} through ${bounds.max}.`,
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `${optionValue(key)} must be a base-10 integer from ${bounds.min} through ${bounds.max}.`,
    );
  }
  return parsed;
}

export function assertAllowedArguments(
  arguments_: ParsedArguments,
  command: string,
  allowed: readonly string[],
): void {
  const repeatable = new Set(["date", "event", "share", "share-file", "share-qr"]);
  for (const [key, entry] of Object.entries(arguments_)) {
    if (Array.isArray(entry) && !repeatable.has(key))
      throw new Error(`Provide only one value for the ${optionLabel(key)} setting.`);
  }
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(arguments_).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0)
    throw new Error(
      `The ${command} command does not support the ${optionLabel(unknown[0]!)} setting.`,
    );
}

export function assertFlag(arguments_: ParsedArguments, key: string): void {
  if (arguments_[key] !== undefined && arguments_[key] !== true)
    throw new Error(
      `${optionSubject(key)} is an on-or-off choice and does not accept a separate value.`,
    );
}
