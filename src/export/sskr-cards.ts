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

/**
 * The cards of `records`, existing shares, drawn with the Node.js renderer (ShareCardSet), for
 * every file of one export. Refuses what ShareCardSet.create refuses: a layout of none or one that
 * the page size does not give, a title that cardTitle refuses, a share form of none or without
 * cards, a style of no design, separate cards of a design printed on sheets only, details that
 * ExportDetails refuses, shares of `records` that Share.readSet refuses, and a plan of decoys that
 * withPlannedDecoys refuses.
 */
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
  /** The new folder of the card files, as the person named it; empty when none was named. */
  readonly directory: string;
  /** The format of the card files: PDF by default (DEFAULT_DOCUMENT_FORMAT), or an image format. */
  readonly imageFormat?: DocumentFormat;
}

/**
 * Saves the documents of `cards` in a new folder `directory`, each share in its own file or, for
 * separate cards, its own folder, as PDF or images of `format`; returns how many files it wrote.
 * Each file contains one share, and its bytes are wiped once written. Refuses a folder that exists
 * already (CARD_FOLDER_TAKEN, export.private-file.absent-path-refused) or is blank
 * (export.private-file.new-folder-path-empty-one-refused), as claimCardFolder refuses it, before
 * anything is drawn. Then what ShareCardSet.documents and writeRenderedDocument refuse passes on,
 * and so do the other failures of NewFolder.publish.
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

/**
 * Saves every page of `cards` in one new PDF at `path`, whose bytes are wiped once written. What
 * ShareCardSet.renderAll refuses passes on; a path that exists already fails with the file
 * system's own error (EEXIST), as publishNewPrivateFile fails, with its other failures.
 */
export async function exportSskrPdf(cards: ShareCardSet, path: string): Promise<void> {
  await wipedAfterAsync(await cards.renderAll(), (document) =>
    publishNewPrivateFile(path, document),
  );
}

/**
 * Saves every page of `cards` as an image of `format` in a new folder `directory`; returns how
 * many image files it wrote. The PDF of the pages is wiped once its images are written. What
 * ShareCardSet.renderAll refuses passes on, then what exportPageImages refuses: a computer
 * without the local image renderer
 * (export.image-export.png-jpeg-export-requires-local-poppler-pdftocairo-program), and a folder
 * that exists already (IMAGE_FOLDER_TAKEN, export.private-file.absent-path-refused) or is blank
 * (export.private-file.new-folder-path-empty-one-refused).
 */
export async function exportSskrImages(
  cards: ShareCardSet,
  directory: string,
  format: ImageFormat = DEFAULT_IMAGE_FORMAT,
): Promise<number> {
  return wipedAfterAsync(await cards.renderAll(), (document) =>
    exportPageImages(document, directory, format),
  );
}
