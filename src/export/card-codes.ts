// What a card prints for each element of a backup: the hex code of its color, which is the element
// itself in the color forms; or, for a Shamir share written in another form, the share's own code
// in that form (a word number, a Unicode code, a Bytewords word), when the colors only decorate the
// cards. Every card design prints through it, so that no design prints a color in place of a code.
// With the numbers in two digits that cards and the names of exported files share.
//
// Host-neutral: it imports only core/typed-number.ts (test/portable-modules.test.ts).

import { inWholeRange, wholeNumbersFrom } from "../core/typed-number.js";

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

/**
 * The file of page `index` of `count`, counted from 0, as every export names its pages: one page
 * has the name alone, several end in "-01", "-02" … ; `extension` without its point.
 */
export function pageFileName(
  base: string,
  index: number,
  count: number,
  extension: string,
): string {
  const suffix = count === 1 ? "" : `-${twoDigits(index + 1)}`;
  return `${base}${suffix}.${extension}`;
}

/** The references that one card holds where its design says nothing else: one, its own code. */
export const ONE_REFERENCE_PER_CARD = 1;

/** Why a design's references per card are refused (assertReferencesPerCard). */
export const REFERENCES_PER_CARD_REFUSAL =
  "The references that one card holds must be a whole number, at least 1.";

/**
 * Refuses `perCard` references to a card unless it is a whole number from ONE_REFERENCE_PER_CARD:
 * a design made by a host may hold any such count, but 0, a fraction, a negative count or NaN would
 * count no card or a card that holds part of a code (AUD-014-API003).
 */
export function assertReferencesPerCard(perCard: number): void {
  if (!inWholeRange(perCard, wholeNumbersFrom(ONE_REFERENCE_PER_CARD)))
    throw new Error(REFERENCES_PER_CARD_REFUSAL);
}

/**
 * How many separate cards `references` codes take, `perCard` to a card: the last card may hold
 * fewer. Every design counts its cards so (render.ts, sskr-render.ts, glass-cards.ts).
 */
export function cardCount(references: number, perCard = ONE_REFERENCE_PER_CARD): number {
  assertReferencesPerCard(perCard);
  return Math.ceil(references / perCard);
}

/** Refuses a card `index` that is not one of the `count` cards, counted from 0. */
export function assertCardIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new Error(`There is no card ${index + 1}: the cards are 1 to ${count}.`);
}

/**
 * The file name of separate card `cardIndex`, counted from 0, each holding `perCard` codes: its
 * place from 01, then the first code it prints, its words joined by hyphens, so that the name
 * needs no quotes in a shell, such as "03-A3F09C".
 */
export function separateCardName(
  content: PrintedCodes,
  cardIndex: number,
  perCard: number,
): string {
  const code = printedCode(content, cardIndex * perCard).replaceAll(" ", "-");
  return `${twoDigits(cardIndex + 1)}-${code}`;
}

/** A count or a number as cards print it: at least two digits, "07". */
export function twoDigits(number: number): string {
  return String(number).padStart(2, "0");
}

/**
 * The element at `index` as cards and sheets label it: its number, counted from 1 among all the
 * elements, `of` the count where a separate card names it ("07 / 12"), then `gap` and its printed
 * code, such as "07  A3F09C". Each design keeps its own gap.
 */
export function numberedCode(
  content: PrintedCodes,
  index: number,
  gap = "  ",
  of?: number,
): string {
  const number =
    of === undefined ? twoDigits(index + 1) : `${twoDigits(index + 1)} / ${twoDigits(of)}`;
  return `${number}${gap}${printedCode(content, index)}`;
}
