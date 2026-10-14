// Arrays with holes, which the code under test must refuse: JavaScript callers can pass them, and
// every() and forEach() skip a hole as if it were not there.

/** An array of `length` holes and no element. */
export function holes<T>(length: number): T[] {
  const list: T[] = [];
  list.length = length;
  return list;
}

/** `values` with the elements at `at` taken out, so that the array keeps its length. */
export function withHoles<T>(values: T[], ...at: number[]): T[] {
  for (const index of at) Reflect.deleteProperty(values, index);
  return values;
}
