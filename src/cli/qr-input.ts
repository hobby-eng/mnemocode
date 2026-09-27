import { readFile, stat } from 'node:fs/promises';
import jsQRModule from 'jsqr';
import { PNG } from 'pngjs';

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PNG_DIMENSION = 4096;
const MAX_PNG_PIXELS = 16 * 1024 * 1024;

function assertPngDimensions(bytes: Uint8Array): void {
  if (bytes.length < 24) throw new Error('The QR input is not a complete PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width === 0 ||
    height === 0 ||
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS
  ) {
    throw new Error('QR PNG dimensions exceed the 4096 px / 16-megapixel safety limit.');
  }
}

/** Reads a QR code from a PNG file saved by the local palette exporter. */
export async function decodeQrPngFile(path: string): Promise<string> {
  if ((await stat(path)).size > MAX_PNG_BYTES)
    throw new Error('QR PNG input exceeds the 16 MiB safety limit.');
  const bytes = await readFile(path);
  assertPngDimensions(bytes);
  const image = PNG.sync.read(bytes);
  // jsQR ships a legacy CommonJS wrapper whose NodeNext import type is exposed
  // as a namespace despite its runtime default export being the scanner.
  const scan = jsQRModule as unknown as (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: { inversionAttempts: 'attemptBoth' },
  ) => { data: string } | null;
  const decoded = scan(
    new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    image.width,
    image.height,
    { inversionAttempts: 'attemptBoth' },
  );
  if (decoded === null) throw new Error('No readable QR code was found in the PNG file.');
  return decoded.data;
}
