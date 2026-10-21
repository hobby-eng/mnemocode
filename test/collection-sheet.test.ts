import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import {
  collectionSheetLayout,
  MIN_SHEET_ROWS,
  SHEET_PLAN_TEXT,
} from "../src/export/collection-layout.js";
import { CARD_TEMPLATES } from "../src/export/templates.js";
import { indexesToColors } from "../src/core.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { renderSskrPdf } from "../src/export/sskr-render.js";
import { shareToColors } from "../src/sskr/transport.js";
import { MM } from "../src/export/business-layout.js";
import { pageOperators } from "./helpers/pdf-content.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { recordingQr } from "./helpers/recording-qr.js";
import { sskrVectors } from "./helpers/vectors.js";

const colors = indexesToColors(Array.from({ length: 24 }, (_, index) => index * 73 + 1));
const payload = colors.join(" ");
const presentation = resolveCardPresentation(() => 0, { studioName: "REVIEW STUDIO" });
afterEach(() => vi.restoreAllMocks());

describe("single-page design studies", () => {
  it("tells a person the order of its preference in the words of its own rule", () => {
    expect(MIN_SHEET_ROWS).toBe(3);
    expect(SHEET_PLAN_TEXT).toBe("at least three rows, the largest cards");
  });

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

  it.each(CARD_TEMPLATES.map((template) => [template.id, template] as const))(
    "renders one business-size proposal of design %s with one complete QR and all exact references",
    async (_id, template) => {
      const textSpy = vi.spyOn(PDFPage.prototype, "drawText");
      const { renderer, payloads, reads, modules } = recordingQr();
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
      // One matrix, of the whole payload, for the room that the layout keeps and for the code,
      // which is drawn from it once, every module of it.
      expect(payloads).toEqual([payload]);
      expect(reads).toEqual(modules);
      const labels = textSpy.mock.calls.map(([label]) => label);
      expect(labels).toContain("REVIEW STUDIO");
      expect(labels).toContain("DESIGN STUDY / FOR SELECTION");
      expect(labels.some((label) => label.startsWith("Series "))).toBe(true);
      for (const color of colors)
        expect(labels.some((label) => label.includes(color.slice(1)))).toBe(true);
      expect(pdf.getTitle() ?? "").toBe("");
    },
  );
});

describe("single-page design studies", () => {
  it("keeps the same studio on three SSKR study pages, with one own-member QR per page", async () => {
    const vector = sskrVectors();
    const shares = vector.deterministic[0]!.shares;
    const textSpy = vi.spyOn(PDFPage.prototype, "drawText");
    const { renderer, payloads, reads, modules } = recordingQr();
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
    // Only the codes made for the sheets are drawn, each whole and once.
    expect(reads).toEqual(modules.map((count, made) => (made < shares.length ? 0 : count)));
    const labels = textSpy.mock.calls.map(([label]) => label);
    expect(labels.filter((label) => label === "REVIEW STUDIO")).toHaveLength(3);
    // The footer line carries the slogan, the series of the share and the footer text.
    expect(new Set(labels.filter((label) => label.includes("Series "))).size).toBe(3);
  });

  // Every supported size and orientation, each a test of its own: all twelve sheets in one test
  // took over half a minute and ran out of time beside the rest of the suite.
  const SHEETS = ["business-it", "material-kitchen"].flatMap((id) =>
    (["business", "a6", "a4"] as const).flatMap((pageSize) =>
      (["landscape", "portrait"] as const).map(
        (orientation) => [id, pageSize, orientation] as const,
      ),
    ),
  );
  it.each(SHEETS)(
    "keeps the artwork and the QR of design %s together on a %s sheet, %s",
    async (id, pageSize, orientation) => {
      const template = CARD_TEMPLATES.find((item) => item.id === id)!;
      const images = vi.spyOn(PDFPage.prototype, "drawImage");
      const { renderer, payloads, reads, modules } = recordingQr();
      const document = await PDFDocument.load(
        await template.render(renderer, {
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
      // On that one page: the artwork, which is drawn as images, and the QR code of the whole
      // payload, every module of it once.
      expect(images).toHaveBeenCalled();
      expect(payloads).toEqual([payload]);
      expect(reads).toEqual(modules);
    },
  );

  it("puts business cards and enclosures on the dark sheet, other materials on their own backdrop", async () => {
    // The first thing drawn on a sheet is its background, a rectangle over the whole page.
    const background = async (id: string) => {
      const template = CARD_TEMPLATES.find((item) => item.id === id)!;
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
    // A showroom, a concrete wall, a tiled wall and an oak floor, each painted over its base
    // colour.
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
