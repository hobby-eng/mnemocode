import { describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, rgb } from "pdf-lib";
import { pageOperators } from "./helpers/pdf-content.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCards, exportCards } from "../src/export/pdf.js";
import type { CardContent } from "../src/export/backup-cards.js";
import { cardTemplates, selectTemplate, type CardTemplate } from "../src/export/templates.js";
import { parseArguments, values } from "../src/cli/arguments.js";
import { commandOptions } from "../src/cli/command-options.js";
import { indexesToColors } from "../src/core.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { createCardIdentity } from "../src/export/card-identities.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { anyOf } from "./helpers/matchers.js";

// Blank PDF fixture tests the export transport only. It is never a registered design.
async function fixture(pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++)
    doc
      .addPage([100, 60])
      .drawRectangle({ x: 8, y: 12, width: 26, height: 18, color: rgb(0.2, 0.4, 0.6) });
  doc.setTitle("Private fixture title");
  doc.setAuthor("Private fixture author");
  doc.setSubject("Private fixture subject");
  doc.setKeywords(["Private fixture keyword"]);
  doc.setCreator("Private fixture creator");
  doc.setProducer("Private fixture producer");
  return doc.save();
}
const content: CardContent = { kind: "colors", colors: [], payload: "public test" };
const fragmentColors = indexesToColors(Array.from({ length: 12 }, (_, index) => index));

// Identity and sheet copy are chosen randomly per export; pin them so paired
// renders can differ only through the setting under test.
const fixedIdentity = {
  presentation: resolveCardPresentation(() => 0, {}),
  profile: createCardIdentity(() => 0, { name: "Alex Morgan" }),
};

describe("export infrastructure", () => {
  it("ships thirteen approved templates, separate cards in the business card designs only", () => {
    expect(cardTemplates).toHaveLength(13);
    expect(new Set(cardTemplates.map((t) => t.id)).size).toBe(13);
    // A material design is printed on sheets only (drawsSeparateCards).
    for (const template of cardTemplates)
      expect(typeof template.renderIndividual, template.id).toBe(
        template.family === "business" ? "function" : "undefined",
      );
  });

  it.each(["business-it", "business-curves", "business-mixed"])(
    "keeps an enabled collection QR off a separate %s card",
    async (id) => {
      const template = selectTemplate(id);
      for (const pageSize of [undefined, "business"] as const) {
        const withQr = await PDFDocument.load(
          await template.renderIndividual!(
            nodeCardRenderer,
            {
              kind: "colors",
              colors: fragmentColors,
              payload: fragmentColors.join(" "),
              cardQr: true,
              pageSize,
              ...fixedIdentity,
            },
            0,
          ),
        );
        const withoutQr = await PDFDocument.load(
          await template.renderIndividual!(
            nodeCardRenderer,
            {
              kind: "colors",
              colors: fragmentColors,
              payload: fragmentColors.join(" "),
              cardQr: false,
              pageSize,
              ...fixedIdentity,
            },
            0,
          ),
        );
        expect(withQr.getPageCount()).toBe(1);
        expect(pageOperators(withQr, 0)).toBe(pageOperators(withoutQr, 0));
      }
    },
  );
});

describe("export infrastructure", () => {
  it("preserves page content and removes private metadata in preview and saved PDFs", async () => {
    const bytes = await fixture();
    const template: CardTemplate = {
      id: "test-only",
      kind: "colors",
      name: "",
      description: "",
      render: vi.fn(async () => bytes),
    };
    const jobs = [{ template, content }];
    const original = await PDFDocument.load(bytes);
    const previewBytes = await renderCards(nodeCardRenderer, jobs);
    const preview = await PDFDocument.load(previewBytes, { updateMetadata: false });
    // No information dictionary is written, so no time of the export either (owner, 2026-10-13):
    // none in the trailer, and no object of the file, compressed or not, holds a date.
    const undated = async (file: Uint8Array) => {
      const document = await PDFDocument.load(file, { updateMetadata: false });
      expect(document.context.trailerInfo.Info).toBeUndefined();
      expect(document.getCreationDate()).toBeUndefined();
      const keys = document.context
        .enumerateIndirectObjects()
        .flatMap(([, object]) => (object instanceof PDFDict ? object.keys() : []))
        .map((key) => key.asString());
      for (const key of ["/CreationDate", "/ModDate", "/Producer"])
        expect(keys, key).not.toContain(key);
    };
    await undated(previewBytes);
    const verify = (document: PDFDocument) => {
      expect(document.getPageCount()).toBe(original.getPageCount());
      expect(document.getPage(0).getSize()).toEqual(original.getPage(0).getSize());
      expect(pageOperators(document, 0)).toBe(pageOperators(original, 0));
      for (const value of [
        document.getTitle(),
        document.getAuthor(),
        document.getSubject(),
        document.getKeywords(),
        document.getCreator(),
        document.getProducer(),
      ])
        expect(value ?? "").toBe("");
    };
    verify(preview);
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-export-"));
    try {
      const path = join(directory, "test.pdf");
      await exportCards(jobs, path);
      const saved = await readFile(path);
      await undated(saved);
      verify(await PDFDocument.load(saved, { updateMetadata: false }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(template.render).toHaveBeenCalledTimes(2);
    // Both drawn with the Node.js renderer, which exportCards passes as the preview's caller does.
    expect(template.render).toHaveBeenCalledWith(
      nodeCardRenderer,
      expect.objectContaining({
        ...content,
        cardQr: false,
        profile: anyOf(Object),
        presentation: anyOf(Object),
      }),
    );
    expect(
      vi.mocked(template.render).mock.calls.every(([drawing]) => drawing === nodeCardRenderer),
    ).toBe(true);
  });

  it("merges all renderers into a single PDF with unchanged page dimensions", async () => {
    const template: CardTemplate = {
      id: "test-only",
      kind: "colors",
      name: "",
      description: "",
      render: () => fixture(),
    };
    const output = await PDFDocument.load(
      await renderCards(nodeCardRenderer, [
        { template, content },
        { template, content },
      ]),
    );
    expect(output.getPageCount()).toBe(2);
    for (const page of output.getPages())
      expect(page.getSize()).toEqual({ width: 100, height: 60 });
  });
});

describe("export infrastructure", () => {
  it("rejects empty jobs and wrong card types, and preserves multi-page collections", async () => {
    const template: CardTemplate = {
      id: "test-only",
      kind: "colors",
      name: "",
      description: "",
      render: () => fixture(2),
    };
    await expect(renderCards(nodeCardRenderer, [])).rejects.toThrow("No approved");
    expect(
      (
        await PDFDocument.load(
          await renderCards(nodeCardRenderer, [
            { template, content },
            { template, content },
          ]),
        )
      ).getPageCount(),
    ).toBe(4);
    await expect(
      // A JavaScript host may pass a design of another kind than its content.
      renderCards(nodeCardRenderer, [
        { template: { ...template, kind: "unicode" as never }, content },
      ]),
    ).rejects.toThrow("does not support");
  });

  it("keeps a date list in entered order", () => {
    const args = parseArguments(["--dates", "23-09-2026", "08-08-1988"]);
    expect(values(args, "date")).toEqual(["23-09-2026", "08-08-1988"]);
    // The labels of dated Unicode cards went with those cards (owner, 2026-10-09): no command
    // takes them.
    expect(Object.values(commandOptions).flat()).not.toContain("event");
  });
});
