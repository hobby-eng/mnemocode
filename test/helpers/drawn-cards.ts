// The cards that a save draws, read where they cross the program's edge: the texts that pdf-lib is
// asked to draw, whose numbered codes tell which cards were drawn and in which order; and
// pdftocairo, the other program that turns pages into images, a fake on PATH that reads a page's
// PDF and answers with a few bytes. Windows looks for pdftocairo.exe and takes no fake there
// (PAGE_IMAGES).

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Whether the fake pdftocairo can stand in for the real one here: not on Windows. */
export const PAGE_IMAGES = process.platform !== "win32";

/**
 * A numbered code as a card or a sheet draws it, after any label such as "Ref.": its place, two
 * spaces and its code (numberedCode in src/export/card-codes.ts), such as "07  A3F09C".
 */
const NUMBERED_CODE = /(?:^|\s)(?<place>\d{2}) {2}(?<code>\S+)$/u;

/**
 * The numbered codes among `texts`, in the order drawn, each written as the file of its separate
 * card is named (separateCardName in src/export/card-codes.ts), such as "07-A3F09C".
 */
export function numberedCodes(texts: readonly string[]): string[] {
  return texts.flatMap((text) => {
    const found = NUMBERED_CODE.exec(text)?.groups;
    return found === undefined ? [] : [`${found["place"]}-${found["code"]}`];
  });
}

/** Writes a fake pdftocairo into `folder`: it reads a page's PDF and answers with a few bytes. */
export async function fakeImageRenderer(folder: string): Promise<void> {
  const program = join(folder, "pdftocairo");
  await writeFile(
    program,
    `#!${process.execPath}
if (process.argv.includes("-v")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write("public fake page image"));
`,
  );
  await chmod(program, 0o700);
}
