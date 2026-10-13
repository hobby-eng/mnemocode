import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pageOperators } from "./helpers/pdf-content.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { indexesToColors, representMnemonic, colorsToUnicode } from "../src/core.js";
import { MM } from "../src/export/business-layout.js";
import { validateProfile, parsePageSize } from "../src/export/card-settings.js";
import { createCardIdentity } from "../src/export/card-identities.js";
import { selectTemplate } from "../src/export/templates.js";
import { renderCards } from "../src/export/pdf.js";
import { parseArguments } from "../src/cli/arguments.js";
import { businessOptions } from "../src/cli/business-options.js";
import { validateCardOptions } from "../src/cli/card-options.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { cardExportCheck } from "../src/export/cards-self-test.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";

const colors = indexesToColors(
  representMnemonic(entropyToMnemonic(new Uint8Array(32), wordlist)).shiftedIndexes,
);

describe("business card collections", () => {
  it("keeps every detail given, trimmed, and validates Latin names", () => {
    const profile = createCardIdentity(() => 0, { name: " Alex Morgan ", email: "me@example.com" });
    expect(profile.name).toBe("Alex Morgan");
    expect(profile.email).toBe("me@example.com");
    expect(validateProfile({ name: "Jean-Luc D’Angelo" }).name).toBe("Jean-Luc D’Angelo");
    expect(() => validateProfile({ name: "Νίκος Παππάς" })).toThrow("Latin letters only");
  });

  it("rejects silent fallbacks for invalid or repeated options and requires a PDF", () => {
    for (const name of ["", "  ", "x\ny", "\x1b[0m", "x".repeat(101)])
      expect(() => validateProfile({ name })).toThrow();
    expect(() => parsePageSize("wallet")).toThrow("a6, a5, a4 or business");
    expect(parsePageSize("business")).toBe("business");
    expect(() =>
      businessOptions(parseArguments(["--card-name", "One", "--card-name", "Two"])),
    ).toThrow("Provide exactly one value for the card name setting.");
    expect(() =>
      validateCardOptions(parseArguments(["--card-email", "me@example.com"]), "colors"),
    ).toThrow("require a PDF file");
    expect(() =>
      validateCardOptions(parseArguments(["--pdf", "a.pdf", "--page-size", "a3"]), "colors"),
    ).toThrow("Page size");
  });

  it("renders both designs with real fonts/artwork, custom fields and both raw QR formats", async () => {
    for (const [id, size, payload] of [
      ["business-architect", "a6", colors.join(" ")],
      ["business-it", "a4", colorsToUnicode(colors)],
    ] as const) {
      const bytes = await renderCards(nodeCardRenderer, [
        {
          template: selectTemplate(id),
          content: {
            kind: "colors",
            colors,
            payload,
            pageSize: size,
            // Given, as the sizes are checked below; without it a sheet is turned the way its
            // cards are largest.
            orientation: size === "a6" ? "landscape" : "portrait",
            cardQr: true,
            presentation: resolveCardPresentation(() => 0, {}),
            profile: {
              name: "Alex Morgan",
              email: "me@example.com",
              company: "VECTOR SYSTEMS",
              role: "IT SOLUTIONS DIRECTOR",
              website: "vector.example",
              phone: "+1 202 555 0148",
              location: "International",
            },
          },
        },
      ]);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo((size === "a6" ? 148 : 210) * MM, 3);
        expect(page.getHeight()).toBeCloseTo((size === "a6" ? 105 : 297) * MM, 3);
      }
      expect(pdf.getTitle() ?? "").toBe("");
      expect((pageOperators(pdf, 0).match(/\nf\n/gu) ?? []).length).toBeGreaterThan(100);
    }
  }, 180_000);

  it("fails on mismatched QR data and unprintable personal fields before returning a PDF", async () => {
    const template = selectTemplate("business-it");
    const content = { kind: "colors" as const, colors, payload: colors.join(" ") };
    await expect(
      template.render(nodeCardRenderer, { ...content, payload: "MNC1:secret" }),
    ).rejects.toThrow();
    await expect(
      template.render(nodeCardRenderer, { ...content, profile: { company: "🛸" } }),
    ).rejects.toThrow("not supported");
    await expect(
      template.render(nodeCardRenderer, { ...content, profile: { email: "x".repeat(95) } }),
    ).rejects.toThrow("too long");
  });

  it.each([
    "business-architect",
    "business-it",
    "business-estate",
    "business-diagonal",
    "business-contact",
    "business-curves",
    "business-facets",
    "business-mixed",
  ])("keeps an individual %s card QR-free and visually unchanged", async (id) => {
    const template = selectTemplate(id);
    // Identity and sheet copy are chosen randomly per export; pin them so the two
    // renders can differ only through the QR setting under test.
    const content = {
      kind: "colors" as const,
      colors,
      payload: colors.join(" "),
      presentation: resolveCardPresentation(() => 0, {}),
      profile: createCardIdentity(() => 0, { name: "Alex Morgan" }),
    };
    const withQr = await PDFDocument.load(
      await template.renderIndividual!(
        nodeCardRenderer,
        {
          ...content,
          cardQr: true,
        },
        0,
      ),
    );
    const withoutQr = await PDFDocument.load(
      await template.renderIndividual!(
        nodeCardRenderer,
        {
          ...content,
          cardQr: false,
        },
        0,
      ),
    );
    expect(withQr.getPageCount()).toBe(1);
    expect(pageOperators(withQr, 0)).toBe(pageOperators(withoutQr, 0));
  });
});

describe("the card renderers' self-test", () => {
  it("draws a sheet of every artwork family (cardExportCheck)", async () => {
    await expect(cardExportCheck(nodeCardRenderer).run()).resolves.toBeUndefined();
  });
});
