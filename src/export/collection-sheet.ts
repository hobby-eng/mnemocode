import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { MM, centredRunStart, runCellSize, type CardBox, type MmRect } from "./business-layout.js";
import { centredText, pdfPoint, pdfRect } from "./business-render-primitives.js";
import { assertCardIndex } from "./card-codes.js";
import { drawCollectionQr, qrSizeForModuleMm } from "./card-qr.js";
import type { QrModules, QrSource } from "./platform.js";
import {
  pageDimensions,
  parsePageSize,
  type CardSettings,
  type CardPresentation,
  type CardPageSize,
  isCardPageSize,
} from "./card-settings.js";
import { graticule, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "./world-map.js";
import { WORLD_MAP_LAND } from "./world-map-data.js";
import { drawMaterialBackdrop, type MaterialBackdrop } from "./study-backdrops.js";

export interface StudyBox extends CardBox {
  readonly captionTop: number;
  readonly captionWidth: number;
  readonly captionX: number;
}

/**
 * The measures of a sheet of one page size, in millimetres and points (STUDY_METRICS): its room,
 * its text and its heading. The frame and the layout read every per-size value from it.
 */
export interface StudySheetMetrics {
  /** The margin on each side, and the heights of the heading and of the footer, in millimetres. */
  readonly margin: number;
  readonly headingHeight: number;
  readonly footer: number;
  /** The size of the captions in points, and the height of one caption line in millimetres. */
  readonly fontSize: number;
  readonly lineHeight: number;
  /** The room between two cards, and between the cards and the QR code, in millimetres. */
  readonly gap: number;
  /** The room that a caption adds below its lines, and its distance below the card. */
  readonly captionPad: number;
  readonly captionOffset: number;
  /** The tops of the heading's lines and of the rule under it, from the top edge. */
  readonly rows: {
    readonly title: number;
    readonly kind: number;
    readonly subtitle: number;
    /** Absent where the heading has no rule under it: a card-sized page has no room for one. */
    readonly rule?: number;
  };
  /** The size of the title, in points. */
  readonly titleSize: number;
  /** The heading's two smaller lines and the footer, at these shares of the caption size. */
  readonly headingScale: number;
  readonly footerScale: number;
  /** The top of the footer line, from the bottom edge. */
  readonly footerBaseline: number;
  /** The least size of the heading and the footer, in points. */
  readonly frameMinimumFont: number;
}

export interface StudyLayout {
  readonly width: number;
  readonly height: number;
  /** The measures of the sheet's page size. */
  readonly metrics: StudySheetMetrics;
  /** Where the cards may start: below the heading, or below the QR code and its caption. */
  readonly header: number;
  /** A card-sized page: the heading sits beside the QR code, and there is no rule or slogan. */
  readonly compact: boolean;
  readonly cards: readonly StudyBox[];
  readonly qr?: { readonly x: number; readonly y: number; readonly size: number };
}

export type StudyTheme = "cool" | "warm" | "noir" | "mist" | MaterialBackdrop;

const COLLECTION_QR_MODULE_MM = 0.3;

/**
 * The smallest size, in points, that a sheet prints: the captions, the QR caption and the frame of
 * a card-sized page. studyCaptionWidth measures captions at it, so that a column the layout accepts
 * never refuses its caption.
 */
const MINIMUM_FONT = 4;
/**
 * Millimetres added to a caption's measured width, so that turning the column's millimetres back
 * into points for fit() never leaves the caption a rounding error below MINIMUM_FONT.
 */
const CAPTION_WIDTH_SLACK_MM = 0.1;
/** The smallest size of the frame of an A6 or A4 sheet, in points. */
const SHEET_FRAME_MINIMUM_FONT = 4.5;
/** How far the plate behind the QR code reaches beyond it on each side, in millimetres. */
const QR_PLATE_MARGIN = 0.6;

/**
 * The measures of a sheet of each page size. A card-sized page is laid out tighter than a sheet,
 * an A4 sheet larger; the approved sheets were drawn with these numbers. Keyed by every size, so
 * that a new size cannot be printed before its row is written.
 */
const STUDY_METRICS: Readonly<Record<CardPageSize, StudySheetMetrics>> = Object.freeze({
  business: {
    margin: 3,
    headingHeight: 11,
    footer: 4.5,
    fontSize: 4.3,
    lineHeight: 2.1,
    gap: 1.5,
    captionPad: 0.6,
    captionOffset: 0.5,
    rows: { title: 1.8, kind: 5.4, subtitle: 7.5 },
    titleSize: 8,
    // A card-sized page already prints its frame at the caption size, the smallest legible one.
    headingScale: 1,
    footerScale: 1,
    footerBaseline: 3,
    frameMinimumFont: MINIMUM_FONT,
  },
  a6: {
    margin: 5,
    headingHeight: 23,
    footer: 9,
    fontSize: 6,
    lineHeight: 3,
    gap: 3,
    captionPad: 1.2,
    captionOffset: 1,
    rows: { title: 5.5, kind: 12, subtitle: 15.4, rule: 19.4 },
    titleSize: 13,
    headingScale: 0.95,
    footerScale: 0.9,
    footerBaseline: 5.2,
    frameMinimumFont: SHEET_FRAME_MINIMUM_FONT,
  },
  a4: {
    margin: 10,
    headingHeight: 33,
    footer: 13,
    fontSize: 8,
    lineHeight: 4,
    gap: 6,
    captionPad: 1.2,
    captionOffset: 1,
    rows: { title: 9, kind: 18.5, subtitle: 23.5, rule: 28 },
    titleSize: 19,
    headingScale: 0.95,
    footerScale: 0.9,
    footerBaseline: 7.5,
    frameMinimumFont: SHEET_FRAME_MINIMUM_FONT,
  },
});

/**
 * The most cards that one sheet lays out: the 16 colours of a 24-word phrase, one box per card.
 * The codes of a share are grouped on its cards so that they fit too (sskr-render.ts).
 */
export const MAX_SHEET_CARDS = 16;

/**
 * A collection is a single design proposal, never a stack of duplex print cards. `code` is the QR
 * code that the sheet prints, if any, whose size the layout makes room for.
 */
export function collectionSheetLayout(
  settings: CardSettings,
  count: number,
  aspect: number,
  captionLines: number,
  code?: QrModules,
  minimumCaptionWidth = 0,
): StudyLayout {
  if (Number.isInteger(count) && count > MAX_SHEET_CARDS)
    throw new Error(`A sheet holds at most ${MAX_SHEET_CARDS} cards.`);
  if (!Number.isInteger(count) || count < 1 || aspect <= 0 || captionLines < 1)
    throw new Error("Invalid design study layout.");
  const size = parsePageSize(settings.pageSize);
  const [width, height] = pageDimensions(size, settings.orientation);
  // Ordinary cards of the business size are separate cards and never come here. The compact
  // sheet exists for the QR card of one Shamir share, which is offered in every size.
  const compact = isCardPageSize(size);
  const metrics = STUDY_METRICS[size];
  const { margin, headingHeight, footer, lineHeight, gap } = metrics;
  const qrSize = code === undefined ? 0 : qrSizeForModuleMm(code, 0, COLLECTION_QR_MODULE_MM);
  const qr =
    code === undefined
      ? undefined
      : {
          x: width - margin - qrSize,
          y: margin,
          size: qrSize,
        };
  let availableWidth = width - margin * 2;
  let availableHeight = height - headingHeight - footer;
  let contentTop = headingHeight;
  if (qr) {
    if (qr.x < margin || qr.y + qr.size + lineHeight >= height - footer)
      throw new Error("The QR cannot fit on the design study; choose a larger page size.");
    if (compact && width >= height) {
      // A card-sized page is too low to place the cards below the QR code; they sit beside it.
      availableWidth -= qrSize + gap * 2;
    } else {
      // The cards start below the QR code, so they stay centred under the heading.
      contentTop = Math.max(headingHeight, qr.y + qrSize + lineHeight + gap);
      availableHeight = height - contentTop - footer;
    }
  }
  const captionHeight = captionLines * lineHeight + metrics.captionPad;
  let best:
    | { columns: number; rows: number; cellWidth: number; imageHeight: number; area: number }
    | undefined;
  for (let columns = 1; columns <= Math.min(count, 6); columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = runCellSize(availableWidth, columns, gap);
    if (cellWidth < minimumCaptionWidth) continue;
    const imageHeight = Math.min(
      cellWidth / aspect,
      runCellSize(availableHeight, rows, gap) - captionHeight,
    );
    const area = imageHeight * imageHeight * aspect;
    if (imageHeight > 2 && (!best || area > best.area))
      best = { columns, rows, cellWidth, imageHeight, area };
  }
  if (!best)
    throw new Error(
      "The cards and their codes cannot fit legibly on this page; choose a larger page size, such as A6.",
    );
  const { columns, rows, cellWidth, imageHeight } = best;
  const cellHeight = imageHeight + captionHeight;
  const top = contentTop + centredRunStart(availableHeight, rows, cellHeight, gap);
  const cards = Array.from({ length: count }, (_, index): StudyBox => {
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const captionX =
      margin +
      centredRunStart(availableWidth, rowCount, cellWidth, gap) +
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
      captionTop: y + imageHeight + metrics.captionOffset,
    };
  });
  return {
    width,
    height,
    metrics,
    header: contentTop,
    compact,
    cards,
    ...(qr === undefined ? {} : { qr }),
  };
}

type Color = ReturnType<typeof rgb>;

/** Colours of one sheet. */
interface SheetPalette {
  readonly background: Color;
  /** The grey world map behind the cards, or the backdrop of a material. */
  readonly backdrop: { readonly land: Color; readonly coast: Color } | MaterialBackdrop;
  /** The plate behind the QR code and its border. */
  readonly plate: Color;
  readonly plateBorder: Color;
  /** The heading, and the quieter lines around it. */
  readonly ink: Color;
  readonly muted: Color;
  /** The first line under a card, and the lines below it. */
  readonly caption: Color;
  readonly captionMuted: Color;
  /** The thin edge around a card and the darkness of its shadow. */
  readonly cardEdge: Color;
  readonly shadowOpacity: number;
}

const GRID = {
  color: rgb(0.5, 0.53, 0.58),
  /** The grid is meant to be felt rather than seen. */
  opacity: 0.07,
} as const;

/** The dark page with the grey map, shared by the dark themes; only their ink differs. */
const DARK_PAGE = {
  background: rgb(0.043, 0.047, 0.059),
  backdrop: { land: rgb(0.155, 0.165, 0.19), coast: rgb(0.22, 0.235, 0.265) },
  plate: rgb(0.075, 0.082, 0.1),
  plateBorder: rgb(0.3, 0.33, 0.38),
} as const;

const COOL: SheetPalette = {
  ...DARK_PAGE,
  ink: rgb(0.93, 0.95, 0.97),
  muted: rgb(0.56, 0.61, 0.67),
  caption: rgb(0.88, 0.91, 0.94),
  captionMuted: rgb(0.55, 0.61, 0.67),
  cardEdge: rgb(0.24, 0.28, 0.31),
  shadowOpacity: 0.42,
};

const PALETTES: Readonly<Record<StudyTheme, SheetPalette>> = {
  cool: COOL,
  warm: {
    ...COOL,
    ink: rgb(0.95, 0.91, 0.84),
    muted: rgb(0.66, 0.6, 0.52),
    caption: rgb(0.93, 0.88, 0.8),
    captionMuted: rgb(0.63, 0.55, 0.46),
  },
  noir: { ...COOL, cardEdge: rgb(0.18, 0.22, 0.26), shadowOpacity: 0.5 },
  // A light page for the light glass cards, which a dark page made look cut out.
  mist: {
    background: rgb(0.78, 0.81, 0.85),
    backdrop: { land: rgb(0.7, 0.74, 0.78), coast: rgb(0.63, 0.67, 0.71) },
    plate: rgb(0.91, 0.93, 0.95),
    plateBorder: rgb(0.48, 0.52, 0.57),
    ink: rgb(0.13, 0.15, 0.18),
    muted: rgb(0.34, 0.38, 0.43),
    caption: rgb(0.13, 0.15, 0.18),
    captionMuted: rgb(0.34, 0.38, 0.43),
    cardEdge: rgb(0.57, 0.61, 0.65),
    shadowOpacity: 0.22,
  },
  // The light material pages carry dark ink; their own backdrop covers the background.
  studio: {
    background: rgb(0.86, 0.87, 0.88),
    backdrop: "studio",
    plate: rgb(0.96, 0.965, 0.97),
    plateBorder: rgb(0.5, 0.53, 0.57),
    ink: rgb(0.11, 0.12, 0.14),
    muted: rgb(0.33, 0.36, 0.4),
    caption: rgb(0.11, 0.12, 0.14),
    captionMuted: rgb(0.33, 0.36, 0.4),
    cardEdge: rgb(0.6, 0.63, 0.67),
    shadowOpacity: 0.24,
  },
  concrete: {
    background: rgb(0.8, 0.79, 0.765),
    backdrop: "concrete",
    plate: rgb(0.95, 0.945, 0.93),
    plateBorder: rgb(0.5, 0.49, 0.47),
    ink: rgb(0.13, 0.13, 0.13),
    muted: rgb(0.33, 0.32, 0.3),
    caption: rgb(0.13, 0.13, 0.13),
    captionMuted: rgb(0.31, 0.3, 0.28),
    cardEdge: rgb(0.58, 0.57, 0.55),
    shadowOpacity: 0.26,
  },
  tiled: {
    background: rgb(0.93, 0.92, 0.9),
    backdrop: "tiled",
    plate: rgb(0.97, 0.965, 0.955),
    plateBorder: rgb(0.52, 0.5, 0.47),
    ink: rgb(0.14, 0.15, 0.16),
    muted: rgb(0.35, 0.35, 0.34),
    caption: rgb(0.14, 0.15, 0.16),
    captionMuted: rgb(0.33, 0.33, 0.32),
    cardEdge: rgb(0.55, 0.53, 0.5),
    shadowOpacity: 0.28,
  },
  parquet: {
    background: rgb(0.86, 0.8, 0.71),
    backdrop: "parquet",
    plate: rgb(0.97, 0.95, 0.91),
    plateBorder: rgb(0.52, 0.45, 0.36),
    ink: rgb(0.17, 0.13, 0.1),
    muted: rgb(0.36, 0.29, 0.22),
    caption: rgb(0.17, 0.13, 0.1),
    captionMuted: rgb(0.34, 0.27, 0.2),
    cardEdge: rgb(0.6, 0.53, 0.43),
    shadowOpacity: 0.26,
  },
};
const GRATICULE_STEP_DEGREES = 30;
const GRATICULE = graticule(GRATICULE_STEP_DEGREES);

/** Draws the grey world map, as wide as the page allows and centred a little below the middle. */
function drawWorldMap(
  page: PDFPage,
  colours: { readonly land: Color; readonly coast: Color },
  width: number,
  height: number,
  margin: number,
): void {
  const mapWidth = (width - margin) * MM;
  const scale = mapWidth / WORLD_MAP_WIDTH;
  const mapHeight = WORLD_MAP_HEIGHT * scale;
  const x = (page.getWidth() - mapWidth) / 2;
  // pdf-lib places the top left corner of an SVG path here and draws downwards from it.
  const y = page.getHeight() / 2 + mapHeight / 2 - height * 0.045 * MM;
  for (const path of GRATICULE)
    page.drawSvgPath(path, {
      x,
      y,
      scale,
      borderColor: GRID.color,
      borderWidth: 0.35,
      borderOpacity: GRID.opacity,
    });
  for (const path of WORLD_MAP_LAND)
    page.drawSvgPath(path, {
      x,
      y,
      scale,
      color: colours.land,
      borderColor: colours.coast,
      borderWidth: 0.3,
    });
}

/** A restrained proposal frame surrounds the existing artwork without altering it. */
function drawStudyFrame(
  page: PDFPage,
  font: PDFFont,
  layout: StudyLayout,
  presentation: CardPresentation,
  title: string,
  series: string,
  preparedFor: string,
  code?: QrModules,
  theme: StudyTheme = "cool",
): void {
  const { width, height, compact, metrics } = layout;
  const { margin, fontSize, rows } = metrics;
  const palette = PALETTES[theme];
  const frameInk = palette.ink;
  const frameMuted = palette.muted;
  page.drawRectangle({
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    color: palette.background,
  });
  if (typeof palette.backdrop === "string")
    drawMaterialBackdrop(page, palette.backdrop, width, height);
  else drawWorldMap(page, palette.backdrop, width, height, margin);

  // A QR code occupies the top right corner. On a sheet the heading stays centred on the page
  // and clear of the code on both sides; a card-sized page only has room beside the code.
  const reserved = layout.qr === undefined ? 0 : layout.qr.size + margin;
  const headingWidth = width - 2 * margin - (compact ? reserved : 2 * reserved);
  const headingLeft = compact ? margin : (width - headingWidth) / 2;
  // The label names the text in the error message when it does not fit.
  const centred = (
    label: string,
    value: string,
    top: number,
    preferred: number,
    color = frameMuted,
  ) =>
    centredText(
      page,
      font,
      value,
      { left: headingLeft, top, width: headingWidth },
      preferred,
      metrics.frameMinimumFont,
      label,
      color,
    );
  // Heading positions are in millimetres from the top edge.
  centred("The studio name or title", title, rows.title, metrics.titleSize, frameInk);
  centred(
    "Study heading",
    "DESIGN STUDY / FOR SELECTION",
    rows.kind,
    fontSize * metrics.headingScale,
  );
  centred(
    "The line with the subtitle and the name",
    compact ? presentation.subtitle : `${presentation.subtitle}  ${preparedForLine(preparedFor)}`,
    rows.subtitle,
    fontSize * metrics.headingScale,
  );
  if (rows.rule !== undefined) {
    const ruleWidth = Math.min(40, headingWidth * 0.4);
    page.drawLine({
      start: pdfPoint(page, (width - ruleWidth) / 2, rows.rule),
      end: pdfPoint(page, (width + ruleWidth) / 2, rows.rule),
      color: frameMuted,
      thickness: 0.4,
      opacity: 0.55,
    });
  }
  // The slogan shares the footer line, where nothing crosses it.
  const footer = [compact ? "" : presentation.slogan, `Series ${series} / 01`, presentation.footer]
    .filter((part) => part !== "")
    .join("   |   ");
  centredText(
    page,
    font,
    footer,
    { left: margin, top: height - metrics.footerBaseline, width: width - 2 * margin },
    fontSize * metrics.footerScale,
    metrics.frameMinimumFont,
    "Study footer",
    frameMuted,
  );
  if (code !== undefined) {
    if (!layout.qr) throw new Error("Missing design study QR area.");
    const { x, y, size } = layout.qr;
    page.drawRectangle({
      ...pdfRect(page, {
        x: x - QR_PLATE_MARGIN,
        y: y - QR_PLATE_MARGIN,
        width: size + 2 * QR_PLATE_MARGIN,
        height: size + 2 * QR_PLATE_MARGIN,
      }),
      color: palette.plate,
      borderColor: palette.plateBorder,
      borderWidth: 0.4,
      opacity: 0.94,
      borderOpacity: 0.62,
    });
    drawCollectionQr(page, code, x, y, size, COLLECTION_QR_MODULE_MM);
    centredText(
      page,
      font,
      "COLLECTION QR",
      { left: x, top: y + size + 0.3, width: size },
      fontSize,
      MINIMUM_FONT,
      "QR caption",
      frameMuted,
    );
  }
}

/** The shadow and the thin edge round a card's picture in `box` on a sheet. */
function drawStudyShadow(page: PDFPage, box: MmRect, theme: StudyTheme): void {
  const palette = PALETTES[theme];
  // The shadow falls to the lower right; the edge shows round the card.
  page.drawRectangle({
    ...pdfRect(page, { ...box, x: box.x + 0.45, y: box.y + 0.7 }),
    color: rgb(0, 0, 0),
    opacity: palette.shadowOpacity,
  });
  page.drawRectangle({
    ...pdfRect(page, {
      x: box.x - 0.3,
      y: box.y - 0.3,
      width: box.width + 0.6,
      height: box.height + 0.6,
    }),
    color: palette.cardEdge,
    opacity: 0.88,
  });
}

export function drawStudyCaption(
  page: PDFPage,
  font: PDFFont,
  layout: StudyLayout,
  box: StudyBox,
  lines: readonly string[],
  theme: StudyTheme = "cool",
): void {
  const palette = PALETTES[theme];
  for (const [i, value] of lines.entries())
    centredText(
      page,
      font,
      value,
      {
        left: box.captionX,
        top: box.captionTop + i * layout.metrics.lineHeight,
        width: box.captionWidth,
      },
      layout.metrics.fontSize,
      MINIMUM_FONT,
      "Study reference",
      i === 0 ? palette.caption : palette.captionMuted,
    );
}

export function studyCaptionWidth(font: PDFFont, lines: readonly string[]): number {
  const widest = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, MINIMUM_FONT)));
  return widest / MM + CAPTION_WIDTH_SLACK_MM;
}

/** What a collection sheet of color cards is made from: a seed phrase's colors, or a share's. */
export interface CollectionContent {
  readonly kind: "colors" | "sskr";
  readonly payload: string;
  readonly title?: string | undefined;
  readonly cardQr?: boolean | undefined;
  /** A share's: the reference of its set, which the sheet names as its series. */
  readonly collectionReference?: string;
  /** A share's: a QR code of the whole share on its sheet. */
  readonly qrCard?: boolean | undefined;
}

/**
 * The series of the cards and sheets of a seed phrase's colors, which has no set to name: every
 * family prints it alike (owner, 2026-10-09: the glass card too, in place of a placeholder text).
 */
const PHRASE_SERIES = "01";

/** The series that a card or sheet of `content` names: a share's set, or a seed phrase's one. */
export function collectionSeries(
  content: Pick<CollectionContent, "kind" | "collectionReference">,
): string {
  return content.kind === "sskr" ? content.collectionReference! : PHRASE_SERIES;
}

/** The line that names the person a set of cards is prepared for. */
export function preparedForLine(name: string): string {
  return `Prepared for ${name}`;
}

/**
 * The title and the series that the frame of a collection sheet names: the content's title or
 * the studio's name, and a share's set or the one series of a seed phrase. Every family's sheet
 * is framed with them, through addCollectionPage.
 */
function collectionFrame(
  content: CollectionContent,
  presentation: Pick<CardPresentation, "studioName">,
): { readonly title: string; readonly series: string } {
  return {
    title: content.title ?? presentation.studioName,
    series: collectionSeries(content),
  };
}

/** Whether the sheet holds a share's whole-share QR code, which only `qrCard: true` asks for. */
function wholeShareQr(content: CollectionContent): boolean {
  return content.kind === "sskr" && content.qrCard === true;
}

/**
 * The text of the collection's QR code where the cards ask for one: with `cardQr: true`, or a
 * share's whole-share QR code; undefined otherwise. Only true asks: any other value leaves it out.
 */
export function collectionPayload(content: CollectionContent): string | undefined {
  return content.cardQr === true || wholeShareQr(content) ? content.payload : undefined;
}

/**
 * The separate card that a renderer is asked for: `index`, or undefined, a sheet, where the content
 * asks for a share's whole-share QR code, which only a sheet prints. Every family of cards decides
 * with it whether it draws a separate card or a sheet. An index that is not one of the `count`
 * cards is refused first, also where the sheet is drawn, so that every family answers it alike.
 */
export function separateCardIndex(
  content: CollectionContent,
  index: number | undefined,
  count: number,
): number | undefined {
  if (index !== undefined) assertCardIndex(index, count);
  return wholeShareQr(content) ? undefined : index;
}

/** What drawCollectionStudy draws a family's collection sheet from. */
export interface CollectionStudy {
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  /** The host's QR matrices (CardDrawing), for the code of the sheet where it prints one. */
  readonly qr: QrSource;
  /** The page size and the orientation of the sheet. */
  readonly settings: CardSettings;
  readonly content: CollectionContent;
  readonly presentation: CardPresentation;
  /** The name of the person the sheet is prepared for. */
  readonly preparedFor: string;
  readonly theme: StudyTheme;
  /** The shape of a card's box, width over height. */
  readonly aspect: number;
  /** The lines under each card, in the order of the cards. */
  readonly captions: readonly (readonly string[])[];
  /**
   * The lines that each caption is given room for: the longest caption's unless a design keeps
   * the room of a full card for every card, as the glass cards do.
   */
  readonly captionLines?: number;
  /** Draws card `box.index` in its box, after its shadow and before its caption. */
  readonly paint: (page: PDFPage, box: StudyBox) => void | Promise<void>;
  /** Where the picture of a card lies in its box, which the shadow follows; the box by default. */
  readonly pictureArea?: (box: StudyBox) => MmRect;
}

/**
 * Draws the collection sheet of `study` on a new page: the frame (addCollectionPage), then for each
 * card its shadow, the family's painting and its caption. Every family of cards draws its sheet
 * with it; it returns the layout it drew.
 */
export async function drawCollectionStudy(study: CollectionStudy): Promise<StudyLayout> {
  const { doc, font, content, captions, theme } = study;
  const payload = collectionPayload(content);
  // One matrix for the room that the layout keeps and for the code drawn in it.
  const code = payload === undefined ? undefined : study.qr.qrModules(payload);
  const layout = collectionSheetLayout(
    study.settings,
    captions.length,
    study.aspect,
    study.captionLines ?? Math.max(...captions.map((lines) => lines.length)),
    code,
    // The captions decide how narrow a column may be: the three words of a share's code are
    // wider than a color code, and on a card-sized page they take fewer cards to a row.
    studyCaptionWidth(font, captions.flat()),
  );
  const page = addCollectionPage(
    doc,
    font,
    layout,
    content,
    study.presentation,
    study.preparedFor,
    code,
    theme,
  );
  for (const box of layout.cards) {
    drawStudyShadow(page, study.pictureArea?.(box) ?? box, theme);
    await study.paint(page, box);
    drawStudyCaption(page, font, layout, box, captions[box.index]!, theme);
  }
  return layout;
}

/**
 * A new page of `doc` for the collection sheet of `content`, laid out by `layout`, with its frame
 * drawn: the title and series of collectionFrame, the person it is prepared for, and the QR code
 * `code` where there is one.
 */
function addCollectionPage(
  doc: PDFDocument,
  font: PDFFont,
  layout: StudyLayout,
  content: CollectionContent,
  presentation: CardPresentation,
  preparedFor: string,
  code: QrModules | undefined,
  theme: StudyTheme,
): PDFPage {
  const page = doc.addPage([layout.width * MM, layout.height * MM]);
  const { title, series } = collectionFrame(content, presentation);
  drawStudyFrame(page, font, layout, presentation, title, series, preparedFor, code, theme);
  return page;
}
