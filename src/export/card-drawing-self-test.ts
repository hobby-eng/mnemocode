// The self-test check of the reader of card PDFs (export/card-drawing.ts), with which a host
// without Poppler paints the pages of cards: a card of each family drawn from the public test
// phrase and read back as one page of drawing steps, and a PDF in a standard font, which carries
// no font program and no card uses, refused (AUD-037-FUN005). A host adds it to its self-test
// (core/self-test.ts, SelfTestHost.after) when it offers cards.
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with. It
// writes no file.
//
// Host-neutral: it imports only other export and core modules and pdf-lib.

import { PDFDocument, StandardFonts } from "pdf-lib";
import { ErrorCatalog } from "../core/error-catalog.js";
import { expectRefusedLater, type SelfTestCheck } from "../core/self-test-check.js";
import { CardPdfReader } from "./card-drawing.js";
import { selfTestCardPdf } from "./cards-self-test.js";
import { cardTemplates, type CardDrawing } from "./templates.js";

const ERRORS = new ErrorCatalog("export.card-drawing-self-test", {
  "drawing-steps-mismatch": (value0: string) => `${value0} drawing steps mismatch.`,
});

/** A page of text in a standard PDF font, which carries no font program and no card uses. */
async function withStandardFont(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("public", { font });
  return pdf.save();
}

async function checkCardDrawing(drawing: CardDrawing): Promise<void> {
  // One design of each family: the business cards and each material's own artwork.
  const families = new Map(cardTemplates.map((template) => [template.family, template]));
  for (const template of families.values()) {
    using reader = await CardPdfReader.load(await selfTestCardPdf(drawing, template));
    const pages = reader.pages();
    if (pages.length !== 1 || pages[0]?.steps.length === 0)
      throw ERRORS.create("drawing-steps-mismatch", [`${template.id}`]);
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
    detail: "a card of each family as drawing steps; refusal",
    run: () => checkCardDrawing(drawing),
  });
}
