import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { referencePlacement } from "../src/export/business-cards.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { readShare, shareToColors, writeShare } from "../src/sskr/transport.js";
// The tests pass the Node.js card renderer, which supplies the fonts and the random choices.
import { nodeCardRenderer } from "../src/export/platform-node.js";

// Public test vectors only: SSKR shares of a public test entropy, made with a test-only seed.
const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
  readonly deterministic: readonly { readonly shares: readonly string[] }[];
};
const SHARES = vectors.deterministic[0]!.shares;

describe("cards of a share set, for any host", () => {
  it("names each share and renders a document that holds one share alone", async () => {
    const cards = new ShareCardSet(nodeCardRenderer, SHARES, { style: "it" });
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
    expect(new ShareCardSet(nodeCardRenderer, SHARES, { style: "it" }).qrCodes).toEqual([]);
    expect(
      new ShareCardSet(nodeCardRenderer, SHARES, {
        style: "it",
        pageSize: "business",
        cardQr: true,
      }).qrCodes,
    ).toEqual([]);
    const codes = new ShareCardSet(nodeCardRenderer, SHARES, { style: "it", cardQr: true }).qrCodes;
    expect(codes.map((code) => code.reference)).toEqual(["376C-1-1", "376C-1-2", "376C-1-3"]);
    expect(codes.map((code) => code.name)).toEqual(
      ["376C-1-1", "376C-1-2", "376C-1-3"].map((reference) => `collection-${reference}`),
    );
    // Each holds its share, which the ordinary reader reads back.
    expect(codes.map((code) => readShare(code.payload).ur)).toEqual(SHARES);
    // A document of QR codes prints one for each share as well.
    expect(
      new ShareCardSet(nodeCardRenderer, SHARES, { style: "it", layout: "qr" }).qrCodes,
    ).toHaveLength(3);
  });

  it("prints a share written in another form in that form, the colors only decorating it", async () => {
    for (const format of ["indexes", "unicode", "words"] as const) {
      const cards = new ShareCardSet(nodeCardRenderer, SHARES, {
        style: "it",
        cardQr: true,
        shareFormat: format,
      });
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
      new ShareCardSet(nodeCardRenderer, SHARES, { style: "it", shareFormat: "ur" })
        .printedCodes(0)
        .join(" "),
    ).toBe(writeShare(SHARES[0]!, "words"));
    // The colors print as themselves in the color forms.
    const colors = shareToColors(SHARES[0]!).map((color) => color.slice(1).toUpperCase());
    expect(new ShareCardSet(nodeCardRenderer, SHARES, { style: "it" }).printedCodes(0)).toEqual(
      colors,
    );
    // Rendered in every design family.
    for (const style of ["it", "tile", "glass-4in1"] as const) {
      const pdf = await new ShareCardSet(nodeCardRenderer, SHARES, {
        style,
        shareFormat: "indexes",
      }).renderShare(0);
      expect(pdf.length, style).toBeGreaterThan(0);
    }
  });

  it("gives separate cards one document per fragment, kept in a folder of the share", async () => {
    const cards = new ShareCardSet(nodeCardRenderer, [SHARES[0]!], {
      style: "it",
      pageSize: "business",
    });
    const [share] = cards.shares;
    const colors = shareToColors(SHARES[0]!);
    expect(share).toEqual({
      reference: "376C-1-1",
      name: "collection-376C-1-1",
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
    expect(
      () => new ShareCardSet(nodeCardRenderer, SHARES, { style: "it", layout: "bad" as never }),
    ).toThrow("The card layout must be one of: qr, collection, individual.");
    expect(
      () => new ShareCardSet(nodeCardRenderer, SHARES, { style: "nonsense" as never }),
    ).toThrow("Unsupported SSKR card style.");
    expect(
      () =>
        new ShareCardSet(nodeCardRenderer, SHARES, {
          style: "it",
          pageSize: "business",
          layout: "collection",
        }),
    ).toThrow("The business page size gives separate cards.");
    expect(
      () => new ShareCardSet(nodeCardRenderer, [SHARES[0]!, SHARES[0]!], { style: "it" }),
    ).toThrow("The same SSKR member was supplied more than once.");
  });
});

describe("share cards after AUD-010", () => {
  const MM_POINTS = 72 / 25.4;
  /** The page of a PDF in whole millimetres. */
  async function pageMillimetres(bytes: Uint8Array): Promise<string> {
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
    return `${Math.round(width / MM_POINTS)}x${Math.round(height / MM_POINTS)}`;
  }

  it("prints sheets of every design on A6 when no size is given (AUD-010-UI001)", async () => {
    for (const style of ["tile", "it", "glass-4in1"] as const)
      expect(
        await pageMillimetres(
          await new ShareCardSet(nodeCardRenderer, SHARES, { style }).renderShare(0),
        ),
        style,
      ).toBe("148x105");
  });

  it("names separate cards after their codes joined by hyphens (AUD-010-DOC005)", async () => {
    const cards = new ShareCardSet(nodeCardRenderer, SHARES, {
      style: "it",
      pageSize: "business",
      shareFormat: "words",
    });
    const names: string[] = [];
    for await (const document of cards.documents(0)) names.push(document.name);
    const words = writeShare(SHARES[0]!, "words").split(" ");
    expect(names[0]).toBe(`01-${words.slice(0, 3).join("-")}`);
    expect(names.every((name) => !name.includes(" "))).toBe(true);
  });

  it("refuses a card-sized QR card that cannot hold the codes, naming the page (AUD-010-FUN003)", async () => {
    // The deterministic shares of 256 bits: a 24-word phrase, whose Bytewords are long.
    const long = vectors.deterministic[4]!.shares;
    const card = new ShareCardSet(nodeCardRenderer, long, {
      style: "architect",
      layout: "qr",
      pageSize: "business",
      shareFormat: "ur",
    });
    await expect(card.renderShare(0)).rejects.toThrow(
      "The cards and their codes cannot fit legibly on this page; choose a larger page size, such as A6.",
    );
    // Word numbers fit beside the QR code, now that the captions decide the columns.
    const numbers = new ShareCardSet(nodeCardRenderer, long, {
      style: "architect",
      layout: "qr",
      pageSize: "business",
      shareFormat: "indexes",
    });
    expect(await pageMillimetres(await numbers.renderShare(0))).toBe("90x50");
  });

  it("takes decorative colors from a source that gives color codes only (AUD-010-API002)", () => {
    const options = { style: "it", shareFormat: "words" } as const;
    expect(() => new ShareCardSet(nodeCardRenderer, SHARES, options, () => 0)).not.toThrow();
    for (const wrong of [Number.NaN, -1, 0x1000000, 0.5])
      expect(
        () => new ShareCardSet(nodeCardRenderer, SHARES, options, () => wrong),
        String(wrong),
      ).toThrow("out of range");
  });

  it("keeps the reference line of the IT design on the card (AUD-010-UI004)", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const line = "Collection reference 01 / 16  tuna next keep  |  3872-1-2";
    const { x, size } = referencePlacement(font, line, "it");
    expect(x).toBeGreaterThanOrEqual(7.2);
    expect(x + font.widthOfTextAtSize(line, size) / MM_POINTS).toBeCloseTo(55.5, 5);
    // A short line keeps its size and ends at the same place, as before.
    expect(referencePlacement(font, "Ref. 01 / 16  #8B0C06", "it").size).toBe(6.3);
  });
});
