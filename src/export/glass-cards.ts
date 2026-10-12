import { MM, separateCardPage, type CardBox } from "./business-layout.js";
import { drawClippedArtwork, fit, pdfColor, pdfRect, text } from "./business-render-primitives.js";
import { ExportDetails } from "./export-details.js";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { CardProfile, CardPresentation, ProfileField } from "./card-settings.js";
import { collectionSeries, drawCollectionStudy, separateCardIndex } from "./collection-sheet.js";
import type { CardContent } from "./backup-cards.js";
import type { CardDrawing } from "./templates.js";
import type { SskrCardContent } from "./sskr-content.js";
import { cardCount, numberedCode, twoDigits } from "./card-codes.js";
import { assertColorCards, type ColorCards } from "./card-content.js";
import { documentWithFont, savedWithoutMetadata } from "./pdf-documents.js";
import { isCardPageSize, BUSINESS_CARD_MM, ID1_CARD_MM } from "./card-settings.js";
import {
  GLASS_REFERENCES,
  PHOTOGRAPHED_GLASS_REFERENCES,
  type GlassReferencesPerCard,
} from "./template-catalog.js";
import { listInWords } from "../core/places.js";

const ink = rgb(0.1, 0.12, 0.13);
/** The references of a glass card stand in two columns, which its sheet's captions pair too. */
const REFERENCE_COLUMNS = 2;
/**
 * The least size of a glass card's details, in points: a value that would need smaller text is
 * refused (fit), never printed below it. The approved glass designs were drawn with this floor.
 */
const GLASS_MINIMUM_TEXT_SIZE = 4.8;

/** The thin border of a reference's swatch, its width in points, as pdf-lib draws it. */
interface SwatchBorder {
  readonly borderWidth: number;
  readonly borderColor: RGB;
}

/** One line of the person's details on a glass card, in millimetres and points on the card. */
interface IdentityLabel {
  readonly field: Exclude<ProfileField, "location">;
  readonly dx: number;
  readonly dy: number;
  /** The size it is printed at where it fits `width`. */
  readonly preferred: number;
  readonly width: number;
}

/**
 * Where a glass design writes its labels on a separate card, in millimetres on the card and in
 * points: the person's details, the grid of the references with their swatches, and the line of
 * the collection where the design has one. Physical sizes in the master; text remains vector and
 * is never stretched.
 */
interface GlassLabelLayout {
  readonly identity: readonly IdentityLabel[];
  readonly references: {
    /** The first swatch's top left, and the steps to the next column and row. */
    readonly left: number;
    readonly columnPitch: number;
    readonly top: number;
    readonly rowPitch: number;
    readonly swatch: number;
    readonly border: SwatchBorder;
    /** How far right of its swatch a code starts, its size, and the gap after its number. */
    readonly textOffset: number;
    readonly fontSize: number;
    readonly codeGap?: string;
  };
  /** The line with the series and the card's number in the set, where the design has one. */
  readonly collectionLine?: { readonly dx: number; readonly dy: number; readonly size: number };
}

/** The four-reference design, whose photograph has room for the series and the card's number. */
const PHOTOGRAPHED_LABELS: GlassLabelLayout = {
  identity: [
    { field: "company", dx: 4, dy: 3.3, preferred: 9, width: 37 },
    { field: "website", dx: 4, dy: 8, preferred: 5.2, width: 37 },
    { field: "name", dx: 47, dy: 3.3, preferred: 8.5, width: 39 },
    { field: "role", dx: 47, dy: 7.4, preferred: 5.8, width: 39 },
    { field: "email", dx: 47, dy: 10.7, preferred: 5.5, width: 39 },
    { field: "phone", dx: 47, dy: 13.8, preferred: 5.2, width: 39 },
  ],
  references: {
    left: 4,
    columnPitch: 33,
    top: 35,
    rowPitch: 6,
    swatch: 2.8,
    border: { borderWidth: 0.3, borderColor: rgb(0.85, 0.85, 0.85) },
    textOffset: 4,
    fontSize: 6.8,
  },
  collectionLine: { dx: 4, dy: 46.5, size: 4.6 },
};

/** The left edge of the right column of the compact designs, a little right of the card's middle. */
const COMPACT_RIGHT = BUSINESS_CARD_MM.width / 2 + 2;
/** The width of a line of the compact designs' details, either column. */
const COMPACT_LINE = COMPACT_RIGHT - 6;
/** The designs of six and eight references, whose references fill the lower part of the card. */
const COMPACT_LABELS: GlassLabelLayout = {
  identity: [
    { field: "company", dx: 3, dy: 2.7, preferred: 8.2, width: COMPACT_LINE },
    { field: "website", dx: 3, dy: 7, preferred: 5.2, width: COMPACT_LINE },
    { field: "name", dx: COMPACT_RIGHT, dy: 2.7, preferred: 8, width: COMPACT_LINE },
    { field: "role", dx: COMPACT_RIGHT, dy: 6.8, preferred: 5.5, width: COMPACT_LINE },
    { field: "email", dx: COMPACT_RIGHT, dy: 10.2, preferred: 5.2, width: COMPACT_LINE },
    { field: "phone", dx: 3, dy: 10.4, preferred: 5.2, width: COMPACT_LINE },
  ],
  references: {
    left: 3,
    columnPitch: 29,
    top: 30,
    rowPitch: 4.8,
    swatch: 2.3,
    border: { borderWidth: 0.25, borderColor: rgb(0.8, 0.8, 0.8) },
    textOffset: 3.3,
    fontSize: 6.6,
    codeGap: " ",
  },
};

/** What the glass cards draw with (CardDrawing): their artwork, font, QR codes and choices. */
type GlassDrawing = Pick<CardDrawing, "glassArtwork" | "readAsset" | "qrModules" | "randomInt">;

interface RenderContext {
  drawing: GlassDrawing;
  doc: PDFDocument;
  font: PDFFont;
  content: ColorCards;
  profile: Required<CardProfile>;
  presentation: CardPresentation;
  count: number;
  referencesPerCard: GlassReferencesPerCard;
  cardWidth: number;
  cardHeight: number;
}

function referencesFor(
  content: ColorCards,
  index: number,
  referencesPerCard: GlassReferencesPerCard = PHOTOGRAPHED_GLASS_REFERENCES,
): readonly string[] {
  const start = index * referencesPerCard;
  return content.colors.slice(start, start + referencesPerCard);
}

/**
 * The photograph of a card of `refs`, recoloured, embedded in `doc`: a PNG for the four-reference
 * design, whose ink ribbons it recolours, a JPEG for the compact ones. Cards and sheets draw it.
 */
async function embeddedArtwork(
  { drawing, doc }: RenderContext,
  refs: readonly string[],
  referencesPerCard: RenderContext["referencesPerCard"],
): Promise<PDFImage> {
  const bytes = await drawing.glassArtwork.of(refs, referencesPerCard);
  return referencesPerCard === PHOTOGRAPHED_GLASS_REFERENCES
    ? doc.embedPng(bytes)
    : doc.embedJpg(bytes);
}

/**
 * Writes text on a card whose top left is at `x`, `top` and which is drawn at `scale`: each label
 * is placed at its offset on the card and sized by the scale. Both designs label their cards so.
 */
function labelWriter(page: PDFPage, font: PDFFont, x: number, top: number, scale: number) {
  return (value: string, dx: number, dy: number, size: number) =>
    write(page, font, value, x + dx * scale, top + dy * scale, size * scale);
}

/** Glass-card text, left out where it is empty, in the ink of the glass cards. */
function write(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  top: number,
  size: number,
): void {
  if (!value) return;
  text(page, font, value, x, top, size, ink);
}

// Glass cards are light, so their sheet is light as well.
const SHEET_THEME = "mist";

// Share of the width of a photograph that lies outside the rim of the plate, on each side.
// Measured in the three photographs: 2 to 4 of about 1000 pixels.
const BACKGROUND_BESIDE_PLATE = 0.004;

/**
 * The photographs show a glass plate with rounded corners on a light background. A card is
 * cut along the plate, not along the photograph: the corners are clipped to the rounded
 * shape of every card, and the photograph is drawn a little wider, so that the rim of the
 * plate meets the edge of the card and none of the background is left.
 */
function drawGlassPlate(page: PDFPage, artwork: PDFImage, box: CardBox): void {
  const width = box.width / (1 - 2 * BACKGROUND_BESIDE_PLATE);
  drawClippedArtwork(page, artwork, box, {
    x: box.x - (width - box.width) / 2,
    y: box.y,
    width,
    height: box.height,
  });
}

/**
 * The swatch of reference `color`, `size` millimetres square with its top left at `x`, `top`, in a
 * thin grey border (`borderWidth` points): both glass designs show each reference so.
 */
function drawSwatch(
  page: PDFPage,
  color: string,
  x: number,
  top: number,
  size: number,
  border: SwatchBorder,
): void {
  page.drawRectangle({
    ...pdfRect(page, { x, y: top, width: size, height: size }),
    color: pdfColor(color),
    ...border,
  });
}

/** Separate card `index`, its top left at `x`, `top`, drawn at `scale`: its plate and its labels. */
async function drawCard(
  context: RenderContext,
  page: PDFPage,
  index: number,
  x: number,
  top: number,
  scale: number,
): Promise<void> {
  const { content, referencesPerCard, cardWidth, cardHeight } = context;
  const refs = referencesFor(content, index, referencesPerCard);
  const artwork = await embeddedArtwork(context, refs, referencesPerCard);
  drawGlassPlate(page, artwork, {
    x,
    y: top,
    width: cardWidth * scale,
    height: cardHeight * scale,
    index,
  });
  const layout =
    referencesPerCard === PHOTOGRAPHED_GLASS_REFERENCES ? PHOTOGRAPHED_LABELS : COMPACT_LABELS;
  drawCardLabels(context, page, index, refs, x, top, scale, layout);
}

/**
 * The labels of card `index` as `layout` places them: the person's details, each reference's
 * swatch and its numbered code, and the collection line where the design has one. References stay
 * vector text at a fixed readable size; the artwork is decorative.
 */
function drawCardLabels(
  context: RenderContext,
  page: PDFPage,
  index: number,
  refs: readonly string[],
  x: number,
  top: number,
  scale: number,
  layout: GlassLabelLayout,
): void {
  const { font, profile, content, count, referencesPerCard } = context;
  const label = labelWriter(page, font, x, top, scale);
  for (const { field, dx, dy, preferred, width } of layout.identity)
    label(
      profile[field],
      dx,
      dy,
      fit(font, profile[field], preferred, GLASS_MINIMUM_TEXT_SIZE, width * MM, "Card text"),
    );
  const grid = layout.references;
  for (const [offset, ref] of refs.entries()) {
    const dx = grid.left + (offset % REFERENCE_COLUMNS) * grid.columnPitch;
    const dy = grid.top + Math.floor(offset / REFERENCE_COLUMNS) * grid.rowPitch;
    drawSwatch(page, ref, x + dx * scale, top + dy * scale, grid.swatch * scale, grid.border);
    label(
      numberedCode(content, index * referencesPerCard + offset, grid.codeGap),
      dx + grid.textOffset,
      dy,
      grid.fontSize,
    );
  }
  const line = layout.collectionLine;
  if (line !== undefined)
    label(
      `${collectionSeries(content)}  /  ${twoDigits(index + 1)}-${twoDigits(count)}`,
      line.dx,
      line.dy,
      line.size,
    );
}

/** Ordered references per card. QR belongs only to a collection study. */
export async function renderGlassCards(
  drawing: GlassDrawing,
  content: CardContent | SskrCardContent,
  individualIndex?: number,
  referencesPerCard: GlassReferencesPerCard = PHOTOGRAPHED_GLASS_REFERENCES,
): Promise<Uint8Array> {
  assertColorCards(content);
  if (!GLASS_REFERENCES.includes(referencesPerCard))
    throw new Error(`Glass capacity must be ${listInWords(GLASS_REFERENCES, "or")}.`);
  const count = cardCount(content.colors.length, referencesPerCard);
  const separate = separateCardIndex(content, individualIndex, count);
  // A separate card always has the business size; only a sheet shows the photographs of the
  // 6 and 8 reference cards in their own proportions, those of an ID-1 card.
  const businessShape =
    referencesPerCard === PHOTOGRAPHED_GLASS_REFERENCES ||
    isCardPageSize(content.pageSize) ||
    separate !== undefined;
  const card = businessShape ? BUSINESS_CARD_MM : ID1_CARD_MM;
  const { doc, font } = await documentWithFont(drawing);
  // Through an export the content carries the details settled for it, which come back unchanged.
  // A glass card suits an employer of any sector.
  const { profile, presentation } = ExportDetails.ofPersonFirst(drawing.randomInt, content);
  const context: RenderContext = {
    drawing,
    doc,
    font,
    content,
    count,
    referencesPerCard,
    cardWidth: card.width,
    cardHeight: card.height,
    profile,
    presentation,
  };
  if (separate === undefined) await drawGlassStudy(context);
  else await drawSeparateCard(context, separate);
  return savedWithoutMetadata(doc);
}

async function drawGlassStudy(context: RenderContext): Promise<void> {
  const { drawing, doc, font, content, profile, presentation, count, referencesPerCard } = context;
  const captions = Array.from({ length: count }, (_, index) => {
    const refs = referencesFor(content, index, referencesPerCard);
    const lines: string[] = [];
    for (let offset = 0; offset < refs.length; offset += REFERENCE_COLUMNS)
      lines.push(
        refs
          .slice(offset, offset + REFERENCE_COLUMNS)
          .map((_, i) => numberedCode(content, index * referencesPerCard + offset + i, " "))
          .join("   "),
      );
    return lines;
  });
  await drawCollectionStudy({
    doc,
    font,
    qr: drawing,
    settings: content,
    content,
    presentation,
    preparedFor: profile.name,
    theme: SHEET_THEME,
    aspect: context.cardWidth / context.cardHeight,
    captions,
    // Every card keeps the room of a full card's references, also a last one with fewer.
    captionLines: Math.ceil(referencesPerCard / REFERENCE_COLUMNS),
    paint: async (page, box) => {
      // The photograph is a design sketch; exact ordered references remain independent vector
      // text.
      const refs = referencesFor(content, box.index, referencesPerCard);
      drawGlassPlate(page, await embeddedArtwork(context, refs, referencesPerCard), box);
    },
  });
}

/** Separate card `index` alone on its page, centred, and smaller only where the page is. */
async function drawSeparateCard(context: RenderContext, index: number): Promise<void> {
  const { doc, content, cardWidth, cardHeight } = context;
  const { width, height, x, top, scale } = separateCardPage(content, cardWidth, cardHeight);
  const page = doc.addPage([width * MM, height * MM]);
  await drawCard(context, page, index, x, top, scale);
}
