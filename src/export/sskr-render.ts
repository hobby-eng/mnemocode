// Renders existing Shamir shares (SSKR) as cards in a card design: every share in one PDF, or one
// share at a time, whose documents hold that share alone. The shares are checked as one set first
// (Share.readSet), and the design, layout and invented details are settled once for the whole
// set, so that every card of it has the same studio, profile and look.
//
// Needs from the host: its CardRenderer (card-renderer.ts), built with its render platform
// (platform-node.ts in Node.js): its bundled fonts and artwork, the random choice of invented
// details, PNG decoding and encoding for the artwork, and the QR matrices of the cards.
// Does not: make, repair or combine shares, write files or folders, or turn pages into images;
// the command line does that around it (sskr-cards.ts), a page offers the bytes for download.

import {
  Share,
  shareToColors,
  isColorShareFormat,
  type ShareFormat,
  parseShareFormat,
  assertShareFormatHasCards,
  shareFormatHasCards,
} from "../sskr/transport.js";
import { IDENTIFIER_BYTES } from "../sskr/share-layout.js";
import { SSKR_LONG_VECTOR } from "../sskr/known-answers.js";
import { refusalMessage } from "../core/refusal.js";
import { ExportDetails } from "./export-details.js";
import {
  type CardSettings,
  assertPageSettings,
  assertSeparateCardSize,
  cardTitle,
  SEPARATE_CARD_SIZE,
  SHEET_PAGE_SIZE,
} from "./card-settings.js";
import { printedCode, separateCardName } from "./card-codes.js";
import type { UniformChoice } from "./platform.js";
import { catalogSheetShape, renderCatalogDesign, type CardDrawing } from "./templates.js";
import {
  resolveSskrLayout,
  type SskrCardContent,
  type SskrCardLayout,
  parseSskrLayout,
} from "./sskr-content.js";
import { joinedDocuments, type NamedDocument } from "./pdf-documents.js";
import {
  assertSeparateCards,
  designOfStyle,
  type CardStyle,
  type CatalogEntry,
} from "./template-catalog.js";
import { codeColors } from "./card-palette.js";
import { ownCards, keptIndividualCards } from "./card-decoys.js";
import { withPlannedDecoys, type SheetShaper } from "./card-plan.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { Redacted } from "../core/redacted.js";
import { defined } from "../core/defined.js";
import { HEX_DIGITS_PER_BYTE } from "../core/bits.js";
import { LONGEST_WORD_COUNT } from "../core/bip39-sizes.js";
import { OwnedCardContent } from "./card-values.js";

const ERRORS = new ErrorCatalog("export.sskr-render", {
  "unsupported-sskr-card-style": () => "Unsupported SSKR card style.",
  "share-cards-cannot-printed-every-seed-phrase-longest": (value0: string) =>
    `These share cards cannot be printed for every seed phrase, the longest of ${LONGEST_WORD_COUNT} words included: ${value0}`,
  "there-no-share-at-place-set": () => "There is no share at that place in the set.",
  "qr-cards-cannot-become-fragments": () =>
    "A whole-share QR card cannot become individual fragments. Start with a collection sheet.",
  "individual-settings-object": {
    kind: "type",
    text: () => "Individual card settings must be an object.",
  },
});

/**
 * How the cards of shares are drawn: the design, the layout, unless the page size decides it, and
 * the card settings.
 */
export interface SskrRenderOptions extends CardSettings {
  /**
   * The design of the cards, by its style (TEMPLATE_CATALOG); a text that names no style is
   * refused (export.sskr-render.unsupported-sskr-card-style), and a design printed on sheets only
   * is refused for separate cards (export.template-catalog.sheets-only).
   */
  readonly style: CardStyle;
  /** Omitted: decided by the page size. */
  readonly layout?: SskrCardLayout;
  /**
   * The form of the shares: colors, or Unicode codes, which the cards print, one to a card. A QR
   * code holds what the cards print, so that a share read from it comes back as it was written.
   * Word numbers, Bytewords and the UR have no cards (shareFormatHasCards).
   */
  readonly shareFormat?: ShareFormat;
  /**
   * The title of each share's sheet, where a design shows one, in place of the studio name: a text
   * of a card, refused as the title of a sheet (cardTitle) before anything is chosen.
   */
  readonly title?: string | undefined;
}

/** One share of the set, as its cards are made. */
export interface ShareCardShare {
  /** The share's reference printed on its cards: identifier, group and member, such as 376C-1-2. */
  readonly reference: string;
  /**
   * The base name of the share's output, such as collection-376C-1-2: the file of a whole share,
   * the folder of its fragments, and the QR code image of its sheets.
   */
  readonly name: string;
  /** How many documents its cards take: one per card for separate cards, otherwise one. */
  readonly documents: number;
  /**
   * The folder that keeps its fragments together, such as collection-376C-1-2, or undefined when
   * the share is one document.
   */
  readonly folder: string | undefined;
}

/** One document of a share. */
export type ShareCardDocument = NamedDocument;

type ResolvedOptions = Omit<SskrRenderOptions, "layout"> & { readonly layout: SskrCardLayout };

interface Member {
  readonly share: ShareCardShare;
  readonly memberIndex: number;
  readonly owned: OwnedCardContent<SskrCardContent>;
}

function ownedMember(share: ShareCardShare, memberIndex: number, content: SskrCardContent): Member {
  return { share, memberIndex, owned: new OwnedCardContent(content) };
}

function contentOf(member: Member): SskrCardContent {
  return member.owned.content;
}

/**
 * The cards of one set of shares. A class, so that the options, the shares, the invented details
 * and the decoys are checked and settled once, as the set is made (ShareCardSet.create), and every
 * document rendered from it belongs to the same set. It renders on request and keeps no rendered
 * document. Its retained codes live in owned bytes until wipe/dispose; returned views cannot be
 * recalled. Its creating caller keeps it live through awaited renders, then ends its scope.
 */
export class ShareCardSet extends Redacted implements Disposable {
  readonly #drawing: CardDrawing;
  readonly #options: ResolvedOptions;
  /** The design of the cards, whose family draws them (template-catalog.ts). */
  readonly #design: CatalogEntry;
  readonly #members: readonly Member[];

  private constructor(
    drawing: CardDrawing,
    options: ResolvedOptions,
    design: CatalogEntry,
    members: readonly Member[],
  ) {
    super("ShareCardSet");
    this.#drawing = drawing;
    this.#options = options;
    this.#design = design;
    this.#members = members;
  }

  /**
   * Checks the layout, the title (cardTitle), the style and the shares, settles the details of the
   * cards, which are drawn with `drawing`, the host's CardRenderer, and plans the decoys after each
   * share's codes (withPlannedDecoys). The decoys come from `randomInt`, the renderer's random
   * integers below a limit unless a host, such as its self-test, gives its own. Refuses, before any
   * choice is made, a layout of none (export.sskr-content.card-layout-one), a title that cardTitle
   * refuses, a form of no shares (sskr.transport.share-format-one) or of shares without cards
   * (sskr.transport.shares-written-as-no-cards-cards-print-shares), a layout that the page size
   * does not give (resolveSskrLayout), a style of no design
   * (export.sskr-render.unsupported-sskr-card-style) and separate cards of a design printed on
   * sheets only (export.template-catalog.sheets-only); then details that ExportDetails refuses,
   * shares that Share.readSet refuses, which asks here for no quorum, and a plan that
   * withPlannedDecoys refuses.
   */
  static async create(
    drawing: CardDrawing,
    records: readonly string[],
    requested: SskrRenderOptions,
    randomInt: UniformChoice = drawing.randomInt,
  ): Promise<ShareCardSet> {
    parseSskrLayout(requested.layout);
    // As it is drawn, and refused before any choice is made, as the cards of a backup refuse it.
    const title = requested.title === undefined ? undefined : cardTitle(requested.title);
    // Checked before any choice is made: another value would print the colors silently
    // (AUD-012-FUN007).
    const suppliedFormat = requested.shareFormat;
    const format = suppliedFormat === undefined ? "colors" : suppliedFormat;
    parseShareFormat(format);
    assertShareFormatHasCards(format);
    const layout = resolveSskrLayout(requested.layout, requested.pageSize);
    const options: ResolvedOptions = {
      ...requested,
      layout,
      // Sheets are A6 when no size is given, in every design, as ordinary cards are (render.ts);
      // separate cards have the business size.
      ...(requested.pageSize === undefined && layout !== "individual"
        ? { pageSize: SHEET_PAGE_SIZE }
        : {}),
    };
    const design = designOfStyle(options.style);
    if (design === undefined) throw ERRORS.create("unsupported-sskr-card-style", []);
    if (layout === "individual") assertSeparateCards(design);
    // The details first, then the shares: the order in which the random choices are made. Copies
    // of what the caller gave (ExportDetails), so that every card rendered later shows them as they
    // were.
    const { presentation, profile } = ExportDetails.of(drawing.randomInt, options, options.style);
    const shares = Share.readSet(records, false);
    const members: Member[] = [];
    try {
      const separate = options.layout === "individual";
      const shaper: SheetShaper = (shapeDrawing, cards, pageSize) =>
        catalogSheetShape(design, shapeDrawing, cards, pageSize);
      for (const read of shares) {
        const reference = shareReference(read);
        const cards: SskrCardContent = {
          ...options,
          kind: "sskr",
          ...shareCardFace(read, format),
          collectionReference: reference,
          qrCard: options.layout === "qr",
          cardQr: options.layout === "qr" || options.cardQr === true,
          presentation,
          profile,
          ...(title === undefined ? {} : { title }),
        };
        const content = await withPlannedDecoys(shaper, drawing, cards, separate, randomInt);
        const name = `collection-${reference}`;
        const share: ShareCardShare = Object.freeze({
          reference,
          name,
          documents: separate ? content.colors.length : 1,
          folder: separate ? name : undefined,
        });
        members.push(ownedMember(share, read.info.memberIndex, content));
      }
      return new ShareCardSet(drawing, options, design, members);
    } catch (error) {
      for (const member of members) member.owned.values.wipe();
      throw error;
    } finally {
      for (const share of shares) share.wipe();
    }
  }

  /**
   * A retained collection or individual set as separate business cards: every real code and its
   * first decoy, with the same colors, identities and share references. Only the requested page
   * size (business by default) and orientation apply; the sheet's orientation is not inherited.
   * Refuses a set that was wiped (core.secret-value.wiped), settings that are no object
   * (export.sskr-render.individual-settings-object), QR cards
   * (export.sskr-render.qr-cards-cannot-become-fragments), sheet-only designs
   * (export.template-catalog.sheets-only), a page setting of none (export.card-settings.page-size,
   * export.card-settings.orientation) or a sheet size
   * (export.card-settings.separate-cards-business-size-choose-business-size-leave). Draws
   * nothing, chooses nothing and leaves this set unchanged; no separate card carries a whole-share
   * QR code.
   */
  forIndividualCards(requested: Pick<CardSettings, "pageSize" | "orientation"> = {}): ShareCardSet {
    this.#assertLive();
    if (requested === null || typeof requested !== "object" || Array.isArray(requested))
      throw ERRORS.create("individual-settings-object", []);
    if (this.#options.layout === "qr") throw ERRORS.create("qr-cards-cannot-become-fragments", []);
    assertSeparateCards(this.#design);
    // Read the host's settings once. Undefined deliberately replaces any sheet orientation.
    const pageSize = requested.pageSize;
    const individual = {
      pageSize: pageSize === undefined ? SEPARATE_CARD_SIZE : pageSize,
      orientation: requested.orientation,
      layout: "individual" as const,
      cardQr: false,
      qrCard: false,
    };
    assertPageSettings(individual);
    assertSeparateCardSize(individual.pageSize);
    const options: ResolvedOptions = { ...this.#options, ...individual };
    const members: Member[] = [];
    try {
      for (const member of this.#members) {
        const content = { ...keptIndividualCards(contentOf(member)), ...individual };
        const share = Object.freeze({
          ...member.share,
          documents: content.colors.length,
          folder: member.share.name,
        });
        members.push(ownedMember(share, member.memberIndex, content));
      }
      this.#assertLive();
      return new ShareCardSet(this.#drawing, options, this.#design, members);
    } catch (error) {
      for (const member of members) member.owned.values.wipe();
      throw error;
    }
  }

  /**
   * The layout the set resolved to (resolveSskrLayout): QR cards, collection sheets or separate
   * cards, so that a host packs the documents as they were made.
   */
  get layout(): SskrCardLayout {
    return this.#options.layout;
  }

  /** The shares, in the order they were given. */
  get shares(): readonly ShareCardShare[] {
    return this.#members.map((member) => member.share);
  }

  /**
   * The QR codes that the sheets print, one for each share in the order given: its reference and
   * the text the code holds, the share in its written form. A host may also save each as an image
   * where the cards go, which a restore reads back. None for separate cards, which never carry
   * one, nor for sheets without a QR code. Refused once the set is wiped (core.secret-value.wiped).
   */
  get qrCodes(): readonly ShareQrCode[] {
    this.#assertLive();
    if (this.#options.layout === "individual") return [];
    return this.#members
      .filter((member) => member.owned.settings.cardQr === true)
      .map((member) =>
        Object.freeze({
          reference: member.share.reference,
          name: member.share.name,
          payload: member.owned.values.view.payload,
        }),
      );
  }

  /**
   * What the cards of the share at `place` (counted from 0) print, in order, one code to a card:
   * the hex codes of its colors, or its Unicode codes, then the decoys. Refuses a place of no share
   * (export.sskr-render.there-no-share-at-place-set), and a set that was wiped
   * (core.secret-value.wiped).
   */
  printedCodes(place: number): readonly string[] {
    const content = contentOf(this.#member(place));
    return content.colors.map((_, index) => printedCode(content, index));
  }

  /**
   * How many cards of the share at `place` print the share's own codes, before the decoys. Refuses
   * a place of no share (export.sskr-render.there-no-share-at-place-set), and a set that was wiped
   * (core.secret-value.wiped).
   */
  ownCodes(place: number): number {
    return ownCards(contentOf(this.#member(place)));
  }

  /**
   * The documents of the share at `place` (counted from 0), rendered one at a time, in order.
   * Refuses a place of no share (export.sskr-render.there-no-share-at-place-set), and a set wiped
   * before or while a document is rendered (core.secret-value.wiped), whose rendered bytes are
   * wiped then; a refusal of the design passes on.
   */
  async *documents(place: number): AsyncGenerator<ShareCardDocument> {
    const member = this.#member(place);
    for (let index = 0; index < member.share.documents; index++) {
      const bytes = await this.#render(member, index);
      let name: string;
      try {
        this.#assertLive();
        name = this.#documentName(member, index);
      } catch (error) {
        bytes.fill(0);
        throw error;
      }
      yield { name, bytes };
    }
  }

  /**
   * Refuses `requested` where the cards of a share of the longest secret, 32 bytes for a 24-word
   * phrase (SSKR_LONG_VECTOR, public), cannot be drawn: a typed detail too long for its card, or a
   * material with fewer distinct samples than such a share has codes. A host asks it before any
   * secret is asked, so that it refuses then, not after the shares are made (AUD-022-FUN004).
   * Every refusal, of the settings or of the drawing, is one
   * (export.sskr-render.share-cards-cannot-printed-every-seed-phrase-longest), which ends with
   * the refusal's own text. Nothing is kept; the render takes about a second.
   */
  static async assertPrintable(drawing: CardDrawing, requested: SskrRenderOptions): Promise<void> {
    try {
      using set = await ShareCardSet.create(drawing, [...SSKR_LONG_VECTOR.shares], requested);
      (await set.renderShare(0)).fill(0);
    } catch (error) {
      throw ERRORS.create("share-cards-cannot-printed-every-seed-phrase-longest", [
        `${refusalMessage(error)}`,
      ]);
    }
  }

  /**
   * One PDF with every page of the share at `place` and of no other share. Refuses a place of no
   * share (export.sskr-render.there-no-share-at-place-set), and a set wiped before or while it is
   * rendered (core.secret-value.wiped).
   */
  async renderShare(place: number): Promise<Uint8Array> {
    return this.#combined([this.#member(place)]);
  }

  /**
   * One PDF with every page of every share, in the order they were given. Refuses a set wiped
   * before or while it is rendered (core.secret-value.wiped).
   */
  async renderAll(): Promise<Uint8Array> {
    return this.#combined(this.#members);
  }

  #member(place: number): Member {
    this.#assertLive();
    const member = Number.isSafeInteger(place) ? this.#members[place] : undefined;
    if (member === undefined) throw ERRORS.create("there-no-share-at-place-set", []);
    return member;
  }

  /**
   * The file name of the document `index` of `member`: a whole share is named after the share, a
   * card after its place, counted from 01, and the code it prints.
   */
  #documentName(member: Member, index: number): string {
    if (member.share.folder === undefined) return member.share.name;
    return separateCardName(contentOf(member), index);
  }

  /** The document `index` of `member`: a separate card, a collection sheet or a QR card. */
  async #render(member: Member, index: number): Promise<Uint8Array> {
    this.#assertLive();
    const { layout } = this.#options;
    // Only separate cards are asked for by their index; a sheet and a QR card are one document.
    const fragment = layout === "individual" ? index : undefined;
    // On QR cards the mixed style starts each share's sheet at another design, by its member.
    const businessOffset = layout === "qr" ? member.memberIndex : 0;
    try {
      const bytes = await renderCatalogDesign(
        this.#design,
        this.#drawing,
        contentOf(member),
        fragment,
        businessOffset,
      );
      return member.owned.values.checkedBytes(bytes);
    } catch (error) {
      this.#assertLive();
      throw error;
    }
  }

  /** The pages of every document of `members`, in order, in one PDF without metadata. */
  async #combined(members: readonly Member[]): Promise<Uint8Array> {
    this.#assertLive();
    // Each document is drawn only when its pages are joined, so that one at a time is in memory.
    const render = (member: Member, index: number) => this.#render(member, index);
    async function* documents(): AsyncGenerator<Uint8Array> {
      for (const member of members)
        for (let index = 0; index < member.share.documents; index++) {
          const bytes = await render(member, index);
          try {
            yield bytes;
          } finally {
            bytes.fill(0);
          }
        }
    }
    try {
      const bytes = await joinedDocuments(documents());
      return defined(this.#members[0]).owned.values.checkedBytes(bytes);
    } catch (error) {
      this.#assertLive();
      throw error;
    }
  }

  #assertLive(): void {
    defined(this.#members[0]).owned.values.assertLive();
  }

  /** Overwrites retained card values immediately; public layout and share metadata remain. */
  wipe(): void {
    for (const member of this.#members) member.owned.values.wipe();
  }

  /** Ends this plan after its borrowed renders/conversions have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * How many cards of `record`, a share, print its own codes in `format`, before the decoys: what
 * the sheet for heirs tells (HeirBackup codes); undefined where the form has no cards. Refuses a
 * form of no shares (sskr.transport.share-format-one) and a record that Share.read refuses.
 */
export function ownShareCards(record: string, format: ShareFormat): number | undefined {
  if (!shareFormatHasCards(format)) return undefined;
  using share = Share.read(record);
  return shareCardFace(share, format).colors.length;
}

/** The hexadecimal digits of a set's identifier in a reference, two for each of its bytes. */
const IDENTIFIER_DIGITS = IDENTIFIER_BYTES * HEX_DIGITS_PER_BYTE;

/** The reference that the cards of `share` print: its set, group and member, such as 4BBF-1-2. */
export function shareReference(share: Share): string {
  const { identifier, groupIndex, memberIndex } = share.info;
  const set = identifier.toString(16).padStart(IDENTIFIER_DIGITS, "0");
  return `${set}-${groupIndex + 1}-${memberIndex + 1}`.toUpperCase();
}

/**
 * What the cards of a share in `format` print, before their decoys: its colors, which are the
 * share, in a color form; in Unicode codes its codes, one to a card, with a color for each
 * distinct code that only decorates it (codeColors). The QR code holds the share as written, so
 * that a share read from it comes back as it was. Refuses a form of no shares
 * (sskr.transport.share-format-one) and a share that was wiped (core.secret-value.wiped).
 */
export function shareCardFace(
  share: Share,
  format: ShareFormat,
): { readonly labels?: string[]; readonly colors: string[]; readonly payload: string } {
  const payload = share.write(format);
  if (isColorShareFormat(format)) return { colors: shareToColors(share.ur), payload };
  const labels = payload.split(" ");
  return { labels, colors: codeColors(labels), payload };
}

/** The QR code that the sheets of one share print (ShareCardSet.qrCodes). */
export interface ShareQrCode {
  /** The share's reference, as its cards and file names show it: identifier, group, member. */
  readonly reference: string;
  /** The base name of the share's output (ShareCardShare name), which its image is named after. */
  readonly name: string;
  /** The text the code holds: the share in its written form. */
  readonly payload: string;
}

/**
 * Each page belongs to one share; the combined file contains the complete supplied set, drawn with
 * `drawing`, the host's CardRenderer. Refuses what ShareCardSet.create refuses of the shares and
 * of `options`, such as a style of no design (export.sskr-render.unsupported-sskr-card-style), and
 * a refusal of the design passes on.
 */
export async function renderSskrPdf(
  drawing: CardDrawing,
  records: readonly string[],
  options: SskrRenderOptions,
): Promise<Uint8Array> {
  using cards = await ShareCardSet.create(drawing, records, options);
  return await cards.renderAll();
}
