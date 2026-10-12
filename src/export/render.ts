import { ExportDetails } from "./export-details.js";
import {
  assertPageSettings,
  assertSheetQr,
  isCardPageSize,
  assertSeparateCardSize,
  SHEET_PAGE_SIZE,
} from "./card-settings.js";
import { PDFDocument } from "pdf-lib";
import type { CardContent } from "./backup-cards.js";
import type { CardDrawing, CardTemplate } from "./templates.js";
import {
  assertReferencesPerCard,
  cardCount,
  ONE_REFERENCE_PER_CARD,
  separateCardName,
} from "./card-codes.js";
import { joinedDocuments, savedWithoutMetadata, type NamedDocument } from "./pdf-documents.js";
import { assertColorCardContent, EMPTY_CARD_COLLECTION } from "./card-content.js";

export interface CardJob {
  readonly template: CardTemplate;
  readonly content: CardContent;
}

/** A separate card, named by its position and the first reference it prints. */
export type RenderedCard = NamedDocument;

/**
 * Preview and encode share this path; no simplified preview renderer exists.
 * A sheet size gives one page per template. A card size gives one page per card. Every card is
 * drawn with `drawing`, the host's CardRenderer.
 */
export async function renderCards(
  drawing: CardDrawing,
  jobs: readonly CardJob[],
): Promise<Uint8Array> {
  if (jobs.length === 0) throw new Error("No approved card templates are installed yet.");
  // Every page setting and design is checked before any choice is made or any template draws
  // (AUD-012-FUN006, AUD-014-API003).
  for (const { template, content } of jobs) {
    assertTemplateCapacity(template);
    assertPageSettings(content);
  }
  // One person and one set of texts for every design; the employer suits the first.
  const details = ExportDetails.of(drawing.randomInt, jobs[0]!.content, jobs[0]!.template.style);
  const pages: Uint8Array[] = [];
  for (const { template, content } of jobs) {
    if (template.kind !== content.kind)
      throw new Error(`Template ${template.id} does not support ${content.kind}.`);
    // A design's own texts and details print over those of the export.
    const resolved: CardContent = {
      ...content,
      presentation: content.presentation ?? details.presentation,
      profile: { ...details.profile, ...content.profile },
      cardQr: content.cardQr === true,
    };
    assertSheetQr(resolved);
    if (resolved.kind === "colors" && isCardPageSize(resolved.pageSize)) {
      for (const card of await renderIndividualCards(drawing, template, resolved))
        pages.push(card.bytes);
      continue;
    }
    // Without a page size every template uses the A6 sheet.
    const bytes = await template.render(drawing, {
      ...resolved,
      pageSize: resolved.pageSize ?? SHEET_PAGE_SIZE,
    });
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() === 0)
      throw new Error(`Template ${template.id} rendered an empty document.`);
    pages.push(bytes);
  }
  if (pages.length === 1) {
    return savedWithoutMetadata(await PDFDocument.load(pages[0]!));
  }
  return joinedDocuments(pages);
}

/** Why a template or content cannot be drawn as separate cards. */
const NO_INDIVIDUAL_CARDS = "This template does not support individual business cards.";

/** The references that one card of `template` holds: its own count, or one where it has none. */
function referencesPerCardOf(template: CardTemplate): number {
  return template.referencesPerCard ?? ONE_REFERENCE_PER_CARD;
}

/**
 * Refuses a template whose cards hold no whole number of references (assertReferencesPerCard): a
 * design made by a host may give any count from one, which is checked before anything is counted,
 * chosen or named after it (AUD-014-API003).
 */
function assertTemplateCapacity(template: CardTemplate): void {
  assertReferencesPerCard(referencesPerCardOf(template));
}

/**
 * Refuses a template that draws no separate cards, or whose cards hold no whole number of
 * references: also before any content exists.
 */
export function assertIndividualTemplate(template: CardTemplate): void {
  if (!template.renderIndividual) throw new Error(NO_INDIVIDUAL_CARDS);
  assertTemplateCapacity(template);
}

/**
 * Refuses what cannot be drawn as separate cards: content that is no colors, or whose colors are
 * not the backup that its QR code holds (assertColorCardContent), a template without separate
 * cards or whose cards hold no whole number of references, no card at all, a page setting that
 * no card family prints, or a sheet size. The export of a folder of cards checks it before any
 * file is touched, and the drawing of the cards again (AUD-012-ARC007).
 */
export function assertIndividualCards(template: CardTemplate, content: CardContent): void {
  assertIndividualTemplate(template);
  if (content.kind !== "colors") throw new Error(NO_INDIVIDUAL_CARDS);
  if (!content.colors.length) throw new Error(EMPTY_CARD_COLLECTION);
  assertColorCardContent(content);
  assertPageSettings(content);
  assertSeparateCardSize(content.pageSize);
}

/** One document per card or reference group, all sharing one identity, drawn with `drawing`. */
export async function renderIndividualCards(
  drawing: CardDrawing,
  template: CardTemplate,
  content: CardContent,
): Promise<RenderedCard[]> {
  assertIndividualCards(template, content);
  // Checked by assertIndividualCards.
  const renderIndividual = template.renderIndividual!;
  const { profile, presentation } = ExportDetails.of(drawing.randomInt, content, template.style);
  const resolvedContent: CardContent = {
    ...content,
    presentation,
    profile,
    cardQr: content.cardQr === true,
  };
  const perCard = referencesPerCardOf(template);
  const count = cardCount(content.colors.length, perCard);
  const cards: RenderedCard[] = [];
  for (let index = 0; index < count; index++) {
    cards.push({
      name: separateCardName(content, index, perCard),
      bytes: await renderIndividual(drawing, resolvedContent, index),
    });
  }
  return cards;
}
