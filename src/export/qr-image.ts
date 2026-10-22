// A QR code as a PNG image file: the encoded backup or a share, which Decode and Restore read back
// (--qr-file, --share-qr). Drawn with the qrcode package of Node.js; a page draws its own.

import QRCode from "qrcode";
import { publishNewPrivateFile } from "./private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { QR_ERROR_CORRECTION_LEVEL } from "./platform.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { QrPngReader } from "./qr-reader.js";

const ERRORS = new ErrorCatalog("export.qr-image", {
  "qr-payload-not-empty": () => "QR payload must not be empty.",
});

/** Pixels of the image's side: a QR code of a whole share still reads at a glance. */
const QR_IMAGE_PIXELS = 720;

/**
 * Saves `payload` as a QR code image, a new private file at `path`; refuses an empty payload
 * (export.qr-image.qr-payload-not-empty). The image shows the payload, so its bytes are wiped once
 * saved or refused. The actual PNG is independently decoded and compared with the exact payload
 * before publication; unreadable or mismatching output fails with qr-verification-failed. A file
 * that exists already, or a staging folder that stays, is refused as
 * publishNewPrivateFile refuses it.
 */
export async function exportQrPayload(payload: string, path: string): Promise<void> {
  if (payload.length === 0) throw ERRORS.create("qr-payload-not-empty", []);
  const reader = await QrPngReader.load();
  const png = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: 1,
    type: "png",
    width: QR_IMAGE_PIXELS,
  });
  await wipedAfterAsync(png, async (image) => {
    reader.assertImage(image, payload);
    await publishNewPrivateFile(path, image);
  });
}
