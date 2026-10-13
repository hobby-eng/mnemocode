// A QR code as a PNG image file: the encoded backup or a share, which Decode and Restore read back
// (--qr-file, --share-qr). Drawn with the qrcode package of Node.js; a page draws its own.

import QRCode from "qrcode";
import { publishNewPrivateFile } from "./private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { QR_ERROR_CORRECTION_LEVEL } from "./platform.js";

/** Pixels of the image's side: a QR code of a whole share still reads at a glance. */
const QR_IMAGE_PIXELS = 720;

/**
 * Saves `payload` as a QR code image, a new private file at `path`; refuses an empty payload. The
 * image shows the payload, so its bytes are wiped once saved or refused.
 */
export async function exportQrPayload(payload: string, path: string): Promise<void> {
  if (payload.length === 0) throw new Error("QR payload must not be empty.");
  const png = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: 1,
    type: "png",
    width: QR_IMAGE_PIXELS,
  });
  await wipedAfterAsync(png, (image) => publishNewPrivateFile(path, image));
}
