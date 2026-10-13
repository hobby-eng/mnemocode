import { MM, centredRunStart, type MmRect } from "./business-layout.js";
import { materialPageLayout, materialGridLayout } from "./material-layout.js";
import { readRenderAsset } from "./platform.js";
import {
  PDFName,
  type PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  clipEvenOdd,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  setFillingRgbColor,
  setGraphicsState,
  type PDFPage,
  type PDFImage,
} from "pdf-lib";
import type { CardContent } from "./backup-cards.js";
import type { CardDrawing } from "./templates.js";
import type { SskrCardContent } from "./sskr-content.js";
import { ExportDetails } from "./export-details.js";
import { clearDocumentMetadata } from "./document-metadata.js";
import {
  drawCollectionStudy,
  MAX_SHEET_CARDS,
  preparedForLine,
  separateCardIndex,
  type SheetShape,
} from "./collection-sheet.js";
import {
  chooseMaterialSamples,
  materialArtwork,
  TINT_OPACITY,
  type MaterialArtwork,
  type MaterialFinish,
  type MaterialSample,
  type MaterialStyle,
} from "./material-artwork.js";
import { numberedCode } from "./card-codes.js";
import { assertColorCards, EMPTY_CARD_COLLECTION, type ColorCards } from "./card-content.js";
import { centredText, pdfRect } from "./business-render-primitives.js";
import { rgbChannels } from "./color-math.js";
import { documentWithFont } from "./pdf-documents.js";
import { type CardPageSize, isCardPageSize, resolvePageSize } from "./card-settings.js";
/** The sizes of a material card's page: those of every card (CardPageSize). */
export type MaterialPageSize = CardPageSize;
export interface MaterialCardOptions {
  readonly pageSize?: MaterialPageSize;
  readonly individualIndex?: number;
}
const TYPE_LAYOUT = {
  studioTop: 2.2,
  titleTop: 6,
  ownerTop: 8.7,
  labelsHeight: 4.5,
  referenceOffset: 0.3,
  // Leaves a visible gap below the 5.5 pt reference line, which is 1.94 mm tall.
  finishOffset: 2.6,
  footerInset: 3.2,
  // The lines across the page keep this margin on each side.
  sideMargin: 4,
  minimumFont: 3.8,
} as const;

// The tint layer keeps the photograph's light, texture and highlights ("Color" blend) and takes
// the hue and saturation of the catalogue colour of the sample. It covers only the object in the
// photograph, inside the material's outline; the backdrop, shadows and screws keep their colour.
const TINT_STATE = PDFName.of("MnemoTint");
const tintedPages = new WeakSet<PDFPage>();

/** Registers the "Color" blend state of the tint on `page`, once, and names it. */
function useTintState(page: PDFPage): PDFName {
  if (!tintedPages.has(page)) {
    const state = page.doc.context.obj({ Type: "ExtGState", BM: "Color", ca: TINT_OPACITY });
    page.node.setExtGState(TINT_STATE, page.doc.context.register(state));
    tintedPages.add(page);
  }
  return TINT_STATE;
}

/** The aspect of a finish's crop, width over height. */
function cropAspect(image: PDFImage, finish: MaterialFinish): number {
  const [, , cw, ch] = finish.crop;
  return (image.width * cw) / (image.height * ch);
}

/** Where a sample's photograph lies in a box: as large as fits, centred, in millimetres. */
function sampleArea(image: PDFImage, finish: MaterialFinish, box: MmRect): MmRect {
  const aspect = cropAspect(image, finish);
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function drawSample(
  page: PDFPage,
  image: PDFImage,
  artwork: MaterialArtwork,
  sample: MaterialSample,
  x: number,
  top: number,
  width: number,
  height: number,
) {
  const [cx, cy, cw, ch] = sample.finish.crop;
  const area = sampleArea(image, sample.finish, { x, y: top, width, height });
  const [dw, dh] = [area.width, area.height];
  const placed = pdfRect(page, area);
  const [left, bottom] = [placed.x, placed.y];
  page.pushOperators(
    pushGraphicsState(),
    rectangle(left, bottom, placed.width, placed.height),
    clip(),
    endPath(),
  );
  page.drawImage(image, {
    x: left - (cx / cw) * dw * MM,
    y: bottom - ((1 - cy - ch) / ch) * dh * MM,
    width: (dw / cw) * MM,
    height: (dh / ch) * MM,
  });
  if (sample.tint !== undefined) {
    const [scale, dx, dy] = sample.finish.outlineFit ?? [1, 0, 0];
    // Outline points are fractions of the crop with y downwards; the page's y runs upwards.
    const at = (ring: readonly number[], i: number) =>
      [
        left + (ring[i]! * scale + dx) * dw * MM,
        bottom + (1 - ring[i + 1]! * scale - dy) * dh * MM,
      ] as const;
    const outline = artwork.catalogue.outline.flatMap((ring) => [
      moveTo(...at(ring, 0)),
      ...Array.from({ length: ring.length / 2 - 1 }, (_, i) => lineTo(...at(ring, 2 * i + 2))),
      closePath(),
    ]);
    const [r, g, b] = rgbChannels(sample.tint!);
    page.pushOperators(
      ...outline,
      // Even-odd, so that a hole in the outline, such as a screw, stays untinted.
      clipEvenOdd(),
      endPath(),
      setGraphicsState(useTintState(page)),
      setFillingRgbColor(r!, g!, b!),
      rectangle(left, bottom, placed.width, placed.height),
      fill(),
    );
  }
  page.pushOperators(popGraphicsState());
}

type MaterialRenderContext = Awaited<ReturnType<typeof createRenderContext>>;

/** What the material cards draw with (CardDrawing): their photographs, font, QR codes, choices. */
type MaterialDrawing = Pick<CardDrawing, "readAsset" | "qrModules" | "randomInt">;

/** Front: ordered exact references. QR belongs only to a collection study. */
export async function renderMaterialCard(
  drawing: MaterialDrawing,
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions = {},
): Promise<Uint8Array> {
  const context = await createRenderContext(drawing, style, content, options);
  if (context.individual === undefined) await drawMaterialStudy(context);
  else drawMaterialFront(context);
  return context.doc.save();
}

async function createRenderContext(
  drawing: MaterialDrawing,
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions,
) {
  assertColorCards(content);
  if (content.colors.length === 0) throw new Error(EMPTY_CARD_COLLECTION);
  if (content.colors.length > MAX_SHEET_CARDS)
    throw new Error(`Material cards support at most ${MAX_SHEET_CARDS} references.`);
  // Material cards are of the business size unless another is asked for.
  // A study keeps the business size too, unlike the other families' A6 sheet: a change of what
  // is drawn, which waits for the card output checks (scan finding S100).
  const size = resolvePageSize(options.pageSize ?? content.pageSize, true);
  const individual = separateCardIndex(content, options.individualIndex, content.colors.length);
  const { width, height, portrait, scale } = materialPageLayout(size, content.orientation);
  const artwork = materialArtwork[style];
  // Through an export the content carries the details settled for it, which come back unchanged.
  // A material card suits an employer of any sector.
  const { profile, presentation } = ExportDetails.of(drawing.randomInt, content);
  const { doc, font } = await documentWithFont(drawing);
  const image = await embeddedPhotograph(doc, drawing, style);
  // Chosen for all references of the card together, so that no two of them look alike and an
  // individual fragment shows the same sample as the whole card.
  const samples = chooseMaterialSamples(style, content.colors);
  const ink = artwork.dark ? rgb(0.94, 0.92, 0.87) : rgb(0.15, 0.16, 0.16);
  const muted = artwork.dark ? rgb(0.73, 0.72, 0.67) : rgb(0.38, 0.38, 0.35);
  clearDocumentMetadata(doc);
  // Each line is centred in the room it may take: the page within its margins, or a sample's cell.
  const drawText = (
    page: PDFPage,
    value: string,
    top: number,
    desired: number,
    left: number,
    width: number,
    subdued = false,
  ) =>
    centredText(
      page,
      font,
      value,
      { left, top, width },
      desired * scale,
      TYPE_LAYOUT.minimumFont * scale,
      "Card text",
      subdued ? muted : ink,
    );
  const makePage = () => {
    const p = doc.addPage([width * MM, height * MM]);
    p.drawRectangle({
      x: 0,
      y: 0,
      width: p.getWidth(),
      height: p.getHeight(),
      color: rgb(...artwork.background),
    });
    return p;
  };
  return {
    qr: drawing,
    doc,
    font,
    size,
    content,
    individual,
    width,
    height,
    scale,
    portrait,
    artwork,
    presentation,
    profile,
    image,
    samples,
    drawText,
    makePage,
  };
}

function drawMaterialFront(context: MaterialRenderContext): void {
  const {
    content,
    individual,
    width,
    height,
    scale,
    portrait,
    artwork,
    presentation,
    profile,
    image,
    samples,
    drawText,
    makePage,
  } = context;
  const page = makePage();
  const side = TYPE_LAYOUT.sideMargin * scale;
  const lineWidth = width - 2 * side;
  drawText(
    page,
    presentation.studioName.toUpperCase(),
    TYPE_LAYOUT.studioTop * scale,
    8,
    side,
    lineWidth,
  );
  drawText(page, artwork.title, TYPE_LAYOUT.titleTop * scale, 4.8, side, lineWidth);
  drawText(
    page,
    preparedForLine(profile.name),
    TYPE_LAYOUT.ownerTop * scale,
    4.5,
    side,
    lineWidth,
    true,
  );
  const entries =
    individual === undefined
      ? content.colors.map((code, index) => ({ code, index }))
      : [{ code: content.colors[individual]!, index: individual }];
  const { columns, cellWidth, cellHeight, gap, areaTop } = materialGridLayout(
    width,
    height,
    scale,
    portrait,
    entries.length,
    individual,
  );
  for (let i = 0; i < entries.length; i++) {
    const sample = samples[entries[i]!.index]!;
    const countThisRow = Math.min(columns, entries.length - Math.floor(i / columns) * columns);
    const x =
      centredRunStart(width, countThisRow, cellWidth, gap) + (i % columns) * (cellWidth + gap);
    const top = areaTop + Math.floor(i / columns) * cellHeight;
    const labelsHeight = TYPE_LAYOUT.labelsHeight * scale;
    const imageHeight = cellHeight - labelsHeight;
    drawSample(page, image, artwork, sample, x, top, cellWidth, imageHeight);
    // Both captions share the physical center of the image, including incomplete rows.
    drawText(
      page,
      numberedCode(content, entries[i]!.index),
      top + imageHeight + TYPE_LAYOUT.referenceOffset * scale,
      5.5,
      x,
      cellWidth,
    );
    drawText(
      page,
      sample.label,
      top + imageHeight + TYPE_LAYOUT.finishOffset * scale,
      4.8,
      x,
      cellWidth,
      true,
    );
  }
  drawText(
    page,
    presentation.subtitle,
    height - TYPE_LAYOUT.footerInset * scale,
    4.5,
    side,
    lineWidth,
    true,
  );
}

/**
 * The lines under the first `count` samples of a sheet: each one's number and code, and on a sheet
 * larger than a card the name of its sample. Compact studies keep the exact references and leave
 * out the decorative names.
 */
function studyCaptions(
  content: ColorCards,
  samples: readonly MaterialSample[],
  compact: boolean,
  count: number,
): string[][] {
  return Array.from({ length: count }, (_, index) => [
    numberedCode(content, index),
    ...(compact ? [] : [samples[index]!.label]),
  ]);
}

/** The photograph of `style`, embedded in `doc`. */
async function embeddedPhotograph(
  doc: PDFDocument,
  drawing: MaterialDrawing,
  style: MaterialStyle,
): Promise<PDFImage> {
  return doc.embedJpg(await readRenderAsset(drawing, `images/material-${style}.jpg`));
}

/**
 * The shape of a sheet of `pageSize` with the samples of `content` in `style`, which a plan of its
 * decoys lays out (planCollectionSheet): the shape of a sample, and the captions of the first
 * cards, whose samples are chosen for those cards alone, as their sheet chooses them. A material
 * with fewer samples than the distinct codes refuses them.
 */
export async function materialSheetShape(
  drawing: MaterialDrawing,
  style: MaterialStyle,
  content: ColorCards,
  pageSize: CardPageSize,
): Promise<SheetShape> {
  const { doc, font } = await documentWithFont(drawing);
  const image = await embeddedPhotograph(doc, drawing, style);
  const compact = isCardPageSize(pageSize);
  return {
    font,
    aspect: cropAspect(image, materialArtwork[style].finishes[0]!),
    captions: (count) => {
      const samples = chooseMaterialSamples(style, content.colors.slice(0, count));
      return studyCaptions(content, samples, compact, count);
    },
  };
}

async function drawMaterialStudy(context: MaterialRenderContext): Promise<void> {
  const { qr, doc, font, content, size, artwork, image, samples, presentation, profile } = context;
  const compact = isCardPageSize(size);
  await drawCollectionStudy({
    doc,
    font,
    qr,
    settings: { ...content, pageSize: size },
    content,
    presentation,
    preparedFor: profile.name,
    theme: artwork.studyTheme,
    // The finishes of one material are cropped alike, so every box takes the shape of a sample.
    aspect: cropAspect(image, artwork.finishes[0]!),
    captions: studyCaptions(content, samples, compact, content.colors.length),
    paint: (page, box) =>
      drawSample(page, image, artwork, samples[box.index]!, box.x, box.y, box.width, box.height),
    pictureArea: (box) => sampleArea(image, samples[box.index]!.finish, box),
  });
}
