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
  type ColorShareFormat,
  isColorShareFormat,
  type ShareFormat,
  parseShareFormat,
} from "../sskr/transport.js";
import { ExportDetails } from "./export-details.js";
import type { CardSettings } from "./card-settings.js";
import { cardCount, printedCode, separateCardName } from "./card-codes.js";
import { checkedChoice, type UniformChoice } from "./platform.js";
import { catalogReferencesPerCard, renderCatalogDesign, type CardDrawing } from "./templates.js";
import {
  resolveSskrLayout,
  type SskrCardContent,
  type SskrCardLayout,
  parseSskrLayout,
} from "./sskr-content.js";
import { joinedDocuments, type NamedDocument } from "./pdf-documents.js";
import { designOfStyle, type CardStyle, type CatalogEntry } from "./template-catalog.js";
import { RGB_MAX_VALUE, rgbHex } from "../core/colors.js";
import { SHEET_PAGE_SIZE } from "./card-settings.js";

export interface SskrRenderOptions extends CardSettings {
  readonly style: CardStyle;
  /** Omitted: decided by the page size. */
  readonly layout?: SskrCardLayout;
  /**
   * The form of the shares. A QR code holds what the cards print, so that a share read from it
   * comes back as it was written: word numbers, Unicode codes or Bytewords (also for ur) as they
   * are, the Unicode codes of colors as such, and the color codes otherwise.
   */
  readonly shareFormat?: ShareFormat;
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
  /** How many documents its cards take: one per fragment for separate cards, otherwise one. */
  readonly documents: number;
  /**
   * The folder that keeps its fragments together, such as collection-376C-1-2, or undefined when
   * the share is one document.
   */
  readonly folder: string | undefined;
}

/** One document of a share. */
export type ShareCardDocument = NamedDocument;

/**
 * The forms in which the cards print the share's own codes, one per card, with colors that only
 * decorate them: word numbers, Unicode codes and Bytewords, which a share written as ur:sskr is
 * printed in too, word by word. The color forms print the colors, which are the share.
 */
const LABELLED_FORMS = Object.freeze({
  indexes: "indexes",
  unicode: "unicode",
  words: "words",
  ur: "words",
}) satisfies Readonly<Record<Exclude<ShareFormat, ColorShareFormat>, ShareFormat>>;
/** How many colors a color code has: 2^24, six hexadecimal digits. */
const COLOR_CODES = RGB_MAX_VALUE + 1;
/**
 * The codes that one card prints in those forms. A collection sheet holds at most
 * MAX_SHEET_CARDS cards (collection-sheet.ts); three codes to a card keep the share of a 24-word
 * phrase within them: 33 word numbers or Unicode codes, or 41 Bytewords (a test checks it).
 */
const CODES_PER_CARD = 3;

type ResolvedOptions = Omit<SskrRenderOptions, "layout"> & { readonly layout: SskrCardLayout };

interface Member {
  readonly share: ShareCardShare;
  readonly memberIndex: number;
  readonly content: SskrCardContent;
  readonly colors: readonly string[];
}

/**
 * The cards of one set of shares. A class, so that the options, the shares and the invented
 * details are checked and settled once, in the constructor, and every document rendered from it
 * belongs to the same set. It renders on request and keeps no rendered document, only the shares
 * it was given, as text, for as long as it is kept.
 */
export class ShareCardSet {
  readonly #drawing: CardDrawing;
  readonly #options: ResolvedOptions;
  /** The design of the cards, whose family draws them (template-catalog.ts). */
  readonly #design: CatalogEntry;
  readonly #referencesPerCard: number;
  readonly #members: readonly Member[];

  /**
   * Checks the layout, the style and the shares, and settles the details of the cards, which are
   * drawn with `drawing`, the host's CardRenderer. The decorative colors of the forms that print
   * codes come from `randomInt`, the renderer's random integers below a limit unless a host, such
   * as its self-test, gives its own.
   */
  constructor(
    drawing: CardDrawing,
    records: readonly string[],
    requested: SskrRenderOptions,
    randomInt: UniformChoice = drawing.randomInt,
  ) {
    parseSskrLayout(requested.layout);
    // Checked before any choice is made: another value would print the colors silently
    // (AUD-012-FUN007).
    if (requested.shareFormat !== undefined) parseShareFormat(requested.shareFormat);
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
    if (design === undefined) throw new Error("Unsupported SSKR card style.");
    // The details first, then the shares: the order in which the random choices are made. Copies
    // of what the caller gave (ExportDetails), so that every card rendered later shows them as they
    // were.
    const { presentation, profile } = ExportDetails.of(drawing.randomInt, options, options.style);
    const shares = Share.readSet(records, false);
    this.#drawing = drawing;
    this.#options = options;
    this.#design = design;
    this.#referencesPerCard = catalogReferencesPerCard(design);
    this.#members = shares.map((read) => {
      const { info } = read;
      const reference =
        `${info.identifier.toString(16).padStart(4, "0")}-${info.groupIndex + 1}-${info.memberIndex + 1}`.toUpperCase();
      const { labels, colors, payload } = cardFace(
        read,
        options.shareFormat ?? "colors",
        randomInt,
      );
      const content: SskrCardContent = {
        ...options,
        kind: "sskr",
        colors,
        ...(labels === undefined ? {} : { labels }),
        payload,
        collectionReference: reference,
        qrCard: options.layout === "qr",
        cardQr: options.layout === "qr" || options.cardQr === true,
        presentation,
        profile,
      };
      // A fragment contains only its own consecutive references; grouping restarts per member.
      const fragments = options.layout === "individual";
      const name = `collection-${reference}`;
      const share: ShareCardShare = Object.freeze({
        reference,
        name,
        documents: fragments ? cardCount(colors.length, this.#referencesPerCard) : 1,
        folder: fragments ? name : undefined,
      });
      return { share, memberIndex: info.memberIndex, content, colors };
    });
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
   * one, nor for sheets without a QR code.
   */
  get qrCodes(): readonly ShareQrCode[] {
    if (this.#options.layout === "individual") return [];
    return this.#members
      .filter((member) => member.content.cardQr === true)
      .map((member) =>
        Object.freeze({
          reference: member.share.reference,
          name: member.share.name,
          payload: member.content.payload,
        }),
      );
  }

  /**
   * What the cards of the share at `place` (counted from 0) print, in order: the hex codes of its
   * colors, or its codes in the form it is written in, a few to a card.
   */
  printedCodes(place: number): readonly string[] {
    const { content } = this.#member(place);
    return content.colors.map((_, index) => printedCode(content, index));
  }

  /** The documents of the share at `place` (counted from 0), rendered one at a time, in order. */
  async *documents(place: number): AsyncGenerator<ShareCardDocument> {
    const member = this.#member(place);
    for (let index = 0; index < member.share.documents; index++) {
      const bytes = await this.#render(member, index);
      yield { name: this.#documentName(member, index), bytes };
    }
  }

  /** One PDF with every page of the share at `place` and of no other share. */
  async renderShare(place: number): Promise<Uint8Array> {
    return this.#combined([this.#member(place)]);
  }

  /** One PDF with every page of every share, in the order they were given. */
  async renderAll(): Promise<Uint8Array> {
    return this.#combined(this.#members);
  }

  #member(place: number): Member {
    const member = Number.isSafeInteger(place) ? this.#members[place] : undefined;
    if (member === undefined) throw new Error("There is no share at that place in the set.");
    return member;
  }

  /**
   * The file name of the document `index` of `member`: a whole share is named after the share, a
   * fragment after its place, counted from 01, and its first color without the #.
   */
  #documentName(member: Member, index: number): string {
    if (member.share.folder === undefined) return member.share.name;
    return separateCardName(member.content, index, this.#referencesPerCard);
  }

  /** The document `index` of `member`: a fragment, a collection sheet or a QR card. */
  #render(member: Member, index: number): Promise<Uint8Array> {
    const { layout } = this.#options;
    // Only separate cards are asked for by their index; a sheet and a QR card are one document.
    const fragment = layout === "individual" ? index : undefined;
    // On QR cards the mixed style starts each share's sheet at another design, by its member.
    const businessOffset = layout === "qr" ? member.memberIndex : 0;
    return renderCatalogDesign(
      this.#design,
      this.#drawing,
      member.content,
      fragment,
      businessOffset,
    );
  }

  /** The pages of every document of `members`, in order, in one PDF without metadata. */
  #combined(members: readonly Member[]): Promise<Uint8Array> {
    // Each document is drawn only when its pages are joined, so that one at a time is in memory.
    const render = (member: Member, index: number) => this.#render(member, index);
    async function* documents(): AsyncGenerator<Uint8Array> {
      for (const member of members)
        for (let index = 0; index < member.share.documents; index++) yield render(member, index);
    }
    return joinedDocuments(documents());
  }
}

/**
 * What the cards of a share print: its colors, which are the share, in a color form; otherwise its
 * codes, with colors that only decorate them. The QR code holds what the cards print, so that a
 * share read from it comes back as written.
 */
function cardFace(
  share: Share,
  format: ShareFormat,
  randomInt: UniformChoice,
): { readonly labels?: string[]; readonly colors: string[]; readonly payload: string } {
  if (isColorShareFormat(format))
    return { colors: shareToColors(share.ur), payload: share.write(format) };
  const labels = cardGroups(share.write(LABELLED_FORMS[format]).split(" "));
  return { labels, colors: decorativeColors(labels.length, randomInt), payload: labels.join(" ") };
}

/** `codes` in groups of CODES_PER_CARD, in their order, each group the text of one card. */
function cardGroups(codes: readonly string[]): string[] {
  const groups: string[] = [];
  for (let start = 0; start < codes.length; start += CODES_PER_CARD)
    groups.push(codes.slice(start, start + CODES_PER_CARD).join(" "));
  return groups;
}

/**
 * `count` colors drawn at random, none twice: decoration, which carries nothing of the share, so
 * that no code is tied to a color and the same code on two cards may have two colors.
 */
function decorativeColors(count: number, randomInt: UniformChoice): string[] {
  const chosen = new Set<number>();
  for (let card = 0; card < count; card++) {
    // Only a color code ends the loop below with a valid code.
    let color = checkedChoice(
      randomInt,
      COLOR_CODES,
      "The random source of the card colors gave a number out of range.",
    );
    // A color drawn twice takes the next free one, so that even a poor random source ends.
    while (chosen.has(color)) color = (color + 1) % COLOR_CODES;
    chosen.add(color);
  }
  return [...chosen].map(rgbHex);
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
 * `drawing`, the host's CardRenderer.
 */
export async function renderSskrPdf(
  drawing: CardDrawing,
  records: readonly string[],
  options: SskrRenderOptions,
): Promise<Uint8Array> {
  return new ShareCardSet(drawing, records, options).renderAll();
}
