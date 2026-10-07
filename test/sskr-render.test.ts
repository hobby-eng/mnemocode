import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
// The Node.js platform (setupFiles of vitest.config.ts) supplies the fonts and the random choices.
import { ShareCardSet } from "../src/export/sskr-render.js";
import { readShare, shareToColors, writeShare } from "../src/sskr/transport.js";

// Public test vectors only: SSKR shares of a public test entropy, made with a test-only seed.
const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
  readonly deterministic: readonly { readonly shares: readonly string[] }[];
};
const SHARES = vectors.deterministic[0]!.shares;

describe("cards of a share set, for any host", () => {
  it("names each share and renders a document that holds one share alone", async () => {
    const cards = new ShareCardSet(SHARES, { style: "it" });
    expect(cards.shares.map((share) => share.reference)).toEqual([
      "376C-1-1",
      "376C-1-2",
      "376C-1-3",
    ]);
    // A6 sheets by default: one collection sheet per share, no folder.
    expect(cards.shares.map((share) => [share.documents, share.folder])).toEqual(
      SHARES.map(() => [1, undefined]),
    );
    // One sheet each: the document of one share holds its sheet alone.
    const one = await PDFDocument.load(await cards.renderShare(1));
    expect(one.getPageCount()).toBe(1);
    expect(one.getTitle() ?? "").toBe("");
    await expect(cards.renderShare(SHARES.length)).rejects.toThrow("no share at that place");
  });

  it("tells the QR code that each share's sheets print, which a host may save as an image", () => {
    // None without a QR code on the sheets, and none for separate cards, which never carry one.
    expect(new ShareCardSet(SHARES, { style: "it" }).qrCodes).toEqual([]);
    expect(
      new ShareCardSet(SHARES, { style: "it", pageSize: "business", cardQr: true }).qrCodes,
    ).toEqual([]);
    const codes = new ShareCardSet(SHARES, { style: "it", cardQr: true }).qrCodes;
    expect(codes.map((code) => code.reference)).toEqual(["376C-1-1", "376C-1-2", "376C-1-3"]);
    // Each holds its share, which the ordinary reader reads back.
    expect(codes.map((code) => readShare(code.payload).ur)).toEqual(SHARES);
    // A document of QR codes prints one for each share as well.
    expect(new ShareCardSet(SHARES, { style: "it", layout: "qr" }).qrCodes).toHaveLength(3);
  });

  it("prints a share written in another form in that form, the colors only decorating it", async () => {
    for (const format of ["indexes", "unicode", "words"] as const) {
      const cards = new ShareCardSet(SHARES, { style: "it", cardQr: true, shareFormat: format });
      const codes = writeShare(SHARES[0]!, format).split(" ");
      // Three codes to a card, in their order, and the QR code holds them all.
      expect(cards.printedCodes(0).join(" "), format).toBe(codes.join(" "));
      expect(cards.printedCodes(0)[0], format).toBe(codes.slice(0, 3).join(" "));
      expect(cards.printedCodes(0)).toHaveLength(Math.ceil(codes.length / 3));
      expect(cards.qrCodes[0]!.payload, format).toBe(codes.join(" "));
      expect(readShare(cards.qrCodes[0]!.payload).ur).toBe(SHARES[0]);
    }
    // A share written as ur:sskr prints its Bytewords, word by word.
    expect(
      new ShareCardSet(SHARES, { style: "it", shareFormat: "ur" }).printedCodes(0).join(" "),
    ).toBe(writeShare(SHARES[0]!, "words"));
    // The colors print as themselves in the color forms.
    const colors = shareToColors(SHARES[0]!).map((color) => color.slice(1).toUpperCase());
    expect(new ShareCardSet(SHARES, { style: "it" }).printedCodes(0)).toEqual(colors);
    // Rendered in every design family.
    for (const style of ["it", "tile", "glass-4in1"] as const) {
      const pdf = await new ShareCardSet(SHARES, { style, shareFormat: "indexes" }).renderShare(0);
      expect(pdf.length, style).toBeGreaterThan(0);
    }
  });

  it("gives separate cards one document per fragment, kept in a folder of the share", async () => {
    const cards = new ShareCardSet([SHARES[0]!], { style: "it", pageSize: "business" });
    const [share] = cards.shares;
    const colors = shareToColors(SHARES[0]!);
    expect(share).toEqual({
      reference: "376C-1-1",
      documents: colors.length,
      folder: "collection-376C-1-1",
    });
    // Rendered one at a time: the first two, named after their places and their first colors.
    const names: string[] = [];
    for await (const document of cards.documents(0)) {
      expect((await PDFDocument.load(document.bytes)).getPageCount()).toBe(1);
      names.push(document.name);
      if (names.length === 2) break;
    }
    expect(names).toEqual(
      colors.slice(0, 2).map((color, place) => `0${place + 1}-${color.slice(1)}`),
    );
  });

  it("checks the layout, the style and the shares before anything is rendered", () => {
    expect(() => new ShareCardSet(SHARES, { style: "it", layout: "bad" as never })).toThrow(
      "Card layout must be qr, collection, or individual.",
    );
    expect(() => new ShareCardSet(SHARES, { style: "nonsense" as never })).toThrow(
      "Unsupported SSKR card style.",
    );
    expect(
      () => new ShareCardSet(SHARES, { style: "it", pageSize: "business", layout: "collection" }),
    ).toThrow("The business page size gives separate cards.");
    expect(() => new ShareCardSet([SHARES[0]!, SHARES[0]!], { style: "it" })).toThrow(
      "The same SSKR member was supplied more than once.",
    );
  });
});
