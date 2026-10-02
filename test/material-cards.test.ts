import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFPage, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { indexesToColors } from "../src/core.js";
import {
  materialArtwork,
  materialSamples,
  chooseMaterialSamples,
  tintedLook,
  type MaterialStyle,
} from "../src/export/material-artwork.js";
import { renderMaterialCard, type MaterialPageSize } from "../src/export/material-cards.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";

const colors = indexesToColors(Array.from({ length: 24 }, (_, i) => i * 73 + 1));
const presentation = resolveCardPresentation(
  {},
  { studioName: "NORTHLINE STUDIO" },
  () => 0,
).presentation;
// The recipient name is otherwise chosen randomly for every export.
const content = {
  kind: "colors" as const,
  colors,
  payload: colors.join(" "),
  presentation,
  profile: { name: "Alex Morgan" },
};
afterEach(() => vi.restoreAllMocks());
const styles = ["kitchen", "vehicle", "enclosure", "tile", "switch"] as const;
// The most references a card holds.
const MAX_REFERENCES = 16;
// CIE76 distance from which two samples side by side read as different colours, not as one colour
// printed twice; a just noticeable difference is about 2.3.
const MIN_LOOK_DIFFERENCE = 10;
/** CIE Lab (D65) of a colour, computed here independently of the module under test. */
function lab(hex: string): [number, number, number] {
  const digits = hex.replace(/^#/u, "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  const f = (v: number) => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labDistance(a: string, b: string) {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
function textSpy() {
  const spy = vi.spyOn(PDFPage.prototype, "drawText");
  return () => spy.mock.calls.map((call) => call[0]);
}
function operators(pdf: PDFDocument) {
  return pdf.getPages().map((page) => {
    const refs = page.node.Contents();
    const streams = refs && "asArray" in refs ? refs.asArray() : [refs];
    return streams
      .map((ref) => {
        const stream = pdf.context.lookup(ref);
        return stream instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")
          : "";
      })
      .join("\n");
  });
}

describe("material selection cards", () => {
  it("refuses a reference that is not six hexadecimal digits", () => {
    for (const invalid of ["123", "#1234567", "oops!!"])
      expect(() => chooseMaterialSamples("vehicle", [invalid])).toThrow();
  });

  it.each(styles)("offers %s samples that all look different from each other", (style) => {
    const samples = materialSamples(style);
    expect(samples.length).toBeGreaterThanOrEqual(MAX_REFERENCES + 8);
    expect(new Set(samples.map((sample) => sample.label)).size).toBe(samples.length);
    for (const [i, a] of samples.entries())
      for (const b of samples.slice(i + 1))
        expect(labDistance(a.look, b.look), `${a.label} / ${b.label}`).toBeGreaterThanOrEqual(
          MIN_LOOK_DIFFERENCE,
        );
    for (const sample of samples) {
      expect(materialArtwork[style].finishes).toContain(sample.finish);
      if (sample.tint !== undefined) {
        expect(sample.finish.surface).toBeDefined();
        expect(sample.look).toBe(tintedLook(sample.finish.color, sample.tint));
      }
    }
  });

  it.each(styles)("never gives two different %s references the same sample", (style) => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let sheet = 0; sheet < 200; sheet++) {
      const codes = Array.from(
        { length: MAX_REFERENCES },
        () => `#${(random() % 2 ** 24).toString(16).padStart(6, "0").toUpperCase()}`,
      );
      const samples = chooseMaterialSamples(style, codes);
      for (const [i, code] of codes.entries())
        for (const [j, other] of codes.entries())
          expect(samples[i] === samples[j]).toBe(code === other);
    }
    // Within one collection a reference keeps its sample in any case and order, and when it is
    // repeated. Other references may change it (AUD-007-ARC001), so this is not checked across
    // collections.
    const reversed = chooseMaterialSamples(style, [...colors].reverse());
    expect(
      chooseMaterialSamples(
        style,
        colors.map((c) => c.toLowerCase()),
      ),
    ).toEqual([...reversed].reverse());
    const [twice] = chooseMaterialSamples(style, [colors[0]!, colors[0]!]);
    expect(chooseMaterialSamples(style, [colors[0]!])).toEqual([twice]);
  });

  it("keeps the direction of a reference's colour", () => {
    // Clear colours of every direction, each with its hue in degrees; together on one card.
    const references = {
      "#B3261E": 36,
      "#E0761C": 60,
      "#E5D222": 96,
      "#5CBD6A": 143,
      "#2AA7A7": 200,
      "#1F08F3": 302,
      "#9C2FB5": 316,
    };
    for (const style of styles) {
      const samples = chooseMaterialSamples(style, Object.keys(references));
      for (const [i, hue] of Object.values(references).entries()) {
        const [, a, b] = lab(samples[i]!.look);
        const lookHue = (Math.atan2(b, a) * 180) / Math.PI;
        const difference = Math.abs(((lookHue - hue + 540) % 360) - 180);
        expect(difference, `${style}: ${samples[i]!.label}`).toBeLessThanOrEqual(45);
      }
    }
  });

  it("tints the object of a photograph with a Color blend", async () => {
    const blend = async (style: MaterialStyle) =>
      (await PDFDocument.load(await renderMaterialCard(style, content, { pageSize: "a4" }))).context
        .enumerateIndirectObjects()
        .some(
          ([, object]) =>
            object instanceof PDFDict && object.get(PDFName.of("BM")) === PDFName.of("Color"),
        );
    for (const style of styles) expect(await blend(style)).toBe(true);
    // The outline is a clipping path: every tinted sample draws one before its tint.
    const pdf = await PDFDocument.load(
      await renderMaterialCard("enclosure", content, { pageSize: "a4" }),
    );
    const tints = chooseMaterialSamples("enclosure", colors).filter((s) => s.tint).length;
    expect((operators(pdf)[0].match(/\nW\*\nn\n/gu) ?? []).length).toBe(tints);
  });

  it.each(["business", "a6", "a4"] as const)("honors both orientations for %s", async (size) => {
    const expected: Record<MaterialPageSize, [number, number]> = {
      business: [90, 50],
      a6: [148, 105],
      a4: [297, 210],
    };
    for (const orientation of ["landscape", "portrait"] as const) {
      const pdf = await PDFDocument.load(
        await renderMaterialCard("vehicle", { ...content, orientation }, { pageSize: size }),
      );
      const dimensions =
        orientation === "portrait" ? [...expected[size]].reverse() : expected[size];
      expect(pdf.getPageCount()).toBe(1);
      for (const page of pdf.getPages()) {
        expect((page.getWidth() * 25.4) / 72).toBeCloseTo(dimensions[0], 3);
        expect((page.getHeight() * 25.4) / 72).toBeCloseTo(dimensions[1], 3);
      }
    }
  });

  it("prints exact ordered references and finish names on the same study page as the QR", async () => {
    const texts = textSpy();
    const pdf = await PDFDocument.load(
      await renderMaterialCard("vehicle", {
        ...content,
        cardQr: true,
        pageSize: "a6",
        presentation: resolveCardPresentation({}, { studioName: "AURORA STUDIO" }, () => 0)
          .presentation,
        profile: { name: "John Smith" },
      }),
    );
    expect(texts()).toContain("AURORA STUDIO");
    expect(texts().some((value) => value.includes("Prepared for John Smith"))).toBe(true);
    expect(texts()).not.toContain("NORTHLINE STUDIO");
    for (const [i, code] of colors.entries()) {
      expect(texts()).toContain(`${String(i + 1).padStart(2, "0")}  ${code.slice(1)}`);
      expect(texts()).toContain(chooseMaterialSamples("vehicle", colors)[i]!.label);
    }
    const streams = operators(pdf);
    expect(streams).toHaveLength(1);
    expect((streams[0].match(/\nf\n/gu) ?? []).length).toBeGreaterThan(100);
  });

  it("uses the resolved studio and exposes only one reference in an individual fragment, without QR", async () => {
    const texts = textSpy();
    const pdf = await PDFDocument.load(
      await renderMaterialCard("switch", content, { individualIndex: 2, pageSize: "business" }),
    );
    expect(pdf.getPageCount()).toBe(1);
    expect(texts()).toContain("NORTHLINE STUDIO");
    expect(texts().filter((t) => /^\d{2}  [0-9A-F]{6}$/u.test(t))).toEqual([
      `03  ${colors[2].slice(1)}`,
    ]);
    expect(texts()).not.toContain(content.payload);
    expect((operators(pdf)[0].match(/\nf\n/gu) ?? []).length).toBeLessThan(10);
  });

  it("keeps individual artwork unchanged when collection QR is requested", async () => {
    const withQr = await PDFDocument.load(
      await renderMaterialCard(
        "switch",
        { ...content, cardQr: true },
        { individualIndex: 2, pageSize: "business" },
      ),
    );
    const withoutQr = await PDFDocument.load(
      await renderMaterialCard("switch", content, {
        individualIndex: 2,
        pageSize: "business",
      }),
    );
    expect(withQr.getPageCount()).toBe(1);
    expect(operators(withQr)).toEqual(operators(withoutQr));
  });

  it("rejects mismatched QR data and invalid fragment indices", async () => {
    await expect(
      renderMaterialCard("tile", { ...content, payload: "MNC1:unrelated" }),
    ).rejects.toThrow();
    await expect(
      renderMaterialCard("enclosure", content, { individualIndex: colors.length }),
    ).rejects.toThrow("index");
  });
});
