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

/** Stages every file before publishing the folder. No manifest contains the full payload. */
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
