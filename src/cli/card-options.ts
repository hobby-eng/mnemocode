import { businessOptionNames, businessOptions } from "./business-options.js";
import { selectTemplate, type CardTemplate } from "../export/templates.js";
import { NoCardTemplate } from "../export/template-catalog.js";
import { type CardKind, type EncodedFormat } from "../core/types.js";

import { value, type ParsedArguments } from "./arguments.js";
import {
  COLOR_FORMAT_NUMBERS,
  CARD_FORMAT_NUMBERS,
  noCardTemplateMessage,
} from "./format-numbers.js";
import { cardKindOf, writtenInColors } from "../core/backup-options.js";
import { assertIndividualTemplate } from "../export/render.js";

/** The card outputs that the options name: sheets (a PDF or page images), and separate cards. */
export interface CardOutputs {
  readonly sheets: boolean;
  readonly cards: boolean;
}

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
    throw new Error("Provide the individual-card output folder once, using a non-empty path.");
  const outputs = cardOutputs(args);
  if (!outputs.sheets && !outputs.cards && settings.some((name) => args[name] !== undefined))
    throw new Error(
      "Card settings require a PDF file, an image output folder or an individual-card output folder.",
    );
  return outputs;
}

/** Encode's card settings, which a card output must use (assertCardOutput). */
const ENCODE_CARD_SETTINGS = ["template", "title", ...businessOptionNames] as const;

/** Refuses card options that cannot draw cards of codes in `format`, before a secret is asked. */
export function validateCardOptions(args: ParsedArguments, format: EncodedFormat): void {
  const { sheets, cards } = assertCardOutput(args, ENCODE_CARD_SETTINGS);
  if (cards) {
    if (!writtenInColors(format))
      throw new Error(
        `Individual cards are available only for RGB color formats ${COLOR_FORMAT_NUMBERS}.`,
      );
    assertIndividualTemplate(selectTemplate(value(args, "template"), "colors"));
  }
  if (!sheets && !cards) return;
  const kind = cardKindOf(format);
  if (kind === undefined) throw new Error(`Card export requires format ${CARD_FORMAT_NUMBERS}.`);
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
    if (error instanceof NoCardTemplate) throw new Error(noCardTemplateMessage(error));
    throw error;
  }
}
