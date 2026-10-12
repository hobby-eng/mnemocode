// Saves the cards of existing Shamir shares in Node.js: one file or folder of files per share in a
// new private folder, one PDF of the whole set, or images of its pages. The cards themselves are
// rendered by the host-neutral ShareCardSet (sskr-render.ts); this file only writes them.

import { nodeCardRenderer } from "./platform-node.js";
import { join } from "node:path";
import {
  DEFAULT_DOCUMENT_FORMAT,
  exportPageImages,
  writeRenderedDocument,
  type DocumentFormat,
  type ImageFormat,
} from "./image-export.js";
import { claimCardFolder } from "./individual-cards.js";
import { publishNewPrivateFile, makePrivateFolder } from "./private-file.js";
import { renderSskrPdf, ShareCardSet, type SskrRenderOptions } from "./sskr-render.js";
import { DEFAULT_IMAGE_FORMAT } from "./document-formats.js";

// Kept for the callers that import them from here.
export { renderSskrPdf, type SskrRenderOptions } from "./sskr-render.js";

export interface SskrExportOptions extends SskrRenderOptions {
  readonly directory: string;
  /** The format of the card files: PDF by default (DEFAULT_DOCUMENT_FORMAT), or an image format. */
  readonly imageFormat?: DocumentFormat;
}

/** Exports existing shares without generating a new set. Each file contains at most one share. */
export async function exportSskrCards(
  records: readonly string[],
  options: SskrExportOptions,
): Promise<number> {
  const cards = new ShareCardSet(nodeCardRenderer, records, options);
  const cardFolder = await claimCardFolder(options.directory);
  return cardFolder.publish(".sskr-cards-", async (staging) => {
    let files = 0;
    for (const [place, share] of cards.shares.entries()) {
      const shareFolder = share.folder === undefined ? staging : join(staging, share.folder);
      // Private like the staging folder: the card names carry the share's references.
      if (share.folder !== undefined) await makePrivateFolder(shareFolder);
      for await (const document of cards.documents(place))
        files += await writeRenderedDocument(
          document.bytes,
          join(shareFolder, document.name),
          options.imageFormat ?? DEFAULT_DOCUMENT_FORMAT,
        );
    }
    return files;
  });
}

export async function exportSskrPdf(
  records: readonly string[],
  options: SskrRenderOptions,
  path: string,
): Promise<void> {
  await publishNewPrivateFile(path, await renderSskrPdf(nodeCardRenderer, records, options));
}

export async function exportSskrImages(
  records: readonly string[],
  options: SskrRenderOptions,
  directory: string,
  format: ImageFormat = DEFAULT_IMAGE_FORMAT,
): Promise<number> {
  return exportPageImages(
    await renderSskrPdf(nodeCardRenderer, records, options),
    directory,
    format,
  );
}
