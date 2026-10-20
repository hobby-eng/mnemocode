// Saves the cards of existing Shamir shares in Node.js: one file or folder of files per share in a
// new private folder, one PDF of the whole set, or images of its pages. The cards themselves are
// rendered by the host-neutral ShareCardSet (sskr-render.ts), made once for every file of one
// export so that each shows the same decoys; this file only writes them.

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
import { wipedAfterAsync } from "../core/bits.js";
import { ShareCardSet, type SskrRenderOptions } from "./sskr-render.js";
import { DEFAULT_IMAGE_FORMAT } from "./document-formats.js";

// Kept for the callers that import them from here.

/** The cards of `records` in the Node.js renderer (ShareCardSet), for every file of one export. */
export function nodeShareCards(
  records: readonly string[],
  options: SskrRenderOptions,
): Promise<ShareCardSet> {
  return ShareCardSet.create(nodeCardRenderer, records, options);
}

/**
 * What the cards of shares are exported with on Node.js: the render options, the folder of their
 * files and its format.
 */
export interface SskrExportOptions extends SskrRenderOptions {
  readonly directory: string;
  /** The format of the card files: PDF by default (DEFAULT_DOCUMENT_FORMAT), or an image format. */
  readonly imageFormat?: DocumentFormat;
}

/**
 * Saves the documents of `cards` in a new folder `directory`, each share in its own file or, for
 * separate cards, its own folder, as PDF or images of `format`. Each file contains one share.
 */
export async function exportSskrCards(
  cards: ShareCardSet,
  directory: string,
  format: DocumentFormat = DEFAULT_DOCUMENT_FORMAT,
): Promise<number> {
  const cardFolder = await claimCardFolder(directory);
  return cardFolder.publish(".sskr-cards-", async (staging) => {
    let files = 0;
    for (const [place, share] of cards.shares.entries()) {
      const shareFolder = share.folder === undefined ? staging : join(staging, share.folder);
      // Private like the staging folder: the card names carry the share's references.
      if (share.folder !== undefined) await makePrivateFolder(shareFolder);
      // Each document shows a share: its bytes are wiped once written.
      for await (const document of cards.documents(place))
        files += await wipedAfterAsync(document.bytes, (bytes) =>
          writeRenderedDocument(bytes, join(shareFolder, document.name), format),
        );
    }
    return files;
  });
}

/** Saves every page of `cards` in one new PDF at `path`. */
export async function exportSskrPdf(cards: ShareCardSet, path: string): Promise<void> {
  await wipedAfterAsync(await cards.renderAll(), (document) =>
    publishNewPrivateFile(path, document),
  );
}

/** Saves every page of `cards` as an image of `format` in a new folder `directory`. */
export async function exportSskrImages(
  cards: ShareCardSet,
  directory: string,
  format: ImageFormat = DEFAULT_IMAGE_FORMAT,
): Promise<number> {
  return wipedAfterAsync(await cards.renderAll(), (document) =>
    exportPageImages(document, directory, format),
  );
}
