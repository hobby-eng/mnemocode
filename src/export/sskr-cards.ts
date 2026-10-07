// Saves the cards of existing Shamir shares in Node.js: one file or folder of files per share in a
// new private folder, one PDF of the whole set, or images of its pages. The cards themselves are
// rendered by the host-neutral ShareCardSet (sskr-render.ts); this file only writes them.

import "./platform-node.js";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { exportPageImages, writeRenderedDocument, type ImageFormat } from "./image-export.js";
import { requireNewCardDirectory } from "./individual-cards.js";
import { publishNewPrivateFile } from "./private-file.js";
import { renderSskrPdf, ShareCardSet, type SskrRenderOptions } from "./sskr-render.js";

// Kept for the callers that import them from here.
export { renderSskrPdf, type SskrRenderOptions } from "./sskr-render.js";

export interface SskrExportOptions extends SskrRenderOptions {
  readonly directory: string;
  readonly imageFormat?: ImageFormat;
}

/** Exports existing shares without generating a new set. Each file contains at most one share. */
export async function exportSskrCards(
  records: readonly string[],
  options: SskrExportOptions,
): Promise<number> {
  const cards = new ShareCardSet(records, options);
  const target = await requireNewCardDirectory(options.directory);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".sskr-cards-"));
  let files = 0;
  try {
    for (const [place, share] of cards.shares.entries()) {
      const folder = share.folder === undefined ? staging : join(staging, share.folder);
      // Private like the staging folder: the card names carry the share's references.
      if (share.folder !== undefined) await mkdir(folder, { mode: 0o700 });
      for await (const document of cards.documents(place))
        files += await writeRenderedDocument(
          document.bytes,
          join(folder, document.name),
          options.imageFormat ?? "pdf",
        );
    }
    await requireNewCardDirectory(target);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return files;
}

export async function exportSskrPdf(
  records: readonly string[],
  options: SskrRenderOptions,
  path: string,
): Promise<void> {
  await publishNewPrivateFile(path, await renderSskrPdf(records, options));
}

export async function exportSskrImages(
  records: readonly string[],
  options: SskrRenderOptions,
  directory: string,
  format: ImageFormat = "png",
): Promise<number> {
  return exportPageImages(await renderSskrPdf(records, options), directory, format);
}
