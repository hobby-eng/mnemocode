import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import { writeSaved } from "./save-retry.js";
import { exportPageImages } from "../export/image-export.js";
import { terminalNotice, terminalResultHeader } from "./terminal.js";
import { exportIndividualCards } from "../export/individual-cards.js";
import { validateCardOptions } from "./card-options.js";
import { businessOptions, businessOptionNames } from "./business-options.js";
import { exportCards, renderCards } from "../export/pdf.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { cardTemplates } from "../export/templates.js";
import { CardPreview, type DesignSelection } from "../export/card-preview.js";
import { value, type ParsedArguments, integerOption } from "./arguments.js";
import { preflightOutputs } from "./output-saving.js";
import { BIP39_WORD_COUNTS } from "../core/bip39-sizes.js";
import { CARD_FORMAT_NUMBERS } from "./format-numbers.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.preview-command", {
  "template-listing-cannot-combined-preview-output-settings": () =>
    "Template listing cannot be combined with preview output settings.",
  "save-preview-provide-pdf-file-image-output-folder": () =>
    "To save a preview, provide a PDF file, an image output folder, or an individual-card output folder. To inspect the available designs, request the template list.",
  "choose-either-all-templates-one-specific-template-not": () =>
    "Choose either all templates or one specific template, not both.",
  "provide-mnemonic-word-count-only-once": () => "Provide the mnemonic word count only once.",
});

export async function runPreview(args: ParsedArguments): Promise<void> {
  const path = value(args, "pdf");
  const directory = value(args, "cards-dir");
  const images = value(args, "images-dir");
  const id = value(args, "template");
  if (args.list === true) {
    if (
      images !== undefined ||
      args["image-format"] !== undefined ||
      path !== undefined ||
      directory !== undefined ||
      id !== undefined ||
      args.all === true ||
      value(args, "title") !== undefined ||
      args.words !== undefined ||
      businessOptionNames.some((key) => args[key] !== undefined)
    ) {
      throw ERRORS.create("template-listing-cannot-combined-preview-output-settings", []);
    }
    // Every design prints the codes of each form that has cards, so the forms are named once.
    terminalResultHeader("Card templates", [
      ["Installed", String(cardTemplates.length)],
      ["Prints", `format ${CARD_FORMAT_NUMBERS}`],
    ]);
    if (!cardTemplates.length)
      console.log(
        "No approved card templates are installed yet. Each design will be added after individual approval.",
      );
    // Each with its number, which --template takes as well as the id (findTemplate).
    const numberWidth = String(cardTemplates.length).length;
    const idWidth = Math.max(...cardTemplates.map((template) => template.id.length));
    const nameWidth = Math.max(...cardTemplates.map((template) => template.name.length));
    for (const [index, template] of cardTemplates.entries()) {
      console.log(
        `${String(index + 1).padStart(numberWidth)}  ${template.id.padEnd(idWidth)}   ${template.name.padEnd(nameWidth)}   ${template.description}`,
      );
    }
    return;
  }
  if (!path && !directory && !images)
    throw ERRORS.create("save-preview-provide-pdf-file-image-output-folder", []);
  if (args.all === true && id !== undefined)
    throw ERRORS.create("choose-either-all-templates-one-specific-template-not", []);
  const selection: DesignSelection = args.all === true ? { every: true } : { template: id };
  if (directory !== undefined) {
    CardPreview.assertOneDesign(selection);
    validateCardOptions(args, "colors");
  }
  await preflightOutputs(args);
  const settings = businessOptions(args);
  if (args.words !== undefined && typeof args.words !== "string")
    throw ERRORS.create("provide-mnemonic-word-count-only-once", []);
  // Read only as a whole number here; which lengths a sample may have, and its default, are the
  // library's (CardPreview).
  const words =
    value(args, "words") === undefined
      ? undefined
      : integerOption(args, "words", {
          min: BIP39_WORD_COUNTS[0],
          max: defined(BIP39_WORD_COUNTS.at(-1)),
          label: "mnemonic word count",
        });
  // The sample cards themselves come from the library (export/card-preview.ts), which a page
  // uses too; this command only reads the options and saves the files.
  const preview = new CardPreview(nodeCardRenderer, {
    ...(words === undefined ? {} : { words }),
    settings,
    title: value(args, "title"),
  });
  const jobs = preview.jobs(selection);
  if (directory !== undefined) {
    const job = preview.separateCardsJob(selection);
    const count = await exportIndividualCards(
      job.template,
      job.content,
      directory,
      cardFileFormat(args),
    );
    terminalNotice(`Saved ${count} individual card preview files to: ${directory}`, "success");
  }
  if (path !== undefined) {
    await writeSaved(() => exportCards(jobs, path));
    terminalNotice(
      `Saved preview PDF (${jobs.length} ${jobs.length === 1 ? "template" : "templates"}): ${path}`,
      "success",
    );
  }
  if (images !== undefined) {
    const count = await exportPageImages(
      await renderCards(nodeCardRenderer, jobs),
      images,
      imageFormat(args),
    );
    savedPagesNotice(args, count, images, "preview");
  }
}
