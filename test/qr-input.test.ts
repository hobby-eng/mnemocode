// The text of a QR code is decoded from the bytes of its segments (CORE-48): two codes that differ
// never read alike. Public data only: the word numbers of "abandon … about".

import { execFileSync } from "node:child_process";
import QRCode, { type QRCodeSegment } from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { testPath } from "./helpers/test-folders.js";

/** "abandon" eleven times, then "about", as word numbers: public test data. */
const WORD_NUMBERS = `${"0001 ".repeat(11)}0004`;

afterEach(() => {
  vi.doUnmock("jsqr");
  vi.resetModules();
});

/** A new path in a folder of its own, which the test removes. */
async function newPath(name: string): Promise<string> {
  return testPath("mnemocode-qr-input-", name);
}

/** A QR code image of `segments`, each in the mode it names, as another tool may write one. */
async function qrImage(segments: QRCodeSegment[]): Promise<string> {
  const path = await newPath("public.png");
  await QRCode.toFile(path, segments, { type: "png" });
  return path;
}

/**
 * A QR code image of one kanji segment, the ideographic space (U+3000, 0x8140 in Shift JIS, the
 * first code of the kanji mode). Drawn by another process: qrcode keeps the Shift JIS converter
 * that the kanji mode needs for as long as its module lives, and would then write kanji for the
 * other tests too.
 */
async function kanjiImage(): Promise<string> {
  const path = await newPath("public.png");
  const draw = `require("qrcode").toFile(process.argv[1], [{ data: "\\u3000", mode: "kanji" }], { type: "png", toSJISFunc: () => 0x8140 })`;
  execFileSync(process.execPath, ["-e", draw, path]);
  return path;
}

describe("the text of a QR code", () => {
  it("is the bytes of all its segments, decoded as UTF-8", async () => {
    expect(
      await decodeQrPngFile(await qrImage([{ data: WORD_NUMBERS, mode: "alphanumeric" }])),
    ).toBe(WORD_NUMBERS);
    // é (C3 A9) split over two byte segments, neither of them UTF-8 alone.
    const split = await qrImage([
      { data: "MNC1 ", mode: "alphanumeric" },
      { data: Uint8Array.of(0xc3), mode: "byte" },
      { data: Uint8Array.of(0xa9), mode: "byte" },
    ]);
    expect(await decodeQrPngFile(split)).toBe("MNC1 é");
  });

  it.each([
    ["after the word numbers", [0xff, 0xfe, 0x41], false],
    ["between the word numbers, hiding a code", [0x20, 0x39, 0x39, 0xc3], true],
  ])("refuses a byte segment that is not UTF-8 %s", async (_, bytes, between) => {
    const half = WORD_NUMBERS.length / 2;
    const segments: QRCodeSegment[] = between
      ? [
          { data: WORD_NUMBERS.slice(0, half), mode: "alphanumeric" },
          { data: Uint8Array.from(bytes), mode: "byte" },
          { data: WORD_NUMBERS.slice(half), mode: "alphanumeric" },
        ]
      : [
          { data: WORD_NUMBERS, mode: "alphanumeric" },
          { data: Uint8Array.from(bytes), mode: "byte" },
        ];
    await expect(decodeQrPngFile(await qrImage(segments))).rejects.toMatchObject({
      code: "cli.utf8.strict-utf8text-refused",
      message: "The QR code is not valid UTF-8 text.",
    });
  });

  it("refuses a kanji segment, which MnemoCode never writes", async () => {
    const path = await kanjiImage();
    await expect(decodeQrPngFile(path)).rejects.toMatchObject({
      code: "cli.qr-input.qr-segment-not-written",
      message: "The QR code holds a kanji or ECI segment, which MnemoCode never writes.",
    });
  });

  it("refuses a QR decoder that is no function before it reads the file", async () => {
    vi.doMock("jsqr", () => ({ default: {} }));
    vi.resetModules();
    const { decodeQrPngFile: decodeWithout } = await import("../src/cli/qr-input.js");
    // The file does not exist: its refusal would come first if the file were read first.
    await expect(decodeWithout(await newPath("missing.png"))).rejects.toMatchObject({
      code: "cli.qr-input.qr-decoder-unavailable",
      message: "The QR decoder could not be loaded.",
    });
  });
});
