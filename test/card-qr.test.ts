import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import jsQRModule from "jsqr";
import { drawCollectionQr, MIN_MODULE_MM, qrSizeForModuleMm } from "../src/export/card-qr.js";
import { MM } from "../src/export/business-layout.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

/** jsQR's scanner (jsqr/dist/index.d.ts): the parts of its options and result read here. */
type Scanner = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" },
) => { data: string } | null;

/**
 * Whether `loaded` is jsQR's scanner. The compilers type the default import of jsQR's CommonJS
 * wrapper differently under NodeNext, tsc as the module and the linter's as the scanner; at run
 * time it is the scanner, which src/cli/qr-input.ts checks the same way.
 */
function isScanner(loaded: unknown): loaded is Scanner {
  return typeof loaded === "function";
}

const jsQR: unknown = jsQRModule;
if (!isScanner(jsQR)) throw new Error("jsQR's default export is no function.");

describe("Printable card QR", () => {
  it.each([
    ["#01AB63 #225531 #3E8775 #613911 #7C5809 #98BDC1 #B8E412 #E3AFE8", 28],
    ["MNC1:direct:english:" + "abandon ".repeat(11) + "about", 28],
    ["\ue001\ue002".repeat(16), 28],
    ["#01AB63", 15],
  ] as const)(
    "decodes exact data from the rectangles actually drawn at 200 dpi %#",
    async (payload, minimum) => {
      const document = await PDFDocument.create();
      const page = document.addPage([85.6 * MM, 54 * MM]);
      const rectangles = vi.spyOn(page, "drawRectangle");
      // The matrix the Node.js platform makes, which every host's qrModules gives too.
      const code = nodeRenderPlatform.qrModules(payload);
      drawCollectionQr(page, code, 5, 5, qrSizeForModuleMm(code, minimum, MIN_MODULE_MM));

      // Small independent raster of the actual PDF drawing calls. The real method
      // still runs. Full PDF rasterization is covered by check-card-output.mjs.
      const pixelsPerPoint = 200 / 72;
      const width = Math.ceil(page.getWidth() * pixelsPerPoint);
      const height = Math.ceil(page.getHeight() * pixelsPerPoint);
      const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
      for (const [rectangle] of rectangles.mock.calls) {
        const { x = 0, y = 0, width: w = 0, height: h = 0, color } = rectangle!;
        if (!color || !("red" in color)) throw new Error("Unexpected QR fill color.");
        const left = Math.round(x * pixelsPerPoint);
        const right = Math.round((x + w) * pixelsPerPoint);
        const top = Math.round((page.getHeight() - y - h) * pixelsPerPoint);
        const bottom = Math.round((page.getHeight() - y) * pixelsPerPoint);
        for (let row = top; row < bottom; row++) {
          for (let column = left; column < right; column++) {
            const offset = (row * width + column) * 4;
            pixels[offset] = Math.round(color.red * 255);
            pixels[offset + 1] = Math.round(color.green * 255);
            pixels[offset + 2] = Math.round(color.blue * 255);
          }
        }
      }
      expect(jsQR(pixels, width, height, { inversionAttempts: "dontInvert" })?.data).toBe(payload);
    },
  );

  it("rejects undersized or out-of-page codes before drawing anything", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([90 * MM, 50 * MM]);
    const rectangles = vi.spyOn(page, "drawRectangle");
    const code = nodeRenderPlatform.qrModules("public transport data ".repeat(10));
    expect(() => drawCollectionQr(page, code, 1, 1, 5)).toThrow("too small");
    expect(() =>
      drawCollectionQr(page, code, -1, 1, qrSizeForModuleMm(code, 28, MIN_MODULE_MM)),
    ).toThrow("does not fit");
    expect(() =>
      drawCollectionQr(page, code, 80, 1, qrSizeForModuleMm(code, 28, MIN_MODULE_MM)),
    ).toThrow("does not fit");
    expect(rectangles).not.toHaveBeenCalled();
  });
});
