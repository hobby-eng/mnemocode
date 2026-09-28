import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { MM, type CardBox } from './business-layout.js';
import { fit, text } from './business-render-primitives.js';
import { drawCollectionQr, qrSizeForModuleMm } from './card-qr.js';
import { parsePageSize, type CardSettings, type CardPresentation } from './card-settings.js';

export interface StudyBox extends CardBox {
  readonly captionTop: number;
  readonly captionWidth: number;
  readonly captionX: number;
}

export interface StudyLayout {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly header: number;
  readonly footer: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly compact: boolean;
  readonly cards: readonly StudyBox[];
  readonly qr?: { readonly x: number; readonly y: number; readonly size: number };
}

export type StudyTheme = 'cool' | 'warm' | 'noir';

const COLLECTION_QR_MODULE_MM = 0.3;

/** A collection is a single design proposal, never a stack of duplex print cards. */
export function collectionSheetLayout(
  settings: CardSettings,
  count: number,
  aspect: number,
  captionLines: number,
  payload?: string,
  minimumCaptionWidth = 0,
): StudyLayout {
  if (!Number.isInteger(count) || count < 1 || count > 16 || aspect <= 0 || captionLines < 1)
    throw new Error('Invalid design study layout.');
  const size = parsePageSize(settings.pageSize);
  const dimensions =
    size === 'a4'
      ? [210, 297]
      : size === 'a6'
        ? [148, 105]
        : size === 'wallet'
          ? [85.6, 54]
          : [90, 50];
  if (
    settings.orientation !== undefined &&
    !['portrait', 'landscape'].includes(settings.orientation)
  )
    throw new Error('Orientation must be portrait or landscape.');
  if (
    (settings.orientation === 'portrait' && dimensions[0]! > dimensions[1]!) ||
    (settings.orientation === 'landscape' && dimensions[0]! < dimensions[1]!)
  )
    dimensions.reverse();
  const [width, height] = dimensions as [number, number];
  const compact = size === 'wallet' || size === 'business';
  const large = size === 'a4';
  const margin = compact ? 3 : large ? 10 : 5;
  const header = compact ? 11 : large ? 30 : 21;
  const footer = compact ? 4.5 : large ? 13 : 9;
  const fontSize = compact ? 4.3 : large ? 8 : 6;
  const lineHeight = compact ? 2.1 : large ? 4 : 3;
  const gap = compact ? 1.5 : large ? 6 : 3;
  const qrSize = payload === undefined ? 0 : qrSizeForModuleMm(payload, 0, COLLECTION_QR_MODULE_MM);
  const qr =
    payload === undefined
      ? undefined
      : {
          x: width - margin - qrSize,
          y: margin,
          size: qrSize,
        };
  let availableWidth = width - margin * 2;
  let availableHeight = height - header - footer;
  let contentTop = header;
  if (qr) {
    if (qr.x < margin || qr.y + qr.size + lineHeight >= height - footer)
      throw new Error('The QR cannot fit on the design study; choose a larger page size.');
    if (width >= height) availableWidth -= qrSize + gap * 2;
    else {
      contentTop = Math.max(header, qr.y + qrSize + lineHeight + gap);
      availableHeight = height - contentTop - footer;
    }
  }
  const captionHeight = captionLines * lineHeight + (compact ? 0.6 : 1.2);
  let best:
    | { columns: number; rows: number; cellWidth: number; imageHeight: number; area: number }
    | undefined;
  for (let columns = 1; columns <= Math.min(count, 6); columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (availableWidth - (columns - 1) * gap) / columns;
    if (cellWidth < minimumCaptionWidth) continue;
    const imageHeight = Math.min(
      cellWidth / aspect,
      (availableHeight - (rows - 1) * gap) / rows - captionHeight,
    );
    const area = imageHeight * imageHeight * aspect;
    if (imageHeight > 2 && (!best || area > best.area))
      best = { columns, rows, cellWidth, imageHeight, area };
  }
  if (!best) throw new Error('The design study cannot fit legibly; choose a larger page size.');
  const { columns, rows, cellWidth, imageHeight } = best;
  const cellHeight = imageHeight + captionHeight;
  const top = contentTop + (availableHeight - rows * cellHeight - (rows - 1) * gap) / 2;
  const cards = Array.from({ length: count }, (_, index): StudyBox => {
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const captionX =
      margin +
      (availableWidth - rowCount * cellWidth - (rowCount - 1) * gap) / 2 +
      (index % columns) * (cellWidth + gap);
    const y = top + row * (cellHeight + gap);
    const cardWidth = imageHeight * aspect;
    return {
      index,
      x: captionX + (cellWidth - cardWidth) / 2,
      y,
      width: cardWidth,
      height: imageHeight,
      captionX,
      captionWidth: cellWidth,
      captionTop: y + imageHeight + (compact ? 0.5 : 1),
    };
  });
  return {
    width,
    height,
    margin,
    header: contentTop,
    footer,
    fontSize,
    lineHeight,
    compact,
    cards,
    qr,
  };
}

/** A restrained proposal frame surrounds the existing artwork without altering it. */
export function drawStudyFrame(
  page: PDFPage,
  font: PDFFont,
  layout: StudyLayout,
  presentation: CardPresentation,
  title: string,
  series: string,
  preparedFor: string,
  payload?: string,
  theme: StudyTheme = 'cool',
): void {
  const { width, height, margin, compact, fontSize } = layout;
  const noir = theme === 'noir';
  const warm = theme === 'warm';
  const frameInk = warm ? rgb(0.95, 0.91, 0.84) : rgb(0.91, 0.94, 0.97);
  const frameMuted = warm ? rgb(0.66, 0.57, 0.46) : rgb(0.54, 0.61, 0.67);
  const background = noir
    ? rgb(0.012, 0.016, 0.021)
    : warm
      ? rgb(0.045, 0.035, 0.028)
      : rgb(0.032, 0.042, 0.052);
  const panel = noir
    ? rgb(0.055, 0.067, 0.082)
    : warm
      ? rgb(0.11, 0.085, 0.06)
      : rgb(0.085, 0.105, 0.125);
  const border = noir ? rgb(0.27, 0.33, 0.4) : warm ? rgb(0.43, 0.32, 0.21) : rgb(0.28, 0.36, 0.43);
  const glow = noir ? rgb(0.09, 0.15, 0.22) : warm ? rgb(0.32, 0.19, 0.09) : rgb(0.1, 0.2, 0.29);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    color: background,
  });
  page.drawRectangle({
    x: margin * MM,
    y: layout.footer * MM,
    width: (width - 2 * margin) * MM,
    height: (height - layout.footer - margin) * MM,
    color: panel,
    borderColor: border,
    borderWidth: 0.45,
    opacity: 0.72,
    borderOpacity: 0.5,
  });
  page.drawEllipse({
    x: width * 0.13 * MM,
    y: height * 0.88 * MM,
    xScale: width * 0.5 * MM,
    yScale: height * 0.38 * MM,
    color: glow,
    opacity: noir ? 0.24 : 0.2,
  });
  page.drawEllipse({
    x: width * 0.9 * MM,
    y: height * 0.08 * MM,
    xScale: width * 0.42 * MM,
    yScale: height * 0.34 * MM,
    color: glow,
    opacity: 0.11,
  });
  page.drawLine({
    start: { x: margin * MM, y: (height - (compact ? 9 : 18)) * MM },
    end: { x: (width - margin) * MM, y: (height - (compact ? 9 : 18)) * MM },
    color: frameMuted,
    thickness: 0.45,
    opacity: 0.34,
  });
  const grid = compact ? 4 : 8;
  for (let x = margin; x < width - margin; x += grid)
    page.drawLine({
      start: { x: x * MM, y: layout.footer * MM },
      end: { x: x * MM, y: (height - layout.header) * MM },
      color: frameMuted,
      thickness: 0.2,
      opacity: 0.1,
    });
  for (let y = layout.header; y < height - layout.footer; y += grid)
    page.drawLine({
      start: { x: margin * MM, y: (height - y) * MM },
      end: { x: (width - margin) * MM, y: (height - y) * MM },
      color: frameMuted,
      thickness: 0.2,
      opacity: 0.1,
    });
  const label = (value: string, y: number, preferred = fontSize, color = frameMuted) =>
    text(
      page,
      font,
      value,
      margin,
      y,
      fit(font, value, preferred, compact ? 4 : 4.5, (width - 2 * margin) * MM, 'Study heading'),
      color,
    );
  label(title, compact ? 1.6 : 3, compact ? 8 : width > 200 ? 18 : 12, frameInk);
  label('DESIGN STUDY / FOR SELECTION', compact ? 5.2 : 9.5);
  label(
    compact ? presentation.subtitle : `${presentation.subtitle}  Prepared for ${preparedFor}`,
    compact ? 7.3 : 13,
    compact ? 4.3 : fontSize,
  );
  if (!compact && presentation.slogan) label(presentation.slogan, 16.3, fontSize * 0.9);
  const footer = `Series ${series} / 01${presentation.footer ? '  |  ' + presentation.footer : ''}`;
  label(footer, height - (compact ? 3 : 5), fontSize);
  if (payload !== undefined) {
    if (!layout.qr) throw new Error('Missing design study QR area.');
    const { x, y, size } = layout.qr;
    const plate = {
      x: (x - 0.6) * MM,
      y: (height - y - size - 0.6) * MM,
      width: (size + 1.2) * MM,
      height: (size + 1.2) * MM,
    };
    page.drawRectangle({
      ...plate,
      color: panel,
      borderColor: border,
      borderWidth: 0.4,
      opacity: 0.94,
      borderOpacity: 0.62,
    });
    drawCollectionQr(page, payload, x, y, size, COLLECTION_QR_MODULE_MM);
    const caption = 'COLLECTION QR';
    const fs = fit(font, caption, fontSize, 4, size * MM, 'QR caption');
    text(
      page,
      font,
      caption,
      x + (size - font.widthOfTextAtSize(caption, fs) / MM) / 2,
      y + size + 0.3,
      fs,
      frameMuted,
    );
  }
}

export function drawStudyShadow(page: PDFPage, box: CardBox, theme: StudyTheme = 'cool'): void {
  const noir = theme === 'noir';
  page.drawRectangle({
    x: (box.x + 0.45) * MM,
    y: page.getHeight() - (box.y + box.height + 0.7) * MM,
    width: box.width * MM,
    height: box.height * MM,
    color: rgb(0, 0, 0),
    opacity: noir ? 0.5 : 0.42,
  });
  page.drawRectangle({
    x: (box.x - 0.3) * MM,
    y: page.getHeight() - (box.y + box.height + 0.3) * MM,
    width: (box.width + 0.6) * MM,
    height: (box.height + 0.6) * MM,
    color: noir ? rgb(0.18, 0.22, 0.26) : rgb(0.24, 0.28, 0.31),
    opacity: 0.88,
  });
}

export function drawStudyCaption(
  page: PDFPage,
  font: PDFFont,
  layout: StudyLayout,
  box: StudyBox,
  lines: readonly string[],
  theme: StudyTheme = 'cool',
): void {
  const warm = theme === 'warm';
  for (const [i, value] of lines.entries()) {
    const fs = fit(font, value, layout.fontSize, 4, box.captionWidth * MM, 'Study reference');
    text(
      page,
      font,
      value,
      box.captionX + (box.captionWidth - font.widthOfTextAtSize(value, fs) / MM) / 2,
      box.captionTop + i * layout.lineHeight,
      fs,
      i === 0
        ? warm
          ? rgb(0.93, 0.88, 0.8)
          : rgb(0.88, 0.91, 0.94)
        : warm
          ? rgb(0.63, 0.55, 0.46)
          : rgb(0.55, 0.61, 0.67),
    );
  }
}

export function studyCaptionWidth(font: PDFFont, lines: readonly string[]): number {
  return Math.max(...lines.map((line) => font.widthOfTextAtSize(line, 4) / MM)) + 0.1;
}
