// The installed card designs: the styles of each family, and from them each design's id, the kind
// of cards it draws, its family and its style, in the order that the list of designs numbers them,
// with the one reader of a design named by its id or its number. It imports no code, so that the
// share cards, the card texts, the card session and a page resolve a design without reaching any
// drawing code; templates.ts adds the renderers, and the types of the styles come from here.
//
// Each design was approved before installation. Keep IDs and their order stable for recorded
// commands, which name a design by its id or its number (a test pins them).

import type { CardKind } from "../core/types.js";

/** The business designs, in their order; "mixed" draws the others in turn. */
export const BUSINESS_STYLES = Object.freeze([
  "architect",
  "it",
  "estate",
  "diagonal",
  "contact",
  "curves",
  "facets",
  "mixed",
] as const);
export type BusinessStyle = (typeof BUSINESS_STYLES)[number];
/** The business designs that have artwork of their own: all but "mixed". */
export type PhysicalBusinessStyle = Exclude<BusinessStyle, "mixed">;

/** Approved photographic finishes, in their order (material-artwork.ts draws them). */
export const MATERIAL_STYLES = Object.freeze([
  "vehicle",
  "enclosure",
  "tile",
  "switch",
  "kitchen",
] as const);
export type MaterialStyle = (typeof MATERIAL_STYLES)[number];

/**
 * How many references a frosted-glass card holds, in the order of the designs: four in the
 * photographed design, six or eight in the compact ones.
 */
export const GLASS_REFERENCES = Object.freeze([4, 6, 8] as const);
export type GlassReferencesPerCard = (typeof GLASS_REFERENCES)[number];
/** The photographed frosted-glass design, which recolors its ink ribbons: the default. */
export const PHOTOGRAPHED_GLASS_REFERENCES = GLASS_REFERENCES[0];
/** The frosted-glass designs, by the references that one card holds. */
export type GlassStyle = `glass-${GlassReferencesPerCard}in1`;

/** How a design draws: a business style, a material, or frosted glass. */
export type CardStyle = BusinessStyle | MaterialStyle | GlassStyle;
/** The families of designs, each drawn by its own renderer. */
export type CardFamily = CatalogEntry["family"];

/** One installed design, in the family whose renderer draws it. */
export type CatalogEntry = { readonly id: string; readonly kind: CardKind } & (
  | { readonly family: "business"; readonly style: BusinessStyle }
  | { readonly family: "material"; readonly style: MaterialStyle }
  | {
      readonly family: "glass";
      readonly style: GlassStyle;
      readonly referencesPerCard: GlassReferencesPerCard;
    }
);

/** The designs, in the order that the list of designs shows and numbers them, from 1. */
export const TEMPLATE_CATALOG: readonly CatalogEntry[] = Object.freeze(
  [
    ...BUSINESS_STYLES.map((style): CatalogEntry => ({
      id: `business-${style}`,
      kind: "colors",
      family: "business",
      style,
    })),
    ...MATERIAL_STYLES.map((style): CatalogEntry => ({
      id: `material-${style}`,
      kind: "colors",
      family: "material",
      style,
    })),
    ...GLASS_REFERENCES.map((referencesPerCard): CatalogEntry => ({
      id: `business-glass-${referencesPerCard}in1`,
      kind: "colors",
      family: "glass",
      style: `glass-${referencesPerCard}in1`,
      referencesPerCard,
    })),
  ].map((entry) => Object.freeze(entry)),
);

/** The design of colour cards when none is named: the first. */
export const DEFAULT_TEMPLATE_ID = TEMPLATE_CATALOG[0]!.id;
/** The design of share cards when none is named, chosen for shares on its own. */
export const DEFAULT_SHARE_TEMPLATE_ID = "business-it";

/** A design's number in a list of designs: a whole number from 1, without leading zeros. */
const TEMPLATE_NUMBER = /^[1-9][0-9]*$/u;

/**
 * The design that `idOrNumber` names among those of `kind` (all when undefined): by its id, or by
 * its number in that list, from 1; the first when none is named. Undefined when none fits.
 */
export function findTemplate(idOrNumber?: string, kind?: CardKind): CatalogEntry | undefined {
  const available = TEMPLATE_CATALOG.filter((entry) => kind === undefined || entry.kind === kind);
  if (idOrNumber === undefined) return available[0];
  return (
    available.find((entry) => entry.id === idOrNumber) ??
    (TEMPLATE_NUMBER.test(idOrNumber) ? available[Number(idOrNumber) - 1] : undefined)
  );
}

/** How a refusal names each kind of card. */
const CARD_KIND_NAMES: Readonly<Record<CardKind, string>> = Object.freeze({
  colors: "color",
});

/**
 * Cards of `kind` that no installed design draws. The message names the kind only: a front end
 * adds how its person chooses another kind, such as the command line's form numbers.
 */
export class NoCardTemplate extends Error {
  readonly kind: CardKind | undefined;

  constructor(kind: CardKind | undefined) {
    super(
      kind === undefined
        ? "No card template is installed."
        : `No installed card template supports ${CARD_KIND_NAMES[kind]} cards yet.`,
    );
    this.name = "NoCardTemplate";
    this.kind = kind;
  }
}

/** The design that `idOrNumber` names (findTemplate); refuses a kind without designs, or no fit. */
export function resolveTemplateId(idOrNumber?: string, kind?: CardKind): CatalogEntry {
  if (findTemplate(undefined, kind) === undefined) throw new NoCardTemplate(kind);
  const found = findTemplate(idOrNumber, kind);
  if (found === undefined)
    throw new Error(
      `The card template “${idOrNumber}” is unknown or incompatible. List the available preview templates and choose one of them.`,
    );
  return found;
}

/** The design drawn in `style`, or undefined for a text that names no style. */
export function designOfStyle(style: string): CatalogEntry | undefined {
  return TEMPLATE_CATALOG.find((entry) => entry.style === style);
}
