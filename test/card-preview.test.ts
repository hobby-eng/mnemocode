import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import "../src/export/platform-node.js";
import { CardPreview } from "../src/export/card-preview.js";

describe("Sample cards as a library (export/card-preview.ts)", () => {
  it("draws one design, or every design in one PDF, from the public test phrase", async () => {
    const preview = new CardPreview({ words: 24 });
    const one = await PDFDocument.load(await preview.render());
    expect(one.getPageCount()).toBe(1);
    const all = await PDFDocument.load(await preview.renderAll());
    expect(all.getPageCount()).toBe(CardPreview.templates.length);
  }, 120_000);

  it("prints the host's labels beside the dates, or labels that name no event", () => {
    const unicode = { id: "u", kind: "unicode", name: "", description: "" } as never;
    const own = new CardPreview({ labels: ["a", "b", "c", "d"] }).content(unicode);
    expect(own.kind === "unicode" && own.eventLabels).toEqual(["a", "b", "c", "d"]);
    const plain = new CardPreview().content(unicode);
    expect(plain.kind === "unicode" && plain.eventLabels).toEqual([
      "First date",
      "Second date",
      "Third date",
      "Fourth date",
    ]);
    expect(() => new CardPreview({ labels: ["only one"] })).toThrow(/one label for each/u);
  });

  it("refuses a phrase length BIP39 does not have", () => {
    expect(() => new CardPreview({ words: 13 })).toThrow(/12, 15, 18, 21, or 24/u);
  });

  it("holds no word of one coin, so that a host for another can take it", () => {
    const source = readFileSync(new URL("../src/export/card-preview.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/bitcoin/iu);
  });
});
