// The decoys of a set of cards and the way its sheet is turned, planned once for the design that
// draws them (owner, 2026-10-13): a sheet holds the backup's codes and at least one decoy in full
// rows, with the largest cards that its page allows (planCollectionSheet); separate cards take one
// decoy without laying out a sheet. Every output of the same layout keeps the same planned cards.
//
// Needs from the host: its CardRenderer, for the font and the photographs that a sheet is laid out
// with, the QR matrix of a sheet's code and the random decoys.

import {
  hasCountedDecoys,
  ownCards,
  withDecoyPool,
  keptCards,
  keptIndividualCards,
  type WithDecoys,
} from "./card-decoys.js";
import { collectionPayload } from "./collection-sheet.js";
import { planCollectionSheet, type SheetShape } from "./collection-layout.js";
import { SHEET_PAGE_SIZE, type CardPageSize, type CardSettings } from "./card-settings.js";
import type { ColorCards } from "./card-content.js";
import type { UniformChoice } from "./platform.js";
import type { CardDrawing } from "./templates.js";

/** The shape of a design's sheet of `pageSize` for some cards (CardTemplate sheetShape). */
export type SheetShaper = (
  drawing: CardDrawing,
  cards: ColorCards,
  pageSize: CardPageSize,
) => Promise<SheetShape>;

/**
 * `cards` with their decoys, drawn with `random`, and for a sheet the orientation of its plan
 * where none was given. Sheets fill rows through `shaper`; separate cards keep one decoy without
 * a sheet layout or QR code. Existing plans keep their real codes and first decoy unchanged.
 * Refuses a count of decoys that is no whole number below the cards
 * (export.card-decoys.decoy-cards-whole-number-fewer-than-cards), what withDecoyPool refuses, and
 * a sheet that planCollectionSheet refuses, such as one with no room for the cards
 * (export.collection-layout.no-room); a failure of `shaper` or of the host's QR codes passes on.
 */
export async function withPlannedDecoys<T extends ColorCards>(
  shaper: SheetShaper,
  drawing: CardDrawing,
  cards: T,
  separate: boolean,
  random: UniformChoice = drawing.randomInt,
): Promise<WithDecoys<T>> {
  // Checked as every count of decoys is (assertDecoys), before the cards are used as they are.
  if (hasCountedDecoys(cards)) {
    ownCards(cards);
    if (!separate) return cards;
    if (cards.decoys > 0) return keptIndividualCards(cards);
  }
  const pool = withDecoyPool(cards, random);
  if (separate) return keptIndividualCards(pool);
  const pageSize = cards.pageSize ?? SHEET_PAGE_SIZE;
  // The key is left out where no orientation is given: a host compiled with
  // exactOptionalPropertyTypes refuses an optional property given as undefined.
  const sheet: Pick<CardSettings, "pageSize" | "orientation"> =
    cards.orientation === undefined ? { pageSize } : { pageSize, orientation: cards.orientation };
  const shape = await shaper(drawing, pool, pageSize);
  const payload = collectionPayload(pool);
  const plan = planCollectionSheet(
    sheet,
    ownCards(cards),
    pool.colors.length,
    shape,
    payload === undefined ? undefined : drawing.qrModules(payload),
  );
  // keptCards gives a new object of its own, which takes the plan's orientation.
  return Object.assign(keptCards(pool, plan.count), { orientation: plan.orientation });
}
