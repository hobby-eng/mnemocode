// What the cards of a backup print and what their QR code holds must be the same backup. Every
// family of cards checks its content here before it draws, and the palette export checks its QR
// code with the same rule.

import { ownCards } from "./card-decoys.js";
import { cardTitle } from "./card-settings.js";
import { contentKindRules, type ContentKind } from "./content-kinds.js";
// Types only, which leave no import behind: the card families import this module.
import type { SskrCardContent } from "./sskr-content.js";
import type { CardContent } from "./backup-cards.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.card-content", {
  "cards-print-codes-print-one-code-each-color": () =>
    "Cards that print codes print one code for each color, in order.",
});

/** The refusal of cards without any reference, which every family that checks gives. */
export const EMPTY_CARD_COLLECTION = "The card collection is empty.";

/** The content that colour cards draw: the colours of a seed phrase, or a share's. */
export type ColorCards = CardContent | SskrCardContent;

/**
 * Refuses content that colour cards cannot draw: content of another kind, which a JavaScript host
 * may pass, as contentKindRules refuses it (export.content-kinds.cards-draw-color-references), or
 * what assertColorCardContent refuses, such as colours that the QR code does not hold. Every family
 * of colour cards checks so.
 */
export function assertColorCards(
  content: CardContent | SskrCardContent,
): asserts content is ColorCards {
  contentKindRules(content.kind);
  assertColorCardContent(content);
}

/**
 * The content of color cards: the colors of a seed phrase, or a share's, or the Unicode codes of
 * either printed on cards whose colors decorate them; and how many of the last cards are decoys.
 */
export interface ColorCardContent {
  /** A seed phrase's cards ("colors") or a share's ("sskr"), whose QR code is checked as such. */
  readonly kind: ContentKind;
  /** The color of each card as # and six hexadecimal digits: the backup's own, then the decoys. */
  readonly colors: readonly string[];
  /** The text of the QR code: the backup alone, without the decoys. */
  readonly payload: string;
  /** The codes printed in place of the colors, one per color, where the colors only decorate. */
  readonly labels?: readonly string[] | undefined;
  /** How many of the last cards are decoys: a whole number below the cards; none if undefined. */
  readonly decoys?: number | undefined;
  /**
   * The title of the sheet in place of the studio name, a text of a card (cardTitle); the studio's
   * name where undefined.
   */
  readonly title?: string | undefined;
}

/**
 * Refuses labels that the cards cannot print one by one (PrintedCodes): one code per color, in
 * order, so that the cards together hold every code and nothing else (AUD-012-FUN004).
 */
function assertLabelsPerColor(content: ColorCardContent): void {
  const { labels } = content;
  if (labels === undefined) return;
  const owned = Array.from(labels);
  if (
    owned.length !== content.colors.length ||
    !owned.every((label) => typeof label === "string" && label.trim() !== "")
  )
    throw ERRORS.create("cards-print-codes-print-one-code-each-color", []);
}

/**
 * Refuses content whose QR code holds another backup than the cards print before their decoys, as
 * the rules of its kind refuse it (ContentKindRules assertQr): for a share, the share of its colors
 * or codes, as assertShareQr refuses it; for a seed phrase, colors that are a phrase's
 * (colorsToIndexes), or the Unicode codes of a phrase (EncodedForm read, assertPhraseIndexes),
 * held by the QR code (export.content-kinds.collection-qr-does-not-match-printed-references); and
 * a kind of none (export.content-kinds.cards-draw-color-references). Refuses labels that are
 * not one code for each color
 * (export.card-content.cards-print-codes-print-one-code-each-color), and the decoys after the
 * codes only for their count (export.card-decoys.decoy-cards-whole-number-fewer-than-cards). A
 * title is refused as the title of a sheet (cardTitle), so that a host that builds the content
 * itself cannot draw one that the cards of a backup would refuse.
 */
export function assertColorCardContent(content: ColorCardContent): void {
  if (content.title !== undefined) cardTitle(content.title);
  assertLabelsPerColor(content);
  const own = ownCards(content);
  contentKindRules(content.kind).assertQr(
    content.colors.slice(0, own),
    content.payload,
    content.labels?.slice(0, own),
  );
}
