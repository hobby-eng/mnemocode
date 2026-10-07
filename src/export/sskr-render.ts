// Renders existing Shamir shares (SSKR) as cards in a card design: every share in one PDF, or one
// share at a time, whose documents hold that share alone. The shares are checked as one set first
// (validateShareSet), and the design, layout and invented details are settled once for the whole
// set, so that every card of it has the same studio, profile and look.
//
// Needs from the host: the render platform (export/platform.ts), configured with
// configureRenderPlatform before the first render (platform-node.ts in Node.js): its bundled fonts
// and artwork, the random choice of invented details, PNG decoding and encoding for the artwork,
// and the QR matrices of the cards.
// Does not: make, repair or combine shares, write files or folders, or turn pages into images;
// the command line does that around it (sskr-cards.ts), a page offers the bytes for download.

import { PDFDocument } from "pdf-lib";
import {
  shareInfo,
  shareToColors,
  urToTransport,
  validateShareSet,
  writeShare,
  type ShareFormat,
} from "../sskr/transport.js";
import { renderBusinessCards } from "./business-cards.js";
import { businessStyles } from "./business-designs.js";
import { resolvePresentationFor } from "./card-copy.js";
import { resolveIdentityFor, sectorForTemplate } from "./card-identities.js";
import type { BusinessStyle, CardSettings } from "./card-settings.js";
import { clearDocumentMetadata } from "./document-metadata.js";
import { renderGlassCards } from "./glass-cards.js";
import { materialArtwork, type MaterialStyle } from "./material-artwork.js";
import { renderMaterialCard } from "./material-cards.js";
import { printedCode } from "./card-codes.js";
import { renderPlatform } from "./platform.js";
import { resolveSskrLayout, type SskrCardContent, type SskrCardLayout } from "./sskr-content.js";

export interface SskrRenderOptions extends CardSettings {
  readonly style: BusinessStyle | MaterialStyle | "glass-4in1" | "glass-6in1" | "glass-8in1";
  /** Omitted: decided by the page size. */
  readonly layout?: SskrCardLayout;
  /**
   * The form of the shares. A QR code holds the color codes that the card prints, unless the
   * shares are written as word numbers or Unicode codes: then it holds them in that form, so that
   * a share read from it comes back as it was written.
   */
  readonly shareFormat?: ShareFormat;
}

/** One share of the set, as its cards are made. */
export interface ShareCardShare {
  /** The share's reference printed on its cards: identifier, group and member, such as 376C-1-2. */
  readonly reference: string;
  /** How many documents its cards take: one per fragment for separate cards, otherwise one. */
  readonly documents: number;
  /**
   * The folder that keeps its fragments together, such as collection-376C-1-2, or undefined when
   * the share is one document.
   */
  readonly folder: string | undefined;
}

/** One document of a share, a PDF, and the name of its file without the extension. */
export interface ShareCardDocument {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * The forms in which the cards print the share's own codes, one per card, with colors that only
 * decorate them: word numbers, Unicode codes and Bytewords, which a share written as ur:sskr is
 * printed in too, word by word. The color forms print the colors, which are the share.
 */
const LABELLED_FORMS: Readonly<Partial<Record<ShareFormat, ShareFormat>>> = {
  indexes: "indexes",
  unicode: "unicode",
  words: "words",
  ur: "words",
};
/** How many colors a color code has: 2^24, six hexadecimal digits. */
const COLOR_CODES = 0x1000000;
/**
 * The codes that one card prints in those forms. A collection sheet holds at most 16 cards
 * (collection-sheet.ts); three codes to a card keep the share of a 24-word phrase within them:
 * 33 word numbers or Unicode codes, or 41 Bytewords.
 */
const CODES_PER_CARD = 3;

/** The layouts that a caller may ask for. */
const LAYOUTS: ReadonlySet<string> = new Set(["qr", "collection", "individual"]);

function glassReferencesPerCard(style: SskrRenderOptions["style"]): 4 | 6 | 8 | undefined {
  if (style === "glass-4in1") return 4;
  if (style === "glass-6in1") return 6;
  if (style === "glass-8in1") return 8;
  return undefined;
}

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
  readonly #options: ResolvedOptions;
  readonly #referencesPerCard: number;
  readonly #members: readonly Member[];

  /** Checks the layout, the style and the shares, and settles the details of the cards. */
  constructor(records: readonly string[], requested: SskrRenderOptions) {
    if (requested.layout !== undefined && !LAYOUTS.has(requested.layout))
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
    // The details first, then the shares: the order in which the random choices are made. A copy
    // of the texts that the caller gave, so that every card rendered later shows them as they were.
    const presentation = Object.freeze({ ...resolvePresentationFor(options) });
    const profile = resolveIdentityFor(options, sectorForTemplate(options.style));
    const shares = validateShareSet(records, false);
    this.#options = options;
    this.#referencesPerCard = glassReferencesPerCard(options.style) ?? 1;
    this.#members = shares.map((record) => {
      const info = shareInfo(urToTransport(record));
      const reference =
        `${info.identifier.toString(16).padStart(4, "0")}-${info.groupIndex + 1}-${info.memberIndex + 1}`.toUpperCase();
      const labelForm = LABELLED_FORMS[options.shareFormat ?? "colors"];
      const labels =
        labelForm === undefined ? undefined : cardGroups(writeShare(record, labelForm).split(" "));
      const colors = labels === undefined ? shareToColors(record) : decorativeColors(labels.length);
      // The QR code holds what the cards print, so that a share read from it comes back as written.
      const payload =
        labels !== undefined
          ? labels.join(" ")
          : writeShare(
              record,
              options.shareFormat === "colors-unicode" ? "colors-unicode" : "colors",
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
      const share: ShareCardShare = Object.freeze({
        reference,
        documents: fragments ? Math.ceil(colors.length / this.#referencesPerCard) : 1,
        folder: fragments ? `collection-${reference}` : undefined,
      });
      return { share, memberIndex: info.memberIndex, content, colors };
    });
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
        Object.freeze({ reference: member.share.reference, payload: member.content.payload }),
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
    if (member.share.folder === undefined) return `collection-${member.share.reference}`;
    return `${String(index + 1).padStart(2, "0")}-${printedCode(member.content, index * this.#referencesPerCard)}`;
  }

  /** The document `index` of `member`: a fragment, a collection sheet or a QR card. */
  #render(member: Member, index: number): Promise<Uint8Array> {
    const options = this.#options;
    const { content, memberIndex } = member;
    const referencesPerCard = glassReferencesPerCard(options.style);
    if (referencesPerCard !== undefined)
      return renderGlassCards(
        content,
        options.layout === "individual" ? index : undefined,
        referencesPerCard,
      );
    if (Object.hasOwn(materialArtwork, options.style))
      // The key is left out for a sheet: a host compiled with exactOptionalPropertyTypes refuses
      // an optional property given as undefined.
      return renderMaterialCard(
        options.style as MaterialStyle,
        content,
        options.layout === "individual" ? { individualIndex: index } : {},
      );
    return renderBusinessCards(
      options.style as BusinessStyle,
      content,
      options.layout === "collection" ? undefined : index,
      options.layout === "qr" ? memberIndex : 0,
    );
  }

  /** The pages of every document of `members`, in order, in one PDF without metadata. */
  async #combined(members: readonly Member[]): Promise<Uint8Array> {
    const combined = await PDFDocument.create();
    for (const member of members)
      for (let index = 0; index < member.share.documents; index++) {
        const source = await PDFDocument.load(await this.#render(member, index));
        for (const page of await combined.copyPages(source, source.getPageIndices()))
          combined.addPage(page);
      }
    clearDocumentMetadata(combined);
    return combined.save();
  }
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
function decorativeColors(count: number): string[] {
  const chosen = new Set<number>();
  for (let card = 0; card < count; card++) {
    let color = renderPlatform().randomInt(COLOR_CODES);
    // A color drawn twice takes the next free one, so that even a poor random source ends.
    while (chosen.has(color)) color = (color + 1) % COLOR_CODES;
    chosen.add(color);
  }
  return [...chosen].map((color) => `#${color.toString(16).padStart(6, "0").toUpperCase()}`);
}

/** The QR code that the sheets of one share print (ShareCardSet.qrCodes). */
export interface ShareQrCode {
  /** The share's reference, as its cards and file names show it: identifier, group, member. */
  readonly reference: string;
  /** The text the code holds: the share in its written form. */
  readonly payload: string;
}

/** Each page belongs to one share; the combined file contains the complete supplied set. */
export async function renderSskrPdf(
  records: readonly string[],
  options: SskrRenderOptions,
): Promise<Uint8Array> {
  return new ShareCardSet(records, options).renderAll();
}
