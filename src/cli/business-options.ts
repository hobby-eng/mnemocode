import { ExportDetails } from "../export/export-details.js";
import { nodeRenderPlatform } from "../export/platform-node.js";
import { DEFAULT_TEMPLATE_ID, findTemplate } from "../export/template-catalog.js";
import {
  parsePageSize,
  parseOrientation,
  profileFields,
  validateProfile,
  type CardSettings,
  COPY_FIELDS,
  type CopyField,
  type ProfileField,
} from "../export/card-settings.js";
import { assertTextValues, value, type ParsedArguments } from "./arguments.js";

/** The option of each text of a card design; studio-name has no card- before it. */
export const COPY_OPTIONS: Readonly<Record<CopyField, string>> = Object.freeze({
  studioName: "studio-name",
  slogan: "card-slogan",
  subtitle: "card-subtitle",
  footer: "card-footer",
  referenceLabel: "card-reference-label",
});
export const cardCopyOptions = COPY_FIELDS.map((field) => COPY_OPTIONS[field]);

/** The option of a detail of the person on the cards, such as --card-name. */
export function profileOption(field: ProfileField): string {
  return `card-${field}`;
}

/** The card options whose text the person writes: the person's details and the design's texts. */
export const TYPED_CARD_TEXT_OPTIONS = Object.freeze([
  ...profileFields.map(profileOption),
  ...cardCopyOptions,
]);
export const businessOptionNames = [
  "page-size",
  "orientation",
  ...TYPED_CARD_TEXT_OPTIONS,
  "card-qr",
] as const;

export function businessOptions(
  args: ParsedArguments,
  templateHint = DEFAULT_TEMPLATE_ID,
): CardSettings {
  assertTextValues(
    args,
    businessOptionNames.filter((name) => name !== "card-qr"),
  );
  const profile = validateProfile(
    Object.fromEntries(
      profileFields.flatMap((field) => {
        const text = value(args, profileOption(field));
        return text === undefined ? [] : [[field, text]];
      }),
    ),
  );
  // Drawn once for the options of a command, so that each of its outputs shows the same details.
  const details = ExportDetails.drawnFor(
    nodeRenderPlatform.randomInt,
    args,
    profile,
    Object.fromEntries(COPY_FIELDS.map((field) => [field, value(args, COPY_OPTIONS[field])])),
    // Every design (--all) takes an employer of any sector. An unknown design is refused where
    // the cards are drawn (selectTemplate).
    args.all === true ? undefined : findTemplate(value(args, "template") ?? templateHint)?.style,
  );
  return {
    pageSize:
      value(args, "page-size") === undefined ? undefined : parsePageSize(value(args, "page-size")),
    orientation: parseOrientation(value(args, "orientation")),
    profile: details.profile,
    presentation: details.presentation,
    cardQr: args["card-qr"] === true,
  };
}
