import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { CardPreview } from "../src/export/card-preview.js";

describe("Sample cards as a library (export/card-preview.ts)", () => {
  it("draws one design, or every design in one PDF, from the public test phrase", async () => {
    // One design with the longest phrase; every design with the default, which draws half the
    // cards: every design at 24 words took a minute alone and ran out of time in the full suite.
    const longest = new CardPreview(nodeCardRenderer, { words: 24 });
    const one = await PDFDocument.load(await longest.render());
    expect(one.getPageCount()).toBe(1);
    const all = await PDFDocument.load(await new CardPreview(nodeCardRenderer).renderAll());
    expect(all.getPageCount()).toBe(CardPreview.templates.length);
  }, 120_000);

  it("refuses a phrase length BIP39 does not have", () => {
    expect(() => new CardPreview(nodeCardRenderer, { words: 13 })).toThrow(/12, 15, 18, 21 or 24/u);
  });

  it("holds no word of one coin, so that a host for another can take it", () => {
    const source = readFileSync(new URL("../src/export/card-preview.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/bitcoin/iu);
  });
});
