// The kinds of content that colour cards draw, a seed phrase's colours ("colors") and a share's
// ("sskr"), and what each kind decides for its cards, in one place (CORE-06): what its QR code
// must hold, how its decoys look, the series its cards and sheets name, the reference line of its
// separate cards, whether its sheet may hold a QR code of the whole backup, and whether its QR code
// is printed on a sheet only. Every family of cards asks the rules of the content's kind
// (contentKindRules) instead of testing the kind, so that a new kind is one entry here, which the
// compiler asks for.
//
// Host-neutral: it reaches only the core's codes and colours, the card settings and the share
// transport.

import {
  assertPhraseIndexes,
  BIP39_DICTIONARY_SIZE,
  BIP39_WORD_COUNTS,
} from "../core/bip39-sizes.js";
import {
  colorsToIndexes,
  indexesToColors,
  isRgbReference,
  RGB_MAX_VALUE,
  RGB_REFERENCE_COUNTS,
  rgbHex,
  unicodeToColors,
} from "../core/colors.js";
import { EncodedForm } from "../core/encoded-form.js";
import { isOneOf } from "../core/one-of.js";
import { assertShareQr } from "../sskr/transport.js";
import { isCardPageSize, SHEET_SIZES_TEXT, type CardSettings } from "./card-settings.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.content-kinds", {
  "cards-draw-color-references": () => "These cards draw color references.",
  "collection-qr-does-not-match-printed-references": () =>
    "Collection QR does not match the printed references.",
  "decoys-added-colors-whole-phrase": () => "Decoys are added to the colors of a whole phrase.",
  "qr-code-printed-on-sheet-only-choose-size": (value0: string) =>
    `A QR code is printed on a sheet only. Choose the ${value0} size for a QR code; separate cards never carry one.`,
});

/** The kinds of content that colour cards draw: a seed phrase's colours, or a share's. */
const CONTENT_KIND_NAMES = Object.freeze(["colors", "sskr"] as const);

/** A kind of content of colour cards: "colors" for a seed phrase's, "sskr" for a share's. */
export type ContentKind = (typeof CONTENT_KIND_NAMES)[number];

/** A random whole number from 0 to below `limit`, as the checked random choice gives it. */
export type DecoyPick = (limit: number) => number;

/** What a kind of content decides for its cards. */
export interface ContentKindRules {
  /**
   * Refuses a QR code `payload` that holds another backup than the backup's own cards print: their
   * `colors`, or, where the cards print `labels` in place of the colours, those codes.
   */
  readonly assertQr: (
    colors: readonly string[],
    payload: string,
    labels: readonly string[] | undefined,
  ) => void;
  /** A decoy colour beside the `own` colours of the backup, drawn with `pick`. */
  readonly decoyColor: (pick: DecoyPick, own: number) => string;
  /** The series that a card or sheet names, from the reference of the content's set. */
  readonly series: (collectionReference: string | undefined) => string;
  /** The reference line of a separate card that prints `code`, in the series `series`. */
  readonly separateReference: (code: string, series: string) => string;
  /** Whether the sheet may hold a QR code of the whole backup, which only `qrCard: true` asks for. */
  readonly wholeBackupQr: boolean;
  /**
   * Whether the QR code that `cardQr` asks for is printed on a sheet only, so that it is refused on
   * separate cards (assertSheetQr). Share cards follow their layout instead (sskr-content.ts).
   */
  readonly qrOnSheetsOnly: boolean;
}

/** The form whose codes a seed phrase's cards print in place of its colors. */
const PRINTED_PHRASE_FORM = EncodedForm.of("unicode");

/**
 * The series of the cards and sheets of a seed phrase's colors, which has no set to name: every
 * family prints it alike (owner, 2026-10-09).
 */
const PHRASE_SERIES = "01";

/** How many colour codes there are: 2^24, six hexadecimal digits. */
const COLOR_CODES = RGB_MAX_VALUE + 1;

/**
 * Whether `payload`, the text of a QR code, holds `colors`: written as the colors themselves, or as
 * Color Unicode codes that decode to them. Other colors are other references, not Color Unicode
 * to be refused as such; any other text is read as Color Unicode, which refuses what it is not.
 */
function payloadHoldsColors(colors: readonly string[], payload: string): boolean {
  const written = colors.join(" ");
  if (payload === written) return true;
  if (payload.trim().split(/\s+/u).every(isRgbReference)) return false;
  return unicodeToColors(payload).join(" ") === written;
}

/**
 * Refuses a seed phrase's QR code `payload` that holds another phrase than its cards print: the
 * Unicode codes of the words of a whole phrase where the cards print `labels` (EncodedForm read,
 * assertPhraseIndexes), else `colors` that are a phrase's (colorsToIndexes), held by the QR code
 * (export.content-kinds.collection-qr-does-not-match-printed-references).
 */
function assertPhraseQr(
  colors: readonly string[],
  payload: string,
  labels: readonly string[] | undefined,
): void {
  if (labels !== undefined) {
    const indexes = PRINTED_PHRASE_FORM.read(labels.join(" "));
    assertPhraseIndexes(indexes);
    if (PRINTED_PHRASE_FORM.read(payload).join(" ") !== indexes.join(" "))
      throw ERRORS.create("collection-qr-does-not-match-printed-references", []);
    return;
  }
  colorsToIndexes(colors);
  if (!payloadHoldsColors(colors, payload))
    throw ERRORS.create("collection-qr-does-not-match-printed-references", []);
}

/**
 * A colour of a random seed phrase of as many colours as `colorCount`: a decoy beside a phrase's
 * colours, with an order tag and word positions like theirs. Refuses a count of no phrase's colours
 * (export.content-kinds.decoys-added-colors-whole-phrase).
 */
function phraseColor(pick: DecoyPick, colorCount: number): string {
  const words = BIP39_WORD_COUNTS[RGB_REFERENCE_COUNTS.indexOf(colorCount)];
  if (words === undefined) throw ERRORS.create("decoys-added-colors-whole-phrase", []);
  const colors = indexesToColors(Array.from({ length: words }, () => pick(BIP39_DICTIONARY_SIZE)));
  return defined(colors[pick(colors.length)]);
}

/** A random colour: a decoy beside a share's colours, which look random themselves. */
function anyColor(pick: DecoyPick): string {
  return rgbHex(pick(COLOR_CODES));
}

/** The rules of each kind of content: a new kind cannot compile without its entry. */
const CONTENT_KINDS: Readonly<Record<ContentKind, ContentKindRules>> = Object.freeze({
  colors: Object.freeze({
    assertQr: assertPhraseQr,
    decoyColor: phraseColor,
    series: () => PHRASE_SERIES,
    // A seed phrase has one series, which a separate card does not repeat.
    separateReference: (code: string) => code,
    wholeBackupQr: false,
    qrOnSheetsOnly: true,
  }),
  sskr: Object.freeze({
    assertQr: assertShareQr,
    decoyColor: anyColor,
    series: (collectionReference: string | undefined) => defined(collectionReference),
    // Every separate card of a share also names the share it belongs to.
    separateReference: (code: string, series: string) => `${code}  |  ${series}`,
    wholeBackupQr: true,
    // Separate share cards carry no QR code, and a share's QR card (the qr layout) has every size.
    qrOnSheetsOnly: false,
  }),
});

/**
 * The rules of the content kind `kind`. Refuses a kind of none, which a JavaScript host may pass
 * (export.content-kinds.cards-draw-color-references): every family of colour cards checks the
 * kind of its content so (assertColorCards).
 */
export function contentKindRules(kind: ContentKind): ContentKindRules {
  if (!isOneOf(CONTENT_KIND_NAMES, kind)) throw ERRORS.create("cards-draw-color-references", []);
  return CONTENT_KINDS[kind];
}

/**
 * Refuses a QR code on cards of the business size, which are separate cards, where the rules of
 * the content's kind print it on a sheet only (ContentKindRules qrOnSheetsOnly), as a seed
 * phrase's do (export.content-kinds.qr-code-printed-on-sheet-only-choose-size), and a kind of none
 * (export.content-kinds.cards-draw-color-references). Fast, it draws nothing: the renderers check
 * it, and a host before it asks for a secret.
 */
export function assertSheetQr(card: { readonly kind: ContentKind } & CardSettings): void {
  const { qrOnSheetsOnly } = contentKindRules(card.kind);
  if (qrOnSheetsOnly && isCardPageSize(card.pageSize) && card.cardQr === true)
    throw ERRORS.create("qr-code-printed-on-sheet-only-choose-size", [`${SHEET_SIZES_TEXT}`]);
}
