// Whether a value is one of a list of literal values, such as a form or a mode that a person or a
// host names: the guard that each list's own predicate (isEncodedFormat, isShareFormat, …) is
// written with, so that TypeScript learns the value's type from the check itself, with no type
// assertion (TS-04).
//
// Host-neutral: it imports nothing.

/** Whether `value` is one of `values`, each compared with ===; then it has their type. */
export function isOneOf<T>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}
