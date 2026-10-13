import { readFileOrRefuse } from "./bounded-read.js";
import { MAX_PNG_BYTES, MAX_PNG_DIMENSION, MAX_PNG_PIXELS, MEGAPIXEL } from "./qr-limits.js";
// The QR decoder and the PNG reader are loaded only when a QR code is read, so that a command
// that reads none starts without the QR decoder (AUD-012-ARC002). The PNG reader is also the one
// that the cards are drawn with (export/platform-node.ts), which a command that draws loads anyway.
import type { PNG } from "pngjs";
import { equalBytes, wipedAfter } from "../core/bits.js";

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
/**
 * The start of a PNG file after its signature (PNG specification, 11.2.2): the IHDR chunk, its
 * data 13 bytes long, whose first two fields are the width and the height, each four bytes.
 */
const IHDR = Object.freeze({
  lengthAt: PNG_SIGNATURE.length,
  length: 13,
  typeAt: PNG_SIGNATURE.length + 4,
  widthAt: PNG_SIGNATURE.length + 8,
  heightAt: PNG_SIGNATURE.length + 12,
});
/** The bytes up to the end of the height, which the checks below read. */
const DIMENSIONS_END = IHDR.heightAt + 4;

function assertPngDimensions(bytes: Uint8Array): void {
  if (bytes.length < DIMENSIONS_END) throw new Error("The QR input is not a complete PNG file.");
  if (!equalBytes(bytes.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE))
    throw new Error("The QR input is not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(IHDR.lengthAt) !== IHDR.length)
    throw new Error("The QR PNG has an invalid IHDR chunk length.");
  if (String.fromCharCode(...bytes.subarray(IHDR.typeAt, IHDR.widthAt)) !== "IHDR")
    throw new Error("The QR PNG does not begin with an IHDR chunk.");
  const width = view.getUint32(IHDR.widthAt);
  const height = view.getUint32(IHDR.heightAt);
  if (width === 0 || height === 0) throw new Error("QR PNG dimensions must be non-zero.");
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) {
    throw new Error(
      `QR PNG dimensions exceed the ${MAX_PNG_DIMENSION} px / ${MAX_PNG_PIXELS / MEGAPIXEL}-megapixel safety limit.`,
    );
  }
}

/**
 * Reads a QR code from a PNG file saved by the local palette exporter. The image holds an encoded
 * backup or a share, so the file's bytes and the decoded pixels are wiped once the code is read,
 * also when it is refused, as a text input is (AUD-018-SEC001). jsQR's own working copies and the
 * text it returns cannot be wiped.
 */
export async function decodeQrPngFile(path: string): Promise<string> {
  // Loaded first, so that the secret bytes are read, decoded and wiped in one step without a wait.
  const [{ PNG: reader }, { default: jsQRModule }] = await Promise.all([
    import("pngjs"),
    import("jsqr"),
  ]);
  // jsQR ships a legacy CommonJS wrapper whose NodeNext import type is exposed
  // as a namespace despite its runtime default export being the scanner.
  const scan = jsQRModule as unknown as (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: { inversionAttempts: "attemptBoth" },
  ) => { data: string } | null;
  const bytes = readFileOrRefuse(
    path,
    MAX_PNG_BYTES,
    "QR PNG input",
    "The QR PNG input could not be read.",
  );
  return wipedAfter(bytes, () => {
    assertPngDimensions(bytes);
    let image: ReturnType<typeof PNG.sync.read>;
    try {
      image = reader.sync.read(bytes);
    } catch {
      throw new Error("The QR input is not a valid PNG file.");
    }
    return wipedAfter(image.data, (pixels) => {
      const decoded = scan(
        new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        image.width,
        image.height,
        { inversionAttempts: "attemptBoth" },
      );
      if (decoded === null) throw new Error("No readable QR code was found in the PNG file.");
      return decoded.data;
    });
  });
}
