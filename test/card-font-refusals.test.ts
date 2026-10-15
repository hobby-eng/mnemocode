import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fit } from "../src/export/business-render-primitives.js";

describe("Card font refusals", () => {
  it("keeps the preferred size when supported text fits", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(fit(font, "Public fixture", 10, 5, 100, "Name")).toBe(10);
  });

  it("names the field without repeating an unsupported typed character", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const glyph = String.fromCodePoint(0x1f512);
    expect(() => fit(font, "Synthetic " + glyph, 10, 5, 100, "Name")).toThrow(
      expect.objectContaining({
        code: "export.business-render-primitives.contains-character-not-supported-by-card-font",
        message: "Name contains a character not supported by the card font.",
      }),
    );
  });

  it("still refuses supported text that cannot fit legibly", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(() => fit(font, "Public fixture", 10, 5, 1, "Name")).toThrow(
      expect.objectContaining({
        code: "export.business-render-primitives.too-long-fit-legibly-on-card-shorten",
        message: "Name is too long to fit legibly on the card; shorten it.",
      }),
    );
  });
});
