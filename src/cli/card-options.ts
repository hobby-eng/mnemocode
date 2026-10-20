import { BUSINESS_OPTION_NAMES, businessOptions } from "./business-options.js";
import { selectTemplate, type CardTemplate } from "../export/templates.js";
import { NoCardTemplateError } from "../export/template-catalog.js";
import { type CardKind, type EncodedFormat } from "../core/types.js";

import { value, type ParsedArguments } from "./arguments.js";
import { CARD_FORMAT_NUMBERS, noCardTemplateMessage } from "./format-numbers.js";
import { EncodedForm } from "../core/encoded-form.js";
import { assertIndividualTemplate, type CardOutputs } from "../export/render.js";
import { isCardPageSize, parsePageSize } from "../export/card-settings.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.card-options", {
  "provide-individual-card-output-folder-once-using-non": () =>
    "Provide the individual-card output folder once, using a non-empty path.",
  "card-settings-require-pdf-file-image-output-folder": () =>
    "Card settings require a PDF file, an image output folder or an individual-card output folder.",
  "card-export-requires-format": (value0: string) => `Card export requires format ${value0}.`,
  "card-template-refused": suppliedMessage,
});

/** Which card outputs the options name. */
export function cardOutputs(args: ParsedArguments): CardOutputs {
  return {
    sheets: value(args, "pdf") !== undefined || value(args, "images-dir") !== undefined,
    cards: value(args, "cards-dir") !== undefined,
  };
}

/**
 * The card outputs that the options name, after refusing a folder of separate cards given twice,
 * and any of `settings`, the card settings of a command, given without a card output that would
 * use them; a blank path is refused with every output (validateOutputPaths). Encode and the
 * commands of shares each pass their own settings.
 */
export function assertCardOutput(args: ParsedArguments, settings: readonly string[]): CardOutputs {
  if (args["cards-dir"] !== undefined && typeof args["cards-dir"] !== "string")
    throw ERRORS.create("provide-individual-card-output-folder-once-using-non", []);
  const outputs = cardOutputs(args);
  if (!outputs.sheets && !outputs.cards && settings.some((name) => args[name] !== undefined))
    throw ERRORS.create("card-settings-require-pdf-file-image-output-folder", []);
  return outputs;
}

/** Encode's card settings, which a card output must use (assertCardOutput). */
export const ENCODE_CARD_SETTINGS = ["template", "title", ...BUSINESS_OPTION_NAMES] as const;

/** Refuses card options that cannot draw cards of codes in `format`, before a secret is asked. */
export function validateCardOptions(args: ParsedArguments, format: EncodedFormat): void {
  const { sheets, cards } = assertCardOutput(args, ENCODE_CARD_SETTINGS);
  if (!sheets && !cards) return;
  const kind = EncodedForm.of(format).cardKind;
  if (kind === undefined)
    throw ERRORS.create("card-export-requires-format", [`${CARD_FORMAT_NUMBERS}`]);
  // A card page size makes a PDF or page images of separate cards too, which only some designs
  // draw (AUD-022-FUN004).
  const separate = cards || isCardPageSize(parsePageSize(value(args, "page-size")));
  if (separate) assertIndividualTemplate(selectTemplate(value(args, "template"), kind));
  businessOptions(args);
  cardTemplate(args, kind);
}

/**
 * The design of cards of `kind` that --template names. A kind that no design draws is refused with
 * the --format numbers of the forms that have one (noCardTemplateMessage).
 */
export function cardTemplate(args: ParsedArguments, kind: CardKind): CardTemplate {
  try {
    return selectTemplate(value(args, "template"), kind);
  } catch (error) {
    if (error instanceof NoCardTemplateError)
      throw ERRORS.create("card-template-refused", [noCardTemplateMessage(error)]);
    throw error;
  }
}
