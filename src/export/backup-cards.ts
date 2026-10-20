// The content of the cards of an encoded backup: its colours, or its Unicode codes in colours that
// decorate them. Every way of saving the cards (a PDF, page images, separate card files, the dry
// run of Encode, the sample cards, a page) builds it here, so that each draws the same backup.
//
// Host-neutral: it imports only the core, card-settings.ts and card-palette.ts. A backup is
// taken by its shape (CardBackup), which EncodedBackup has, so that this module needs no backup
// class and the renderers do not reach it.

import { indexesToColors } from "../core/colors.js";
import { EncodedForm } from "../core/encoded-form.js";
import { codeColors } from "./card-palette.js";
import type { EncodedFormat } from "../core/types.js";
import { cardTitle, type CardSettings } from "./card-settings.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.backup-cards", {
  "no-card-prints-codes-written-as": (value0: string) =>
    `No card prints codes written as ${value0}.`,
});

/** What cards are drawn from: codes in their form, such as an EncodedBackup. */
export interface CardBackup {
  /** The form the codes are written in; backupCardContent refuses one that no card prints. */
  readonly format: EncodedFormat;
  /** The codes as BIP39 indexes from 0 to 2047. */
  readonly indexes: readonly number[];
  /** The codes written in their form, which a QR code on the cards holds. */
  text(): string;
}

/** What the cards print besides the codes. */
export interface CardDetails {
  /** The page, the profile and the texts of the cards. */
  readonly settings?: CardSettings | undefined;
  /**
   * The title of the sheet, where a design shows one, in place of the studio name; text on one
   * line, which backupCardContent checks as every text of a card (cardTitle).
   */
  readonly title?: string | undefined;
}

/**
 * The content of the cards of a seed phrase: the colour of each card, the codes printed in place
 * of the colours where those only decorate the cards (Unicode codes), the codes that its QR code
 * holds, and how many of the last cards are decoys (card-decoys.ts). Every card template draws
 * it (templates.ts); defined here, beside the one function that builds it, so that this module
 * needs no renderer.
 */
export type CardContent = CardSettings & {
  /** Tells a seed phrase's cards from a share's (SskrCardContent). */
  readonly kind: "colors";
  /** The colour of each card as # and six hexadecimal digits: the backup's own, then the decoys. */
  readonly colors: readonly string[];
  /** The codes printed in place of the colours, one per colour, where the colours only decorate. */
  readonly labels?: readonly string[];
  /** The text of the QR code: the codes of the backup in their form, without the decoys. */
  readonly payload: string;
  /**
   * The title of the sheet, where a design shows one, in place of the studio name: in NFC, trimmed,
   * on one line and at most MAX_CARD_TEXT_LENGTH characters (cardTitle).
   */
  readonly title?: string | undefined;
  /** How many of the last cards are decoys; undefined until a plan adds them (card-plan.ts). */
  readonly decoys?: number;
};

/**
 * The content of the cards of `backup` with `details.settings`: its colours, or its Unicode codes
 * in the colours that decorate them (codeColors), without decoys yet (card-plan.ts), and the title
 * of `details` as it is drawn. Refuses, before any card is drawn, a form that names none
 * (core.encoded-form.unsupported-encoded-format) or that no card prints (EncodedForm cardKind;
 * export.backup-cards.no-card-prints-codes-written-as), and a title that is blank, on more than
 * one line or holds a control or format character
 * (export.card-settings.card-non-empty-text-on-one-line), or is longer than MAX_CARD_TEXT_LENGTH
 * (export.card-settings.card-too-long-maximum-characters), as cardTitle refuses it.
 */
export function backupCardContent(backup: CardBackup, details: CardDetails = {}): CardContent {
  const form = EncodedForm.of(backup.format);
  const kind = form.cardKind;
  if (kind === undefined)
    throw ERRORS.create("no-card-prints-codes-written-as", [`${backup.format}`]);
  const codes = form.cardCodes(backup.indexes);
  return Object.freeze({
    ...details.settings,
    kind,
    colors: Object.freeze(
      codes === undefined ? indexesToColors(backup.indexes) : codeColors(codes),
    ),
    ...(codes === undefined ? {} : { labels: Object.freeze(codes) }),
    payload: backup.text(),
    ...(details.title === undefined ? {} : { title: cardTitle(details.title) }),
  });
}
