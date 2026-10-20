import { pageDimensions, resolvePageSize, type CardSettings } from "./card-settings.js";

// Points in a millimetre (page-units.ts), here too for the card layouts that take it with CardBox.
export { MM } from "./page-units.js";

/** A rectangle in millimetres, measured from the top left of the page. */
export interface MmRect {
  /** The left edge, in millimetres from the left edge of the page. */
  x: number;
  /** The top edge, in millimetres from the top edge of the page. */
  y: number;
  /** The width, in millimetres. */
  width: number;
  /** The height, in millimetres. */
  height: number;
}

/** Coordinates in millimetres, measured from the top left, of card `index`. */
export interface CardBox extends MmRect {
  /** The card's place among the cards of the content, counted from 0. */
  index: number;
}

/**
 * The size of each of `count` cells that fill `span` with `gap` between neighbours. Every grid of
 * cards and sheet columns divides its room so.
 */
export function runCellSize(span: number, count: number, gap: number): number {
  return (span - (count - 1) * gap) / count;
}

/**
 * Where a run of `count` cells of `size`, `gap` apart, starts so that it is centred in `span`:
 * an incomplete last row of a grid, or the rows of a grid on a page.
 */
export function centredRunStart(span: number, count: number, size: number, gap: number): number {
  return (span - count * size - (count - 1) * gap) / 2;
}

/** Where a separate card lies on its page, in millimetres from the top left (separateCardPage). */
export interface SeparateCardPage {
  /** The width of the page, in millimetres, in the orientation asked for. */
  readonly width: number;
  /** The height of the page, in millimetres, in the orientation asked for. */
  readonly height: number;
  /** The left edge of the drawn card, in millimetres from the left edge of the page. */
  readonly x: number;
  /** The top edge of the drawn card, in millimetres from the top edge of the page. */
  readonly top: number;
  /** The factor the card is drawn at: 1, or less where the page is smaller than the card. */
  readonly scale: number;
}

/**
 * The page of a separate card of `cardWidth` x `cardHeight` millimetres and where the card lies on
 * it: the size and the orientation that `settings` ask for, the business size by default, checked
 * as every family checks them (pageDimensions); the card centred, and drawn smaller only where the
 * page is smaller than the card. The business cards place their separate cards so.
 */
export function separateCardPage(
  settings: Pick<CardSettings, "pageSize" | "orientation">,
  cardWidth: number,
  cardHeight: number,
): SeparateCardPage {
  const [width, height] = pageDimensions(
    resolvePageSize(settings.pageSize, true),
    settings.orientation,
  );
  const scale = Math.min(1, width / cardWidth, height / cardHeight);
  return {
    width,
    height,
    x: (width - cardWidth * scale) / 2,
    top: (height - cardHeight * scale) / 2,
    scale,
  };
}
