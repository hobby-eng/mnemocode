import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import { exportPageImages } from "../export/image-export.js";
import { exportCards, renderCards } from "../export/pdf.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { plannedCardJob, type CardJob } from "../export/render.js";
import { backupCardContent } from "../export/backup-cards.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { exportIndividualCards } from "../export/individual-cards.js";
import { cardTemplate } from "./card-options.js";
import { businessOptions } from "./business-options.js";
import { indexesToColors } from "../core.js";
import { type ParsedArguments, value } from "./arguments.js";
import { colorCards, terminalNotice } from "./terminal.js";
import { exportQrPayload } from "../export/qr-image.js";
import type { EncodeOutcome } from "./encode-command.js";

/**
 * The cards of Encode's backup and their design: what its PDF, its page images and its separate
 * card files all draw (backupCardContent), with the card settings of `arguments_` and its title.
 */
function cardJob(arguments_: ParsedArguments, outcome: EncodeOutcome): CardJob {
  const content = backupCardContent(outcome.encoding.backup, {
    settings: businessOptions(arguments_),
    title: value(arguments_, "title"),
  });
  return { template: cardTemplate(arguments_, content.kind), content };
}

/**
 * Every destination receives the same completed transformation, and every card file the same
 * cards: their decoys are planned once, when the first of them is saved.
 */
export async function saveEncodeResult(
  arguments_: ParsedArguments,
  outcome: EncodeOutcome,
): Promise<void> {
  let planned: Promise<CardJob> | undefined;
  const plannedJob = (): Promise<CardJob> =>
    (planned ??= plannedCardJob(nodeCardRenderer, cardJob(arguments_, outcome)));
  const { backup } = outcome.encoding;
  const { format } = backup;
  const pdfPath = value(arguments_, "pdf");
  const imageDirectory = value(arguments_, "images-dir");
  const cardDirectory = value(arguments_, "cards-dir");
  const outputPath = value(arguments_, "output");
  if (outputPath !== undefined) {
    await wipedAfterAsync(Buffer.from(`${backup.record()}\n`, "utf8"), (record) =>
      publishNewPrivateFile(outputPath, record),
    );
    terminalNotice(`Saved MnemoCode record: ${outputPath}`, "success");
  }
  if (arguments_.cards === true) {
    console.error(colorCards(indexesToColors(backup.indexes)));
  }
  if (pdfPath !== undefined) {
    await exportCards([await plannedJob()], pdfPath);
    terminalNotice(`Saved PDF: ${pdfPath}`, "success");
  }
  if (imageDirectory !== undefined) {
    // The rendered cards show the backup: wiped once their images are written.
    const count = await wipedAfterAsync(
      await renderCards(nodeCardRenderer, [await plannedJob()]),
      (document) => exportPageImages(document, imageDirectory, imageFormat(arguments_)),
    );
    savedPagesNotice(arguments_, count, imageDirectory);
  }
  if (cardDirectory !== undefined) {
    const { template, content } = await plannedJob();
    const count = await exportIndividualCards(
      template,
      content,
      cardDirectory,
      cardFileFormat(arguments_),
    );
    terminalNotice(`Saved ${count} individual card files to: ${cardDirectory}`, "success");
  }
  const qrPath = value(arguments_, "qr");
  if (qrPath !== undefined) {
    await exportQrPayload(backup.text(), qrPath);
    terminalNotice(`Saved QR code (${format}): ${qrPath}`, "success");
  }
}
