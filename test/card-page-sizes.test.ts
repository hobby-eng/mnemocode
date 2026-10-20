import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { isCardPageSize, renderCards, selectTemplate, type CardContent } from "../src/cards.js";
import { indexesToColors } from "../src/core.js";
import { MM } from "../src/export/business-layout.js";
import { pageOperators } from "./helpers/pdf-content.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

/**
 * The limit of the test that draws a sheet for each share on A6 and a page for each card in every
 * card size: four times TEST_TIME_LIMIT_MS.
 */
const SHEETS_TIME_LIMIT_MS = 4 * TEST_TIME_LIMIT_MS;

const colors = indexesToColors(Array.from({ length: 12 }, (_, index) => index * 7));
const content: CardContent = { kind: "colors", colors, payload: colors.join(" ") };

async function pages(template: string, settings: Partial<CardContent>) {
  const bytes = await renderCards(nodeCardRenderer, [
    {
      template: selectTemplate(template, "colors"),
      content: { ...content, ...settings },
    },
  ]);
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round((width / MM) * 10) / 10, Math.round((height / MM) * 10) / 10];
  });
}

describe("page size decides between a sheet and separate cards", () => {
  it("names only the business size as a card size", () => {
    expect(
      // "wallet", which no type allows, fed on purpose as a JavaScript host could.
      [undefined, "a6", "a5", "a4", "wallet", "business"].map((size) =>
        isCardPageSize(size as never),
      ),
    ).toEqual([false, false, false, false, false, true]);
  });

  it("puts the whole collection on one A6 sheet when no size is given, turned as given", async () => {
    // Without an orientation the sheet is turned the way its cards are largest.
    for (const template of ["business-it", "material-tile"]) {
      const [page, ...more] = await pages(template, {});
      expect(more, template).toEqual([]);
      expect(
        [...page!].sort((a, b) => a - b),
        template,
      ).toEqual([105, 148]);
      expect(await pages(template, { orientation: "landscape" }), template).toEqual([[148, 105]]);
      expect(await pages(template, { orientation: "portrait" }), template).toEqual([[105, 148]]);
    }
    expect(await pages("business-it", { pageSize: "a4" })).toHaveLength(1);
    expect(await pages("business-it", { pageSize: "a5", orientation: "portrait" })).toEqual([
      [148, 210],
    ]);
  });

  it("gives one page per card for a card size, decoys after the codes", async () => {
    const cards = await pages("business-it", { pageSize: "business" });
    expect(cards.length).toBeGreaterThan(colors.length);
    expect(new Set(cards.map(String))).toEqual(new Set(["90,50"]));
    // A material design is printed on sheets only (drawsSeparateCards).
    await expect(pages("material-tile", { pageSize: "business" })).rejects.toThrow(
      "printed on sheets only",
    );
    // A page size that no type allows, fed on purpose as a JavaScript host could.
    await expect(pages("business-it", { pageSize: "wallet" as never })).rejects.toThrow(
      "a6, a5, a4 or business",
    );
  });

  it("refuses separate cards of a sheet size", async () => {
    const { renderIndividualCards } = await import("../src/cards.js");
    const template = selectTemplate("business-it", "colors");
    for (const pageSize of ["a6", "a4"] as const)
      await expect(
        renderIndividualCards(nodeCardRenderer, template, { ...content, pageSize }),
      ).rejects.toThrow("Separate cards have the business size.");
    expect(
      (await renderIndividualCards(nodeCardRenderer, template, { ...content })).length,
    ).toBeGreaterThan(colors.length);
  });

  it("knows the size of every page in both orientations", async () => {
    const { pageDimensions } = await import("../src/export/card-settings.js");
    expect(pageDimensions("a4")).toEqual([210, 297]);
    expect(pageDimensions("a4", "landscape")).toEqual([297, 210]);
    expect(pageDimensions("a6")).toEqual([148, 105]);
    expect(pageDimensions("a6", "portrait")).toEqual([105, 148]);
    expect(pageDimensions("business", "portrait")).toEqual([50, 90]);
  });

  it.each(["business-it", "business-architect"])(
    "gives a separate %s card rounded corners and paints nothing outside them",
    async (id) => {
      const template = selectTemplate(id, "colors");
      const document = await PDFDocument.load(
        await template.renderIndividual!(nodeCardRenderer, { ...content, pageSize: "business" }, 0),
      );
      const operators = pageOperators(document, 0);
      // Four curves form the corners of the clipping path; the artwork is drawn inside it.
      expect(operators.match(/ c$/gmu)).toHaveLength(4);
      expect(operators.indexOf("\nW\n")).toBeGreaterThan(-1);
      expect(operators.indexOf("\nW\n")).toBeLessThan(operators.indexOf(" Do"));
    },
  );

  it("refuses a QR code on separate cards", async () => {
    await expect(pages("business-it", { pageSize: "business", cardQr: true })).rejects.toThrow(
      "A QR code is printed on a sheet only.",
    );
  });
});

describe("page size decides the layout of Shamir share cards", () => {
  it("chooses the layout from the page size and rejects a conflicting request", async () => {
    const { resolveSskrLayout } = await import("../src/export/sskr-content.js");
    expect(resolveSskrLayout(undefined, undefined)).toBe("collection");
    expect(resolveSskrLayout(undefined, "a4")).toBe("collection");
    expect(resolveSskrLayout(undefined, "business")).toBe("individual");
    expect(resolveSskrLayout("individual", undefined)).toBe("individual");
    // A QR card holds one whole share and exists in every size.
    for (const size of [undefined, "a6", "business"] as const)
      expect(resolveSskrLayout("qr", size)).toBe("qr");
    expect(() => resolveSskrLayout("collection", "business")).toThrow("gives separate cards");
    expect(() => resolveSskrLayout("individual", "a6")).toThrow(
      "Separate cards have the business size",
    );
  });

  it(
    "prints one sheet per share on A6 and one page per card for a card size",
    { timeout: SHEETS_TIME_LIMIT_MS },
    async () => {
      const { splitSskrMnemonic } = await import("../src/sskr/shares.js");
      const { ShareCardSet } = await import("../src/export/sskr-render.js");
      const { renderSskrPdf } = await import("../src/export/sskr-render.js");
      // Public BIP39 test vector; never a real wallet.
      const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      const sheets = await PDFDocument.load(
        await renderSskrPdf(nodeCardRenderer, shares, { style: "it" }),
      );
      expect(sheets.getPageCount()).toBe(shares.length);
      const set = await ShareCardSet.create(nodeCardRenderer, shares, {
        style: "it",
        pageSize: "business",
      });
      const cards = await PDFDocument.load(await set.renderAll());
      // One page for every card of every share, its decoys included.
      const references = set.shares.reduce((sum, share) => sum + share.documents, 0);
      expect(cards.getPageCount()).toBe(references);
      expect(references).toBeGreaterThan(
        shares.reduce((sum, _, place) => sum + set.ownCodes(place), 0),
      );
      const { width, height } = cards.getPage(0).getSize();
      expect([Math.round(width / MM), Math.round(height / MM)]).toEqual([90, 50]);
    },
  );

  it("prints the QR card of a share as a compact sheet of the business size", async () => {
    const { splitSskrMnemonic } = await import("../src/sskr/shares.js");
    const { renderSskrPdf } = await import("../src/export/sskr-render.js");
    const { collectionSheetLayout } = await import("../src/export/collection-layout.js");
    // Public BIP39 test vector; never a real wallet.
    const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
    const document = await PDFDocument.load(
      await renderSskrPdf(nodeCardRenderer, shares, {
        style: "it",
        pageSize: "business",
        layout: "qr",
      }),
    );
    // One page for every share, each with its QR code: this is the only use of the compact sheet.
    expect(document.getPageCount()).toBe(shares.length);
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      expect([Math.round(width / MM), Math.round(height / MM)]).toEqual([90, 50]);
      expect(pageOperators(document, document.getPages().indexOf(page))).toContain(" Do");
    }
    expect(
      collectionSheetLayout(
        { pageSize: "business" },
        1,
        1.8,
        1,
        nodeRenderPlatform.qrModules("payload"),
      ).compact,
    ).toBe(true);
    expect(
      collectionSheetLayout({ pageSize: "a6" }, 1, 1.8, 1, nodeRenderPlatform.qrModules("payload"))
        .compact,
    ).toBe(false);
  });
});
