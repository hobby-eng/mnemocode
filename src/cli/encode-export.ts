import { imageFormat } from "./image-options.js";
import { exportPageImages } from "../export/image-export.js";
import { renderCards } from "../export/pdf.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { exportIndividualCards } from "../export/individual-cards.js";
import { selectTemplate } from "../export/templates.js";
import { businessOptions } from "./business-options.js";
import { indexesToColors } from "../core.js";
import { serializeRecord } from "../record.js";
import { type ParsedArguments, value } from "./arguments.js";
import { colorCards, terminalNotice } from "./terminal.js";
import { exportColorPalette } from "../color-export.js";
import { exportUnicodeCard } from "../unicode-card-export.js";
import { exportQrPayload } from "./qr-export.js";
import type { EncodeOutcome } from "./encode-command.js";

/** Every destination receives the same completed transformation. */
export async function saveEncodeResult(
  arguments_: ParsedArguments,
  outcome: EncodeOutcome,
  eventLabels: readonly string[],
): Promise<void> {
  const { result, format, recordMode, encoded } = outcome;
  const enteredDates = outcome.enteredDates;
  const pdfPath = value(arguments_, "pdf");
  const imageDirectory = value(arguments_, "images-dir");
  const cardDirectory = value(arguments_, "cards-dir");
  const record = serializeRecord(recordMode, format, encoded);
  const outputPath = value(arguments_, "output");
  if (outputPath !== undefined) {
    await publishNewPrivateFile(outputPath, Buffer.from(`${record}\n`, "utf8"));
    terminalNotice(`Saved MnemoCode record: ${outputPath}`, "success");
  }
  if (arguments_.cards === true) {
    console.error(colorCards(indexesToColors(result.shiftedIndexes)));
  }
  if (pdfPath !== undefined) {
    if (format === "unicode") {
      await exportUnicodeCard({
        unicodePayload: encoded,
        dates: enteredDates,
        eventLabels,
        pdfPath,
        template: value(arguments_, "template"),
        title: value(arguments_, "title"),
      });
    } else {
      await exportColorPalette({
        ...businessOptions(arguments_),
        colors: indexesToColors(result.shiftedIndexes),
        qrPayload: encoded,
        pdfPath,
        template: value(arguments_, "template"),
        title: value(arguments_, "title"),
      });
    }
    terminalNotice(`Saved PDF: ${pdfPath}`, "success");
  }
  if (imageDirectory !== undefined) {
    const template = selectTemplate(
      value(arguments_, "template"),
      format === "unicode" ? "unicode" : "colors",
    );
    const content =
      format === "unicode"
        ? {
            kind: "unicode" as const,
            dates: enteredDates,
            eventLabels,
            payload: encoded,
            title: value(arguments_, "title"),
          }
        : {
            ...businessOptions(arguments_),
            kind: "colors" as const,
            colors: indexesToColors(result.shiftedIndexes),
            payload: encoded,
            title: value(arguments_, "title"),
          };
    const count = await exportPageImages(
      await renderCards([{ template, content }]),
      imageDirectory,
      imageFormat(arguments_),
    );
    terminalNotice(
      `Saved ${count} ${imageFormat(arguments_).toUpperCase()} pages to: ${imageDirectory}`,
      "success",
    );
  }
  if (cardDirectory !== undefined) {
    const colors = indexesToColors(result.shiftedIndexes);
    const count = await exportIndividualCards(
      selectTemplate(value(arguments_, "template"), "colors"),
      {
        ...businessOptions(arguments_),
        kind: "colors",
        colors,
        payload: encoded,
      },
      cardDirectory,
      arguments_["image-format"] === undefined ? "pdf" : imageFormat(arguments_),
    );
    terminalNotice(`Saved ${count} individual card files to: ${cardDirectory}`, "success");
  }
  const qrPath = value(arguments_, "qr");
  if (qrPath !== undefined) {
    await exportQrPayload(encoded, qrPath);
    terminalNotice(`Saved QR code (${format}): ${qrPath}`, "success");
  }
}
