import { readFileOrRefuse } from "./bounded-read.js";
import { MAX_PNG_BYTES } from "../core/png-admission.js";
import { wipedAfter } from "../core/bits.js";
import { QrPngReader } from "../export/qr-reader.js";

/**
 * Reads a bounded local PNG with the shared strict QR reader. File bytes and decoder pixels are
 * wiped on success and refusal; the reader loads before file bytes are acquired. Third-party
 * decoder copies and returned text cannot be guaranteed erased.
 */
export async function decodeQrPngFile(path: string): Promise<string> {
  const reader = await QrPngReader.load();
  const bytes = readFileOrRefuse(path, MAX_PNG_BYTES, "The QR PNG input");
  return wipedAfter(bytes, (image) => reader.read(image));
}
