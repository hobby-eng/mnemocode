// The numbers that --format and the menu give the forms of codes: their places in ENCODED_FORMATS,
// counted from 1. The help, the messages and the questions name the forms by them, so that no
// number is written by hand anywhere (AUD-011-ARC037).

import { EncodedForm } from "../core/encoded-form.js";
import { ENCODED_FORMATS, type EncodedFormat } from "../core/types.js";
import { listInWords } from "../core/places.js";
import { findTemplate, type NoCardTemplateError } from "../export/template-catalog.js";
import { defined } from "../core/defined.js";

/** The number of a form, as --format and every question of a form take it. */
export function formatNumber(format: EncodedFormat): number {
  return ENCODED_FORMATS.indexOf(format) + 1;
}

/** `formats` by their numbers, in the order of the numbers: "4 and 5", "3, 4 or 5". */
function numbersOf(formats: readonly EncodedFormat[], last: string): string {
  return listInWords(
    formats.map(formatNumber).sort((a, b) => a - b),
    last,
  );
}

/** The numbers of the forms, as --format takes them: "1 to 5". */
export const FORMAT_NUMBER_RANGE = `${formatNumber(ENCODED_FORMATS[0])} to ${formatNumber(defined(ENCODED_FORMATS.at(-1)))}`;

/** The forms written in colors, by their numbers, as the help and the messages name them. */
export const COLOR_FORMAT_NUMBERS = numbersOf(
  ENCODED_FORMATS.filter((format) => EncodedForm.of(format).writtenInColors),
  "and",
);

/** The forms that print on cards, by their numbers, as a refusal names them: "3, 4 or 5". */
export const CARD_FORMAT_NUMBERS = numbersOf(
  ENCODED_FORMATS.filter((format) => EncodedForm.of(format).cardKind !== undefined),
  "or",
);

/**
 * The refusal of cards that no installed design draws, with the forms of that kind and those whose
 * cards a design draws, by their numbers: "… Format 3 has no template; use format 4 or 5."
 */
export function noCardTemplateMessage(refusal: NoCardTemplateError): string {
  const own = ENCODED_FORMATS.filter((format) => EncodedForm.of(format).cardKind === refusal.kind);
  const drawn = ENCODED_FORMATS.filter((format) => {
    const kind = EncodedForm.of(format).cardKind;
    return kind !== undefined && findTemplate(undefined, kind) !== undefined;
  });
  if (drawn.length === 0) return refusal.message;
  const instead = `format ${numbersOf(drawn, "or")}`;
  if (own.length === 0) return `${refusal.message} Use ${instead}.`;
  const named =
    own.length === 1
      ? `Format ${numbersOf(own, "and")} has`
      : `Formats ${numbersOf(own, "and")} have`;
  return `${refusal.message} ${named} no template; use ${instead}.`;
}

/**
 * Every form by its number, in order, each with its name in `names`, by default its own:
 * "1 english, 2 indexes, …".
 */
export function formatLegend(names?: Readonly<Record<EncodedFormat, string>>): string {
  return ENCODED_FORMATS.map(
    (format) => `${formatNumber(format)} ${names?.[format] ?? format}`,
  ).join(", ");
}
