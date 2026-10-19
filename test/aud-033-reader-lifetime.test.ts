import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { CardPdfReader, readCardPages, type CardPageDrawing } from "../src/export/card-drawing.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

const PNG_COMPRESSION_LEVEL = 6;

afterEach(() => vi.restoreAllMocks());

async function imagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const png = nodeRenderPlatform.encodePng(
    { width: 1, height: 1, data: Uint8Array.of(20, 60, 90, 128) },
    PNG_COMPRESSION_LEVEL,
  );
  try {
    const image = await document.embedPng(png);
    document.addPage([20, 20]).drawImage(image, { x: 0, y: 0, width: 20, height: 20 });
    return await document.save();
  } finally {
    png.fill(0);
  }
}

function firstImage(pages: readonly CardPageDrawing[]) {
  const step = pages.flatMap((page) => page.steps).find((item) => item.do === "image");
  if (step?.do !== "image") throw new Error("The public PDF fixture must contain an image.");
  return step.image;
}

describe("the reusable card reader's owned image lifetime", () => {
  it.each(["wipe", "dispose"] as const)(
    "overwrites cached private pixels after %s without changing borrowed input",
    async (method) => {
      const input = Buffer.from(await imagePdf());
      const before = Buffer.from(input);
      const reader = await CardPdfReader.load(input);
      const image = firstImage(reader.pages());
      expect([...image.data]).toEqual([20, 60, 90]);
      expect([...image.alpha!]).toEqual([128]);
      const end: unknown = Reflect.get(reader, method === "wipe" ? "wipe" : Symbol.dispose);
      if (typeof end === "function") {
        Reflect.apply(end, reader, []);
        Reflect.apply(end, reader, []);
      }
      expect(image.data.every((byte) => byte === 0)).toBe(true);
      expect(image.alpha?.every((byte) => byte === 0)).toBe(true);
      expect(input).toEqual(before);
      expect(() => reader.pages()).toThrow(
        expect.objectContaining({ code: "export.card-drawing.reader-wiped" }),
      );
      input.fill(0);
      before.fill(0);
    },
  );

  it("ends a one-shot reader but transfers independently live image buffers to its caller", async () => {
    const input = await imagePdf();
    const load = vi.spyOn(CardPdfReader, "load");
    const pages = await readCardPages(input);
    const returned = load.mock.results[0]!;
    if (returned.type !== "return") throw new Error("The real reader factory must return.");
    const reader = await returned.value;
    const image = firstImage(pages);
    try {
      expect([...image.data]).toEqual([20, 60, 90]);
      expect([...image.alpha!]).toEqual([128]);
      expect(() => reader.pages()).toThrow(
        expect.objectContaining({ code: "export.card-drawing.reader-wiped" }),
      );
    } finally {
      image.data.fill(0);
      image.alpha?.fill(0);
      input.fill(0);
    }
  });

  it("transfers cached aliases together and refuses a second transfer", async () => {
    const input = await imagePdf();
    using reader = await CardPdfReader.load(input);
    const borrowed = firstImage(reader.pages());
    const transferred = firstImage(reader.takePages());
    expect(transferred).toBe(borrowed);
    expect(Object.isFrozen(transferred)).toBe(true);
    expect([...transferred.data]).toEqual([20, 60, 90]);
    expect(() => reader.takePages()).toThrow(
      expect.objectContaining({ code: "export.card-drawing.reader-wiped" }),
    );
    transferred.data.fill(0);
    transferred.alpha?.fill(0);
    input.fill(0);
  });

  it("owns JPEG bytes separately from a caller's Buffer-backed PDF", async () => {
    const document = await PDFDocument.create();
    const jpeg = await nodeRenderPlatform.readAsset("images/material-tile.jpg");
    const embedded = await document.embedJpg(jpeg);
    document.addPage([20, 20]).drawImage(embedded);
    const input = Buffer.from(await document.save());
    const before = Buffer.from(input);
    const reader = await CardPdfReader.load(input);
    const image = firstImage(reader.pages());
    expect(image.format).toBe("jpeg");
    expect(image.data).toEqual(Uint8Array.from(jpeg));
    reader.wipe();
    expect(image.data.every((byte) => byte === 0)).toBe(true);
    expect(input).toEqual(before);
    input.fill(0);
    before.fill(0);
    jpeg.fill(0);
  });

  it("retires an already decoded RGB image immediately when its mask is refused", async () => {
    const document = await PDFDocument.load(await imagePdf());
    const resources = document.getPage(0).node.Resources();
    if (resources === undefined) throw new Error("The fixture must have image resources.");
    const reference = resources.lookup(PDFName.of("XObject"), PDFDict).entries()[0]![1];
    const stream = document.context.lookup(reference);
    if (!(stream instanceof PDFRawStream)) throw new Error("The fixture image must be a stream.");
    stream.dict.set(PDFName.of("SMask"), PDFNumber.of(7));
    const input = await document.save();
    const cleared: Uint8Array[] = [];
    const fill: unknown = Reflect.get(Uint8Array.prototype, "fill");
    if (typeof fill !== "function") throw new Error("The native byte-fill method must exist.");
    vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (
      this: Uint8Array,
      value,
      start,
      end,
    ) {
      const privateImage =
        value === 0 && this.length === 3 && this[0] === 20 && this[1] === 60 && this[2] === 90;
      Reflect.apply(fill, this, [value, start, end]);
      if (privateImage) cleared.push(this);
      return this;
    });
    using reader = await CardPdfReader.load(input);
    expect(() => reader.pages()).toThrow("transparency of an image");
    expect(cleared).toHaveLength(1);
    expect([...cleared[0]!]).toEqual([0, 0, 0]);
    input.fill(0);
  });
});
