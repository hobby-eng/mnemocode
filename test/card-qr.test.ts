import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import jsQR from 'jsqr';
import { drawCollectionQr, qrSizeMm } from '../src/export/card-qr.js';
import { MM } from '../src/export/business-layout.js';

describe('Printable card QR', () => {
  it.each([
    '#01AB63 #225531 #3E8775 #613911 #7C5809 #98BDC1 #B8E412 #E3AFE8',
    'MNC1:direct:english:' + 'abandon '.repeat(11) + 'about',
    '\ue001\ue002'.repeat(16),
  ])('decodes exact data from the rectangles actually drawn at 200 dpi %#', async (payload) => {
    const document = await PDFDocument.create();
    const page = document.addPage([85.6 * MM, 54 * MM]);
    const rectangles = vi.spyOn(page, 'drawRectangle');
    drawCollectionQr(page, payload, 5, 5, qrSizeMm(payload));

    // Small independent raster of the actual PDF drawing calls. The real method
    // still runs. Full PDF rasterization is covered by check-card-output.mjs.
    const pixelsPerPoint = 200 / 72;
    const width = Math.ceil(page.getWidth() * pixelsPerPoint);
    const height = Math.ceil(page.getHeight() * pixelsPerPoint);
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (const [rectangle] of rectangles.mock.calls) {
      const { x = 0, y = 0, width: w = 0, height: h = 0, color } = rectangle!;
      if (!color || !('red' in color)) throw new Error('Unexpected QR fill color.');
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
    expect(jsQR(pixels, width, height, { inversionAttempts: 'dontInvert' })?.data).toBe(payload);
  });

  it('rejects undersized or out-of-page codes before drawing anything', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([90 * MM, 50 * MM]);
    const rectangles = vi.spyOn(page, 'drawRectangle');
    const payload = 'public transport data '.repeat(10);
    expect(() => drawCollectionQr(page, payload, 1, 1, 5)).toThrow('too small');
    expect(() => drawCollectionQr(page, payload, -1, 1, qrSizeMm(payload))).toThrow('does not fit');
    expect(() => drawCollectionQr(page, payload, 80, 1, qrSizeMm(payload))).toThrow('does not fit');
    expect(rectangles).not.toHaveBeenCalled();
  });
});
