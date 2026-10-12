// QR code images beside the sheets that print them: the encoded backup or a share as a PNG that
// Decode and Restore read back (--qr-file, --share-qr), under a name that is free. Each is saved
// as every result is (save-retry.ts, writeSaved), so a staging copy left behind is warned of.

import { basename, dirname, extname, join } from "node:path";
import { exportQrPayload } from "../export/qr-image.js";
import { firstFreeName } from "./output-paths.js";
import { writeSaved } from "./save-retry.js";

/**
 * The image of a QR code that a sheet prints, saved where the sheet is: beside the PDF `sheet`,
 * named after it, "cards.pdf" giving "cards-qr.png", with `suffix` before "-qr" if given. A
 * taken name gets a number (firstFreeName). Returns the name used.
 */
export async function saveQrBeside(payload: string, sheet: string, suffix = ""): Promise<string> {
  const name = basename(sheet, extname(sheet));
  const path = await firstFreeName(join(dirname(sheet), `${name}${suffix}-qr.png`));
  await writeSaved(() => exportQrPayload(payload, path));
  return path;
}

/** The same, inside the folder `folder` of the sheets, as "qr.png" or "<name>-qr.png". */
export async function saveQrInside(payload: string, folder: string, name = ""): Promise<string> {
  const path = await firstFreeName(join(folder, name === "" ? "qr.png" : `${name}-qr.png`));
  await writeSaved(() => exportQrPayload(payload, path));
  return path;
}
