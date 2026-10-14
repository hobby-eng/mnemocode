// What the share commands write: the shares in their forms on the screen, and the files, cards and
// QR codes that the options name, each saved with a choice after a failure (save-retry.ts).

import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import {
  assertSeparateCards,
  DEFAULT_SHARE_TEMPLATE_ID,
  resolveTemplateId,
} from "../export/template-catalog.js";
import { resolveSskrLayout, parseSskrLayout } from "../export/sskr-content.js";
import { printCodes, terminalNotice, terminalResultHeader } from "./terminal.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { value, type ParsedArguments } from "./arguments.js";
import { businessOptions, businessOptionNames } from "./business-options.js";
import {
  writeShare,
  type ShareFormat,
  parseShareFormat,
  DEFAULT_SHARE_FORMAT,
  assertShareFormatHasCards,
  MIRRORED_FORM,
} from "../sskr/transport.js";
import { SHARE_FORMAT_NAMES, type WrittenShare } from "../sskr/share-set.js";
import {
  exportSskrCards,
  exportSskrPdf,
  exportSskrImages,
  nodeShareCards,
  type SskrExportOptions,
} from "../export/sskr-cards.js";
import { ShareCardSet, type ShareQrCode } from "../export/sskr-render.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { saveOutput } from "./output-saving.js";
import { assertCardOutput } from "./card-options.js";
import type { DocumentFormat } from "../export/image-export.js";
import { shareKeepingNote, type ShareCardPackaging } from "../export/sskr-keeping-text.js";
import { refusalMessage } from "../core/refusal.js";

export const sskrExportOptions = [
  "cards-dir",
  "card-layout",
  "template",
  ...businessOptionNames,
] as const;

/** The card settings of the commands of shares, with the format of the card files settled. */
export type ShareCardOptions = SskrExportOptions & { readonly imageFormat: DocumentFormat };

export function exportOptions(
  args: ParsedArguments,
  shareFormat: ShareFormat,
): ShareCardOptions | undefined {
  const { sheets, cards } = assertCardOutput(
    args,
    sskrExportOptions.filter((key) => key !== "cards-dir"),
  );
  if (!sheets && !cards) return undefined;
  // Before any secret is asked, as the cards would refuse it later.
  assertShareFormatHasCards(shareFormat);
  const template = value(args, "template") ?? DEFAULT_SHARE_TEMPLATE_ID;
  const design = resolveTemplateId(template, "colors");
  const requested = parseSskrLayout(value(args, "card-layout"));
  const settings = businessOptions(args, template);
  // Resolved here so that the messages below describe what is actually written.
  const layout = resolveSskrLayout(requested, settings.pageSize);
  if (layout === "individual") assertSeparateCards(design);
  return {
    ...settings,
    style: design.style,
    layout,
    directory: value(args, "cards-dir") ?? "",
    imageFormat: cardFileFormat(args),
    shareFormat,
  };
}

/** ShareCardSet.assertPrintable with this host's renderer, where share cards are asked for. */
export async function assertShareCardsPrintable(
  options: ShareCardOptions | undefined,
): Promise<void> {
  if (options !== undefined) await ShareCardSet.assertPrintable(nodeCardRenderer, options);
}

export function shareFormat(args: ParsedArguments): ShareFormat {
  try {
    return parseShareFormat(value(args, "format") ?? DEFAULT_SHARE_FORMAT);
  } catch (error) {
    throw new Error(`${refusalMessage(error)} These are share formats, not BIP39 representations.`);
  }
}

/** Shares in the same form, in their order, as a split makes them. */
export function inForm(shares: readonly string[], format: ShareFormat): WrittenShare[] {
  return shares.map((ur, index) => ({ ur, format, number: index + 1 }));
}

/**
 * Prints one share under `title`, with its form and what it holds where that is known: as a
 * result header on a terminal, as one line before it elsewhere.
 */
export function printShareBlock(
  title: string,
  ur: string,
  format: ShareFormat,
  holds?: string,
): void {
  const form = SHARE_FORMAT_NAMES[format];
  const facts: [string, string][] = [["Format", form]];
  if (holds !== undefined) facts.push(["Holds", holds]);
  if (!terminalResultHeader(title, facts))
    console.error(`${title} — ${form}${holds === undefined ? "" : `, holds ${holds}`}:`);
  // In Unicode codes and in colors as Unicode codes, apart and joined (printCodes).
  printCodes(writeShare(ur, format), MIRRORED_FORM[format]);
}

/**
 * Prints shares as "SSKR share N of M", by their places among the `total` made or typed, with what
 * they hold where that is known (PHRASE_WORDS), so that a masked phrase is not taken for the
 * wallet's.
 */
export function printShares(
  shares: readonly WrittenShare[],
  total: number = shares.length,
  holds?: string,
): void {
  for (const share of shares) {
    printShareBlock(`SSKR share ${share.number} of ${total}`, share.ur, share.format, holds);
  }
}

// Saving, with a choice after a failure (save-retry.ts).

/**
 * Saves the shares where the options say, each output with saveOutput, each followed by how its
 * shares are kept (shareKeepingNote): `masked` says that they hold the masked phrase.
 */
export async function saveShares(
  shown: readonly WrittenShare[],
  args: ParsedArguments,
  options: ShareCardOptions | undefined,
  masked: boolean,
): Promise<void> {
  const shares = shown.map((share) => share.ur);
  const keep = (packaging: ShareCardPackaging): void =>
    terminalNotice(shareKeepingNote(shares, packaging, masked));
  // One set of cards for every file, so that each shows the same decoys.
  if (options !== undefined)
    await saveShareCards(await nodeShareCards(shares, options), args, options, keep);
  // Each share in its form, as the terminal shows it.
  const lines = shown.map((share) => writeShare(share.ur, share.format));
  const output = await saveOutput(args, "output", "The file of the shares", (path) =>
    // The shares in the open: their bytes are wiped once this attempt has saved or failed.
    wipedAfterAsync(new TextEncoder().encode(lines.join("\n") + "\n"), (bytes) =>
      publishNewPrivateFile(path, bytes),
    ),
  );
  if (output !== undefined) {
    terminalNotice(`Saved SSKR records: ${output} (one complete share per line).`, "success");
    keep("file");
  }
}

/** The QR codes of the shares saved in `folder`, a folder of cards or images just saved. */
function saveShareQrsInside(cards: ShareCardSet, folder: string): Promise<void> {
  return saveShareQrs(cards, (code) => saveQrInside(code.payload, folder, code.name));
}

/** Saves the cards, the PDF and the images of the shares that the options name, from `set`. */
async function saveShareCards(
  set: ShareCardSet,
  args: ParsedArguments,
  options: ShareCardOptions,
  keep: (packaging: ShareCardPackaging) => void,
): Promise<void> {
  let cards = 0;
  const directory = await saveOutput(
    args,
    "cards-dir",
    "The folder of share cards",
    async (path) => {
      cards = await exportSskrCards(set, path, options.imageFormat);
    },
  );
  if (directory !== undefined) {
    terminalNotice(
      `Saved ${cards} ${options.imageFormat.toUpperCase()} files to: ${directory}`,
      "success",
    );
    await saveShareQrsInside(set, directory);
    keep(
      options.layout === "individual"
        ? "folders"
        : options.imageFormat !== "pdf"
          ? "pages"
          : "files",
    );
  }
  const pdf = await saveOutput(args, "pdf", "The PDF of the shares", (path) =>
    exportSskrPdf(set, path),
  );
  if (pdf !== undefined) {
    terminalNotice(`Saved SSKR collection PDF: ${pdf}`, "success");
    keep("file");
    await saveShareQrs(set, (code) => saveQrBeside(code.payload, pdf, `-${code.reference}`));
  }
  let pages = 0;
  const images = await saveOutput(
    args,
    "images-dir",
    "The folder of share images",
    async (path) => {
      pages = await exportSskrImages(set, path, imageFormat(args));
    },
  );
  if (images !== undefined) {
    savedPagesNotice(args, pages, images, "SSKR");
    keep("folder");
    await saveShareQrsInside(set, images);
  }
}

/**
 * The QR code of each share's sheets, also saved as an image where the cards went (`save`), which
 * Restore reads back (--share-qr): one for each share, none when the sheets print no QR code.
 */
async function saveShareQrs(
  cards: ShareCardSet,
  save: (code: ShareQrCode) => Promise<string>,
): Promise<void> {
  const codes = cards.qrCodes;
  for (const code of codes) await save(code);
  if (codes.length > 0)
    terminalNotice(
      `Saved the QR code of each share's sheets as an image beside them: ${codes.length} PNG ${codes.length === 1 ? "file" : "files"}.`,
      "success",
    );
}
