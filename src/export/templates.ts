import { materialSheetShape, renderMaterialCard } from "./material-cards.js";
import type { CardKind } from "../core/types.js";
import type { BusinessStyle } from "./card-settings.js";
import {
  assertSeparateCards,
  drawsSeparateCards,
  resolveTemplateId,
  TEMPLATE_CATALOG,
  type CardFamily,
  type CardStyle,
  type CatalogEntry,
} from "./template-catalog.js";
import { businessSheetShape, renderBusinessCards } from "./business-cards.js";
import {
  pageSizeLabel,
  SEPARATE_CARD_SIZE,
  SHEET_SIZES_TEXT,
  type CardPageSize,
} from "./card-settings.js";
import type { SheetShape } from "./collection-layout.js";
import { capitalized } from "../core/prose.js";
import type { CardDrawing } from "./drawing-sources.js";
import type { CardContent } from "./backup-cards.js";
import type { ColorCards } from "./card-content.js";
import { defined } from "../core/defined.js";

// The kinds of cards are the core's (core/types.ts); what the renderers draw with is a leaf's.
export type { CardDrawing, CardKind };

/**
 * An installed card design: its id, the kind of codes it draws, its style and family, its name and
 * description, and how it draws a sheet, a separate card and the plan of a sheet.
 */
export interface CardTemplate {
  /** Its id, such as business-it, by which a command names it; stable for recorded commands. */
  readonly id: string;
  /**
   * The kind of codes it draws; content of another kind is refused
   * (export.render.template-does-not-support).
   */
  readonly kind: CardKind;
  /**
   * How it draws (TEMPLATE_CATALOG); the employer on business cards follows it (sectorForStyle).
   * A design that a host makes itself may have none, and then suits any employer.
   */
  readonly style?: CardStyle;
  /** The family whose renderer draws it (TEMPLATE_CATALOG); none for a design a host made. */
  readonly family?: CardFamily;
  /** Its name in the list of designs, such as "IT card collection". */
  readonly name: string;
  /** What it draws and on which page sizes: a sentence beside its name in the list of designs. */
  readonly description: string;
  /** The same renderer is used for preview and ordinary export. */
  readonly render: (drawing: CardDrawing, content: CardContent) => Promise<Uint8Array>;
  /**
   * The PDF of the separate card `index` of `content`, counted from 0; absent for a design printed
   * on sheets only (SHEETS_ONLY).
   */
  readonly renderIndividual?: (
    drawing: CardDrawing,
    content: CardContent,
    index: number,
  ) => Promise<Uint8Array>;
  /**
   * The shape of its sheet of `pageSize` for `content`, from which the decoys after the codes are
   * planned (card-plan.ts). A design that a host makes may have none, and its cards get no decoys.
   */
  readonly sheetShape?: (
    drawing: CardDrawing,
    content: ColorCards,
    pageSize: CardPageSize,
  ) => Promise<SheetShape>;
}

const businessNames: Record<BusinessStyle, string> = {
  architect: "Architecture",
  it: "IT",
  estate: "Property consultant",
  diagonal: "Diagonal city",
  contact: "Light contact blocks",
  curves: "Signature curves",
  facets: "Light geometric",
  mixed: "Mixed design",
};

/**
 * Draws `content` in the design `entry` of the catalog with its family's renderer: the whole
 * document, or the separate card `fragment`, counted from 0, where the design has separate cards
 * (assertSeparateCards). `businessOffset` starts the mixed business style at another of its
 * designs, as the QR cards of shares do by member; the other families have no such choice. The
 * templates below and the share cards (sskr-render.ts) both draw through it, so that a design is
 * drawn the same way from either.
 */
export async function renderCatalogDesign(
  entry: CatalogEntry,
  drawing: CardDrawing,
  content: ColorCards,
  fragment?: number,
  businessOffset = 0,
): Promise<Uint8Array> {
  if (fragment !== undefined) assertSeparateCards(entry);
  switch (entry.family) {
    case "business":
      return renderBusinessCards(drawing, entry.style, content, fragment, businessOffset);
    case "material":
      return renderMaterialCard(drawing, entry.style, content);
  }
}

/** The shape of a sheet of `pageSize` for `content` in the design `entry`, by its family. */
export function catalogSheetShape(
  entry: CatalogEntry,
  drawing: CardDrawing,
  content: ColorCards,
  pageSize: CardPageSize,
): Promise<SheetShape> {
  switch (entry.family) {
    case "business":
      return businessSheetShape(drawing, content);
    case "material":
      return materialSheetShape(drawing, entry.style, content, pageSize);
  }
}

/** What the list of designs says of a design of the catalog, by its family. */
function wordsOf(entry: CatalogEntry): Pick<CardTemplate, "name" | "description"> {
  switch (entry.family) {
    case "business": {
      const { style } = entry;
      return {
        name: `${businessNames[style]} card collection`,
        description:
          style === "mixed"
            ? `One identity across all designs; ${SHEET_SIZES_TEXT} sheets or individual cards.`
            : `Editable contact details; ${SHEET_SIZES_TEXT} sheets or individual ${pageSizeLabel(SEPARATE_CARD_SIZE)} cards.`,
      };
    }
    case "material":
      return {
        name: `${capitalized(entry.style)} finish selection`,
        description: `Photo-realistic material samples with finish names and exact references; optional collection QR. ${SHEET_SIZES_TEXT} sheets.`,
      };
  }
}

/** The template of a design of the catalog: its words, and its family's renderer. */
function templateOf(entry: CatalogEntry): CardTemplate {
  const { id, kind, style, family } = entry;
  return {
    id,
    kind,
    style,
    family,
    ...wordsOf(entry),
    render: (drawing, content) => renderCatalogDesign(entry, drawing, content),
    // Only a design with separate cards has them (drawsSeparateCards).
    ...(drawsSeparateCards(entry)
      ? {
          renderIndividual: (drawing: CardDrawing, content: CardContent, index: number) =>
            renderCatalogDesign(entry, drawing, content, index),
        }
      : {}),
    sheetShape: (drawing, content, pageSize) =>
      catalogSheetShape(entry, drawing, content, pageSize),
  };
}

/** Every installed design with its renderer, in the order of the catalog. */
export const cardTemplates: readonly CardTemplate[] = Object.freeze(
  TEMPLATE_CATALOG.map((entry) => Object.freeze(templateOf(entry))),
);

/** The installed designs that draw cards of `kind`, in the order of the catalog. */
export function templatesOfKind(kind: CardKind): readonly CardTemplate[] {
  return cardTemplates.filter((template) => template.kind === kind);
}

/** The number that names `template` among the designs of its kind, from 1 (findTemplate). */
export function templateNumber(template: CardTemplate): number {
  return templatesOfKind(template.kind).indexOf(template) + 1;
}

/** The design that `id`, its id or its number, names among those of `kind` (resolveTemplateId). */
export function selectTemplate(id?: string, kind?: CardKind): CardTemplate {
  const { id: found } = resolveTemplateId(id, kind);
  return defined(cardTemplates.find((template) => template.id === found));
}
