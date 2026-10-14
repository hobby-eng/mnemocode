// Vitest's asymmetric matchers, typed unknown: Vitest types them any, which the lint gate keeps
// out of the code (TS-02). A matcher stands where expect compares a value with it.

import { expect } from "vitest";

/** A string that holds `text`. */
export function containing(text: string): unknown {
  return expect.stringContaining(text);
}

/** A string that `pattern` matches. */
export function matching(pattern: RegExp | string): unknown {
  return expect.stringMatching(pattern);
}

/** Any value made by `kind`, such as any Error or any Number. */
export function anyOf(kind: unknown): unknown {
  return expect.any(kind);
}
