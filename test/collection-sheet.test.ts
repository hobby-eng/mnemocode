import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFPage } from "pdf-lib";
import { collectionSheetLayout } from "../src/export/collection-sheet.js";
import { cardTemplates } from "../src/export/templates.js";
import { indexesToColors } from "../src/core.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { renderSskrPdf } from "../src/export/sskr-cards.js";
import { shareToColors } from "../src/sskr/transport.js";
import * as qr from "../src/export/card-qr.js";
import { MM } from "../src/export/business-layout.js";
import { pageOperators } from "./helpers/pdf-content.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import type { QrModules } from "../src/export/platform.js";

const colors = indexesToColors(Array.from({ length: 24 }, (_, index) => index * 73 + 1));
const payload = colors.join(" ");
const presentation = resolveCardPresentation(() => 0, { studioName: "REVIEW STUDIO" });
afterEach(() => vi.restoreAllMocks());

/**
 * A renderer whose QR matrices come from the Node.js platform, each payload and the matrix made
 * for it recorded, so that a test can tell which code a sheet drew.
 */
function recordingQr(): { renderer: CardRenderer; payloads: string[]; matrices: QrModules[] } {
  const payloads: string[] = [];
  const matrices: QrModules[] = [];
  const renderer = new CardRenderer({
    ...nodeRenderPlatform,
    qrModules: (text) => {
      const matrix = nodeRenderPlatform.qrModules(text);
      payloads.push(text);
      matrices.push(matrix);
      return matrix;
    },
  });
  return { renderer, payloads, matrices };
}

describe("single-page design studies", () => {
  it.each(["business", "a6", "a4"] as const)(
    "reserves non-overlapping artwork, captions and a corner QR for every %s orientation and count",
    (pageSize) => {
      for (const orientation of ["portrait", "landscape"] as const)
        for (let count = 1; count <= 16; count++)
          for (const includeQr of [false, true]) {
            const layout = collectionSheetLayout(
              { pageSize, orientation },
              count,
              1.8,
              1,
              includeQr ? nodeRenderPlatform.qrModules(payload) : undefined,
            );
            expect(layout.cards.map((box) => box.index)).toEqual(
              Array.from({ length: count }, (_, i) => i),
            );
            for (const box of layout.cards) {
              expect(box.x).toBeGreaterThanOrEqual(layout.metrics.margin - 0.001);
              expect(box.y).toBeGreaterThanOrEqual(layout.header - 0.001);
              expect(box.x + box.width).toBeLessThanOrEqual(
                layout.width - layout.metrics.margin + 0.001,
              );
              const bottom = box.captionTop + layout.metrics.lineHeight;
              expect(bottom).toBeLessThanOrEqual(layout.height - layout.metrics.footer + 0.001);
              if (layout.qr) {
                // Landscape sheets keep the cells left of the QR; portrait sheets start below
                // the QR and its one-line caption.
                const qrBottom = layout.qr.y + layout.qr.size + layout.metrics.lineHeight;
                const right = Math.max(box.x + box.width, box.captionX + box.captionWidth);
                expect(right <= layout.qr.x || box.y >= qrBottom).toBe(true);
              }
              for (const other of layout.cards.filter((item) => item.index !== box.index))
                expect(
                  box.captionX + box.captionWidth <= other.captionX ||
                    other.captionX + other.captionWidth <= box.captionX ||
                    bottom <= other.y ||
                    other.captionTop + layout.metrics.lineHeight <= box.y,
                ).toBe(true);
            }
          }
    },
  );

  it.each(cardTemplates.map((template) => [template.id, template] as const))(
    "%s renders one business-size proposal with one complete QR and all exact references",
    async (_id, template) => {
      const qrSpy = vi.spyOn(qr, "drawCollectionQr");
      const textSpy = vi.spyOn(PDFPage.prototype, "drawText");
      const { renderer, payloads, matrices } = recordingQr();
      const pdf = await PDFDocument.load(
        await template.render(renderer, {
          kind: "colors",
          colors,
          payload,
          presentation,
          cardQr: true,
          pageSize: "business",
          orientation: "landscape",
        }),
      );
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(90 * MM);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(50 * MM);
      expect(qrSpy).toHaveBeenCalledTimes(1);
      // One matrix, of the whole payload, for the room that the layout keeps and for the code.
      expect(payloads).toEqual([payload]);
      expect(qrSpy.mock.calls[0]![1]).toBe(matrices[0]);
      const labels = textSpy.mock.calls.map(([label]) => label);
      expect(labels).toContain("REVIEW STUDIO");
      expect(labels).toContain("DESIGN STUDY / FOR SELECTION");
      expect(labels.some((label) => label.startsWith("Series "))).toBe(true);
      for (const color of colors)
        expect(labels.some((label) => label.includes(color.slice(1)))).toBe(true);
      expect(pdf.getTitle() ?? "").toBe("");
    },
  );

  it("keeps the same studio on three SSKR study pages, with one own-member QR per page", async () => {
    const vector = JSON.parse(
      await readFile(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
    );
    const shares = vector.deterministic[0].shares as string[];
    const qrSpy = vi.spyOn(qr, "drawCollectionQr");
    const textSpy = vi.spyOn(PDFPage.prototype, "drawText");
    const { renderer, payloads, matrices } = recordingQr();
    const pdf = await PDFDocument.load(
      await renderSskrPdf(renderer, shares, {
        style: "it",
        layout: "collection",
        // A collection sheet needs a sheet size; a card size would give separate cards.
        pageSize: "a6",
        orientation: "landscape",
        cardQr: true,
        presentation,
      }),
    );
    expect(shares).toHaveLength(3);
    expect(pdf.getPageCount()).toBe(3);
    // Each share's code is made for the plan of its decoys, then for its sheet, which draws it.
    const own = shares.map((share) => shareToColors(share).join(" "));
    expect(payloads).toEqual([...own, ...own]);
    expect(qrSpy.mock.calls.map((call) => call[1])).toEqual(matrices.slice(shares.length));
    const labels = textSpy.mock.calls.map(([label]) => label);
    expect(labels.filter((label) => label === "REVIEW STUDIO")).toHaveLength(3);
    // The footer line carries the slogan, the series of the share and the footer text.
    expect(new Set(labels.filter((label) => label.includes("Series "))).size).toBe(3);
  });

  it.each(["business-it", "material-kitchen"])(
    "%s keeps artwork and QR together at every supported size and orientation",
    async (id) => {
      const template = cardTemplates.find((item) => item.id === id)!;
      for (const pageSize of ["business", "a6", "a4"] as const)
        for (const orientation of ["landscape", "portrait"] as const) {
          const document = await PDFDocument.load(
            await template.render(nodeCardRenderer, {
              kind: "colors",
              colors,
              payload,
              presentation,
              cardQr: true,
              pageSize,
              orientation,
            }),
          );
          expect(document.getPageCount()).toBe(1);
        }
    },
  );

  it("puts business cards and enclosures on the dark sheet, other materials on their own backdrop", async () => {
    // The first thing drawn on a sheet is its background, a rectangle over the whole page.
    const background = async (id: string) => {
      const template = cardTemplates.find((item) => item.id === id)!;
      const document = await PDFDocument.load(
        await template.render(nodeCardRenderer, {
          kind: "colors",
          colors,
          payload,
          presentation,
          pageSize: "a6",
        }),
      );
      return /^([\d.]+ [\d.]+ [\d.]+) rg$/mu.exec(pageOperators(document, 0))?.[1];
    };
    for (const id of ["business-it", "business-architect", "material-enclosure"])
      expect(await background(id), id).toBe("0.043 0.047 0.059");
    // A showroom, a concrete wall, a tiled wall and an oak floor, each painted over its base colour.
    const backdrops = {
      "material-vehicle": "0.86 0.87 0.88",
      "material-switch": "0.8 0.79 0.765",
      "material-tile": "0.93 0.92 0.9",
      "material-kitchen": "0.86 0.8 0.71",
    };
    for (const [id, base] of Object.entries(backdrops)) expect(await background(id), id).toBe(base);
  });

  it("fails instead of creating a QR-only back when physical constraints cannot be met", () => {
    expect(() =>
      collectionSheetLayout(
        { pageSize: "business" },
        16,
        1.8,
        1,
        nodeRenderPlatform.qrModules("x".repeat(2000)),
      ),
    ).toThrow("choose a larger page size");
  });
});
