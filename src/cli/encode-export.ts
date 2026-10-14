import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import { exportPageImages } from "../export/image-export.js";
import { exportCards, renderCards } from "../export/pdf.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { plannedCardJob, separateCardJob, type CardJob } from "../export/render.js";
import { parseOrientation } from "../export/card-settings.js";
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

/** Retains the library's planned cards for the sequential saves and retries of one Encode run. */
export class EncodeCardExport {
  readonly #arguments: ParsedArguments;
  readonly #outcome: EncodeOutcome;
  #job: CardJob | undefined;

  constructor(arguments_: ParsedArguments, outcome: EncodeOutcome) {
    this.#arguments = arguments_;
    this.#outcome = outcome;
  }

  /** Plans on the first card save, preserving when card details are drawn. */
  async job(): Promise<CardJob> {
    // Retain only a completed plan: a planning failure must still allow the destination's retry.
    return (this.#job ??= await plannedCardJob(
      nodeCardRenderer,
      cardJob(this.#arguments, this.#outcome),
    ));
  }

  /**
   * The same cards as separate card files draw them: turned as the person asked, not as a sheet.
   */
  async separateJob(): Promise<CardJob> {
    return separateCardJob(
      await this.job(),
      parseOrientation(value(this.#arguments, "orientation")),
    );
  }
}

/**
 * Saves the named destinations. Separate calls in one run share `cards`, so every file and retry
 * receives the same complete collection; a standalone call keeps its own collection. Shared
 * `cards` belongs to this outcome and the run's one object of card options.
 */
export async function saveEncodeResult(
  arguments_: ParsedArguments,
  outcome: EncodeOutcome,
  cards = new EncodeCardExport(arguments_, outcome),
): Promise<void> {
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
    await exportCards([await cards.job()], pdfPath);
    terminalNotice(`Saved PDF: ${pdfPath}`, "success");
  }
  if (imageDirectory !== undefined) {
    // The rendered cards show the backup: wiped once their images are written.
    const count = await wipedAfterAsync(
      await renderCards(nodeCardRenderer, [await cards.job()]),
      (document) => exportPageImages(document, imageDirectory, imageFormat(arguments_)),
    );
    savedPagesNotice(arguments_, count, imageDirectory);
  }
  if (cardDirectory !== undefined) {
    const { template, content } = await cards.separateJob();
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
