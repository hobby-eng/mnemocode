// QR code images: the encoded backup or a share as a PNG that Decode and Restore read back
// (--qr-file, --share-qr). Drawn with the qrcode package of Node.js; a page draws its own.

import { basename, dirname, extname, join } from "node:path";
import QRCode from "qrcode";
import { publishNewPrivateFile } from "../export/private-file.js";
import { firstFreeName } from "./output-paths.js";

/** Pixels of the image's side: a QR code of a whole share still reads at a glance. */
const QR_IMAGE_PIXELS = 720;

export async function exportQrPayload(payload: string, path: string): Promise<void> {
  if (payload.length === 0) throw new Error("QR payload must not be empty.");
  const png = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "png",
    width: QR_IMAGE_PIXELS,
  });
  await publishNewPrivateFile(path, png);
}

/**
 * The image of a QR code that a sheet prints, saved where the sheet is: beside the PDF `sheet`,
 * named after it, "cards.pdf" giving "cards-qr.png", with `suffix` before "-qr" if given. A
 * taken name gets a number (firstFreeName). Returns the name used.
 */
export async function saveQrBeside(payload: string, sheet: string, suffix = ""): Promise<string> {
  const name = basename(sheet, extname(sheet));
  const path = await firstFreeName(join(dirname(sheet), `${name}${suffix}-qr.png`));
  await exportQrPayload(payload, path);
  return path;
}

/** The same, inside the folder `folder` of the sheets, as "qr.png" or "<name>-qr.png". */
export async function saveQrInside(payload: string, folder: string, name = ""): Promise<string> {
  const path = await firstFreeName(join(folder, name === "" ? "qr.png" : `${name}-qr.png`));
  await exportQrPayload(payload, path);
  return path;
}
