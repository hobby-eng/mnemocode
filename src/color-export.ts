import type { CardSettings } from "./export/card-settings.js";
import { ExportDetails } from "./export/export-details.js";
import { exportQrPayload } from "./export/qr-image.js";
import { exportCards } from "./export/pdf.js";
import { nodeRenderPlatform } from "./export/platform-node.js";
import { selectTemplate, templatesOfKind } from "./export/templates.js";
import { assertColorCardContent } from "./export/card-content.js";
import { ErrorCatalog } from "./core/error-catalog.js";

const ERRORS = new ErrorCatalog("color-export", {
  "select-one-template-template-collection-not-both": () =>
    "Select one template or a template collection, not both.",
});

/** The id of a design of color cards, as the catalog names it (templates.ts). */
export type ColorCardTemplateId = string;
/** The designs that draw color cards, in the order of the catalog. */
export const COLOR_CARD_TEMPLATES = templatesOfKind("colors");

/**
 * What exportColorPalette draws and saves: the colors, the QR code's text if it is not the colors
 * themselves, the files to write, the design or designs, and the card settings.
 */
export interface ColorExportOptions extends CardSettings {
  /** The phrase's colors, one #RRGGBB code per card; refused unless they make a whole phrase. */
  readonly colors: readonly string[];
  /**
   * The QR code's text; undefined for the colors joined by spaces. Another text must hold the same
   * colors, such as the phrase's Color Unicode codes, as the rules of a seed phrase's cards check
   * it (ContentKindRules assertQr, content-kinds.ts).
   */
  readonly qrPayload?: string;
  /** Where the PDF of the cards is saved, as a new private file; undefined to draw no cards. */
  readonly pdfPath?: string;
  /** Where the QR code is saved, as a new private PNG file; undefined to save none. */
  readonly qrPath?: string;
  /** The title of the sheet, where a design shows one; undefined for the studio's name. */
  readonly title?: string;
  /**
   * The design, by its id or its number from 1 among the color designs; undefined for the first.
   * Refused together with `templates`.
   */
  readonly template?: ColorCardTemplateId;
  /** The designs, each drawn in this order into the one PDF; an empty list is refused. */
  readonly templates?: readonly ColorCardTemplateId[];
}

/**
 * Draws the color cards of `options` into its PDF and saves its QR code image, each where a path is
 * given. Refuses colors that the cards cannot print or a QR text that holds others, as
 * assertColorCardContent refuses them (its export.card-content, export.card-decoys and
 * export.content-kinds codes), and a design given both alone and in a list
 * (color-export.select-one-template-template-collection-not-both). A design that names none is
 * refused as selectTemplate refuses it, cards as renderCards refuses them, and a file that exists
 * already as exportCards and exportQrPayload refuse it.
 */
export async function exportColorPalette(options: ColorExportOptions): Promise<void> {
  const payload = options.qrPayload ?? options.colors.join(" ");
  // Checked here too: the palette may write only its QR code, and draw no card.
  assertColorCardContent({ kind: "colors", colors: options.colors, payload });
  if (options.template !== undefined && options.templates !== undefined)
    throw ERRORS.create("select-one-template-template-collection-not-both", []);
  if (options.pdfPath !== undefined) {
    const ids = options.templates ?? [options.template];
    const templates = ids.map((id) => selectTemplate(id, "colors"));
    // The person's employer follows the first design, as the cards of one export share one person.
    // An empty list of designs is refused by renderCards, so no first one is assumed here.
    const { profile, presentation } = ExportDetails.of(
      nodeRenderPlatform.randomInt,
      options,
      templates[0]?.style,
    );
    const jobs = templates.map((template) => ({
      template,
      content: {
        kind: "colors" as const,
        colors: options.colors,
        payload,
        title: options.title,
        pageSize: options.pageSize,
        profile,
        orientation: options.orientation,
        presentation,
        cardQr: options.cardQr === true,
      },
    }));
    await exportCards(jobs, options.pdfPath);
  }
  if (options.qrPath !== undefined) await exportQrPayload(payload, options.qrPath);
}
