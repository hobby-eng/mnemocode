import type { CardSettings } from "./export/card-settings.js";
import { resolveIdentityFor, sectorForTemplate } from "./export/card-identities.js";
import { resolvePresentationFor } from "./export/card-copy.js";
import { colorsToIndexes, unicodeToColors } from "./core.js";
import { exportQrPayload } from "./cli/qr-export.js";
import { exportCards } from "./export/pdf.js";
import { cardTemplates, selectTemplate } from "./export/templates.js";

export type ColorCardTemplateId = string;
export const colorCardTemplates = cardTemplates.filter((item) => item.kind === "colors");

export interface ColorExportOptions extends CardSettings {
  readonly colors: readonly string[];
  readonly qrPayload?: string;
  readonly pdfPath?: string;
  readonly qrPath?: string;
  readonly title?: string;
  readonly template?: ColorCardTemplateId;
  readonly templates?: readonly ColorCardTemplateId[];
}

export async function exportColorPalette(options: ColorExportOptions): Promise<void> {
  colorsToIndexes(options.colors);
  const payload = options.qrPayload ?? options.colors.join(" ");
  if (payload !== options.colors.join(" ")) {
    const decoded = unicodeToColors(payload);
    if (decoded.join(" ") !== options.colors.join(" "))
      throw new Error("Palette QR data must match the color representation.");
  }
  if (options.template !== undefined && options.templates !== undefined)
    throw new Error("Select one template or a template collection, not both.");
  if (options.pdfPath !== undefined) {
    const presentation = resolvePresentationFor(options);
    const ids = options.templates ?? [options.template];
    const profile = resolveIdentityFor(options, sectorForTemplate(ids[0] ?? "business-architect"));
    const jobs = ids.map((id) => ({
      template: selectTemplate(id, "colors"),
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
