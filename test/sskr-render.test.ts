import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { referencePlacement } from "../src/export/business-cards.js";
import { ownShareCards, ShareCardSet } from "../src/export/sskr-render.js";
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
    const cards = await ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it" });
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

  it("tells the QR code that each share's sheets print, which a host may save as an image", async () => {
    // None without a QR code on the sheets, and none for separate cards, which never carry one.
    expect((await ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it" })).qrCodes).toEqual(
      [],
    );
    const separate = await ShareCardSet.create(nodeCardRenderer, SHARES, {
      style: "it",
      pageSize: "business",
      cardQr: true,
    });
    expect(separate.qrCodes).toEqual([]);
    const codes = (
      await ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it", cardQr: true })
    ).qrCodes;
    expect(codes.map((code) => code.reference)).toEqual(["376C-1-1", "376C-1-2", "376C-1-3"]);
    expect(codes.map((code) => code.name)).toEqual(
      ["376C-1-1", "376C-1-2", "376C-1-3"].map((reference) => `collection-${reference}`),
    );
    // Each holds its share alone, without the decoys, which the ordinary reader reads back.
    expect(codes.map((code) => readShare(code.payload).ur)).toEqual(SHARES);
    expect(codes[0]!.payload).toBe(writeShare(SHARES[0]!, "colors"));
    // A document of QR codes prints one for each share as well.
    expect(
      (await ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it", layout: "qr" })).qrCodes,
    ).toHaveLength(3);
  });

  it("prints a share in Unicode codes one to a card, one color for each distinct code", async () => {
    const cards = await ShareCardSet.create(nodeCardRenderer, SHARES, {
      style: "it",
      cardQr: true,
      shareFormat: "unicode",
    });
    const codes = writeShare(SHARES[0]!, "unicode").split(" ");
    const printed = cards.printedCodes(0);
    // The share's codes first, in their order, then at least one decoy of the same look.
    expect(cards.ownCodes(0)).toBe(codes.length);
    expect(ownShareCards(SHARES[0]!, "unicode")).toBe(codes.length);
    expect(printed.slice(0, codes.length)).toEqual(codes);
    expect(printed.length).toBeGreaterThan(codes.length);
    for (const decoy of printed.slice(codes.length)) expect(decoy).toMatch(/^[0-9A-F]{4}$/u);
    // The QR code holds the share alone.
    expect(cards.qrCodes[0]!.payload).toBe(codes.join(" "));
    expect(readShare(cards.qrCodes[0]!.payload).ur).toBe(SHARES[0]);
    // The colors print as themselves in the color forms, before their decoys.
    const colors = shareToColors(SHARES[0]!).map((color) => color.slice(1).toUpperCase());
    const inColors = await ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it" });
    expect(inColors.printedCodes(0).slice(0, colors.length)).toEqual(colors);
    expect(inColors.ownCodes(0)).toBe(colors.length);
    // Rendered in every design family.
    for (const style of ["it", "tile"] as const) {
      const set = await ShareCardSet.create(nodeCardRenderer, SHARES, {
        style,
        shareFormat: "unicode",
      });
      expect((await set.renderShare(0)).length, style).toBeGreaterThan(0);
    }
  });

  it("refuses cards of shares in word numbers, Bytewords or a UR, which have none", async () => {
    for (const shareFormat of ["indexes", "words", "ur"] as const) {
      await expect(
        ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it", shareFormat }),
        shareFormat,
      ).rejects.toThrow(`Shares written as ${shareFormat} have no cards`);
      expect(ownShareCards(SHARES[0]!, shareFormat)).toBeUndefined();
    }
  });

  it("gives separate cards one document per card, decoys too, kept in a folder of the share", async () => {
    const cards = await ShareCardSet.create(nodeCardRenderer, [SHARES[0]!], {
      style: "it",
      pageSize: "business",
    });
    const [share] = cards.shares;
    const colors = shareToColors(SHARES[0]!);
    expect(share!.documents).toBe(cards.printedCodes(0).length);
    expect(share!.documents).toBeGreaterThan(colors.length);
    expect(share).toMatchObject({
      reference: "376C-1-1",
      name: "collection-376C-1-1",
      folder: "collection-376C-1-1",
    });
    // Rendered one at a time: the first two, named after their places and their colors.
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

  it("checks the layout, the style and the shares before anything is rendered", async () => {
    await expect(
      ShareCardSet.create(nodeCardRenderer, SHARES, { style: "it", layout: "bad" as never }),
    ).rejects.toThrow("The card layout must be one of: qr, collection, individual.");
    await expect(
      ShareCardSet.create(nodeCardRenderer, SHARES, { style: "nonsense" as never }),
    ).rejects.toThrow("Unsupported SSKR card style.");
    await expect(
      ShareCardSet.create(nodeCardRenderer, SHARES, {
        style: "it",
        pageSize: "business",
        layout: "collection",
      }),
    ).rejects.toThrow("The business page size gives separate cards.");
    await expect(
      ShareCardSet.create(nodeCardRenderer, [SHARES[0]!, SHARES[0]!], { style: "it" }),
    ).rejects.toThrow("The same SSKR member was supplied more than once.");
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
    for (const style of ["tile", "it"] as const) {
      const set = await ShareCardSet.create(nodeCardRenderer, SHARES, {
        style,
        orientation: "landscape",
      });
      expect(await pageMillimetres(await set.renderShare(0)), style).toBe("148x105");
    }
  });

  it("names separate cards after their codes (AUD-010-DOC005)", async () => {
    const cards = await ShareCardSet.create(nodeCardRenderer, SHARES, {
      style: "it",
      pageSize: "business",
      shareFormat: "unicode",
    });
    const names: string[] = [];
    for await (const document of cards.documents(0)) names.push(document.name);
    const codes = writeShare(SHARES[0]!, "unicode").split(" ");
    expect(names[0]).toBe(`01-${codes[0]}`);
    expect(names.every((name) => !name.includes(" "))).toBe(true);
  });

  it("refuses a sheet that cannot hold the codes, naming the page (AUD-010-FUN003)", async () => {
    // The deterministic shares of 256 bits: a 24-word phrase, whose Unicode codes are many; one
    // code to a card, they fit beside the QR code of a card-sized page, as the colors do.
    const long = vectors.deterministic[4]!.shares;
    for (const shareFormat of ["unicode", "colors"] as const) {
      const card = await ShareCardSet.create(nodeCardRenderer, long, {
        style: "architect",
        layout: "qr",
        pageSize: "business",
        shareFormat,
      });
      // Turned the way the cards are largest.
      const page = await pageMillimetres(await card.renderShare(0));
      expect(["90x50", "50x90"], shareFormat).toContain(page);
    }
    // More cards than any layout holds on the page are refused with the page named.
    const { planCollectionSheet } = await import("../src/export/collection-sheet.js");
    const { businessSheetShape } = await import("../src/export/business-cards.js");
    const content = {
      kind: "colors",
      colors: Array<string>(64).fill("#000000"),
      payload: "",
    } as const;
    const shape = await businessSheetShape(nodeCardRenderer, content);
    expect(() =>
      planCollectionSheet({ pageSize: "business" }, 60, 64, shape, nodeCardRenderer.qrModules("x")),
    ).toThrow(
      "The cards and their codes cannot fit legibly on this page; choose a larger page size, such as A6.",
    );
  });

  it("takes decoys from a source that gives numbers in range only (AUD-010-API002)", async () => {
    const options = { style: "it", shareFormat: "unicode" } as const;
    await expect(
      ShareCardSet.create(nodeCardRenderer, SHARES, options, () => 0),
    ).resolves.toBeDefined();
    for (const wrong of [Number.NaN, -1, 0x1000000, 0.5])
      await expect(
        ShareCardSet.create(nodeCardRenderer, SHARES, options, () => wrong),
        String(wrong),
      ).rejects.toThrow("out of range");
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
