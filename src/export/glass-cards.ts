import {
  glassPageLayout,
  GLASS_CARD as CARD,
  GLASS_SHEET as SHEET,
  type GlassPageLayout,
} from './glass-layout.js';
import { resolveIdentityFor } from './card-identities.js';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { colorsToIndexes, unicodeToColors } from '../core.js';
import { colorsToShare } from '../sskr/transport.js';
import { drawCollectionQr, qrSizeMm } from './card-qr.js';
import { resolvePresentationFor } from './card-copy.js';
import { clearDocumentMetadata } from './document-metadata.js';
import { parsePageSize, type CardProfile, type CardPresentation } from './card-settings.js';
import { glassArtwork } from './glass-artwork.js';
import type { CardContent } from './templates.js';
import type { SskrCardContent } from './sskr-content.js';

const MM = 72 / 25.4;
// Physical millimetres in the compact master; text remains vector and is never stretched.
const COMPACT_REFERENCES = {
  left: 3,
  columnPitch: 29,
  businessTop: 30,
  walletTop: 31,
  businessRowPitch: 4.8,
  walletRowPitch: 5.3,
  swatchSize: 2.3,
  textOffset: 3.3,
  fontSize: 6.6,
} as const;
const INLINE_QR = { minimum: 20, maximum: 22, rightInset: 23.5, bottomInset: 23.5 } as const;
const ink = rgb(0.1, 0.12, 0.13);
export const GLASS_REFERENCES_PER_CARD = 4;
export const glassCardCount = (referenceCount: number, referencesPerCard: 4 | 6 | 8 = 4): number =>
  Math.ceil(referenceCount / referencesPerCard);
type GlassContent = Exclude<CardContent, { readonly kind: 'unicode' }> | SskrCardContent;
interface RenderContext {
  doc: PDFDocument;
  font: PDFFont;
  content: GlassContent;
  profile: Required<CardProfile>;
  presentation: CardPresentation;
  count: number;
  referencesPerCard: 4 | 6 | 8;
  cardWidth: number;
  cardHeight: number;
  wholeShareQr: boolean;
}

function validateContent(content: CardContent | SskrCardContent): asserts content is GlassContent {
  if (content.kind !== 'colors' && content.kind !== 'sskr')
    throw new Error('Glass cards require color references.');
  if (content.kind === 'sskr') {
    colorsToShare(content.colors.join(' '));
    if (content.payload !== content.colors.join(' '))
      throw new Error('Share QR does not match the printed references.');
  } else {
    colorsToIndexes(content.colors);
    if (
      content.payload !== content.colors.join(' ') &&
      unicodeToColors(content.payload).join(' ') !== content.colors.join(' ')
    )
      throw new Error('Collection QR does not match the printed references.');
  }
}

function referencesFor(
  content: GlassContent,
  index: number,
  referencesPerCard = GLASS_REFERENCES_PER_CARD,
): readonly string[] {
  const start = index * referencesPerCard;
  return content.colors.slice(start, start + referencesPerCard);
}

function fit(
  font: PDFFont,
  value: string,
  preferred: number,
  width: number,
  minimum = 4.8,
): number {
  const size = Math.min(
    preferred,
    (width * MM) / Math.max(0.001, font.widthOfTextAtSize(value, 1)),
  );
  if (size < minimum) throw new Error('Card contact details are too long; shorten the value.');
  return size;
}

function write(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  top: number,
  size: number,
): void {
  if (!value) return;
  page.drawText(value, {
    x: x * MM,
    // Convert the established top-of-line-box convention to the PDF baseline.
    y: page.getHeight() - top * MM - size,
    font,
    size,
    color: ink,
  });
}

function drawSheetIdentity(context: RenderContext, page: PDFPage, layout: GlassPageLayout): void {
  if (!layout.studioSheet) return;
  const { font, presentation } = context;
  const width = layout.width - 2 * SHEET.side;
  for (const [value, top, preferred] of [
    [presentation.studioName, 3, 11],
    [presentation.slogan, 9, 6.5],
    [presentation.subtitle, 13, 5.8],
    [presentation.footer, layout.height - 7, 5.5],
  ] as const) {
    if (value) write(page, font, value, SHEET.side, top, fit(font, value, preferred, width, 4.5));
  }
}

async function drawCard(
  context: RenderContext,
  page: PDFPage,
  index: number,
  x: number,
  top: number,
  scale: number,
): Promise<void> {
  const { doc, font, content, profile, count, referencesPerCard, cardWidth, cardHeight } = context;
  const refs = referencesFor(content, index, referencesPerCard);
  const bytes = await glassArtwork(refs, referencesPerCard);
  const artwork = referencesPerCard === 4 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  page.drawImage(artwork, {
    x: x * MM,
    y: page.getHeight() - (top + cardHeight * scale) * MM,
    width: cardWidth * scale * MM,
    height: cardHeight * scale * MM,
  });
  if (referencesPerCard !== 4) {
    drawCompactLabels(context, page, index, refs, x, top, scale);
    return;
  }
  const label = (value: string, dx: number, dy: number, size: number) =>
    write(page, font, value, x + dx * scale, top + dy * scale, size * scale);
  label(profile.company, 4, 3.3, fit(font, profile.company, 9, 37));
  label(profile.website, 4, 8, fit(font, profile.website, 5.2, 37));
  label(profile.name, 47, 3.3, fit(font, profile.name, 8.5, 39));
  label(profile.role, 47, 7.4, fit(font, profile.role, 5.8, 39));
  label(profile.email, 47, 10.7, fit(font, profile.email, 5.5, 39));
  label(profile.phone, 47, 13.8, fit(font, profile.phone, 5.2, 39));
  for (const [offset, ref] of refs.entries()) {
    const dx = 4 + (offset % 2) * 33;
    const dy = 35 + Math.floor(offset / 2) * 6;
    const components = [1, 3, 5].map((p) => parseInt(ref.slice(p, p + 2), 16) / 255);
    page.drawRectangle({
      x: (x + dx * scale) * MM,
      y: page.getHeight() - (top + (dy + 2.8) * scale) * MM,
      width: 2.8 * scale * MM,
      height: 2.8 * scale * MM,
      color: rgb(components[0]!, components[1]!, components[2]!),
      borderWidth: 0.3,
      borderColor: rgb(0.85, 0.85, 0.85),
    });
    label(
      `${String(index * GLASS_REFERENCES_PER_CARD + offset + 1).padStart(2, '0')}  ${ref.slice(1)}`,
      dx + 4,
      dy,
      6.8,
    );
  }
  label(
    `${content.kind === 'sskr' ? content.collectionReference : 'Collection reference'}  /  ${String(index + 1).padStart(2, '0')}-${String(count).padStart(2, '0')}`,
    4,
    46.5,
    4.6,
  );
}

/** Compact references stay vector text at a fixed readable size; artwork is decorative. */
function drawCompactLabels(
  context: RenderContext,
  page: PDFPage,
  index: number,
  refs: readonly string[],
  x: number,
  top: number,
  scale: number,
): void {
  const { font, profile, referencesPerCard, cardWidth, cardHeight } = context;
  const label = (value: string, dx: number, dy: number, size: number) =>
    write(page, font, value, x + dx * scale, top + dy * scale, size * scale);
  const right = cardWidth / 2 + 2;
  label(profile.company, 3, 2.7, fit(font, profile.company, 8.2, right - 6));
  label(profile.website, 3, 7, fit(font, profile.website, 5.2, right - 6));
  label(profile.name, right, 2.7, fit(font, profile.name, 8, right - 6));
  label(profile.role, right, 6.8, fit(font, profile.role, 5.5, right - 6));
  label(profile.email, right, 10.2, fit(font, profile.email, 5.2, right - 6));
  label(profile.phone, 3, 10.4, fit(font, profile.phone, 5.2, right - 6));
  const rowGap =
    cardHeight === 50 ? COMPACT_REFERENCES.businessRowPitch : COMPACT_REFERENCES.walletRowPitch;
  const firstRow =
    cardHeight === 50 ? COMPACT_REFERENCES.businessTop : COMPACT_REFERENCES.walletTop;
  for (const [offset, ref] of refs.entries()) {
    const dx = COMPACT_REFERENCES.left + (offset % 2) * COMPACT_REFERENCES.columnPitch;
    const dy = firstRow + Math.floor(offset / 2) * rowGap;
    const components = [1, 3, 5].map((p) => parseInt(ref.slice(p, p + 2), 16) / 255);
    page.drawRectangle({
      x: (x + dx * scale) * MM,
      y: page.getHeight() - (top + (dy + COMPACT_REFERENCES.swatchSize) * scale) * MM,
      width: COMPACT_REFERENCES.swatchSize * scale * MM,
      height: COMPACT_REFERENCES.swatchSize * scale * MM,
      color: rgb(components[0]!, components[1]!, components[2]!),
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 0.25,
    });
    label(
      `${String(index * referencesPerCard + offset + 1).padStart(2, '0')} ${ref.slice(1)}`,
      dx + COMPACT_REFERENCES.textOffset,
      dy,
      COMPACT_REFERENCES.fontSize,
    );
  }
}

function drawQrBack(context: RenderContext, layout: GlassPageLayout, payload: string): void {
  const { doc, font, profile, content } = context;
  const qrSize = qrSizeMm(payload, 28);
  const available = Math.min(layout.width - 10, layout.height - 18);
  if (qrSize > available)
    throw new Error('The QR code does not fit this card size. Choose A6 or A4.');
  const page = doc.addPage([layout.width * MM, layout.height * MM]);
  drawSheetIdentity(context, page, layout);
  if (!layout.studioSheet)
    write(page, font, profile.company, 5, 3, fit(font, profile.company, 8, layout.width - 10));
  const top = (layout.height - qrSize) / 2;
  drawCollectionQr(page, payload, (layout.width - qrSize) / 2, top, qrSize);
  const caption =
    content.kind === 'sskr'
      ? `Collection reference ${content.collectionReference}`
      : 'Collection reference';
  write(page, font, caption, 5, layout.height - (layout.studioSheet ? 11 : 6), 5.5);
}

/** Four ordered references per card. Optional QR is never reduced to a decorative thumbnail. */
export async function renderGlassCards(
  content: CardContent | SskrCardContent,
  individualIndex?: number,
  referencesPerCard: 4 | 6 | 8 = 4,
): Promise<Uint8Array> {
  validateContent(content);
  const wholeShareQr = content.kind === 'sskr' && content.qrCard === true;
  if (![4, 6, 8].includes(referencesPerCard)) throw new Error('Glass capacity must be 4, 6 or 8.');
  const count = wholeShareQr ? 1 : glassCardCount(content.colors.length, referencesPerCard);
  const cardWidth = referencesPerCard === 4 || content.pageSize === 'business' ? 90 : 85.6;
  const cardHeight = referencesPerCard === 4 || content.pageSize === 'business' ? 50 : 54;
  if (
    individualIndex !== undefined &&
    (!Number.isInteger(individualIndex) || individualIndex < 0 || individualIndex >= count)
  )
    throw new Error('Invalid glass card index.');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(new URL('../../assets/fonts/DejaVuSans-UI.ttf', import.meta.url)),
    { subset: true },
  );
  const context: RenderContext = {
    doc,
    font,
    content,
    count,
    referencesPerCard,
    cardWidth,
    cardHeight,
    wholeShareQr,
    profile: resolveIdentityFor(content, undefined),
    presentation: resolvePresentationFor(content),
  };
  const layout = glassPageLayout(
    content,
    individualIndex !== undefined,
    cardWidth,
    cardHeight,
    count,
  );
  const selected =
    individualIndex === undefined ? Array.from({ length: count }, (_, i) => i) : [individualIndex];
  let needsQrBack = Boolean(content.cardQr || wholeShareQr);
  const inlinePayloads = selected.map((index) =>
    wholeShareQr ? content.payload : referencesFor(content, index, referencesPerCard).join(' '),
  );
  const inlineQr =
    needsQrBack &&
    referencesPerCard !== 4 &&
    layout.scale >= 1 &&
    inlinePayloads.every((payload) => qrSizeMm(payload, INLINE_QR.minimum) <= INLINE_QR.maximum);
  if (inlineQr) needsQrBack = false;
  await drawGlassPages(context, layout, selected, inlineQr);
  if (needsQrBack) {
    const payload =
      individualIndex !== undefined && !wholeShareQr
        ? referencesFor(content, individualIndex, referencesPerCard).join(' ')
        : content.payload;
    drawQrBack(context, layout, payload);
  }
  clearDocumentMetadata(doc);
  return doc.save();
}

async function drawGlassPages(
  context: RenderContext,
  layout: GlassPageLayout,
  selected: readonly number[],
  inlineQr: boolean,
): Promise<void> {
  const { doc, content, cardWidth, cardHeight, wholeShareQr, referencesPerCard } = context;
  const capacity = layout.columns * layout.rows;
  for (let start = 0; start < selected.length; start += capacity) {
    const indices = selected.slice(start, start + capacity);
    const page = doc.addPage([layout.width * MM, layout.height * MM]);
    drawSheetIdentity(context, page, layout);
    const usedRows = Math.ceil(indices.length / layout.columns);
    const cw = cardWidth * layout.scale;
    const ch = cardHeight * layout.scale;
    const gridHeight = usedRows * ch + (usedRows - 1) * CARD.gap;
    for (const [local, index] of indices.entries()) {
      const row = Math.floor(local / layout.columns);
      const col = local % layout.columns;
      const usedColumns = Math.min(layout.columns, indices.length - row * layout.columns);
      const x =
        (layout.width - (usedColumns * cw + (usedColumns - 1) * CARD.gap)) / 2 +
        col * (cw + CARD.gap);
      const top =
        layout.top + (layout.bottom - layout.top - gridHeight) / 2 + row * (ch + CARD.gap);
      await drawCard(context, page, index, x, top, layout.scale);
      if (inlineQr) {
        const payload = wholeShareQr
          ? content.payload
          : referencesFor(content, index, referencesPerCard).join(' ');
        const qrSize = qrSizeMm(payload, INLINE_QR.minimum);
        drawCollectionQr(
          page,
          payload,
          x + cardWidth - INLINE_QR.rightInset,
          top + cardHeight - INLINE_QR.bottomInset,
          qrSize,
        );
      }
    }
  }
}
