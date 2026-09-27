import { resolveIdentityFor, sectorForTemplate } from './card-identities.js';
import { fit, text, clipCard } from './business-render-primitives.js';
import { businessFields, physicalStyle } from './business-designs.js';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  popGraphicsState,
} from 'pdf-lib';
import { drawCollectionQr, qrSizeMm } from './card-qr.js';
export { drawCollectionQr } from './card-qr.js';
import { clearDocumentMetadata } from './document-metadata.js';
import { resolvePresentationFor } from './card-copy.js';
import { colorsToIndexes, unicodeToColors } from '../core.js';
import type { CardContent } from './templates.js';
import type { SskrCardContent } from './sskr-content.js';
import { colorsToShare } from '../sskr/transport.js';
import { businessArtwork } from './business-artwork.js';
import { businessPages, MM, type CardBox, type BusinessPage } from './business-layout.js';
import {
  parsePageSize,
  type BusinessStyle,
  type CardProfile,
  type CardPageSize,
  type CardPresentation,
} from './card-settings.js';

const ink = rgb(0.12, 0.13, 0.14);
const muted = rgb(0.4, 0.42, 0.44);
const white = rgb(1, 1, 1);

type BusinessContent = Exclude<CardContent, { readonly kind: 'unicode' }> | SskrCardContent;

function validateContent(
  content: CardContent | SskrCardContent,
): asserts content is BusinessContent {
  if (content.kind !== 'colors' && content.kind !== 'sskr')
    throw new Error('Business cards require a color representation.');
  const share = content.kind === 'sskr';
  if (share) {
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

const CARD = { width: 90, height: 50 } as const;
const COLORS = { ink, muted, white, page: rgb(0.965, 0.968, 0.971) } as const;
type FittedField = ReturnType<typeof businessFields>[number] & { size: number };
interface RenderContext {
  doc: PDFDocument;
  font: PDFFont;
  content: BusinessContent;
  style: BusinessStyle;
  styleOffset: number;
  size: CardPageSize;
  artwork: (index: number, code: string) => Promise<PDFImage>;
  profile: Required<CardProfile>;
  presentation: CardPresentation;
  fieldsFor: (index: number) => FittedField[];
  fieldColor: (dark: boolean | undefined, index: number) => ReturnType<typeof rgb>;
}

export async function renderBusinessCards(
  style: BusinessStyle,
  content: CardContent | SskrCardContent,
  individualIndex?: number,
  styleOffset = 0,
): Promise<Uint8Array> {
  validateContent(content);
  const size = parsePageSize(content.pageSize);
  const profile = resolveIdentityFor(content, sectorForTemplate(style));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(new URL('../../assets/fonts/DejaVuSans-UI.ttf', import.meta.url)),
    { subset: true },
  );
  const presentation = resolvePresentationFor(content);
  clearDocumentMetadata(doc);
  const fieldColor = (dark: boolean | undefined, index: number) => {
    if (!dark) return white;
    if (physicalStyle(style, index + styleOffset) !== 'curves') return ink;
    const hex = content.colors[index]!;
    const c = [1, 3, 5].map((pos) => parseInt(hex.slice(pos, pos + 2), 16));
    const peak = Math.max(...c, 1);
    return (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / peak > 0.48 ? ink : white;
  };
  const fieldsFor = (index: number) => buildFields(style, styleOffset, profile, font, index);
  // Scoped to one PDF: shared images never retain user data across exports.
  const artworkCache = new Map<string, Promise<PDFImage>>();
  const artwork = (index: number, code: string): Promise<PDFImage> => {
    const design = physicalStyle(style, index + styleOffset);
    const key = `${design}:${code}`;
    let pending = artworkCache.get(key);
    if (!pending) {
      pending = businessArtwork(design, code).then((bytes) => doc.embedPng(bytes));
      artworkCache.set(key, pending);
    }
    return pending;
  };
  const context: RenderContext = {
    artwork,
    doc,
    font,
    content,
    style,
    styleOffset,
    size,
    profile,
    presentation,
    fieldsFor,
    fieldColor,
  };
  if (individualIndex !== undefined) await renderSingle(context, individualIndex);
  else await renderCollection(context);
  return doc.save();
}

function buildFields(
  style: BusinessStyle,
  styleOffset: number,
  profile: Required<CardProfile>,
  font: PDFFont,
  index: number,
): FittedField[] {
  return businessFields(physicalStyle(style, index + styleOffset), profile).map((field) => ({
    ...field,
    size: fit(
      font,
      field.value,
      field.preferred,
      field.minimum,
      CARD.width * MM * field.width,
      field.label,
    ),
  }));
}

async function renderSingle(context: RenderContext, individualIndex: number): Promise<void> {
  const {
    doc,
    font,
    content,
    style,
    styleOffset,
    size,
    profile,
    presentation,
    fieldsFor,
    fieldColor,
  } = context;
  const share = content.kind === 'sskr';
  if (
    !Number.isInteger(individualIndex) ||
    individualIndex < 0 ||
    individualIndex >= content.colors.length
  )
    throw new Error('Invalid card index.');
  const code = content.colors[individualIndex]!.toUpperCase();
  // This document contains only this reference: no collection QR or hidden full payload.
  const page = doc.addPage([90 * MM, 50 * MM]);
  const box = { x: 0, y: 0, width: 90, height: 50, index: individualIndex };
  clipCard(page, box);
  page.drawImage(await context.artwork(individualIndex, code), {
    x: 0,
    y: 0,
    width: 90 * MM,
    height: 50 * MM,
  });
  page.pushOperators(popGraphicsState());
  for (const field of fieldsFor(individualIndex))
    text(
      page,
      font,
      field.value,
      field.x * 90,
      field.y * 50,
      field.size,
      fieldColor(field.dark, individualIndex),
    );
  const wholeShareQr = share && content.qrCard === true;
  const reference = wholeShareQr
    ? content.collectionReference
    : share
      ? `${String(individualIndex + 1).padStart(2, '0')} / ${content.colors.length}  ${code.slice(1)}  |  ${content.collectionReference}`
      : code.slice(1);
  const referenceText = `${presentation.referenceLabel} ${reference}`.trim();
  const design = physicalStyle(style, individualIndex + styleOffset);
  text(
    page,
    font,
    referenceText,
    7.2,
    46,
    fit(font, referenceText, design === 'contact' ? 4.6 : 6.3, 4.2, 76 * MM, 'Reference'),
    ['contact', 'facets'].includes(design) ? ink : rgb(0.84, 0.86, 0.88),
  );
  resizeSinglePage(page, content);
  if (content.cardQr || wholeShareQr) {
    // Ordinary individual files contain this fragment only, never the complete secret.
    drawQrBack(
      context,
      page.getWidth() / MM,
      page.getHeight() / MM,
      wholeShareQr ? content.payload : code,
      share ? content.collectionReference : '',
    );
  }
}

async function renderCollection(context: RenderContext): Promise<void> {
  const {
    doc,
    font,
    content,
    style,
    styleOffset,
    size,
    profile,
    presentation,
    fieldsFor,
    fieldColor,
  } = context;
  const share = content.kind === 'sskr';
  const small = size === 'wallet' || size === 'business';
  const pages = businessPages(content.colors.length, size, content.orientation, share);
  for (const [pageNumber, layout] of pages.entries()) {
    const page = doc.addPage([layout.width * MM, layout.height * MM]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
      color: COLORS.page,
    });
    drawCollectionHeader(context, page, layout, small);
    for (const box of layout.cards) {
      await drawCard(context, page, box, small);
    }
    drawFooter(context, page, layout, pageNumber, pages.length, small);
  }
  if (content.cardQr || (share && content.qrCard)) {
    const lastLayout = pages[pages.length - 1]!;
    drawQrBack(
      context,
      lastLayout.width,
      lastLayout.height,
      content.payload,
      share ? content.collectionReference : '',
    );
  }
}

async function drawCard(
  context: RenderContext,
  page: PDFPage,
  box: CardBox,
  small: boolean,
): Promise<void> {
  const { doc, font, content, style, styleOffset, size, fieldsFor, fieldColor, presentation } =
    context;
  const share = content.kind === 'sskr';
  const code = content.colors[box.index]!.toUpperCase();
  const artwork = await context.artwork(box.index, code);
  if (size === 'a6')
    page.drawRectangle({
      x: (box.x + 0.3) * MM,
      y: page.getHeight() - (box.y + box.height + 0.4) * MM,
      width: box.width * MM,
      height: box.height * MM,
      color: rgb(0.8, 0.81, 0.82),
      opacity: 0.4,
    });
  clipCard(page, box);
  page.drawImage(artwork, {
    x: box.x * MM,
    y: page.getHeight() - (box.y + box.height) * MM,
    width: box.width * MM,
    height: box.height * MM,
  });
  page.pushOperators(popGraphicsState());
  const scale = box.width / 90;
  for (const field of fieldsFor(box.index))
    text(
      page,
      font,
      field.value,
      box.x + field.x * box.width,
      box.y + field.y * box.height,
      field.size * scale,
      fieldColor(field.dark, box.index),
    );
  const ref = `${small || !presentation.referenceLabel ? '' : presentation.referenceLabel + ' '}${share ? String(box.index + 1).padStart(2, '0') + ' ' : ''}${code.slice(1)}`;
  const refSize = small ? 6 : size === 'a6' ? 4.7 : 7;
  text(
    page,
    font,
    ref,
    box.x + (box.width - font.widthOfTextAtSize(ref, refSize) / MM) / 2,
    box.y + box.height + 0.9,
    refSize,
  );
}

function drawFooter(
  context: RenderContext,
  page: PDFPage,
  layout: BusinessPage,
  pageNumber: number,
  pageCount: number,
  small: boolean,
): void {
  if (small) return;
  const { font, content, size, presentation } = context;
  const lineY = layout.height - 8;
  page.drawLine({
    start: { x: 4 * MM, y: page.getHeight() - lineY * MM },
    end: { x: (layout.width - 4) * MM, y: page.getHeight() - lineY * MM },
    color: muted,
    thickness: 0.3,
  });
  const footerSize = fit(
    font,
    presentation.footer,
    size === 'a6' ? 4.6 : 7,
    4.2,
    (layout.width / 2 - 8) * MM,
    'Footer',
  );
  text(page, font, presentation.footer, 4, lineY + 2, footerSize, muted);
  if (content.kind === 'sskr') {
    const caption = `${presentation.referenceLabel} ${content.collectionReference}`.trim();
    const captionSize = fit(
      font,
      caption,
      size === 'a6' ? 4.5 : 7,
      4.2,
      (layout.width / 2 - 8) * MM,
      'Reference',
    );
    text(
      page,
      font,
      caption,
      layout.width - 4 - font.widthOfTextAtSize(caption, captionSize) / MM,
      lineY + 2,
      captionSize,
      muted,
    );
  }
  if (size === 'a4')
    text(page, font, `${pageNumber + 1} / ${pageCount}`, 12, layout.height - 26, 7, muted);
}

/** Full-payload QR gets its own physical area; decorative cards are never shrunk around it. */
function drawQrBack(
  context: RenderContext,
  width: number,
  height: number,
  payload: string,
  reference: string,
): void {
  const { doc, font, profile, presentation } = context;
  const qrSize = qrSizeMm(payload);
  if (qrSize > Math.min(width - 10, height - 16))
    throw new Error('The QR does not fit legibly; choose a larger page size.');
  const page = doc.addPage([width * MM, height * MM]);
  const headingSize = fit(font, profile.company, 8, 4.2, (width - 10) * MM, 'Company');
  text(
    page,
    font,
    profile.company,
    (width - font.widthOfTextAtSize(profile.company, headingSize) / MM) / 2,
    3,
    headingSize,
  );
  drawCollectionQr(page, payload, (width - qrSize) / 2, (height - qrSize) / 2, qrSize);
  const caption = reference ? `${presentation.referenceLabel} ${reference}`.trim() : '';
  if (caption) {
    const captionSize = fit(font, caption, 6, 4.2, (width - 10) * MM, 'Reference');
    text(
      page,
      font,
      caption,
      (width - font.widthOfTextAtSize(caption, captionSize) / MM) / 2,
      height - 6,
      captionSize,
      muted,
    );
  }
}

function drawCollectionHeader(
  context: RenderContext,
  page: PDFPage,
  layout: BusinessPage,
  small: boolean,
): void {
  const { content, presentation, font, size } = context;
  const pageTitle = content.title ?? presentation.studioName;
  const headingSize = fit(
    font,
    pageTitle,
    small ? 7 : size === 'a6' ? 11 : 17,
    small ? 5 : size === 'a6' ? 7 : 10,
    (layout.width - 12) * MM,
    'Title',
  );
  const headingX = (layout.width - font.widthOfTextAtSize(pageTitle, headingSize) / MM) / 2;
  text(page, font, pageTitle, headingX, small ? 2 : size === 'a6' ? 2.5 : 7, headingSize);
  const subtitle = presentation.subtitle;
  const subtitleSize = fit(
    font,
    subtitle,
    size === 'a6' ? 5.5 : 9,
    4.2,
    (layout.width - 12) * MM,
    'Subtitle',
  );
  if (!small)
    text(
      page,
      font,
      subtitle,
      (layout.width - font.widthOfTextAtSize(subtitle, subtitleSize) / MM) / 2,
      size === 'a6' ? 8 : 15,
      subtitleSize,
      muted,
    );
  if (!small && presentation.slogan) {
    const sloganSize = fit(
      font,
      presentation.slogan,
      size === 'a6' ? 4.8 : 7,
      4.2,
      (layout.width - 12) * MM,
      'Slogan',
    );
    text(
      page,
      font,
      presentation.slogan,
      (layout.width - font.widthOfTextAtSize(presentation.slogan, sloganSize) / MM) / 2,
      size === 'a6' ? 10.7 : 20,
      sloganSize,
      muted,
    );
  }
}

function resizeSinglePage(page: PDFPage, content: BusinessContent): void {
  if (content.pageSize !== undefined || content.orientation !== undefined) {
    const dimensions =
      content.pageSize === 'a4'
        ? [210, 297]
        : content.pageSize === 'a6'
          ? [148, 105]
          : content.pageSize === 'wallet'
            ? [85.6, 54]
            : [90, 50];
    if (
      (content.orientation === 'portrait' && dimensions[0]! > dimensions[1]!) ||
      (content.orientation === 'landscape' && dimensions[0]! < dimensions[1]!)
    )
      dimensions.reverse();
    const [width, height] = dimensions as [number, number];
    const scale = Math.min(1, width / 90, height / 50);
    page.scaleContent(scale, scale);
    page.translateContent(((width - 90 * scale) * MM) / 2, ((height - 50 * scale) * MM) / 2);
    page.setSize(width * MM, height * MM);
  }
}
