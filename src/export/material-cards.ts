import { materialPageLayout, materialGridLayout } from './material-layout.js';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  type PDFPage,
  type PDFImage,
} from 'pdf-lib';
import { colorsToIndexes, unicodeToColors } from '../core.js';
import { colorsToShare } from '../sskr/transport.js';
import type { CardContent } from './templates.js';
import type { SskrCardContent } from './sskr-content.js';
import { resolveIdentityFor } from './card-identities.js';
import { drawCollectionQr, qrSizeMm } from './card-qr.js';
import { resolvePresentationFor } from './card-copy.js';
import { clearDocumentMetadata } from './document-metadata.js';
import {
  chooseMaterialFinish,
  materialArtwork,
  type MaterialFinish,
  type MaterialStyle,
} from './material-artwork.js';
export type MaterialPageSize = 'wallet' | 'business' | 'a6' | 'a4';
export interface MaterialCardOptions {
  readonly pageSize?: MaterialPageSize;
  readonly individualIndex?: number;
}
const MM = 72 / 25.4;
const TYPE_LAYOUT = {
  studioTop: 2.2,
  titleTop: 6,
  ownerTop: 8.7,
  labelsHeight: 4.5,
  referenceOffset: 0.3,
  finishOffset: 2.3,
  footerInset: 3.2,
  minimumFont: 3.8,
} as const;

function drawSample(
  page: PDFPage,
  image: PDFImage,
  finish: MaterialFinish,
  x: number,
  top: number,
  width: number,
  height: number,
) {
  const [cx, cy, cw, ch] = finish.crop;
  const cropRatio = (image.width * cw) / (image.height * ch);
  const dw = Math.min(width, height * cropRatio);
  const dh = dw / cropRatio;
  const left = (x + (width - dw) / 2) * MM;
  const bottom = page.getHeight() - (top + (height + dh) / 2) * MM;
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
  page.pushOperators(popGraphicsState());
}

type MaterialRenderContext = Awaited<ReturnType<typeof createRenderContext>>;

/** Front: ordered exact references. An explicitly requested QR uses a separate reverse. */
export async function renderMaterialCard(
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions = {},
): Promise<Uint8Array> {
  const context = await createRenderContext(style, content, options);
  drawMaterialFront(context);
  if (context.includeQr) drawMaterialReverse(context);
  return context.doc.save();
}

async function createRenderContext(
  style: MaterialStyle,
  content: CardContent | SskrCardContent,
  options: MaterialCardOptions,
) {
  if (content.kind !== 'colors' && content.kind !== 'sskr')
    throw new Error('Material cards require color references.');
  const share = content.kind === 'sskr';
  if (share) {
    colorsToShare(content.colors.join(' '));
    if (content.payload !== content.colors.join(' '))
      throw new Error('Share QR does not match its references.');
  } else {
    colorsToIndexes(content.colors);
    if (
      content.payload !== content.colors.join(' ') &&
      unicodeToColors(content.payload).join(' ') !== content.colors.join(' ')
    )
      throw new Error('Collection QR does not match its references.');
  }
  if (content.colors.length < 1 || content.colors.length > 16)
    throw new Error('Material cards support at most 16 references.');
  const size = options.pageSize ?? content.pageSize ?? 'wallet';
  if (!['wallet', 'business', 'a6', 'a4'].includes(size))
    throw new Error('Material page size must be wallet, business, a6 or a4.');
  const individual = options.individualIndex;
  if (
    individual !== undefined &&
    (!Number.isInteger(individual) || individual < 0 || individual >= content.colors.length)
  )
    throw new Error('Invalid material card index.');
  const { width, height, portrait, scale } = materialPageLayout(size, content.orientation);
  const artwork = materialArtwork[style];
  const presentation = resolvePresentationFor(content);
  const includeQr = content.cardQr === true || (share && content.qrCard === true);
  const profile = resolveIdentityFor(content);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(new URL('../../assets/fonts/DejaVuSans-UI.ttf', import.meta.url)),
    { subset: true },
  );
  const image = await doc.embedJpg(
    await readFile(new URL(`../../assets/images/material-${style}.jpg`, import.meta.url)),
  );
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
      throw new Error('Card text contains a character not supported by the font.');
    const fs = Math.min(
      desired * scale,
      (maxWidth * MM) / Math.max(font.widthOfTextAtSize(value, 1), 0.01),
    );
    if (fs < TYPE_LAYOUT.minimumFont * scale)
      throw new Error('Card text is too long to fit legibly; shorten the company or name.');
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
    content,
    individual,
    style,
    width,
    height,
    scale,
    portrait,
    artwork,
    presentation,
    profile,
    image,
    includeQr,
    drawText,
    makePage,
  };
}

function drawMaterialFront(context: MaterialRenderContext): void {
  const {
    content,
    individual,
    style,
    width,
    height,
    scale,
    portrait,
    artwork,
    presentation,
    profile,
    image,
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
    const code = entries[i]!.code.toUpperCase();
    const finish = chooseMaterialFinish(style, code);
    const countThisRow = Math.min(columns, entries.length - Math.floor(i / columns) * columns);
    const centeredStart = (width - (countThisRow * cellWidth + (countThisRow - 1) * gap)) / 2;
    const x = centeredStart + (i % columns) * (cellWidth + gap);
    const top = areaTop + Math.floor(i / columns) * cellHeight;
    const labelsHeight = TYPE_LAYOUT.labelsHeight * scale;
    const imageHeight = cellHeight - labelsHeight;
    drawSample(page, image, finish, x, top, cellWidth, imageHeight);
    // Both captions share the physical center of the image, including incomplete rows.
    drawText(
      page,
      `${String(entries[i]!.index + 1).padStart(2, '0')}  ${code.slice(1)}`,
      top + imageHeight + TYPE_LAYOUT.referenceOffset * scale,
      5.5,
      cellWidth,
      x + cellWidth / 2,
    );
    drawText(
      page,
      finish.name,
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

function drawMaterialReverse(context: MaterialRenderContext): void {
  const {
    content,
    individual,
    width,
    height,
    scale,
    artwork,
    presentation,
    profile,
    drawText,
    makePage,
  } = context;
  // A fragment never inherits the full collection payload, even when QR is explicitly enabled.
  const qrPayload = individual === undefined ? content.payload : content.colors[individual]!;
  const back = makePage();
  drawText(
    back,
    presentation.studioName.toUpperCase(),
    3.5 * scale,
    8,
    width - 8 * scale,
    width / 2,
  );
  drawText(back, artwork.title, 8 * scale, 4.8, width - 8 * scale, width / 2, true);
  const qrSize = qrSizeMm(qrPayload, Math.max(28, 30 * scale));
  if (qrSize > width - 6 * scale || qrSize > height - 22 * scale) {
    throw new Error('The requested QR cannot fit safely on this card; choose a larger page size.');
  }
  drawCollectionQr(
    back,
    qrPayload,
    (width - qrSize) / 2,
    (height - qrSize) / 2 + 2 * scale,
    qrSize,
  );
  drawText(back, presentation.subtitle, height - 6.5 * scale, 4.8, width - 8 * scale, width / 2);
  drawText(
    back,
    `Prepared for ${profile.name}`,
    height - 3.5 * scale,
    4.5,
    width - 8 * scale,
    width / 2,
    true,
  );
}
