import { MM } from "./business-layout.js";
import { materialPageLayout, materialGridLayout } from "./material-layout.js";
import { readRenderAsset } from "./platform.js";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFName,
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
import { colorsToIndexes, unicodeToColors } from "../core/colors.js";
import { assertShareQr } from "../sskr/transport.js";
import type { CardContent } from "./templates.js";
import type { SskrCardContent } from "./sskr-content.js";
import { resolveIdentityFor } from "./card-identities.js";
import { resolvePresentationFor } from "./card-copy.js";
import { clearDocumentMetadata } from "./document-metadata.js";
import {
  collectionSheetLayout,
  drawStudyCaption,
  drawStudyFrame,
  drawStudyShadow,
  studyCaptionWidth,
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
import { printedCode } from "./card-codes.js";
export type MaterialPageSize = "business" | "a6" | "a4";
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

/** A rectangle in millimetres from the top left corner of the page. */
interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The aspect of a finish's crop, width over height. */
function cropAspect(image: PDFImage, finish: MaterialFinish): number {
  const [, , cw, ch] = finish.crop;
  return (image.width * cw) / (image.height * ch);
}

/** Where a sample's photograph lies in a box: as large as fits, centred, in millimetres. */
function sampleArea(image: PDFImage, finish: MaterialFinish, box: Area): Area {
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
  const left = area.x * MM;
  const bottom = page.getHeight() - (area.y + dh) * MM;
  page.pushOperators(
    pushGraphicsState(),
    rectangle(left, bottom, dw * MM, dh * MM),
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
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(sample.tint!.slice(i, i + 2), 16) / 255);
    page.pushOperators(
      ...outline,
      // Even-odd, so that a hole in the outline, such as a screw, stays untinted.
      clipEvenOdd(),
      endPath(),
      setGraphicsState(useTintState(page)),
      setFillingRgbColor(r!, g!, b!),
      rectangle(left, bottom, dw * MM, dh * MM),
      fill(),
    );
  }
  page.pushOperators(popGraphicsState());
}

type MaterialRenderContext = Awaited<ReturnType<typeof createRenderContext>>;

/** Front: ordered exact references. QR belongs only to a collection study. */
export async function renderMaterialCard(
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions = {},
): Promise<Uint8Array> {
  const context = await createRenderContext(style, content, options);
  if (context.individual === undefined) drawMaterialStudy(context);
  else drawMaterialFront(context);
  return context.doc.save();
}

async function createRenderContext(
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions,
) {
  if (content.kind !== "colors" && content.kind !== "sskr")
    throw new Error("Material cards require color references.");
  const share = content.kind === "sskr";
  if (share) {
    assertShareQr(content.colors, content.payload, content.labels);
  } else {
    colorsToIndexes(content.colors);
    if (
      content.payload !== content.colors.join(" ") &&
      unicodeToColors(content.payload).join(" ") !== content.colors.join(" ")
    )
      throw new Error("Collection QR does not match its references.");
  }
  if (content.colors.length < 1 || content.colors.length > 16)
    throw new Error("Material cards support at most 16 references.");
  const size = options.pageSize ?? content.pageSize ?? "business";
  if (!["business", "a6", "a4"].includes(size))
    throw new Error("Material page size must be business, a6 or a4.");
  const individual = options.individualIndex;
  if (
    individual !== undefined &&
    (!Number.isInteger(individual) || individual < 0 || individual >= content.colors.length)
  )
    throw new Error("Invalid material card index.");
  const { width, height, portrait, scale } = materialPageLayout(size, content.orientation);
  const artwork = materialArtwork[style];
  const presentation = resolvePresentationFor(content);
  const includeQr = content.cardQr === true || (share && content.qrCard === true);
  const profile = resolveIdentityFor(content);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readRenderAsset("fonts/DejaVuSans-UI.ttf"), {
    subset: true,
  });
  const image = await doc.embedJpg(await readRenderAsset(`images/material-${style}.jpg`));
  // Chosen for all references of the card together, so that no two of them look alike and an
  // individual fragment shows the same sample as the whole card.
  const samples = chooseMaterialSamples(style, content.colors);
  const ink = artwork.dark ? rgb(0.94, 0.92, 0.87) : rgb(0.15, 0.16, 0.16);
  const muted = artwork.dark ? rgb(0.73, 0.72, 0.67) : rgb(0.38, 0.38, 0.35);
  clearDocumentMetadata(doc);
  const drawText = (
    page: PDFPage,
    value: string,
    top: number,
    desired: number,
    maxWidth: number,
    center: number,
    subdued = false,
  ) => {
    const supported = font.getCharacterSet();
    if ([...value].some((c) => !supported.includes(c.codePointAt(0)!)))
      throw new Error("Card text contains a character not supported by the font.");
    const fs = Math.min(
      desired * scale,
      (maxWidth * MM) / Math.max(font.widthOfTextAtSize(value, 1), 0.01),
    );
    if (fs < TYPE_LAYOUT.minimumFont * scale)
      throw new Error("Card text is too long to fit legibly; shorten the company or name.");
    page.drawText(value, {
      x: center * MM - font.widthOfTextAtSize(value, fs) / 2,
      // Preserve the one-font-size line box used by the other card renderers.
      y: page.getHeight() - top * MM - fs,
      size: fs,
      font,
      color: subdued ? muted : ink,
    });
  };
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
    includeQr,
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
  drawText(
    page,
    presentation.studioName.toUpperCase(),
    TYPE_LAYOUT.studioTop * scale,
    8,
    width - 8 * scale,
    width / 2,
  );
  drawText(page, artwork.title, TYPE_LAYOUT.titleTop * scale, 4.8, width - 8 * scale, width / 2);
  drawText(
    page,
    `Prepared for ${profile.name}`,
    TYPE_LAYOUT.ownerTop * scale,
    4.5,
    width - 8 * scale,
    width / 2,
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
    const centeredStart = (width - (countThisRow * cellWidth + (countThisRow - 1) * gap)) / 2;
    const x = centeredStart + (i % columns) * (cellWidth + gap);
    const top = areaTop + Math.floor(i / columns) * cellHeight;
    const labelsHeight = TYPE_LAYOUT.labelsHeight * scale;
    const imageHeight = cellHeight - labelsHeight;
    drawSample(page, image, artwork, sample, x, top, cellWidth, imageHeight);
    // Both captions share the physical center of the image, including incomplete rows.
    drawText(
      page,
      `${String(entries[i]!.index + 1).padStart(2, "0")}  ${printedCode(content, entries[i]!.index)}`,
      top + imageHeight + TYPE_LAYOUT.referenceOffset * scale,
      5.5,
      cellWidth,
      x + cellWidth / 2,
    );
    drawText(
      page,
      sample.label,
      top + imageHeight + TYPE_LAYOUT.finishOffset * scale,
      4.8,
      cellWidth,
      x + cellWidth / 2,
      true,
    );
  }
  drawText(
    page,
    presentation.subtitle,
    height - TYPE_LAYOUT.footerInset * scale,
    4.5,
    width - 8 * scale,
    width / 2,
    true,
  );
}

function drawMaterialStudy(context: MaterialRenderContext): void {
  const { doc, font, content, size, artwork, image, samples, presentation, profile, includeQr } =
    context;
  const payload = includeQr ? content.payload : undefined;
  const compact = size === "business";
  // Compact studies prioritize exact recovery references over decorative finish names.
  const captions = content.colors.map((_, index) => [
    `${String(index + 1).padStart(2, "0")}  ${printedCode(content, index)}`,
    ...(compact ? [] : [samples[index]!.label]),
  ]);
  const layout = collectionSheetLayout(
    { ...content, pageSize: size },
    content.colors.length,
    // The finishes of one material are cropped alike, so every box takes the shape of a sample.
    cropAspect(image, artwork.finishes[0]!),
    compact ? 1 : 2,
    payload,
    studyCaptionWidth(font, captions.flat()),
  );
  const page = doc.addPage([layout.width * MM, layout.height * MM]);
  drawStudyFrame(
    page,
    font,
    layout,
    presentation,
    content.title ?? presentation.studioName,
    content.kind === "sskr" ? content.collectionReference : "01",
    profile.name,
    payload,
    artwork.studyTheme,
  );
  for (const box of layout.cards) {
    const sample = samples[box.index]!;
    drawStudyShadow(page, { ...box, ...sampleArea(image, sample.finish, box) }, artwork.studyTheme);
    drawSample(page, image, artwork, sample, box.x, box.y, box.width, box.height);
    drawStudyCaption(page, font, layout, box, captions[box.index]!, artwork.studyTheme);
  }
}
