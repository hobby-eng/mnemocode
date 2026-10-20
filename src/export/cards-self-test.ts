// The self-test check of the card renderers: one card of each artwork family drawn from the public
// test phrase, on an A6 page, with its embedded font, images and QR code. A host adds it to its
// self-test (core/self-test.ts, SelfTestHost.after) when it offers cards.
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with. It
// writes no file.
//
// Host-neutral: it imports only other export and core modules and pdf-lib.

import { PDFDocument } from "pdf-lib";
import { indexesToColors } from "../core/colors.js";
import { representMnemonic } from "../core/seedshift.js";
import type { SelfTestCheck } from "../core/self-test-check.js";
import { CARD_TEMPLATES, type CardDrawing, type CardTemplate } from "./templates.js";
import {
  A6_WIDTH_POINTS,
  SELF_TEST_CARD_DETAILS,
  WIDTH_TOLERANCE_POINTS,
} from "./self-test-cards.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { PUBLIC_MNEMONIC } from "../core/self-test-vectors.js";

const ERRORS = new ErrorCatalog("export.cards-self-test", {
  "a6-page-count-mismatch": (value0: string) => `${value0} A6 page count mismatch.`,
  "a6-dimensions-mismatch": (value0: string) => `${value0} A6 dimensions mismatch.`,
});

/**
 * The PDF of `template` drawn with `drawing` from the public test phrase, on one A6 page: local
 * images, the embedded font, individual-card QR suppression and the production PDF renderer. A
 * refusal of `template` passes on, such as one of a host's design that cannot draw the phrase.
 */
export async function selfTestCardPdf(
  drawing: CardDrawing,
  template: CardTemplate,
): Promise<Uint8Array> {
  const colors = indexesToColors(representMnemonic(PUBLIC_MNEMONIC).shiftedIndexes);
  return template.render(drawing, {
    kind: "colors",
    colors,
    payload: colors.join(" "),
    pageSize: "a6",
    orientation: "landscape",
    cardQr: true,
    ...SELF_TEST_CARD_DETAILS,
  });
}

async function checkCardExports(drawing: CardDrawing): Promise<void> {
  // Mixed covers the seven business artworks. Each material has its own artwork path;
  // exercise each without repeating business styles.
  for (const template of CARD_TEMPLATES.filter(
    (item) => item.style === "mixed" || item.family !== "business",
  )) {
    const bytes = await selfTestCardPdf(drawing, template);
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw ERRORS.create("a6-page-count-mismatch", [`${template.id}`]);
    if (Math.abs(pdf.getPage(0).getWidth() - A6_WIDTH_POINTS) > WIDTH_TOLERANCE_POINTS)
      throw ERRORS.create("a6-dimensions-mismatch", [`${template.id}`]);
  }
}

/** The check of the card renderers, drawn with the host's `drawing`, for a host's self-test. */
export function cardExportCheck(drawing: CardDrawing): SelfTestCheck {
  return Object.freeze({
    name: "Card export assets",
    detail: "templates, fonts, artwork and single-page A6 PDF",
    run: () => checkCardExports(drawing),
  });
}
