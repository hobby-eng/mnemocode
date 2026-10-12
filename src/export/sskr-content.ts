import {
  isCardPageSize,
  type CardPageSize,
  type CardSettings,
  assertSeparateCardSize,
} from "./card-settings.js";

/** The layouts of share cards that a caller may ask for. */
export const SSKR_CARD_LAYOUTS = Object.freeze(["qr", "collection", "individual"] as const);
export type SskrCardLayout = (typeof SSKR_CARD_LAYOUTS)[number];

/** `value` as a layout of share cards; undefined stays undefined, for the page size to decide. */
export function parseSskrLayout(value: string | undefined): SskrCardLayout | undefined {
  if (value === undefined) return undefined;
  if (!(SSKR_CARD_LAYOUTS as readonly string[]).includes(value))
    throw new Error(`The card layout must be one of: ${SSKR_CARD_LAYOUTS.join(", ")}.`);
  return value as SskrCardLayout;
}
/**
 * The page size decides the layout, as for ordinary cards: a sheet size gives one
 * collection sheet per share, a card size gives separate numbered cards. A QR card
 * holds one whole share and is available in every size.
 */
export function resolveSskrLayout(
  requested: SskrCardLayout | undefined,
  pageSize: CardPageSize | undefined,
): SskrCardLayout {
  if (requested === "qr") return "qr";
  const cards = isCardPageSize(pageSize);
  if (requested === "collection" && cards)
    throw new Error(
      "The business page size gives separate cards. Choose the A6 or A4 size for a collection sheet.",
    );
  if (requested === "individual") assertSeparateCardSize(pageSize);
  return requested ?? (cards ? "individual" : "collection");
}

export interface SskrCardContent extends CardSettings {
  readonly kind: "sskr";
  /**
   * The colors of the cards: the share itself in the color forms; otherwise drawn at random, none
   * twice, to decorate the cards that print `labels`.
   */
  readonly colors: readonly string[];
  /**
   * The share's codes in the form it is written in, a few to each card, for a share written as
   * word numbers, Unicode codes or words: the cards print them in place of the colors' hex codes.
   */
  readonly labels?: readonly string[];
  readonly payload: string;
  readonly collectionReference: string;
  readonly qrCard?: boolean;
  readonly title?: string;
}
