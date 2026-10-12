// What the cards of a backup print and what their QR code holds must be the same backup. Every
// family of cards checks its content here before it draws, and the palette export checks its QR
// code with the same rule.

import { colorsToIndexes, unicodeToColors } from "../core/colors.js";
import { assertShareQr } from "../sskr/transport.js";
// Types only, which leave no import behind: the card families import this module.
import type { SskrCardContent } from "./sskr-content.js";
import type { CardContent } from "./backup-cards.js";

/** The refusal of cards without any reference, which every family that checks gives. */
export const EMPTY_CARD_COLLECTION = "The card collection is empty.";

/** The content that colour cards draw: the colours of a seed phrase, or a share's. */
export type ColorCards = CardContent | SskrCardContent;

/**
 * Refuses content that colour cards cannot draw: content of another kind, which a JavaScript host
 * may pass, or colours that the QR code does not hold (assertColorCardContent). Every family of
 * colour cards checks so.
 */
export function assertColorCards(
  content: CardContent | SskrCardContent,
): asserts content is ColorCards {
  if (content.kind !== "colors" && content.kind !== "sskr")
    throw new Error("These cards draw color references.");
  assertColorCardContent(content);
}

/**
 * Whether `payload`, the text of a QR code, holds `colors`: written as the colors themselves, or as
 * Color Unicode codes that decode to them.
 */
export function payloadHoldsColors(colors: readonly string[], payload: string): boolean {
  const written = colors.join(" ");
  return payload === written || unicodeToColors(payload).join(" ") === written;
}

/** The content of color cards: the colors of a seed phrase, or a share with its codes. */
export interface ColorCardContent {
  readonly kind: "colors" | "sskr";
  readonly colors: readonly string[];
  readonly payload: string;
  readonly labels?: readonly string[] | undefined;
}

/**
 * Refuses labels that the cards cannot print one by one (PrintedCodes): the colors of a seed phrase
 * are printed themselves and take none; a share's codes are one label per color, in its order, so
 * that the cards together hold every code and nothing else (AUD-012-FUN004).
 */
function assertLabelsPerColor(content: ColorCardContent): void {
  const { labels } = content;
  if (labels === undefined) return;
  if (content.kind === "colors")
    throw new Error("Cards of a seed phrase's colors print the colors themselves, not labels.");
  const owned = Array.from(labels);
  if (
    owned.length !== content.colors.length ||
    !owned.every((label) => typeof label === "string" && label.trim() !== "")
  )
    throw new Error("A share's cards print one group of its codes for each color, in order.");
}

/**
 * Refuses content whose QR code holds another backup than the cards print: for a share, the share
 * of its colors or codes (assertShareQr); for a seed phrase, colors that are a phrase's, held by
 * the QR code (payloadHoldsColors).
 */
export function assertColorCardContent(content: ColorCardContent): void {
  assertLabelsPerColor(content);
  if (content.kind === "sskr") {
    assertShareQr(content.colors, content.payload, content.labels);
    return;
  }
  colorsToIndexes(content.colors);
  if (!payloadHoldsColors(content.colors, content.payload))
    throw new Error("Collection QR does not match the printed references.");
}
