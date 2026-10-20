// Decoys: random codes after a backup's own codes on its cards (owner, 2026-10-13). A sheet of
// cards ends in full rows, which a backup's own codes seldom fill, and with a few more codes its
// cards may be larger: a set of cards has at least one decoy, then as many as give the largest
// cards in full rows on one sheet (planCollectionSheet, collection-layout.ts). Separate cards have
// exactly one decoy. A decoy looks like the backup's codes: the Unicode code of a random word
// beside printed codes, else a colour as the kind of the content draws it (content-kinds.ts), of a
// random phrase of the same length or a random one beside the colours of a share. The QR code of
// the cards holds the backup alone; the sheet for heirs says how many codes the backup has, and a
// restore reads that many from the start.
//
// Host-neutral: it reaches only the core's codes, card-palette.ts, content-kinds.ts and
// platform.ts for the checked random choice.

import { BIP39_DICTIONARY_SIZE } from "../core/bip39-sizes.js";
import { unicodeCodesOfIndexes } from "../core/words.js";
import { codeColors } from "./card-palette.js";
import { contentKindRules, type ContentKind, type DecoyPick } from "./content-kinds.js";
import { checkedChoice, type UniformChoice } from "./platform.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.card-decoys", {
  "decoy-cards-whole-number-fewer-than-cards": () =>
    "The decoy cards must be a whole number, fewer than the cards.",
  "cards-their-decoys-already": () => "These cards have their decoys already.",
  "cards-kept-hold-every-code-backup": () => "The cards kept must hold every code of the backup.",
});

/** The most decoys that a set of cards takes: more than any sheet needs to fill its last row. */
export const MAX_DECOYS = 16;

/** Separate cards need no grid padding: one extra card follows all real codes. */
const INDIVIDUAL_DECOYS = 1;

/** Why a random source is refused that gave a number out of range. */
const RANDOM_REFUSAL = "The random source of the decoy cards gave a number out of range.";

/**
 * The cards that decoys are added to: colours, the codes printed in their place, and the decoys.
 */
export interface DecoyCards {
  /** A seed phrase's cards ("colors") or a share's ("sskr"). */
  readonly kind: ContentKind;
  /** The colour of each card as # and six hexadecimal digits: the backup's own, then the decoys. */
  readonly colors: readonly string[];
  /** The codes printed in place of the colours, one per card, where the colours only decorate. */
  readonly labels?: readonly string[] | undefined;
  /** How many of the last cards are decoys; none when undefined. */
  readonly decoys?: number | undefined;
}

/** Cards whose decoys are counted. */
export type WithDecoys<T extends DecoyCards> = T & {
  /** How many of the last cards are decoys: a whole number from 0, below the number of cards. */
  readonly decoys: number;
};

/** Whether the decoys of `cards` are counted, as a plan counts them; assertDecoys checks them. */
export function hasCountedDecoys<T extends DecoyCards>(cards: T): cards is WithDecoys<T> {
  return cards.decoys !== undefined;
}

/**
 * Refuses a count of decoys that is no whole number from 0 to below the number of cards
 * (export.card-decoys.decoy-cards-whole-number-fewer-than-cards).
 */
export function assertDecoys(cards: DecoyCards): void {
  const { decoys } = cards;
  if (decoys === undefined) return;
  if (!Number.isSafeInteger(decoys) || decoys < 0 || decoys >= cards.colors.length)
    throw ERRORS.create("decoy-cards-whole-number-fewer-than-cards", []);
}

/**
 * How many of the cards print the backup's own codes: all but the decoys after them. Refuses a
 * count of decoys as assertDecoys does
 * (export.card-decoys.decoy-cards-whole-number-fewer-than-cards).
 */
export function ownCards(cards: DecoyCards): number {
  assertDecoys(cards);
  return cards.colors.length - (cards.decoys ?? 0);
}

/** The Unicode code of a random word: a decoy beside the Unicode codes of a phrase or a share. */
function wordCode(pick: DecoyPick): string {
  return defined(unicodeCodesOfIndexes([pick(BIP39_DICTIONARY_SIZE)])[0]);
}

/**
 * `cards` with MAX_DECOYS decoys after its own codes, drawn with `random`, of which a plan keeps
 * the first few (keptCards): Unicode codes of words beside printed codes, else colours as the rules
 * of the kind of `cards` draw them (ContentKindRules decoyColor). Cards that print codes take their
 * colours again for every code (codeColors), which keeps the colours of their own codes. Refuses
 * cards that have decoys already (export.card-decoys.cards-their-decoys-already), a kind of none
 * (export.content-kinds.cards-draw-color-references), colours of a seed phrase whose count is no
 * phrase's (export.content-kinds.decoys-added-colors-whole-phrase), and a number from `random`
 * that is no whole number below its limit (export.platform.checked-choice-refused).
 */
export function withDecoyPool<T extends DecoyCards>(
  cards: T,
  random: UniformChoice,
): WithDecoys<T> {
  if ((cards.decoys ?? 0) !== 0) throw ERRORS.create("cards-their-decoys-already", []);
  const { decoyColor } = contentKindRules(cards.kind);
  const pick: DecoyPick = (limit) => checkedChoice(random, limit, RANDOM_REFUSAL);
  const own = cards.colors.length;
  const decoys = Array.from({ length: MAX_DECOYS }, () =>
    cards.labels !== undefined ? wordCode(pick) : decoyColor(pick, own),
  );
  if (cards.labels === undefined)
    return { ...cards, colors: [...cards.colors, ...decoys], decoys: MAX_DECOYS };
  const labels = [...cards.labels, ...decoys];
  return { ...cards, labels, colors: codeColors(labels), decoys: MAX_DECOYS };
}

/**
 * `cards` with only their first `count` cards: their own codes and the decoys that fit. Refuses a
 * `count` that is no whole number from the own cards to all the cards
 * (export.card-decoys.cards-kept-hold-every-code-backup), and a count of decoys that ownCards
 * refuses.
 */
export function keptCards<T extends DecoyCards>(cards: T, count: number): WithDecoys<T> {
  const own = ownCards(cards);
  if (!Number.isSafeInteger(count) || count < own || count > cards.colors.length)
    throw ERRORS.create("cards-kept-hold-every-code-backup", []);
  return {
    ...cards,
    colors: cards.colors.slice(0, count),
    ...(cards.labels === undefined ? {} : { labels: cards.labels.slice(0, count) }),
    decoys: count - own,
  };
}

/**
 * Keeps every real code and the first decoy of an existing plan or decoy pool, without redrawing.
 * Refuses cards without a decoy, which have no first one to keep
 * (export.card-decoys.cards-kept-hold-every-code-backup), and a count of decoys that ownCards
 * refuses.
 */
export function keptIndividualCards<T extends DecoyCards>(cards: T): WithDecoys<T> {
  const count = ownCards(cards) + INDIVIDUAL_DECOYS;
  return hasCountedDecoys(cards) && cards.decoys === INDIVIDUAL_DECOYS
    ? cards
    : keptCards(cards, count);
}
