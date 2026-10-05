// The sheet that tells heirs how to restore a backup (mnemocode encode --heir-sheet): one sheet,
// printed on both sides. The front says what the owner leaves and gives the rest of its room, in
// one block, to a hint written by hand; the back gives the steps and the basics for someone new to
// wallets. It holds no secret; src/cli/heir-sheet.ts writes its words, this file only lays them out.

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { MM } from "./business-layout.js";
import { clearDocumentMetadata } from "./document-metadata.js";
import { readRenderAsset } from "./platform.js";

/** A part of the back: a heading and its paragraphs. */
export interface HeirSheetSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/** The words of the sheet, in the order they are printed. */
export interface HeirSheetText {
  readonly title: string;
  readonly subtitle: string;
  readonly newcomer: string;
  readonly needs: readonly string[];
  readonly hintNote: string;
  readonly steps: readonly string[];
  /** What to do when a step does not work. */
  readonly trouble: string;
  readonly warning: string;
  /** What the sheet is, for whoever keeps it; printed under the title. */
  readonly footer: string;
  readonly basicsTitle: string;
  readonly basics: readonly HeirSheetSection[];
}

/** A page size with the type sizes, in points, and the spacing that suit it. */
export interface HeirSheetFormat {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly title: number;
  readonly heading: number;
  readonly body: number;
  readonly small: number;
  /** Space before a heading. */
  readonly gap: number;
  /** Distance of the ruled lines for the hint, wide enough for handwriting. */
  readonly ruling: number;
}

/** A5 portrait, the size of a notebook (ISO 216: 148 x 210 mm). */
export const A5: HeirSheetFormat = {
  width: 148 * MM,
  height: 210 * MM,
  margin: 10 * MM,
  title: 14,
  heading: 10.5,
  body: 9,
  small: 7.5,
  gap: 3.5 * MM,
  ruling: 7 * MM,
};

/** A6 portrait, the size of a postcard and of MnemoCode's cards (ISO 216: 105 x 148 mm). */
export const A6: HeirSheetFormat = {
  width: 105 * MM,
  height: 148 * MM,
  margin: 5 * MM,
  title: 10.5,
  heading: 7.5,
  body: 6.7,
  small: 6,
  gap: 2 * MM,
  ruling: 6 * MM,
};

/** Line height as a multiple of the font size; dense, as on a printed leaflet. */
const LEADING = 1.22;
/** Space between a heading and its text, and after the paragraphs of the back. */
const SMALL_GAP = 0.8 * MM;
/** Indent of a list item's text, as a multiple of the font size: room for "5." and a space. */
const ITEM_INDENT = 1.5;
/** Fewer ruled lines than this leave no real room for a hint. */
const MIN_HINT_LINES = 4;

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.7, 0.7, 0.7);

/** Splits `text` into lines no wider than `width` at `size`; words are never broken. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * Writes one page from the top down; `y` is the baseline of the last line written. Without a page
 * it only measures.
 */
class Writer {
  y: number;

  constructor(
    private readonly page: PDFPage | undefined,
    private readonly font: PDFFont,
    private readonly format: HeirSheetFormat,
  ) {
    this.y = format.height - format.margin;
  }

  /** The room left above the bottom margin. */
  get room(): number {
    return this.y - this.format.margin;
  }

  paragraph(text: string, size: number, color = INK, indent = 0, marker?: string): void {
    const width = this.format.width - 2 * this.format.margin - indent;
    const x = this.format.margin;
    wrap(text, this.font, size, width).forEach((line, index) => {
      this.y -= size * LEADING;
      if (index === 0 && marker !== undefined)
        this.page?.drawText(marker, { x, y: this.y, size, font: this.font, color });
      this.page?.drawText(line, { x: x + indent, y: this.y, size, font: this.font, color });
    });
  }

  heading(text: string): void {
    this.y -= this.format.gap;
    this.paragraph(text, this.format.heading);
    this.y -= SMALL_GAP;
  }

  ruledLines(count: number): void {
    for (let line = 0; line < count; line += 1) {
      this.y -= this.format.ruling;
      this.page?.drawLine({
        start: { x: this.format.margin, y: this.y },
        end: { x: this.format.width - this.format.margin, y: this.y },
        thickness: 0.5,
        color: RULE,
      });
    }
  }
}

/** The front: what the owner leaves, the hint being one block of ruled lines to the foot. */
function writeFront(
  writer: Writer,
  text: HeirSheetText,
  format: HeirSheetFormat,
  hintLines: number,
): void {
  writer.paragraph(text.title, format.title);
  writer.paragraph(text.subtitle, format.small, MUTED);
  writer.paragraph(text.footer, format.small, MUTED);
  writer.paragraph(text.newcomer, format.body);
  writer.heading("What you need");
  for (const need of text.needs)
    writer.paragraph(need, format.body, INK, ITEM_INDENT * format.body, "-");
  writer.heading("Hint from the owner");
  writer.paragraph(text.hintNote, format.small, MUTED);
  writer.ruledLines(hintLines);
}

/**
 * How many ruled lines fill the room that the front leaves, measured by writing the front once
 * without drawing it. The words are fixed by the program, so a front without room for a hint is a
 * bug in them.
 */
function hintLinesFor(font: PDFFont, text: HeirSheetText, format: HeirSheetFormat): number {
  const trial = new Writer(undefined, font, format);
  writeFront(trial, text, format, 0);
  const lines = Math.floor(trial.room / format.ruling);
  if (lines < MIN_HINT_LINES)
    throw new Error("The instructions for heirs leave no room for a hint on the front.");
  return lines;
}

function writeSteps(writer: Writer, text: HeirSheetText, format: HeirSheetFormat): void {
  writer.paragraph("Steps", format.title);
  text.steps.forEach((step, index) =>
    writer.paragraph(step, format.body, INK, ITEM_INDENT * format.body, `${index + 1}.`),
  );
  writer.heading("If something goes wrong");
  writer.paragraph(text.trouble, format.body);
  writer.y -= format.gap;
  writer.paragraph(text.warning, format.heading);
}

function writeBasics(writer: Writer, text: HeirSheetText, format: HeirSheetFormat): void {
  writer.paragraph(text.basicsTitle, format.title);
  for (const section of text.basics) {
    writer.heading(section.heading);
    for (const paragraph of section.paragraphs) {
      writer.paragraph(paragraph, format.body);
      writer.y -= SMALL_GAP;
    }
  }
}

/** The back: what to do, the steps first and then the basics. */
function writeBack(writer: Writer, text: HeirSheetText, format: HeirSheetFormat): void {
  writeSteps(writer, text, format);
  writer.y -= format.gap;
  writeBasics(writer, text, format);
  // The words are fixed by the program, so a back they overflow is a bug in them.
  if (writer.room < 0)
    throw new Error("The steps and the basics for heirs do not fit on the back.");
}

export async function renderHeirSheet(
  text: HeirSheetText,
  format: HeirSheetFormat = A5,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readRenderAsset("fonts/DejaVuSans-UI.ttf"), {
    subset: true,
  });
  clearDocumentMetadata(doc);
  const size: [number, number] = [format.width, format.height];
  const hintLines = hintLinesFor(font, text, format);
  writeFront(new Writer(doc.addPage(size), font, format), text, format, hintLines);
  writeBack(new Writer(doc.addPage(size), font, format), text, format);
  return doc.save();
}
