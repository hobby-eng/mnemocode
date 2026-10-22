// QR code images beside the sheets that print them: the encoded backup or a share as a PNG that
// Decode and Restore read back (--qr-file, --share-qr), under a name that is free. Each is saved
// as every result is (save-retry.ts, writeSaved), so a staging copy left behind is warned of.

import { basename, dirname, extname, join } from "node:path";
import { exportQrPayload } from "../export/qr-image.js";
import { firstFreeName } from "./output-paths.js";
import { saveWithRetry } from "./save-retry.js";
import { preflightFileDestination } from "./output-paths.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { terminalSaved } from "./terminal.js";

/** Reports only images already verified by exportQrPayload and successfully published. */
export function reportQrVerified(count = 1): void {
  if (count > 0) terminalSaved(count === 1 ? "QR code verified." : `${count} QR codes verified.`);
}

/**
 * The image of a QR code that a sheet prints, saved where the sheet is: beside the PDF `sheet`,
 * named after it, "cards.pdf" giving "cards-qr.png", with `suffix` before "-qr" if given. A
 * taken name gets a number (firstFreeName). Returns the name used, undefined when skipped, or
 * CANCELLED at Ctrl+C, as every interactive save does.
 */
export async function saveQrBeside(
  payload: string,
  sheet: string,
  suffix = "",
): Promise<string | undefined | Cancelled> {
  const name = basename(sheet, extname(sheet));
  const path = await firstFreeName(join(dirname(sheet), `${name}${suffix}-qr.png`));
  return saveQrAt(payload, path);
}

/** The same outcomes inside the sheets' folder, as "qr.png" or "<name>-qr.png". */
export async function saveQrInside(
  payload: string,
  folder: string,
  name = "",
): Promise<string | undefined | Cancelled> {
  const path = await firstFreeName(join(folder, name === "" ? "qr.png" : `${name}-qr.png`));
  return saveQrAt(payload, path);
}

async function saveQrAt(payload: string, path: string): Promise<string | undefined | Cancelled> {
  const saved = await saveWithRetry({
    what: "The QR code of the sheet",
    kind: "file",
    path,
    write: (name) => exportQrPayload(payload, name),
    checkName: (name) => preflightFileDestination(name, false),
  });
  if (saved !== undefined && saved !== CANCELLED) reportQrVerified();
  return saved;
}
