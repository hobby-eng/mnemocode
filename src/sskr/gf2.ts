// Linear algebra over GF(2) with bit vectors held in bigints: bit i of a column is equation i.
// repair.ts and joint-repair.ts write every check of a share as such equations in the bits of
// its unreadable elements, and solve them here instead of trying values.

/** The index of the highest set bit; the vector must not be zero. */
export function topBit(vector: bigint): number {
  return vector.toString(2).length - 1;
}

/**
 * Solves A x = b over GF(2), with A given by its columns: one solution, the basis of the
 * differences between solutions (each a combination of unknowns that changes nothing), and the
 * rank; undefined when there is no solution.
 */
export function solve(
  columns: readonly bigint[],
  target: bigint,
):
  | { readonly particular: bigint; readonly free: readonly bigint[]; readonly rank: number }
  | undefined {
  // Each pivot keeps its reduced column and the unknowns it combines.
  const pivots = new Map<number, { column: bigint; combination: bigint }>();
  const free: bigint[] = [];
  columns.forEach((original, index) => {
    let column = original;
    let combination = 1n << BigInt(index);
    while (column !== 0n) {
      const top = topBit(column);
      const pivot = pivots.get(top);
      if (pivot === undefined) {
        pivots.set(top, { column, combination });
        return;
      }
      column ^= pivot.column;
      combination ^= pivot.combination;
    }
    // A column that reduced to zero: this combination of unknowns changes nothing at all.
    free.push(combination);
  });
  let rest = target;
  let particular = 0n;
  while (rest !== 0n) {
    const pivot = pivots.get(topBit(rest));
    if (pivot === undefined) return undefined;
    rest ^= pivot.column;
    particular ^= pivot.combination;
  }
  return { particular, free, rank: pivots.size };
}

/** Bytes as one bit vector, byte i at bits 8i to 8i + 7. */
export function bytesToBits(bytes: Uint8Array): bigint {
  let vector = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1)
    vector = (vector << 8n) | BigInt(bytes[index]!);
  return vector;
}
