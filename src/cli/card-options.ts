import { businessOptionNames, businessOptions } from "./business-options.js";
import { askSecretUntil } from "./ask.js";
import { terminalAvailable } from "./terminal-input.js";
import { formatDate, type DateShiftDate } from "../core.js";
import { selectTemplate } from "../export/templates.js";
import type { EncodedFormat } from "./input.js";
import { value, values, type ParsedArguments } from "./arguments.js";

export function validateCardOptions(
  args: ParsedArguments,
  format: EncodedFormat,
  mode: string,
): void {
  const pdf = value(args, "pdf") ?? value(args, "images-dir");
  const directory = value(args, "cards-dir");
  if (args["cards-dir"] !== undefined && typeof args["cards-dir"] !== "string")
    throw new Error("Provide the individual-card output folder once, using a non-empty path.");
  if (directory !== undefined) {
    if (!directory.trim())
      throw new Error("The individual-card output folder path must not be empty.");
    if (!["colors", "colors-unicode"].includes(format))
      throw new Error("Individual cards are available only for RGB color formats 4 and 5.");
    if (!selectTemplate(value(args, "template"), "colors").renderIndividual)
      throw new Error("This template does not support individual cards.");
  }
  if (pdf === undefined && directory === undefined) {
    if (
      value(args, "template") !== undefined ||
      value(args, "title") !== undefined ||
      values(args, "event").length ||
      businessOptionNames.some((name) => args[name] !== undefined)
    ) {
      throw new Error(
        "Card design settings require a PDF file, an image output folder, or an individual-card output folder.",
      );
    }
    return;
  }
  if (!["unicode", "colors", "colors-unicode"].includes(format))
    throw new Error("Card export requires format 3, 4, or 5.");
  if (format === "unicode" && mode === "direct")
    throw new Error(
      "To export a card with dates, select a Seedshift mode. The dates will be visible on the card.",
    );
  if (format !== "unicode" && values(args, "event").length)
    throw new Error("Event labels apply only to dated Unicode cards.");
  businessOptions(args);
  if (format === "unicode" && businessOptionNames.some((name) => args[name] !== undefined))
    throw new Error("Page and business-card settings do not apply to dated Unicode cards.");
  selectTemplate(value(args, "template"), format === "unicode" ? "unicode" : "colors");
}

/**
 * One event label for each date of a dated card: those given with --event, then the others asked
 * on the private screen, where an empty label is asked again. A label stands next to its date on
 * the card, so it is asked like the date, as a secret. With --ask-secrets the dates question
 * already wants a date for each label given (promptedEncodeInputs), so the first check below
 * refuses only dates given with --dates.
 */
export async function completeEventLabels(
  dates: readonly DateShiftDate[],
  supplied: readonly string[],
): Promise<string[]> {
  if (supplied.length > dates.length)
    throw new Error("Provide exactly one event label for every card date.");
  const labels = supplied.map((label) => label.trim());
  if (labels.some((label) => !label)) throw new Error("Card event labels must not be empty.");
  if (labels.length === dates.length) return labels;
  // terminalAvailable, as every question asks it: also TERM=dumb asks nothing.
  if (!terminalAvailable())
    throw new Error("To export a dated card, provide one event label for every date.");
  for (const date of dates.slice(labels.length))
    labels.push(
      await askSecretUntil(`Event label for ${formatDate(date)}:`, (label) => label, {
        what: "a label for this date",
      }),
    );
  return labels;
}
