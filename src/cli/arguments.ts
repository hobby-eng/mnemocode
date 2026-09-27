export type ParsedArguments = Record<string, string | boolean | string[]>;

export function parseArguments(items: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {};
  const booleanOptions = new Set([
    'card-qr',
    'sskr',
    'all',
    'ask-secrets',
    'cards',
    'legacy-valid-last-word',
    'list',
  ]);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!item.startsWith('--'))
      throw new Error('Unexpected positional argument. Pass values through their named options.');
    const key = item.slice(2);
    if (key === 'dates' || key === 'events') {
      const dateValues: string[] = [];
      while (items[index + 1] !== undefined && !items[index + 1]!.startsWith('--')) {
        dateValues.push(items[index + 1]!);
        index += 1;
      }
      if (dateValues.length === 0)
        throw new Error(`--${key} must be followed by at least one value.`);
      const target = key === 'dates' ? 'date' : 'event';
      const existing = parsed[target];
      parsed[target] =
        existing === undefined
          ? dateValues
          : [...(Array.isArray(existing) ? existing : [String(existing)]), ...dateValues];
      continue;
    }
    const next = items[index + 1];
    if (next === undefined || next.startsWith('--')) {
      if (!booleanOptions.has(key)) throw new Error(`--${key} requires a value.`);
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
  return typeof result === 'string' ? result : undefined;
}

export function values(arguments_: ParsedArguments, key: string): string[] {
  const result = arguments_[key];
  if (Array.isArray(result)) return result;
  if (typeof result === 'string') return [result];
  return [];
}

export function assertAllowedArguments(
  arguments_: ParsedArguments,
  command: string,
  allowed: readonly string[],
): void {
  const repeatable = new Set(['date', 'event', 'share', 'share-file', 'share-qr']);
  for (const [key, entry] of Object.entries(arguments_)) {
    if (Array.isArray(entry) && !repeatable.has(key))
      throw new Error(`--${key} must be supplied once.`);
  }
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(arguments_).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0)
    throw new Error(`Unknown or unsupported option for ${command}: --${unknown[0]}.`);
}

export function assertFlag(arguments_: ParsedArguments, key: string): void {
  if (arguments_[key] !== undefined && arguments_[key] !== true)
    throw new Error(`--${key} does not take a value.`);
}
