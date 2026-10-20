import { readFileOrRefuse } from "./bounded-read.js";
import { MAX_PNG_BYTES, PngAdmission, INVALID_PNG_INPUT } from "../core/png-admission.js";
import { inflateSync } from "node:zlib";
// The QR decoder and the PNG reader are loaded only when a QR code is read, so that a command
// that reads none starts without the QR decoder (AUD-012-ARC002). The PNG reader is also the one
// that the cards are drawn with (export/platform-node.ts), which a command that draws loads anyway.
import type { PNG } from "pngjs";
import { wipedAfter } from "../core/bits.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { strictUtf8Text } from "./utf8.js";

const ERRORS = new ErrorCatalog("cli.qr-input", {
  "invalid-png-input": () => INVALID_PNG_INPUT,
  "no-readable-qr-code-was-found-png-file": () => "No readable QR code was found in the PNG file.",
  "qr-decoder-unavailable": () => "The QR decoder could not be loaded.",
  "qr-segment-not-written": () =>
    "The QR code holds a kanji or ECI segment, which MnemoCode never writes.",
});

/** What jsQR finds in an image (QRCode in jsqr/dist/index.d.ts): the parts read here. */
interface ScannedQr {
  /** The bytes of every segment, in their order; numeric and alphanumeric ones as ASCII. */
  readonly binaryData: readonly number[];
  /** The segments, each with its mode: numeric, alphanumeric, byte, kanji or eci. */
  readonly chunks: readonly { readonly type: string }[];
}

/** jsQR's scanner, its default export (jsqr/dist/index.d.ts): the code in an image, or null. */
type QrScanner = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: "attemptBoth" },
) => ScannedQr | null;

/**
 * The modes of the segments that the QR exporter writes (qrcode, export/qr-image.ts), which picks
 * them for the text; it writes kanji only with a Shift JIS converter, which it is not given, and no
 * ECI segment.
 */
const WRITTEN_MODES: ReadonlySet<string> = new Set(["numeric", "alphanumeric", "byte"]);

/** What a refusal names the QR code's text by (notUtf8Text). */
const QR_TEXT = "The QR code";

/**
 * jsQR's scanner from its module's default export, refused when that is no function: jsQR ships a
 * legacy CommonJS wrapper, whose NodeNext import type is a namespace though the export is the
 * scanner.
 */
function qrScanner(loaded: unknown): QrScanner {
  if (typeof loaded !== "function") throw ERRORS.create("qr-decoder-unavailable", []);
  // Checked above to be a function; its parameters and result are jsQR's (jsqr/dist/index.d.ts).
  return loaded as QrScanner;
}

/**
 * The text of a QR code, decoded here from the bytes of its segments: jsQR's own text leaves out
 * a byte segment that is not UTF-8 without a word, so that two different codes would read as one
 * (CORE-48). A segment of a mode that MnemoCode never writes is refused, and so are bytes that are
 * not UTF-8, as in a file (strictUtf8Text, AUD-014-API002). The copy of the bytes is wiped.
 */
function qrText(scanned: ScannedQr): string {
  if (scanned.chunks.some((chunk) => !WRITTEN_MODES.has(chunk.type)))
    throw ERRORS.create("qr-segment-not-written", []);
  return wipedAfter(Uint8Array.from(scanned.binaryData), (bytes) => strictUtf8Text(bytes, QR_TEXT));
}

/**
 * Reads a QR code from a PNG file saved by the local palette exporter. The image holds an encoded
 * backup or a share, so the file's bytes and the decoded pixels are wiped once the code is read,
 * also when it is refused, as a text input is (AUD-018-SEC001), and so is the trial inflation that
 * checks the scanline budget. The code's text is decoded strictly from its bytes (qrText). What the
 * libraries keep inside cannot be wiped: pngjs's compressed, inflated and unfiltered buffers,
 * jsQR's working copies and the text and bytes it returns.
 */
export async function decodeQrPngFile(path: string): Promise<string> {
  // Loaded first, so that the secret bytes are read, decoded and wiped in one step without a wait.
  const [{ PNG: reader }, { default: jsQRModule }] = await Promise.all([
    import("pngjs"),
    import("jsqr"),
  ]);
  const scan = qrScanner(jsQRModule);
  const bytes = readFileOrRefuse(path, MAX_PNG_BYTES, "The QR PNG input");
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
      throw ERRORS.create("invalid-png-input", []);
    }
    return wipedAfter(image.data, (pixels) => {
      const decoded = scan(
        new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        image.width,
        image.height,
        { inversionAttempts: "attemptBoth" },
      );
      if (decoded === null) throw ERRORS.create("no-readable-qr-code-was-found-png-file", []);
      return qrText(decoded);
    });
  });
}
