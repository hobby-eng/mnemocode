import { ExportDetails } from "./export-details.js";
import { checkedCardPresentation } from "./card-copy.js";
import {
  assertPageSettings,
  isCardPageSize,
  assertSeparateCardSize,
  SHEET_PAGE_SIZE,
  type CardOrientation,
} from "./card-settings.js";
import { PDFDocument } from "pdf-lib";
import type { CardContent } from "./backup-cards.js";
import type { CardDrawing, CardTemplate } from "./templates.js";
import { separateCardName } from "./card-codes.js";
import { joinedDocuments, savedWithoutMetadata, type NamedDocument } from "./pdf-documents.js";
import { assertColorCardContent, EMPTY_CARD_COLLECTION } from "./card-content.js";
import { assertSheetQr } from "./content-kinds.js";
import { withPlannedDecoys } from "./card-plan.js";
import { keptIndividualCards } from "./card-decoys.js";
import { SHEETS_ONLY, sheetsOnly } from "./template-catalog.js";
import { defined } from "../core/defined.js";
import { wipeAll } from "../core/bits.js";
import { checkedExportFileName } from "./file-name.js";
import { OwnedCardContent } from "./card-values.js";
import { Redacted } from "../core/redacted.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.render", {
  "no-cards-to-render": () => "No cards to render: no design was given.",
  "template-does-not-support": (value0: string, value1: string) =>
    `Template ${value0} does not support ${value1}.`,
  "template-rendered-empty-document": (value0: string) =>
    `Template ${value0} rendered an empty document.`,
  "assert-individual-template-refused": suppliedMessage,
  "no-individual-cards": () => NO_INDIVIDUAL_CARDS,
  "empty-card-collection": () => EMPTY_CARD_COLLECTION,
});

/** One card output: the design that draws it and the content it draws. */
export interface CardJob {
  /**
   * The design that draws it; one of another kind than the content is refused
   * (export.render.template-does-not-support).
   */
  readonly template: CardTemplate;
  /** The codes, the settings and the texts that the design draws; its decoys once planned. */
  readonly content: CardContent;
}

/** A separate card, named by its position and the reference it prints. */
export type RenderedCard = NamedDocument;

/** The card outputs of a save: sheets (renderCards) and separate cards (renderIndividualCards). */
export interface CardOutputs {
  /** Sheets of cards, in a PDF or as page images. */
  readonly sheets: boolean;
  /** Separate cards, one file for each card. */
  readonly cards: boolean;
}

/**
 * `content` with the decoys that `template` plans for it (withPlannedDecoys): for `separate`
 * cards, or for its sheet. A design that a host made without a sheet shape adds none.
 */
function plannedContent(
  drawing: CardDrawing,
  template: CardTemplate,
  content: CardContent,
  separate: boolean,
): Promise<CardContent> {
  const { sheetShape } = template;
  if (sheetShape === undefined) return Promise.resolve(content);
  return withPlannedDecoys(sheetShape, drawing, content, separate);
}

/**
 * `job` with the decoys that its template plans (plannedContent): for separate cards where its
 * page has a card size. A host that saves one export in several files, such as a PDF and its page
 * images, plans it once and passes it to each, so that every file shows the same cards. Refuses a
 * page size or an orientation of none (export.card-settings.page-size,
 * export.card-settings.orientation), and what withPlannedDecoys refuses, such as cards that no
 * sheet holds (export.collection-layout.no-room).
 */
export async function plannedCardJob(drawing: CardDrawing, job: CardJob): Promise<CardJob> {
  assertPageSettings(job.content);
  const separate = isCardPageSize(job.content.pageSize);
  return { ...job, content: await plannedContent(drawing, job.template, job.content, separate) };
}

/**
 * The cards of one export planned once (plannedCardJob) for every file of it, each retry included,
 * so that its PDF, its page images and its card files show the same cards: the library's owner of
 * the cards of a backup, as ShareCardSet is of those of a share (AUD-037-ARC002). Its planned codes
 * live in owned text until wipe or dispose (OwnedCardContent); each job is a fresh view.
 */
export class PlannedCards extends Redacted implements Disposable {
  readonly #template: CardTemplate;
  readonly #content: OwnedCardContent<CardContent>;

  private constructor(template: CardTemplate, content: OwnedCardContent<CardContent>) {
    super("PlannedCards");
    this.#template = template;
    this.#content = content;
  }

  /** The cards of `job`, planned with the services of `drawing`; refused as plannedCardJob is. */
  static async plan(drawing: CardDrawing, job: CardJob): Promise<PlannedCards> {
    const planned = await plannedCardJob(drawing, job);
    return new PlannedCards(planned.template, new OwnedCardContent(planned.content));
  }

  /** The planned job, its codes fresh views; refused once wiped (core.secret-value.wiped). */
  get job(): CardJob {
    return { template: this.#template, content: this.#content.content };
  }

  /** Wipes the planned codes; a later job is refused. */
  wipe(): void {
    this.#content.wipe();
  }

  /** Wipes the planned codes when the owning scope ends (wipe); a later job is refused. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * `job`, planned for a sheet (plannedCardJob), as separate cards draw it: every real code and one
 * decoy kept, its orientation the one the person gave, never the one the sheet plan chose, which turns a
 * sheet, not the page of one card (AUD-022-FUN002). Refuses a count of decoys that is no whole
 * number below the cards (export.card-decoys.decoy-cards-whole-number-fewer-than-cards).
 */
export function separateCardJob(job: CardJob, orientation: CardOrientation | undefined): CardJob {
  const { orientation: _planned, ...content } = job.content;
  const cards =
    content.decoys === undefined || content.decoys === 0 ? content : keptIndividualCards(content);
  return { ...job, content: orientation === undefined ? cards : { ...cards, orientation } };
}

/**
 * Preview and encode share this path; no simplified preview renderer exists.
 * A sheet size gives one page per template. A card size gives one page per card. Every card is
 * drawn with `drawing`, the host's CardRenderer. Refuses no job at all
 * (export.render.no-cards-to-render); before any choice is made, a page setting that no card family
 * prints (assertPageSettings) and a design without separate cards for colour cards of a card size
 * (export.render.assert-individual-template-refused); a design of another kind than its content
 * (export.render.template-does-not-support); a QR code on separate cards
 * (export.content-kinds.qr-code-printed-on-sheet-only-choose-size); texts of the design that
 * checkedCardPresentation refuses; and a design that draws no page
 * (export.render.template-rendered-empty-document). What a design refuses passes on, such as
 * content that assertColorCardContent refuses.
 */
export async function renderCards(
  drawing: CardDrawing,
  jobs: readonly CardJob[],
): Promise<Uint8Array> {
  if (jobs.length === 0) throw ERRORS.create("no-cards-to-render", []);
  // Every page setting is checked before any choice is made or any template draws
  // (AUD-012-FUN006), and so is every design that a card page size draws as separate cards.
  for (const { template, content } of jobs) {
    assertPageSettings(content);
    if (content.kind === "colors" && isCardPageSize(content.pageSize))
      assertIndividualTemplate(template, jobs.length > 1);
  }
  // One person and one set of texts for every design; the employer suits the first.
  const details = ExportDetails.of(
    drawing.randomInt,
    defined(jobs[0]).content,
    defined(jobs[0]).template.style,
  );
  const pages: Uint8Array[] = [];
  try {
    for (const { template, content } of jobs) {
      if (template.kind !== content.kind)
        throw ERRORS.create("template-does-not-support", [
          `${template.id}`,
          `${String(content.kind)}`,
        ]);
      // A design's own texts and details print over those of the export.
      const resolved: CardContent = {
        ...content,
        presentation: checkedCardPresentation(content.presentation) ?? details.presentation,
        profile: { ...details.profile, ...content.profile },
        cardQr: content.cardQr === true,
      };
      assertSheetQr(resolved);
      if (resolved.kind === "colors" && isCardPageSize(resolved.pageSize)) {
        for (const card of await renderIndividualCards(drawing, template, resolved))
          pages.push(card.bytes);
        continue;
      }
      const planned = await plannedContent(drawing, template, resolved, false);
      // Without a page size every template uses the A6 sheet.
      const bytes = await template.render(drawing, {
        ...planned,
        pageSize: planned.pageSize ?? SHEET_PAGE_SIZE,
      });
      pages.push(bytes);
      const source = await PDFDocument.load(bytes);
      if (source.getPageCount() === 0)
        throw ERRORS.create("template-rendered-empty-document", [`${template.id}`]);
    }
    if (pages.length === 1) {
      return await savedWithoutMetadata(await PDFDocument.load(defined(pages[0])));
    }
    return await joinedDocuments(pages);
  } finally {
    wipeAll(pages);
  }
}

/** Why content cannot be drawn as separate cards. */
const NO_INDIVIDUAL_CARDS = "Only color codes are drawn as individual business cards.";

/**
 * Refuses a template that draws no separate cards, such as a design printed on sheets only
 * (SHEETS_ONLY; export.render.assert-individual-template-refused): also before any content exists.
 * `named`: the design is one of several drawn together, and the refusal names it.
 */
export function assertIndividualTemplate(template: CardTemplate, named = false): void {
  if (!template.renderIndividual)
    throw ERRORS.create("assert-individual-template-refused", [
      named ? sheetsOnly(`The design "${template.name}"`) : SHEETS_ONLY,
    ]);
}

/**
 * Refuses what cannot be drawn as separate cards: a template without separate cards
 * (export.render.assert-individual-template-refused), content that is no colors
 * (export.render.no-individual-cards), no card at all (export.render.empty-card-collection),
 * colors that are not the backup that its QR code holds (assertColorCardContent), a page setting
 * that no card family prints (export.card-settings.page-size, export.card-settings.orientation),
 * or a sheet size (export.card-settings.separate-cards-business-size-choose-business-size-leave).
 * The export of a folder of cards checks it before any file is touched, and the drawing of the
 * cards again (AUD-012-ARC007).
 */
export function assertIndividualCards(template: CardTemplate, content: CardContent): void {
  assertIndividualTemplate(template);
  if (content.kind !== "colors") throw ERRORS.create("no-individual-cards", []);
  if (!content.colors.length) throw ERRORS.create("empty-card-collection", []);
  assertColorCardContent(content);
  assertPageSettings(content);
  assertSeparateCardSize(content.pageSize);
}

/**
 * One document per card, all sharing one identity, drawn with `drawing`. Refuses what
 * assertIndividualCards refuses, before any choice is made; what the design refuses passes on,
 * and so does a card name that checkedExportFileName refuses (export.file-name.invalid-component).
 */
export async function renderIndividualCards(
  drawing: CardDrawing,
  template: CardTemplate,
  content: CardContent,
): Promise<RenderedCard[]> {
  assertIndividualCards(template, content);
  // Checked by assertIndividualCards.
  const renderIndividual = defined(template.renderIndividual);
  const { profile, presentation } = ExportDetails.of(drawing.randomInt, content, template.style);
  const resolvedContent = await plannedContent(
    drawing,
    template,
    { ...content, presentation, profile, cardQr: content.cardQr === true },
    true,
  );
  const cards: RenderedCard[] = [];
  try {
    for (let index = 0; index < resolvedContent.colors.length; index++) {
      cards.push({
        name: checkedExportFileName(separateCardName(resolvedContent, index)),
        bytes: await renderIndividual(drawing, resolvedContent, index),
      });
    }
    return cards;
  } catch (error) {
    wipeAll(cards.map((card) => card.bytes));
    throw error;
  }
}
