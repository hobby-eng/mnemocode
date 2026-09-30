import { readBoundedFile } from './bounded-read.js';
import jsQRModule from 'jsqr';
import { PNG } from 'pngjs';

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PNG_DIMENSION = 4096;
const MAX_PNG_PIXELS = 16 * 1024 * 1024;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function assertPngDimensions(bytes: Uint8Array): void {
  if (bytes.length < 24) throw new Error('The QR input is not a complete PNG file.');
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new Error('The QR input is not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) throw new Error('The QR PNG has an invalid IHDR chunk length.');
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR')
    throw new Error('The QR PNG does not begin with an IHDR chunk.');
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new Error('QR PNG dimensions must be non-zero.');
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) {
    throw new Error('QR PNG dimensions exceed the 4096 px / 16-megapixel safety limit.');
  }
}

/** Reads a QR code from a PNG file saved by the local palette exporter. */
export async function decodeQrPngFile(path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = readBoundedFile(path, MAX_PNG_BYTES, 'QR PNG input exceeds the 16 MiB safety limit.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds the 16 MiB safety limit'))
      throw error;
    throw new Error('The QR PNG input could not be read.');
  }
  assertPngDimensions(bytes);
  let image: ReturnType<typeof PNG.sync.read>;
  try {
    image = PNG.sync.read(bytes);
  } catch {
    throw new Error('The QR input is not a valid PNG file.');
  }
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
