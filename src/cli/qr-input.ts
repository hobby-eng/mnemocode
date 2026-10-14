import { readFileOrRefuse } from "./bounded-read.js";
import { MAX_PNG_BYTES, PngAdmission, INVALID_PNG_INPUT } from "../core/png-admission.js";
import { inflateSync } from "node:zlib";
// The QR decoder and the PNG reader are loaded only when a QR code is read, so that a command
// that reads none starts without the QR decoder (AUD-012-ARC002). The PNG reader is also the one
// that the cards are drawn with (export/platform-node.ts), which a command that draws loads anyway.
import type { PNG } from "pngjs";
import { wipedAfter } from "../core/bits.js";

/**
 * Reads a QR code from a PNG file saved by the local palette exporter. The image holds an encoded
 * backup or a share, so the file's bytes and the decoded pixels are wiped once the code is read,
 * also when it is refused, as a text input is (AUD-018-SEC001), and so is the trial inflation that
 * checks the scanline budget. What the libraries keep inside cannot be wiped: pngjs's compressed,
 * inflated and unfiltered buffers, jsQR's working copies and the text it returns.
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
    const admitted = PngAdmission.read(bytes);
    let image: ReturnType<typeof PNG.sync.read>;
    try {
      // pngjs bounds only noninterlaced inflation. Validate the same input's exact scanline
      // budget first, and wipe this temporary expansion before the decoder allocates pixels.
      wipedAfter(admitted.compressedData(), (compressed) => {
        wipedAfter(
          inflateSync(compressed, { maxOutputLength: admitted.filteredBytes }),
          (filtered) => {
            admitted.assertInflatedSize(filtered.length);
          },
        );
      });
      image = reader.sync.read(bytes);
    } catch {
      throw new Error(INVALID_PNG_INPUT);
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
