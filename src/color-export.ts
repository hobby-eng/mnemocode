import type { CardSettings } from "./export/card-settings.js";
import { ExportDetails } from "./export/export-details.js";
import { exportQrPayload } from "./export/qr-image.js";
import { exportCards } from "./export/pdf.js";
import { nodeRenderPlatform } from "./export/platform-node.js";
import { selectTemplate, templatesOfKind } from "./export/templates.js";
import { assertColorCardContent } from "./export/card-content.js";

export type ColorCardTemplateId = string;
export const colorCardTemplates = templatesOfKind("colors");

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
  const payload = options.qrPayload ?? options.colors.join(" ");
  // Checked here too: the palette may write only its QR code, and draw no card.
  assertColorCardContent({ kind: "colors", colors: options.colors, payload });
  if (options.template !== undefined && options.templates !== undefined)
    throw new Error("Select one template or a template collection, not both.");
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
