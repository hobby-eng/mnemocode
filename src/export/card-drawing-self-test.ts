// The self-test check of the reader of card PDFs (export/card-drawing.ts), with which a host
// without Poppler paints the pages of cards: a rectangle in a known colour at known coordinates
// read back as exactly its drawing steps; a card of each family drawn from the public test phrase
// and read back as one A6 landscape page of drawing steps; and a PDF in a standard font, which
// carries no font program and no card uses, refused (AUD-037-FUN005). A host adds it to its
// self-test (core/self-test.ts, SelfTestHost.after) when it offers cards.
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with. It
// writes no file.
//
// Host-neutral: it imports only other export and core modules and pdf-lib.

import { PDFDocument, StandardFonts, fill, rectangle, setFillingRgbColor } from "pdf-lib";
import { ErrorCatalog } from "../core/error-catalog.js";
import { expectRefusedLater, expectSame, type SelfTestCheck } from "../core/self-test-check.js";
import { CardPdfReader, type DrawingStep } from "./card-drawing.js";
import { selfTestCardPdf } from "./cards-self-test.js";
import { A6_HEIGHT_POINTS, A6_WIDTH_POINTS, WIDTH_TOLERANCE_POINTS } from "./self-test-cards.js";
import { cardTemplates, type CardDrawing } from "./templates.js";

const ERRORS = new ErrorCatalog("export.card-drawing-self-test", {
  "drawing-steps-mismatch": (value0: string) => `${value0} drawing steps mismatch.`,
  "a6-landscape-page-mismatch": (value0: string) => `${value0} A6 landscape page mismatch.`,
});

/**
 * The drawing steps of the rectangle that withRectangle draws: its fill colour, then its corners
 * from (10, 20), 30 wide and 40 high, counterclockwise and closed, as ISO 32000-1, 8.5.2.1,
 * defines the command `re`, filled. Each value is exact in binary, so that the PDF keeps it.
 */
const RECTANGLE_STEPS: readonly DrawingStep[] = [
  { do: "fillColor", red: 0.25, green: 0.5, blue: 0.75 },
  {
    do: "path",
    segments: [
      { to: "move", x: 10, y: 20 },
      { to: "line", x: 40, y: 20 },
      { to: "line", x: 40, y: 60 },
      { to: "line", x: 10, y: 60 },
      { to: "close" },
    ],
    fill: true,
    stroke: false,
    clip: false,
    clipRule: "nonzero",
  },
];

/** A page with one rectangle, written with the commands of pdf-lib that the card renderers use. */
async function withRectangle(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .pushOperators(setFillingRgbColor(0.25, 0.5, 0.75), rectangle(10, 20, 30, 40), fill());
  return pdf.save();
}

/** A page of text in a standard PDF font, which carries no font program and no card uses. */
async function withStandardFont(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("public", { font });
  return pdf.save();
}

/** Whether `size` is the size of an A6 page in landscape, in points, as a renderer draws it. */
function isA6Landscape(size: { readonly width: number; readonly height: number }): boolean {
  return (
    Math.abs(size.width - A6_WIDTH_POINTS) <= WIDTH_TOLERANCE_POINTS &&
    Math.abs(size.height - A6_HEIGHT_POINTS) <= WIDTH_TOLERANCE_POINTS
  );
}

async function checkCardDrawing(drawing: CardDrawing): Promise<void> {
  {
    using reader = await CardPdfReader.load(await withRectangle());
    // As JSON: the steps are plain data, and their fields come in the order of DrawingStep.
    expectSame(
      JSON.stringify(reader.pages().map((page) => page.steps)),
      JSON.stringify([RECTANGLE_STEPS]),
      "Rectangle drawing steps",
    );
  }
  // One design of each family: the business cards and each material's own artwork.
  const families = new Map(cardTemplates.map((template) => [template.family, template]));
  for (const template of families.values()) {
    using reader = await CardPdfReader.load(await selfTestCardPdf(drawing, template));
    const pages = reader.pages();
    const [page] = pages;
    if (pages.length !== 1 || page === undefined || page.steps.length === 0)
      throw ERRORS.create("drawing-steps-mismatch", [`${template.id}`]);
    if (!isA6Landscape(page)) throw ERRORS.create("a6-landscape-page-mismatch", [`${template.id}`]);
  }
  await expectRefusedLater(
    async () => {
      using reader = await CardPdfReader.load(await withStandardFont());
      reader.pages();
    },
    /no TrueType program/u,
    "A PDF whose font no card uses",
  );
}

/** The check of the reader of card PDFs, with the host's `drawing`, for a host's self-test. */
export function cardDrawingCheck(drawing: CardDrawing): SelfTestCheck {
  return Object.freeze({
    name: "Card pages read back",
    detail: "a known rectangle, a card of each family on A6; refusal",
    run: () => checkCardDrawing(drawing),
  });
}
