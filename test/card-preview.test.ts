import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { CardPreview } from "../src/export/card-preview.js";
import { phraseOfRandomEntropy } from "../src/core/english-words.js";

describe("Sample cards as a library (export/card-preview.ts)", () => {
  it("draws one design, or every design in one PDF, from a sample phrase", async () => {
    // One design with the longest phrase; every design with the default, which draws half the
    // cards: every design at 24 words took a minute alone and ran out of time in the full suite.
    const longest = new CardPreview(nodeCardRenderer, { words: 24 });
    const one = await PDFDocument.load(await longest.render());
    expect(one.getPageCount()).toBe(1);
    const all = await PDFDocument.load(await new CardPreview(nodeCardRenderer).renderAll());
    expect(all.getPageCount()).toBe(CardPreview.templates.length);
  }, 120_000);

  it("draws a sample phrase of its own for each preview, with the host's randomness", () => {
    const colorsOf = (preview: CardPreview): unknown => {
      const template = CardPreview.templates.find((design) => design.kind === "colors")!;
      const content = preview.content(template);
      return content.kind === "colors" ? content.payload : undefined;
    };
    const first = colorsOf(new CardPreview(nodeCardRenderer));
    expect(first).toEqual(expect.any(String));
    // Two phrases of 128 random bits alike would be a fault of the randomness, not chance.
    expect(colorsOf(new CardPreview(nodeCardRenderer))).not.toBe(first);
  });

  it("makes a sample phrase from entropy drawn byte by byte", () => {
    // Published BIP39 vectors (trezor/python-mnemonic, vectors.json): each byte of the entropy
    // alike.
    const vectors = [
      [
        0x00,
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      ],
      [0x7f, "legal winner thank year wave sausage worth useful legal winner thank yellow"],
      [0x80, "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"],
      [0xff, "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"],
    ] as const;
    for (const [byte, phrase] of vectors) {
      const asked: number[] = [];
      const randomInt = (upperExclusive: number): number => {
        asked.push(upperExclusive);
        return byte;
      };
      expect(phraseOfRandomEntropy(12, randomInt)).toBe(phrase);
      // 16 bytes for 12 words, each drawn from the 256 values of a byte.
      expect(asked).toEqual(Array<number>(16).fill(256));
    }
    expect(phraseOfRandomEntropy(24, () => 0).split(" ")).toHaveLength(24);
  });

  it("refuses a phrase length BIP39 does not have", () => {
    expect(() => new CardPreview(nodeCardRenderer, { words: 13 })).toThrow(/12, 15, 18, 21 or 24/u);
  });

  it("holds no word of one coin, so that a host for another can take it", () => {
    const source = readFileSync(new URL("../src/export/card-preview.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/bitcoin/iu);
  });
});
