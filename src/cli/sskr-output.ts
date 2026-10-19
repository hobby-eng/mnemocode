// What the share commands write: the shares in their forms on the screen, and the files, cards and
// QR codes that the options name, each saved with a choice after a failure (save-retry.ts).

import { imageFormat, cardFileFormat, savedPagesNotice } from "./image-options.js";
import {
  assertSeparateCards,
  DEFAULT_SHARE_TEMPLATE_ID,
  resolveTemplateId,
} from "../export/template-catalog.js";
import { resolveSskrLayout, parseSskrLayout } from "../export/sskr-content.js";
import {
  printableText,
  codeLines,
  resultHeaderLines,
  terminalLine,
  terminalNotice,
  terminalWork,
  type Channel,
} from "./terminal.js";
import { PrivateSteps } from "./private-steps.js";
import { STYLE_CODES } from "./terminal-style.js";
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
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { PrivateResult } from "./private-result.js";

const ERRORS = new ErrorCatalog("cli.sskr-output", {
  "share-formats-not-bip39-representations": (value0: string) =>
    `${value0} These are share formats, not BIP39 representations.`,
});

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
  if (options === undefined) return;
  terminalWork("Checking that the share cards can be printed…");
  await ShareCardSet.assertPrintable(nodeCardRenderer, options);
}

export function shareFormat(args: ParsedArguments): ShareFormat {
  try {
    return parseShareFormat(value(args, "format") ?? DEFAULT_SHARE_FORMAT);
  } catch (error) {
    throw ERRORS.create("share-formats-not-bip39-representations", [`${refusalMessage(error)}`]);
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
  printShareLines(shareBlockLines(title, ur, format, holds));
}

type ShareLine = readonly [Channel, string];

function shareBlockLines(
  title: string,
  ur: string,
  format: ShareFormat,
  holds: string | undefined,
): ShareLine[] {
  const form = SHARE_FORMAT_NAMES[format];
  const facts: [string, string][] = [["Format", form]];
  if (holds !== undefined) facts.push(["Holds", holds]);
  const header = resultHeaderLines(title, facts);
  const heading: ShareLine[] =
    header.length === 0
      ? [["stderr", `${title} — ${form}${holds === undefined ? "" : `, holds ${holds}`}:`]]
      : header.map((line) => ["stdout", line] as const);
  return [
    ...heading,
    ...codeLines(writeShare(ur, format), MIRRORED_FORM[format]).map(
      (line) => ["stdout", line] as const,
    ),
  ];
}

function printShareLines(lines: readonly ShareLine[]): void {
  PrivateSteps.showResult();
  for (const [channel, line] of lines) terminalLine(channel, line);
}

/**
 * Prints shares as "SSKR share N of M", by their places among the `total` made or typed, with what
 * they hold where that is known (PHRASE_WORDS), so that a masked phrase is not taken for the
 * wallet's.
 */
export async function printShares(
  shares: readonly WrittenShare[],
  total: number = shares.length,
  holds?: string,
): Promise<Cancelled | undefined> {
  const lines = shares.flatMap((share) =>
    shareBlockLines(`SSKR share ${share.number} of ${total}`, share.ur, share.format, holds),
  );
  // Measure what the fallback actually prints; styling has no terminal width. A compact summary
  // omits the result facts and the separated-code view, so even three shares can overflow it.
  using display = new PrivateResult(lines.map(([, line]) => line.replace(STYLE_CODES, "")));
  return await display.show(() => printShareLines(lines));
}

// Saving, with a choice after a failure (save-retry.ts).

/**
 * Saves the shares where the options say, each output with saveOutput, each followed by how its
 * shares are kept (shareKeepingNote): `masked` says that they hold the masked phrase. CANCELLED
 * when the command was cancelled at the question after a failed save; the outputs saved before
 * stay.
 */
export async function saveShares(
  shown: readonly WrittenShare[],
  args: ParsedArguments,
  options: ShareCardOptions | undefined,
  masked: boolean,
): Promise<Cancelled | undefined> {
  const shares = shown.map((share) => share.ur);
  const keep = (packaging: ShareCardPackaging): void =>
    terminalNotice(shareKeepingNote(shares, packaging, masked));
  if (options !== undefined) terminalWork("Rendering the share cards…");
  // One set of cards for every file, so that each shows the same decoys.
  if (options !== undefined) {
    using cards = await nodeShareCards(shares, options);
    if ((await saveShareCards(cards, args, options, keep)) === CANCELLED) return CANCELLED;
  }
  // Each share in its form, as the terminal shows it.
  const lines = shown.map((share) => writeShare(share.ur, share.format));
  const output = await saveOutput(args, "output", "The file of the shares", (path) =>
    // The shares in the open: their bytes are wiped once this attempt has saved or failed.
    wipedAfterAsync(new TextEncoder().encode(lines.join("\n") + "\n"), (bytes) =>
      publishNewPrivateFile(path, bytes),
    ),
  );
  if (output === CANCELLED) return CANCELLED;
  if (output !== undefined) {
    terminalNotice(
      `Saved SSKR records: ${printableText(output)} (one complete share per line).`,
      "success",
    );
    keep("file");
  }
  return undefined;
}

/** The QR codes of the shares saved in `folder`, a folder of cards or images just saved. */
function saveShareQrsInside(cards: ShareCardSet, folder: string): Promise<Cancelled | undefined> {
  return saveShareQrs(cards, (code) => saveQrInside(code.payload, folder, code.name));
}

/** Saves the cards, the PDF and the images of the shares that the options name, from `set`. */
async function saveShareCards(
  set: ShareCardSet,
  args: ParsedArguments,
  options: ShareCardOptions,
  keep: (packaging: ShareCardPackaging) => void,
): Promise<Cancelled | undefined> {
  let cards = 0;
  const directory = await saveOutput(
    args,
    "cards-dir",
    "The folder of share cards",
    async (path) => {
      cards = await exportSskrCards(set, path, options.imageFormat);
    },
  );
  if (directory === CANCELLED) return CANCELLED;
  if (directory !== undefined) {
    terminalNotice(
      `Saved ${cards} ${options.imageFormat.toUpperCase()} files to: ${printableText(directory)}`,
      "success",
    );
    if ((await saveShareQrsInside(set, directory)) === CANCELLED) return CANCELLED;
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
  if (pdf === CANCELLED) return CANCELLED;
  if (pdf !== undefined) {
    terminalNotice(`Saved SSKR collection PDF: ${printableText(pdf)}`, "success");
    keep("file");
    if (
      (await saveShareQrs(set, (code) => saveQrBeside(code.payload, pdf, `-${code.reference}`))) ===
      CANCELLED
    )
      return CANCELLED;
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
  if (images === CANCELLED) return CANCELLED;
  if (images !== undefined) {
    savedPagesNotice(args, pages, images, "SSKR");
    keep("folder");
    if ((await saveShareQrsInside(set, images)) === CANCELLED) return CANCELLED;
  }
  return undefined;
}

/**
 * The QR code of each share's sheets, also saved as an image where the cards went (`save`), which
 * Restore reads back (--share-qr): one for each share, none when the sheets print no QR code.
 */
async function saveShareQrs(
  cards: ShareCardSet,
  save: (code: ShareQrCode) => Promise<string | undefined | Cancelled>,
): Promise<Cancelled | undefined> {
  const codes = cards.qrCodes;
  let saved = 0;
  for (const code of codes) {
    const path = await save(code);
    if (path === CANCELLED) return CANCELLED;
    if (path !== undefined) saved += 1;
  }
  if (saved > 0)
    terminalNotice(
      `Saved the QR codes of the share sheets as images beside them: ${saved} PNG ${saved === 1 ? "file" : "files"}.`,
      "success",
    );
}
