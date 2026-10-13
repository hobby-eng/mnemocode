// What the share commands write: the shares in their forms on the screen, and the files, cards and
// QR codes that the options name, each saved with a choice after a failure (save-retry.ts).

import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import { DEFAULT_SHARE_TEMPLATE_ID, resolveTemplateId } from "../export/template-catalog.js";
import { resolveSskrLayout, parseSskrLayout } from "../export/sskr-content.js";
import { terminalNotice, terminalResultHeader } from "./terminal.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { value, type ParsedArguments } from "./arguments.js";
import { businessOptions, businessOptionNames } from "./business-options.js";
import {
  writeShare,
  type ShareFormat,
  parseShareFormat,
  DEFAULT_SHARE_FORMAT,
} from "../sskr/transport.js";
import { SHARE_FORMAT_NAMES, type WrittenShare } from "../sskr/share-set.js";
import {
  exportSskrCards,
  exportSskrPdf,
  exportSskrImages,
  type SskrExportOptions,
  type SskrRenderOptions,
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
  const template = value(args, "template") ?? DEFAULT_SHARE_TEMPLATE_ID;
  const { style } = resolveTemplateId(template, "colors");
  const requested = parseSskrLayout(value(args, "card-layout"));
  const settings = businessOptions(args, template);
  return {
    ...settings,
    style,
    // Resolved here so that the messages below describe what is actually written.
    layout: resolveSskrLayout(requested, settings.pageSize),
    directory: value(args, "cards-dir") ?? "",
    imageFormat: cardFileFormat(args),
    shareFormat,
  };
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
  console.log(writeShare(ur, format));
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
  if (options !== undefined) await saveShareCards(shares, args, options, keep);
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
function saveShareQrsInside(
  shares: readonly string[],
  options: ShareCardOptions,
  folder: string,
): Promise<void> {
  return saveShareQrs(shares, options, (code) => saveQrInside(code.payload, folder, code.name));
}

/** Saves the cards, the PDF and the images of the shares that the options name. */
async function saveShareCards(
  shares: readonly string[],
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
      cards = await exportSskrCards(shares, { ...options, directory: path });
    },
  );
  if (directory !== undefined) {
    terminalNotice(
      `Saved ${cards} ${options.imageFormat.toUpperCase()} files to: ${directory}`,
      "success",
    );
    await saveShareQrsInside(shares, options, directory);
    keep(
      options.layout === "individual"
        ? "folders"
        : options.imageFormat !== "pdf"
          ? "pages"
          : "files",
    );
  }
  const pdf = await saveOutput(args, "pdf", "The PDF of the shares", (path) =>
    exportSskrPdf(shares, options, path),
  );
  if (pdf !== undefined) {
    terminalNotice(`Saved SSKR collection PDF: ${pdf}`, "success");
    keep("file");
    await saveShareQrs(shares, options, (code) =>
      saveQrBeside(code.payload, pdf, `-${code.reference}`),
    );
  }
  let pages = 0;
  const images = await saveOutput(
    args,
    "images-dir",
    "The folder of share images",
    async (path) => {
      pages = await exportSskrImages(shares, options, path, imageFormat(args));
    },
  );
  if (images !== undefined) {
    savedPagesNotice(args, pages, images, "SSKR");
    keep("folder");
    await saveShareQrsInside(shares, options, images);
  }
}

/**
 * The QR code of each share's sheets, also saved as an image where the cards went (`save`), which
 * Restore reads back (--share-qr): one for each share, none when the sheets print no QR code.
 */
async function saveShareQrs(
  shares: readonly string[],
  options: SskrRenderOptions,
  save: (code: ShareQrCode) => Promise<string>,
): Promise<void> {
  const codes = new ShareCardSet(nodeCardRenderer, shares, options).qrCodes;
  for (const code of codes) await save(code);
  if (codes.length > 0)
    terminalNotice(
      `Saved the QR code of each share's sheets as an image beside them: ${codes.length} PNG ${codes.length === 1 ? "file" : "files"}.`,
      "success",
    );
}
