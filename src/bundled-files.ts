import { readFile } from "node:fs/promises";
import { getAsset, isSea } from "node:sea";

/**
 * Reads a file that ships with MnemoCode, such as card artwork, the SSKR engine or the public
 * vectors, by its path from the package root ("assets/fonts/DejaVuSans-UI.ttf").
 *
 * Run from a checkout or an installed package, the file lies next to the code. Inside the single
 * executable (scripts/build-executable.mjs) it is an embedded asset under the same path, and
 * `import.meta.url` is not used, because the executable has no files of its own on disk.
 */
export async function readBundledFile(path: string): Promise<Uint8Array> {
  if (isSea()) return new Uint8Array(getAsset(path));
  // This module is src/bundled-files.ts or dist/bundled-files.js, one level below the root.
  return readFile(new URL(`../${path}`, import.meta.url));
}
