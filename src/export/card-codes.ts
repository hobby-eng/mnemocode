// What a card prints for each element of a backup: the hex code of its color, which is the element
// itself in the color forms; or, for a Shamir share written in another form, the share's own code
// in that form (a word number, a Unicode code, a Bytewords word), when the colors only decorate the
// cards. Every card design prints through it, so that no design prints a color in place of a code.
//
// Host-neutral: it imports nothing (test/portable-modules.test.ts).

/** The colors of the cards, and the codes they print when those are not the colors. */
export interface PrintedCodes {
  readonly colors: readonly string[];
  /** The codes printed in place of the colors' hex codes, one per color, in the same order. */
  readonly labels?: readonly string[] | undefined;
}

/** The code that the card of the element at `index` prints, without a #. */
export function printedCode(content: PrintedCodes, index: number): string {
  return content.labels?.[index] ?? content.colors[index]!.slice(1).toUpperCase();
}
