import { nodeCardRenderer } from "./platform-node.js";
import { assertIndividualCards, renderIndividualCards } from "./render.js";
import {
  DEFAULT_DOCUMENT_FORMAT,
  writeRenderedDocument,
  type DocumentFormat,
} from "./image-export.js";
import { NewFolder, privateChildPath } from "./private-file.js";
import { separateCardName } from "./card-codes.js";
import { wipeAll } from "../core/bits.js";
import type { CardContent } from "./backup-cards.js";
import type { CardTemplate } from "./templates.js";

/** Why a card folder is refused: something is there already. */
export const CARD_FOLDER_TAKEN =
  "The card folder already exists. Choose a new folder to avoid mixing separate card collections.";

/**
 * Claims the new card folder `directory`, refused with CARD_FOLDER_TAKEN (NewFolder). A claim makes
 * nothing, so the command line also asks it early, before anything is rendered.
 */
export function claimCardFolder(directory: string): Promise<NewFolder> {
  return NewFolder.claim(directory, CARD_FOLDER_TAKEN);
}

/**
 * Saves each card of `content`, drawn with `template`, as its own file or files in the new folder
 * `directory`, in `format`: the PDF of the card, or the image of each of its pages. Returns how
 * many files it wrote. Every card is drawn before anything is written, and every file is staged
 * before the folder is published under its name (NewFolder.publish); no manifest contains the full
 * payload, and the bytes of the cards are wiped once written, also after a failure. Refuses,
 * before any file is touched, what assertIndividualCards refuses, a card name that
 * privateChildPath refuses (export.file-name.invalid-component), and a folder that exists already
 * (CARD_FOLDER_TAKEN, export.private-file.absent-path-refused) or is blank
 * (export.private-file.new-folder-path-empty-one-refused), as claimCardFolder refuses it. Then
 * what renderIndividualCards and writeRenderedDocument refuse passes on, and so do the other
 * failures of NewFolder.publish.
 */
export async function exportIndividualCards(
  template: CardTemplate,
  content: CardContent,
  directory: string,
  format: DocumentFormat = DEFAULT_DOCUMENT_FORMAT,
): Promise<number> {
  assertIndividualCards(template, content);
  // Reject preplanned decoy names before the renderer sees any private card content.
  for (let index = 0; index < content.colors.length; index++)
    privateChildPath(directory, separateCardName(content, index));
  const folder = await claimCardFolder(directory);
  // Every card is rendered before anything is written.
  const cards = await renderIndividualCards(nodeCardRenderer, template, content);
  try {
    return await folder.publish(".card-collection-", async (staging) => {
      let files = 0;
      for (const card of cards)
        files += await writeRenderedDocument(
          card.bytes,
          privateChildPath(staging, card.name),
          format,
        );
      return files;
    });
  } finally {
    // The cards show the backup: wiped once written, also when a card or the folder failed.
    wipeAll(cards.map((card) => card.bytes));
  }
}
