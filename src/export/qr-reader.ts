// The Node PNG/QR decoder shared by imported images and automatic export verification.
// Readers load before secret bytes are acquired; no image or payload is retained by this type.

import { inflateSync } from "node:zlib";
import type { PNG } from "pngjs";
import { wipedAfter } from "../core/bits.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { PngAdmission, INVALID_PNG_INPUT } from "../core/png-admission.js";
import { strictUtf8Text } from "../core/utf8-text.js";
import {
  createRasterImage,
  pixelOffset,
  QR_QUIET_MODULES,
  type QrModules,
  type RasterImage,
} from "./platform.js";

// Keep the established import refusal codes while sharing the decoder with export verification.
const ERRORS = new ErrorCatalog("cli.qr-input", {
  "invalid-png-input": () => INVALID_PNG_INPUT,
  "no-readable-qr-code-was-found-png-file": () => "No readable QR code was found in the PNG file.",
  "qr-decoder-unavailable": () => "The QR decoder could not be loaded.",
  "qr-segment-not-written": () =>
    "The QR code holds a kanji or ECI segment, which MnemoCode never writes.",
});

const VERIFICATION_ERRORS = new ErrorCatalog("export.qr-image", {
  "qr-verification-failed": () =>
    "QR verification failed: the image is unreadable or does not match the backup. It was not saved. Try creating it again.",
});

/** QR Model 2 versions 1 to 40: 21 to 177 modules, increasing by four per version. */
const MIN_QR_MODULES = 21;
const MAX_QR_MODULES = 177;
const QR_VERSION_STEP = 4;
/** Integer pixels per module keep the verification raster crisp without page-size dependence. */
const VERIFICATION_MODULE_PIXELS = 4;

interface ScannedQr {
  readonly binaryData: readonly number[];
  readonly chunks: readonly { readonly type: string }[];
}

type QrScanner = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: "attemptBoth" },
) => ScannedQr | null;

/** qrcode writes these modes without a Shift JIS converter, which MnemoCode never supplies. */
const WRITTEN_MODES: ReadonlySet<string> = new Set(["numeric", "alphanumeric", "byte"]);

function qrScanner(loaded: unknown): QrScanner {
  if (typeof loaded !== "function") throw ERRORS.create("qr-decoder-unavailable", []);
  // The function check above narrows jsQR's CommonJS default; this is its documented signature.
  return loaded as QrScanner;
}

/** Decode all segment bytes together: an invalid byte must never silently hide a code. */
function qrText(scanned: ScannedQr): string {
  if (scanned.chunks.some((chunk) => !WRITTEN_MODES.has(chunk.type)))
    throw ERRORS.create("qr-segment-not-written", []);
  return wipedAfter(Uint8Array.from(scanned.binaryData), (bytes) =>
    strictUtf8Text(bytes, "The QR code"),
  );
}

/**
 * A lazily loaded Node PNG/QR reader with bounded PNG admission and strict UTF-8 segment decoding.
 * It retains decoder functions only. read borrows the image bytes; its caller wipes them, while
 * the reader wipes its temporary inflation and decoded pixels even on refusal. Copies retained
 * internally by pngjs/jsQR and strings cannot be recalled or guaranteed erased.
 */
export class QrPngReader {
  readonly #reader: typeof PNG;
  readonly #scan: QrScanner;

  private constructor(reader: typeof PNG, scan: QrScanner) {
    this.#reader = reader;
    this.#scan = scan;
  }

  /** Creates a reader from loaded host codecs; refuses a missing scanner with qr-decoder-unavailable. */
  static withScanner(reader: typeof PNG, scan: unknown): QrPngReader {
    return new QrPngReader(reader, qrScanner(scan));
  }

  /** Loads before secret bytes are acquired; a missing scanner fails with qr-decoder-unavailable. */
  static async load(): Promise<QrPngReader> {
    const [{ PNG: reader }, { default: scan }] = await Promise.all([
      import("pngjs"),
      import("jsqr"),
    ]);
    return QrPngReader.withScanner(reader, scan);
  }

  /** Compares a PNG with its exact payload before publication; refuses qr-verification-failed. */
  assertImage(bytes: Uint8Array, expected: string): void {
    this.#assertExpected(() => this.read(bytes), expected);
  }

  /**
   * Verifies a stable QR matrix before PDF/image rendering, independently of A4/A5/A6 placement.
   * Invalid dimensions, unreadable symbols and mismatches fail with qr-verification-failed.
   * The temporary RGBA raster is wiped; the returned matrix is the borrowed matrix unchanged.
   */
  checkedModules(qr: QrModules, expected: string): QrModules {
    this.#assertExpected(() => {
      if (
        !Number.isInteger(qr.size) ||
        qr.size < MIN_QR_MODULES ||
        qr.size > MAX_QR_MODULES ||
        (qr.size - MIN_QR_MODULES) % QR_VERSION_STEP !== 0
      )
        throw VERIFICATION_ERRORS.create("qr-verification-failed", []);
      const side = (qr.size + QR_QUIET_MODULES * 2) * VERIFICATION_MODULE_PIXELS;
      const image = createRasterImage(side, side);
      return wipedAfter(image.data, (pixels) => {
        pixels.fill(255);
        for (let row = 0; row < qr.size; row++)
          for (let col = 0; col < qr.size; col++) {
            if (!qr.get(row, col)) continue;
            for (let y = 0; y < VERIFICATION_MODULE_PIXELS; y++)
              for (let x = 0; x < VERIFICATION_MODULE_PIXELS; x++) {
                const at = pixelOffset(
                  image,
                  (col + QR_QUIET_MODULES) * VERIFICATION_MODULE_PIXELS + x,
                  (row + QR_QUIET_MODULES) * VERIFICATION_MODULE_PIXELS + y,
                );
                pixels[at] = 0;
                pixels[at + 1] = 0;
                pixels[at + 2] = 0;
              }
          }
        return this.#readPixels(image);
      });
    }, expected);
    return qr;
  }

  #assertExpected(read: () => string, expected: string): void {
    let matches: boolean;
    try {
      matches = read() === expected;
    } catch (error) {
      throw VERIFICATION_ERRORS.create("qr-verification-failed", [], { cause: error });
    }
    if (!matches) throw VERIFICATION_ERRORS.create("qr-verification-failed", []);
  }

  #readPixels(image: RasterImage): string {
    const pixels = image.data;
    const decoded = this.#scan(
      new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      image.width,
      image.height,
      { inversionAttempts: "attemptBoth" },
    );
    if (decoded === null) throw ERRORS.create("no-readable-qr-code-was-found-png-file", []);
    return qrText(decoded);
  }

  /**
   * Reads borrowed PNG bytes after PngAdmission's dimension/sample/scanline limits. Malformed,
   * unreadable inputs fail with invalid-png-input or no-readable-qr-code-was-found-png-file;
   * unsupported-segment and invalid UTF-8 inputs retain their established refusal codes.
   */
  read(bytes: Uint8Array): string {
    const admitted = PngAdmission.read(bytes);
    let image: ReturnType<typeof PNG.sync.read>;
    try {
      // pngjs bounds only noninterlaced inflation; check the exact budget before pixel allocation.
      wipedAfter(admitted.compressedData(), (compressed) => {
        wipedAfter(
          inflateSync(compressed, { maxOutputLength: admitted.filteredBytes }),
          (filtered) => {
            admitted.assertInflatedSize(filtered.length);
          },
        );
      });
      image = this.#reader.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    } catch {
      throw ERRORS.create("invalid-png-input", []);
    }
    return wipedAfter(image.data, () => this.#readPixels(image));
  }
}
