import {
  SHEET_SIZES_TEXT,
  isCardPageSize,
  type CardPageSize,
  type CardSettings,
  assertSeparateCardSize,
} from "./card-settings.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { isOneOf } from "../core/one-of.js";
import { assertSeparateCards, type CatalogEntry } from "./template-catalog.js";

const ERRORS = new ErrorCatalog("export.sskr-content", {
  "card-layout-one": (value0: string) => `The card layout must be one of: ${value0}.`,
  "business-page-size-gives-separate-cards-choose-size": (value0: string) =>
    `The business page size gives separate cards. Choose the ${value0} size for a collection sheet.`,
});

/** The layouts of share cards that a caller may ask for. */
export const SSKR_CARD_LAYOUTS = Object.freeze(["qr", "collection", "individual"] as const);
/** A layout of share cards (SSKR_CARD_LAYOUTS). */
export type SskrCardLayout = (typeof SSKR_CARD_LAYOUTS)[number];

/**
 * `value` as a layout of share cards; undefined stays undefined, for the page size to decide.
 * Refuses a name of no layout, naming those there are (export.sskr-content.card-layout-one).
 */
export function parseSskrLayout(value: string | undefined): SskrCardLayout | undefined {
  if (value === undefined) return undefined;
  if (!isOneOf(SSKR_CARD_LAYOUTS, value))
    throw ERRORS.create("card-layout-one", [`${SSKR_CARD_LAYOUTS.join(", ")}`]);
  return value;
}

/**
 * What a layout of share cards decides for its cards, in one place (CORE-06): the share cards
 * (sskr-render.ts) and the hosts that save them ask it instead of testing the layout, so that a new
 * layout is one entry of SSKR_LAYOUT_RULES, which the compiler asks for.
 */
export interface SskrLayoutRules {
  /**
   * Whether each card of a share is a document of its own, a fragment numbered in its folder;
   * otherwise a share is one document, a sheet, A6 unless another size is asked for. Separate cards
   * never carry a QR code.
   */
  readonly separateCards: boolean;
  /**
   * Whether each share's sheet carries a QR code of the whole share, which cannot become separate
   * cards.
   */
  readonly wholeShareQr: boolean;
  /** Whether the mixed style starts each share's sheet at another design, by its member. */
  readonly designByMember: boolean;
  /**
   * Refuses a page size that the layout cannot have; none given passes. Each refusal is named in
   * resolveSskrLayout.
   */
  readonly assertPageSize: (pageSize: CardPageSize | undefined) => void;
  /** Refuses a design that cannot draw the layout (export.template-catalog.sheets-only). */
  readonly assertDesign: (design: CatalogEntry) => void;
}

/** Refuses the business size for a collection sheet, which it gives as separate cards. */
function assertCollectionSize(pageSize: CardPageSize | undefined): void {
  if (isCardPageSize(pageSize))
    throw ERRORS.create("business-page-size-gives-separate-cards-choose-size", [
      `${SHEET_SIZES_TEXT}`,
    ]);
}

/** Accepts what is asked: the layout has no rule of its own here. */
function anyFits(): void {
  // Nothing to refuse.
}

/** The rules of each layout of share cards: a new layout cannot compile without its entry. */
export const SSKR_LAYOUT_RULES: Readonly<Record<SskrCardLayout, SskrLayoutRules>> = Object.freeze({
  // A QR card holds one whole share and is available in every size.
  qr: Object.freeze({
    separateCards: false,
    wholeShareQr: true,
    designByMember: true,
    assertPageSize: anyFits,
    assertDesign: anyFits,
  }),
  collection: Object.freeze({
    separateCards: false,
    wholeShareQr: false,
    designByMember: false,
    assertPageSize: assertCollectionSize,
    assertDesign: anyFits,
  }),
  individual: Object.freeze({
    separateCards: true,
    wholeShareQr: false,
    designByMember: false,
    assertPageSize: assertSeparateCardSize,
    assertDesign: assertSeparateCards,
  }),
});

/**
 * The page size decides the layout, as for ordinary cards: a sheet size gives one
 * collection sheet per share, a card size gives separate numbered cards. A QR card
 * holds one whole share and is available in every size. Refuses a layout of none
 * (export.sskr-content.card-layout-one), which a JavaScript host may pass, a collection sheet of
 * the business size (export.sskr-content.business-page-size-gives-separate-cards-choose-size), and
 * separate cards of a sheet size
 * (export.card-settings.separate-cards-business-size-choose-business-size-leave).
 */
export function resolveSskrLayout(
  requested: SskrCardLayout | undefined,
  pageSize: CardPageSize | undefined,
): SskrCardLayout {
  const layout =
    parseSskrLayout(requested) ?? (isCardPageSize(pageSize) ? "individual" : "collection");
  SSKR_LAYOUT_RULES[layout].assertPageSize(pageSize);
  return layout;
}

/**
 * The content of the cards of one share: its colors, the codes that the cards print where they are
 * not its colors, the share as its QR code holds it, and the card settings.
 */
export interface SskrCardContent extends CardSettings {
  /** Always "sskr": the cards of a share, which name its set (collectionReference). */
  readonly kind: "sskr";
  /**
   * The colors of the cards: the share itself in the color forms; otherwise one for each distinct
   * code (codeColors, card-palette.ts), to decorate the cards that print `labels`.
   */
  readonly colors: readonly string[];
  /**
   * The share's Unicode codes, one to each card, for a share written in them: the cards print them
   * in place of the colors' hex codes.
   */
  readonly labels?: readonly string[];
  /** The share in its written form (Share.write), as its QR code holds it, without the decoys. */
  readonly payload: string;
  /** How many of the last cards are decoys (card-decoys.ts). */
  readonly decoys?: number;
  /**
   * The share's reference, such as 376C-1-2: the series that its sheets name, and on a separate
   * card after its number.
   */
  readonly collectionReference: string;
  /** Whether its sheet carries a QR code of the whole share (the qr layout); none when absent. */
  readonly qrCard?: boolean;
  /**
   * The title that the frame of its sheet names, a text of a card (cardTitle); the studio's name
   * when absent.
   */
  readonly title?: string | undefined;
}
