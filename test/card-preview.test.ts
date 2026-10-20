import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { CardPreview } from "../src/export/card-preview.js";
import { CardRenderer } from "../src/export/card-renderer.js";
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

  it("draws a sample phrase of its own for each preview with the host's randomInt, a byte at a time", () => {
    const colorsOf = (preview: CardPreview): unknown => {
      const template = CardPreview.templates.find((design) => design.kind === "colors")!;
      const content = preview.content(template);
      return content.kind === "colors" ? content.payload : undefined;
    };
    // The phrases of entropy bytes all 0x7f ("legal winner thank year wave sausage worth useful
    // legal winner thank yellow") and all 0x00 ("abandon … about"), masked with the four sample
    // dates. The colours come from an independent Python oracle of docs/SEEDSHIFT_CONSTRUCTION.md,
    // BIP39 with hashlib and the documented BIP39Colors layout, not from this code.
    const answers = [
      [0x7f, "#017EE4 #22833E #4016B7 #688BD1 #7D1C97 #9BCED8 #BA1FB9 #E446DA"],
      [0x00, "#0310C4 #203250 #401A28 #5BDBA4 #7D2328 #98E4AD #BA2C8C #D68B50"],
    ] as const;
    let byte = 0;
    const asked: number[] = [];
    // One host for both previews, so that each preview must ask it for entropy of its own.
    const renderer = new CardRenderer({
      ...nodeRenderPlatform,
      randomInt: (upperExclusive) => {
        asked.push(upperExclusive);
        return byte;
      },
    });
    for (const [answer, colors] of answers) {
      byte = answer;
      asked.length = 0;
      expect(colorsOf(new CardPreview(renderer))).toBe(colors);
      // 16 bytes for 12 words, each drawn from the 256 values of a byte.
      expect(asked).toEqual(Array<number>(16).fill(256));
    }
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

  it.each([256, -1, 0.5, Number.NaN])(
    "refuses a host's random byte %s out of range for the sample phrase, as for every card choice",
    (byte) => {
      // Faulty for the 256 values of a byte alone, so that no other choice refuses it.
      const drawing = new CardRenderer({
        ...nodeRenderPlatform,
        randomInt: (limit) => (limit === 256 ? byte : 0),
      });
      expect(() => new CardPreview(drawing)).toThrow(
        expect.objectContaining({ code: "export.platform.checked-choice-refused" }),
      );
    },
  );

  it("refuses a phrase length BIP39 does not have", () => {
    expect(() => new CardPreview(nodeCardRenderer, { words: 13 })).toThrow(/12, 15, 18, 21 or 24/u);
  });

  it("holds no word of one coin, so that a host for another can take it", () => {
    const source = readFileSync(new URL("../src/export/card-preview.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/bitcoin/iu);
  });
});
