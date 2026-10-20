import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  appendQuadraticCurve,
  clipEvenOdd,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setGraphicsState,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_OPERATORS,
  CARD_DRAWING_REFUSAL,
  CardPdfReader,
  readCardPages,
  type CardPageDrawing,
  type DrawingStep,
} from "../src/export/card-drawing.js";
import { CardPreview } from "../src/export/card-preview.js";
import { documentWithFont } from "../src/export/pdf-documents.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { renderIndividualCards } from "../src/export/render.js";
import { SSKR_CARD_LAYOUTS } from "../src/export/sskr-content.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import type { CardStyle } from "../src/export/template-catalog.js";
import { CARD_TEMPLATES, type CardTemplate } from "../src/export/templates.js";
import { SHARE_FORMATS, shareFormatHasCards } from "../src/sskr/transport.js";
import { sskrVectors } from "./helpers/vectors.js";

// The reader of card PDFs that a host without Poppler, such as a browser page, paints cards with
// (export/card-drawing.ts). Every renderer family draws public sample cards through the Node.js
// card renderer, and each page must be read: a renderer that writes a PDF command outside the
// accepted list fails here, not in a browser's image export. Bounded: each drawing path once, not
// every combination (orientation swaps the width and height of the page, and A4 uses the same
// renderers). Synthetic and public test data only: the random sample phrase of CardPreview, masked
// with public dates, and the public SSKR vectors.

const SHARES: readonly string[] = sskrVectors().deterministic[0]!.shares;
/**
 * The limit of each test here, above the one of vitest.config.ts: each renders and reads the cards
 * of every design or family, which takes minutes on a loaded machine or a hosted CI runner.
 */
const DRAWING_TIME_LIMIT_MS = 300_000;

const steps = (page: CardPageDrawing, kind: DrawingStep["do"]) =>
  page.steps.filter((step) => step.do === kind);

/** The first installed design of every family, in the order of the catalog. */
const FAMILY_DESIGNS: readonly CardTemplate[] = CARD_TEMPLATES.filter(
  (template, index) =>
    CARD_TEMPLATES.findIndex((other) => other.family === template.family) === index,
);

function styleOf(template: CardTemplate): CardStyle {
  if (template.style === undefined) throw new Error(`${template.id} has no style.`);
  return template.style;
}

/** Reads every page of `pdf` and checks what each card paints: artwork, letters, balanced saves. */
async function expectCardPages(pdf: Uint8Array, what: string): Promise<CardPageDrawing[]> {
  const pages = await readCardPages(pdf);
  expect(pages.length, what).toBeGreaterThan(0);
  for (const page of pages) {
    expect(steps(page, "image").length, what).toBeGreaterThan(0);
    expect(steps(page, "text").length, what).toBeGreaterThan(0);
    expect(steps(page, "save").length, what).toBe(steps(page, "restore").length);
  }
  return pages;
}

describe("Card pages read back as drawing steps (export/card-drawing.ts)", () => {
  it("knows a design of every family", () => {
    expect(FAMILY_DESIGNS.map((template) => template.family)).toEqual(["business", "material"]);
  });

  it(
    "reads the sample cards of every design, one page each",
    async () => {
      const pdf = await new CardPreview(nodeCardRenderer).renderAll();
      const reader = await CardPdfReader.load(pdf);
      expect(reader.pageCount).toBe(CARD_TEMPLATES.length);
      await expectCardPages(pdf, "every design");
    },
    DRAWING_TIME_LIMIT_MS,
  );

  it(
    "reads a titled A4 sheet in landscape and an A6 sheet in portrait, with QR codes",
    async () => {
      const sheets = [
        { pageSize: "a4", orientation: "landscape", title: "Public sample" },
        { pageSize: "a6", orientation: "portrait", title: undefined },
      ] as const;
      for (const { title, ...page } of sheets) {
        const preview = new CardPreview(nodeCardRenderer, {
          settings: { ...page, cardQr: true },
          title,
        });
        for (const template of FAMILY_DESIGNS) {
          const what = `${template.id} ${page.pageSize} ${page.orientation}`;
          const [first] = await expectCardPages(await preview.render(template.id), what);
          // The page keeps the orientation asked for.
          expect(first!.width > first!.height, what).toBe(page.orientation === "landscape");
        }
      }
    },
    DRAWING_TIME_LIMIT_MS,
  );

  it(
    "reads a separate card of every family that has them",
    async () => {
      const preview = new CardPreview(nodeCardRenderer);
      // The material designs are printed on sheets only (drawsSeparateCards).
      for (const template of FAMILY_DESIGNS.filter((item) => item.renderIndividual)) {
        const { content } = preview.job(template.id);
        const [card] = await renderIndividualCards(nodeCardRenderer, template, content);
        const pages = await expectCardPages(card!.bytes, template.id);
        expect(pages, template.id).toHaveLength(1);
      }
    },
    DRAWING_TIME_LIMIT_MS,
  );

  it(
    "reads the share cards of every family in every layout, with a whole-share QR",
    async () => {
      for (const template of FAMILY_DESIGNS)
        for (const layout of SSKR_CARD_LAYOUTS) {
          // The material designs are printed on sheets only (drawsSeparateCards).
          if (layout === "individual" && !template.renderIndividual) continue;
          const cards = await ShareCardSet.create(nodeCardRenderer, SHARES, {
            style: styleOf(template),
            layout,
            cardQr: true,
          });
          // The first document of the first share: a sheet, or its first separate card.
          for await (const document of cards.documents(0)) {
            await expectCardPages(document.bytes, `${template.id} ${layout}`);
            break;
          }
        }
    },
    DRAWING_TIME_LIMIT_MS,
  );

  it(
    "reads share cards in every form of a share that has cards",
    async () => {
      const [business] = FAMILY_DESIGNS;
      for (const shareFormat of SHARE_FORMATS.filter(shareFormatHasCards)) {
        const cards = await ShareCardSet.create(nodeCardRenderer, SHARES, {
          style: styleOf(business!),
          shareFormat,
        });
        await expectCardPages(await cards.renderShare(0), shareFormat);
      }
    },
    DRAWING_TIME_LIMIT_MS,
  );
});

describe("Card pages refused or placed exactly (export/card-drawing.ts)", () => {
  // A frame with a hole, as the material cards clip their samples, then a tinted fill.
  async function tintedFrame(blendMode: string): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([100, 100]);
    page.node.setExtGState(
      PDFName.of("Tint"),
      document.context.obj({ Type: "ExtGState", BM: blendMode, ca: 0.85 }),
    );
    page.pushOperators(
      pushGraphicsState(),
      ...[10, 30].flatMap((inset) => [
        moveTo(inset, inset),
        lineTo(100 - inset, inset),
        lineTo(100 - inset, 100 - inset),
        lineTo(inset, 100 - inset),
        closePath(),
      ]),
      clipEvenOdd(),
      endPath(),
      setGraphicsState("Tint"),
      rectangle(0, 0, 100, 100),
      fill(),
      popGraphicsState(),
    );
    return document.save();
  }

  it("reads an even-odd outline and a Color tint, and refuses another blend mode", async () => {
    const [page] = await readCardPages(await tintedFrame("Color"));
    const [outline, tint] = steps(page!, "path");
    expect(outline).toMatchObject({ clip: true, clipRule: "evenodd", fill: false, stroke: false });
    expect(tint).toMatchObject({ clip: false, fill: true });
    expect(steps(page!, "graphicsState")).toEqual([
      { do: "graphicsState", fill: 0.85, blend: "color" },
    ]);
    await expect(readCardPages(await tintedFrame("Multiply"))).rejects.toThrow(
      "it uses the blend mode /Multiply",
    );
  });

  it("places each line of a text one line height below the one before", async () => {
    const { doc, font } = await documentWithFont(nodeRenderPlatform);
    const LINE_HEIGHT = 14;
    doc
      .addPage([200, 100])
      .drawText("AB\nAB", { font, size: 10, lineHeight: LINE_HEIGHT, x: 20, y: 60 });
    const [page] = await readCardPages(await doc.save());
    const [first, second] = steps(page!, "text");
    if (first?.do !== "text" || second?.do !== "text") throw new Error("Two lines are missing.");
    expect(first.matrix).toEqual([1, 0, 0, 1, 20, 60]);
    expect(second.matrix).toEqual([1, 0, 0, 1, 20, 60 - LINE_HEIGHT]);
    expect(second.segments).toEqual(first.segments);
  });

  it("refuses commands and encodings that the cards do not write", async () => {
    const shapes = await PDFDocument.create();
    shapes
      .addPage([100, 100])
      .drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(1, 0, 0) });
    const [page] = await readCardPages(await shapes.save());
    expect(page?.steps.some((step) => step.do === "path" && step.fill)).toBe(true);

    // A standard font writes its text in another way than the card renderers do.
    const letters = await PDFDocument.create();
    letters
      .addPage([100, 100])
      .drawText("text", { font: await letters.embedFont(StandardFonts.Helvetica) });
    await expect(readCardPages(await letters.save())).rejects.toThrow(CARD_DRAWING_REFUSAL);

    // pdf-lib writes `v` for a quadratic curve of drawSvgPath, which no card draws.
    expect(ACCEPTED_OPERATORS).not.toContain("v");
    const curve = await PDFDocument.create();
    curve
      .addPage([100, 100])
      .pushOperators(moveTo(0, 0), appendQuadraticCurve(50, 100, 100, 0), fill());
    await expect(readCardPages(await curve.save())).rejects.toThrow("the PDF command v");

    // A restore without its save.
    const unbalanced = await PDFDocument.create();
    unbalanced.addPage([100, 100]).pushOperators(popGraphicsState());
    await expect(readCardPages(await unbalanced.save())).rejects.toThrow("restores more");
  });

  it("refuses a stream with decoding parameters, which pdf-lib would ignore", async () => {
    const document = await PDFDocument.load(await tintedFrame("Color"));
    // A loaded page lists its content streams; the frame has one.
    const contents = document.getPage(0).node.Contents();
    const stream = contents instanceof PDFArray ? contents.lookup(0) : contents;
    if (!(stream instanceof PDFRawStream)) throw new Error("The page has no content stream.");
    stream.dict.set(PDFName.of("DecodeParms"), document.context.obj({ Predictor: 12 }));
    await expect(readCardPages(await document.save())).rejects.toThrow("decoding parameters");
  });
});
