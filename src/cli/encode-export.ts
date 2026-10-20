import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import { exportPageImages } from "../export/image-export.js";
import { exportCards, renderCards } from "../export/pdf.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { PlannedCards, separateCardJob, type CardJob } from "../export/render.js";
import { parseOrientation } from "../export/card-settings.js";
import { backupCardContent, type CardBackup } from "../export/backup-cards.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { exportIndividualCards } from "../export/individual-cards.js";
import { cardTemplate, ENCODE_CARD_SETTINGS } from "./card-options.js";
import { businessOptions } from "./business-options.js";
import { indexesToColors } from "../core.js";
import { type ParsedArguments, value } from "./arguments.js";
import { colorCards, printableText, terminalNotice, terminalWork } from "./terminal.js";
import { exportQrPayload } from "../export/qr-image.js";
import type { EncodeOutcome } from "./encode-command.js";
import { SecretValue } from "../core/secret-value.js";
import { Redacted } from "../core/redacted.js";
import { defined } from "../core/defined.js";
import type { CardDrawing } from "../export/templates.js";
import { ExportDetails } from "../export/export-details.js";

const CARD_JOB_OPTIONS = [...ENCODE_CARD_SETTINGS, "all"] as const;

/**
 * The cards of Encode's backup and their design: what its PDF, its page images and its separate
 * card files all draw (backupCardContent), with the card settings of `arguments_` and its title.
 */
function cardJob(arguments_: ParsedArguments, backup: CardBackup): CardJob {
  const content = backupCardContent(backup, {
    settings: businessOptions(arguments_),
    title: value(arguments_, "title"),
  });
  return { template: cardTemplate(arguments_, content.kind), content };
}

/**
 * Retains the library's planned cards (PlannedCards) for the sequential saves and retries of one
 * Encode run, planned on the first save from the card options of the command.
 */
export class EncodeCardExport extends Redacted implements Disposable {
  readonly #arguments: ParsedArguments;
  readonly #drawing: CardDrawing;
  readonly #lifetime = SecretValue.utf16Texts([]);
  #backup: CardBackup | undefined;
  #cards: PlannedCards | undefined;
  #pending: Promise<void> | undefined;

  constructor(
    arguments_: ParsedArguments,
    outcome: EncodeOutcome,
    drawing: CardDrawing = nodeCardRenderer,
  ) {
    super("EncodeCardExport");
    this.#arguments = {};
    // Retain only public card options, never argv's phrase, dates or unrelated output options.
    for (const key of CARD_JOB_OPTIONS) {
      const given = arguments_[key];
      if (given !== undefined) this.#arguments[key] = Array.isArray(given) ? [...given] : given;
    }
    ExportDetails.reuseForSnapshot(arguments_, this.#arguments);
    this.#backup = outcome.encoding.backup;
    this.#drawing = drawing;
  }

  /** Plans once on the first save; fresh decoded job views cannot be recalled after return. */
  async job(): Promise<CardJob> {
    this.#lifetime.assertLive();
    if (this.#cards === undefined) {
      // Assign before invoking a host callback, including a callback that re-enters job().
      const pending = (this.#pending ??= Promise.resolve().then(() => this.#plan()));
      try {
        await pending;
      } finally {
        if (this.#pending === pending) this.#pending = undefined;
      }
    }
    this.#lifetime.assertLive();
    return defined(this.#cards).job;
  }

  async #plan(): Promise<void> {
    this.#lifetime.assertLive();
    let cards: PlannedCards | undefined;
    try {
      cards = await PlannedCards.plan(
        this.#drawing,
        cardJob(this.#arguments, defined(this.#backup)),
      );
      this.#lifetime.assertLive();
      this.#cards = cards;
    } catch (error) {
      cards?.wipe();
      // A failed plan is never cached; disposal also refuses a late host failure.
      this.#lifetime.assertLive();
      throw error;
    }
  }

  /**
   * Every real code and one decoy as separate files, turned as the person asked, not as a sheet.
   */
  async separateJob(): Promise<CardJob> {
    const job = await this.job();
    this.#lifetime.assertLive();
    return separateCardJob(job, parseOrientation(value(this.#arguments, "orientation")));
  }

  /** Ends cached card values immediately, without disposing the borrowed backup. */
  wipe(): void {
    this.#lifetime.wipe();
    this.#cards?.wipe();
    this.#cards = undefined;
    this.#backup = undefined;
  }

  /** Ends the owning scope after every asynchronous save/render has settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * Saves the named destinations. Separate calls in one run share `cards`, so every file and retry
 * receives the same plan for that layout; a standalone call keeps its own collection. Shared
 * `cards` is borrowed for this call; a standalone call disposes its own temporary helper.
 */
export async function saveEncodeResult(
  arguments_: ParsedArguments,
  outcome: EncodeOutcome,
  cards?: EncodeCardExport,
): Promise<void> {
  using ownedCards = cards === undefined ? new EncodeCardExport(arguments_, outcome) : undefined;
  const plannedCards = cards ?? defined(ownedCards);
  const { backup } = outcome.encoding;
  const { format } = backup;
  const pdfPath = value(arguments_, "pdf");
  const imageDirectory = value(arguments_, "images-dir");
  const cardDirectory = value(arguments_, "cards-dir");
  if (pdfPath !== undefined || imageDirectory !== undefined || cardDirectory !== undefined)
    terminalWork("Rendering the cards…");
  const outputPath = value(arguments_, "output");
  if (outputPath !== undefined) {
    await wipedAfterAsync(Buffer.from(`${backup.record()}\n`, "utf8"), (record) =>
      publishNewPrivateFile(outputPath, record),
    );
    terminalNotice(`Saved MnemoCode record: ${printableText(outputPath)}`, "success");
  }
  if (arguments_.cards === true) {
    console.error(colorCards(indexesToColors(backup.indexes)));
  }
  if (pdfPath !== undefined) {
    await exportCards([await plannedCards.job()], pdfPath);
    terminalNotice(`Saved PDF: ${printableText(pdfPath)}`, "success");
  }
  if (imageDirectory !== undefined) {
    // The rendered cards show the backup: wiped once their images are written.
    const count = await wipedAfterAsync(
      await renderCards(nodeCardRenderer, [await plannedCards.job()]),
      (document) => exportPageImages(document, imageDirectory, imageFormat(arguments_)),
    );
    savedPagesNotice(arguments_, count, imageDirectory);
  }
  if (cardDirectory !== undefined) {
    const { template, content } = await plannedCards.separateJob();
    const count = await exportIndividualCards(
      template,
      content,
      cardDirectory,
      cardFileFormat(arguments_),
    );
    terminalNotice(
      `Saved ${count} individual card files to: ${printableText(cardDirectory)}`,
      "success",
    );
  }
  const qrPath = value(arguments_, "qr");
  if (qrPath !== undefined) {
    await exportQrPayload(backup.text(), qrPath);
    terminalNotice(`Saved QR code (${format}): ${printableText(qrPath)}`, "success");
  }
}
