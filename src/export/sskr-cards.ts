import { resolveIdentityFor, sectorForTemplate } from "./card-identities.js";
import { resolvePresentationFor } from "./card-copy.js";
import { clearDocumentMetadata } from "./document-metadata.js";
import { writeRenderedDocument, exportPageImages, type ImageFormat } from "./image-export.js";
import { renderMaterialCard } from "./material-cards.js";
import { renderGlassCards } from "./glass-cards.js";
import { materialArtwork, type MaterialStyle } from "./material-artwork.js";
import "./platform-node.js";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { publishNewPrivateFile } from "./private-file.js";
import { businessStyles } from "./business-designs.js";
import { PDFDocument } from "pdf-lib";
import { dirname, join } from "node:path";
import {
  shareInfo,
  shareToColors,
  urToTransport,
  validateShareSet,
  writeShare,
  type ShareFormat,
} from "../sskr/transport.js";
import { renderBusinessCards } from "./business-cards.js";
import { requireNewCardDirectory } from "./individual-cards.js";
import type { BusinessStyle, CardSettings } from "./card-settings.js";
import { resolveSskrLayout, type SskrCardContent, type SskrCardLayout } from "./sskr-content.js";

export interface SskrExportOptions extends CardSettings {
  readonly style: BusinessStyle | MaterialStyle | "glass-4in1" | "glass-6in1" | "glass-8in1";
  /** Omitted: decided by the page size. */
  readonly layout?: SskrCardLayout;
  /**
   * The form of the shares. A QR code holds the color codes that the card prints, unless the
   * shares are written as word numbers or Unicode codes: then it holds them in that form, so that
   * a share read from it comes back as it was written.
   */
  readonly shareFormat?: ShareFormat;
  readonly directory: string;
  readonly imageFormat?: ImageFormat;
}

/** Share forms that a QR code of a share card holds as they are; any other gives the colors. */
const QR_FORMS: ReadonlySet<ShareFormat> = new Set(["indexes", "unicode", "colors-unicode"]);

function glassReferencesPerCard(style: SskrExportOptions["style"]): 4 | 6 | 8 | undefined {
  if (style === "glass-4in1") return 4;
  if (style === "glass-6in1") return 6;
  if (style === "glass-8in1") return 8;
  return undefined;
}

type ResolvedOptions = Omit<SskrExportOptions, "directory" | "layout"> & {
  readonly layout: SskrCardLayout;
};

async function renderMember(
  options: ResolvedOptions,
  content: SskrCardContent,
  index: number,
  member: number,
): Promise<Uint8Array> {
  const referencesPerCard = glassReferencesPerCard(options.style);
  if (referencesPerCard !== undefined)
    return renderGlassCards(
      content,
      options.layout === "individual" ? index : undefined,
      referencesPerCard,
    );
  if (Object.hasOwn(materialArtwork, options.style))
    return renderMaterialCard(options.style as MaterialStyle, content, {
      individualIndex: options.layout === "individual" ? index : undefined,
    });
  return renderBusinessCards(
    options.style as BusinessStyle,
    content,
    options.layout === "collection" ? undefined : index,
    options.layout === "qr" ? member : 0,
  );
}

function prepareMembers(
  records: readonly string[],
  requested: Omit<SskrExportOptions, "directory">,
) {
  if (
    requested.layout !== undefined &&
    !["qr", "collection", "individual"].includes(requested.layout)
  )
    throw new Error("Card layout must be qr, collection, or individual.");
  const options: ResolvedOptions = {
    ...requested,
    layout: resolveSskrLayout(requested.layout, requested.pageSize),
  };
  if (
    options.style !== "mixed" &&
    glassReferencesPerCard(options.style) === undefined &&
    !Object.hasOwn(materialArtwork, options.style) &&
    !businessStyles.some((style) => style === options.style)
  )
    throw new Error("Unsupported SSKR card style.");
  const presentation = resolvePresentationFor(options);
  const profile = resolveIdentityFor(options, sectorForTemplate(options.style));
  const shares = validateShareSet(records, false);
  const referencesPerCard = glassReferencesPerCard(options.style) ?? 1;
  return shares.map((share) => {
    const info = shareInfo(urToTransport(share));
    const id =
      `${info.identifier.toString(16).padStart(4, "0")}-${info.groupIndex + 1}-${info.memberIndex + 1}`.toUpperCase();
    const colors = shareToColors(share);
    const qrFormat = QR_FORMS.has(options.shareFormat ?? "colors")
      ? options.shareFormat!
      : "colors";
    const content: SskrCardContent = {
      ...options,
      kind: "sskr",
      colors,
      payload: writeShare(share, qrFormat),
      collectionReference: id,
      qrCard: options.layout === "qr",
      cardQr: options.layout === "qr" || options.cardQr === true,
      presentation,
      profile,
    };
    // A fragment contains only its own consecutive references; grouping restarts per member.
    const fragmentCount = Math.ceil(colors.length / referencesPerCard);
    const count = options.layout === "individual" ? fragmentCount : 1;
    return {
      id,
      memberIndex: info.memberIndex,
      content,
      colors,
      referencesPerCard,
      count,
      options,
    };
  });
}

/** Exports existing shares without generating a new set. Each file contains at most one share. */
export async function exportSskrCards(
  records: readonly string[],
  options: SskrExportOptions,
): Promise<number> {
  const members = prepareMembers(records, options);
  const target = await requireNewCardDirectory(options.directory);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".sskr-cards-"));
  let files = 0;
  try {
    for (const member of members) {
      const { id, memberIndex, content, colors, referencesPerCard, count } = member;
      const fragments = member.options.layout === "individual";
      const folder = fragments ? join(staging, `collection-${id}`) : staging;
      // Private like the staging folder: the card names carry the share's references.
      if (fragments) await mkdir(folder, { mode: 0o700 });
      for (let i = 0; i < count; i++) {
        const bytes = await renderMember(member.options, content, i, memberIndex);
        const file = fragments
          ? `${String(i + 1).padStart(2, "0")}-${colors[i * referencesPerCard]!.slice(1)}`
          : `collection-${id}`;
        files += await writeRenderedDocument(
          bytes,
          join(folder, file),
          options.imageFormat ?? "pdf",
        );
      }
    }
    await requireNewCardDirectory(target);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return files;
}

/** Each page belongs to one share; the combined file contains the complete supplied set. */
export async function renderSskrPdf(
  records: readonly string[],
  options: Omit<SskrExportOptions, "directory">,
): Promise<Uint8Array> {
  const members = prepareMembers(records, options);
  const combined = await PDFDocument.create();
  for (const member of members) {
    const { content, memberIndex, count } = member;
    for (let index = 0; index < count; index++) {
      const bytes = await renderMember(member.options, content, index, memberIndex);
      const source = await PDFDocument.load(bytes);
      for (const page of await combined.copyPages(source, source.getPageIndices()))
        combined.addPage(page);
    }
  }
  clearDocumentMetadata(combined);
  return combined.save();
}

export async function exportSskrPdf(
  records: readonly string[],
  options: Omit<SskrExportOptions, "directory">,
  path: string,
): Promise<void> {
  await publishNewPrivateFile(path, await renderSskrPdf(records, options));
}

export async function exportSskrImages(
  records: readonly string[],
  options: Omit<SskrExportOptions, "directory">,
  directory: string,
  format: ImageFormat = "png",
): Promise<number> {
  return exportPageImages(await renderSskrPdf(records, options), directory, format);
}
