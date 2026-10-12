// The content of the cards of an encoded backup: its colours. Every way of saving the cards (a PDF,
// page images, separate card files, the dry run of Encode, the sample cards, a page) builds it
// here, so that each draws the same backup.
//
// Host-neutral: it imports only the core and card-settings.ts. A backup is
// taken by its shape (CardBackup), which EncodedBackup has, so that this module needs no backup
// class and the renderers do not reach it.

import { indexesToColors } from "../core/colors.js";
import { EncodedForm } from "../core/encoded-form.js";
import type { EncodedFormat } from "../core/types.js";
import type { CardSettings } from "./card-settings.js";

/** What cards are drawn from: codes in their form, such as an EncodedBackup. */
export interface CardBackup {
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
  /** The title of the sheet, where a design shows one. */
  readonly title?: string | undefined;
}

/**
 * The content of the colour cards of a seed phrase: its colours, and the codes their QR code holds.
 * Every card template draws it (templates.ts); defined here, beside the one function that builds
 * it, so that this module needs no renderer.
 */
export type CardContent = CardSettings & {
  readonly kind: "colors";
  readonly colors: readonly string[];
  readonly payload: string;
  readonly title?: string;
};

/**
 * The content of the cards of `backup`: its colours with `details.settings`. Refuses a form that
 * no card prints (EncodedForm cardKind).
 */
export function backupCardContent(backup: CardBackup, details: CardDetails = {}): CardContent {
  const kind = EncodedForm.of(backup.format).cardKind;
  if (kind === undefined) throw new Error(`No card prints codes written as ${backup.format}.`);
  return Object.freeze({
    ...details.settings,
    kind,
    colors: Object.freeze(indexesToColors(backup.indexes)),
    payload: backup.text(),
    ...(details.title === undefined ? {} : { title: details.title }),
  });
}
