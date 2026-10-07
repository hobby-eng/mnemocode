// The self-test check of the card renderers: one card of each artwork family drawn from the public
// test phrase, on an A6 page, with its embedded font, images and QR code. A host adds it to its
// self-test (core/self-test.ts, SelfTestHost.after) when it offers cards.
//
// From the host it needs the render platform that the card renderers read (export/platform.ts,
// configureRenderPlatform), set before the check runs. It writes no file.
//
// Host-neutral: it imports only other export and core modules and pdf-lib.

import { PDFDocument } from "pdf-lib";
import { indexesToColors } from "../core/colors.js";
import { representMnemonic } from "../core/seedshift.js";
import type { SelfTestCheck } from "../core/self-test-check.js";
import { cardTemplates } from "./templates.js";

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** An A6 page is 148 mm wide in landscape; a PDF measures in points of 1/72 inch. */
const A6_WIDTH_POINTS = (148 * 72) / 25.4;
/** How far a measured page width may differ from A6 by rounding. */
const WIDTH_TOLERANCE_POINTS = 0.01;

async function checkCardExports(): Promise<void> {
  const colors = indexesToColors(representMnemonic(PUBLIC_MNEMONIC).shiftedIndexes);
  // Mixed covers the seven business artworks. Material families and glass 4/6/8
  // each have independent artwork paths; exercise each without repeating business styles.
  for (const template of cardTemplates.filter(
    (item) =>
      item.id === "business-mixed" ||
      item.id.startsWith("material-") ||
      item.id.startsWith("business-glass-"),
  )) {
    // Exercises local images, embedded font, individual-card QR suppression,
    // and the production PDF renderer.
    const bytes = await template.render({
      kind: "colors",
      colors,
      payload: colors.join(" "),
      pageSize: "a6",
      orientation: "landscape",
      cardQr: true,
      profile: {
        name: "Alex Morgan",
        role: "Design Director",
        company: "VECTOR STUDIO",
        email: "alex@vector.example",
        phone: "+44 20 7946 0281",
        website: "vector.example",
        location: "London",
      },
      presentation: {
        studioName: "VECTOR STUDIO",
        slogan: "Design with purpose.",
        subtitle: "Selected finishes",
        footer: "Crafted with care.",
        referenceLabel: "Ref.",
      },
    });
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw new Error(`${template.id} A6 page count mismatch.`);
    if (Math.abs(pdf.getPage(0).getWidth() - A6_WIDTH_POINTS) > WIDTH_TOLERANCE_POINTS)
      throw new Error(`${template.id} A6 dimensions mismatch.`);
  }
}

/** The check of the card renderers, for a host's self-test. */
export const CARD_EXPORT_CHECK: SelfTestCheck = Object.freeze({
  name: "Card export assets",
  detail: "approved templates, fonts, artwork and single-page A6 PDF",
  run: checkCardExports,
});
