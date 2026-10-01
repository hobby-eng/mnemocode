import { createCardIdentity, sectorForTemplate } from "../export/card-identities.js";
import {
  parsePageSize,
  parseOrientation,
  profileFields,
  validateProfile,
  type CardSettings,
} from "../export/card-settings.js";
import { resolveCardPresentation, type ResolvedCardPresentation } from "../export/card-copy.js";
import { assertFlag, value, type ParsedArguments } from "./arguments.js";
import { optionLabel } from "./option-copy.js";

export const cardCopyOptions = [
  "studio-name",
  "card-slogan",
  "card-subtitle",
  "card-footer",
  "card-reference-label",
] as const;
export const businessOptionNames = [
  "page-size",
  "orientation",
  ...profileFields.map((field) => `card-${field}`),
  ...cardCopyOptions,
  "card-qr",
] as const;
const presentations = new WeakMap<ParsedArguments, ResolvedCardPresentation>();

export function businessOptions(
  args: ParsedArguments,
  templateHint = "business-architect",
): CardSettings {
  for (const name of businessOptionNames) {
    if (name !== "card-qr" && args[name] !== undefined && typeof args[name] !== "string")
      throw new Error(`Provide exactly one value for the ${optionLabel(name)} setting.`);
  }
  assertFlag(args, "card-qr");
  const profile = validateProfile(
    Object.fromEntries(
      profileFields.flatMap((field) => {
        const text = value(args, `card-${field}`);
        return text === undefined ? [] : [[field, text]];
      }),
    ),
  );
  let resolved = presentations.get(args);
  if (resolved === undefined) {
    resolved = resolveCardPresentation(profile, {
      studioName: value(args, "studio-name"),
      slogan: value(args, "card-slogan"),
      subtitle: value(args, "card-subtitle"),
      footer: value(args, "card-footer"),
      referenceLabel: value(args, "card-reference-label"),
    });
    resolved = {
      ...resolved,
      profile: createCardIdentity(
        profile,
        args.all === true ? undefined : sectorForTemplate(value(args, "template") ?? templateHint),
      ),
    };
    presentations.set(args, resolved);
  }
  return {
    pageSize:
      value(args, "page-size") === undefined ? undefined : parsePageSize(value(args, "page-size")),
    orientation: parseOrientation(value(args, "orientation")),
    profile: resolved.profile,
    presentation: resolved.presentation,
    cardQr: args["card-qr"] === true,
  };
}
