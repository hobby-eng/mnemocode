import { validateOutputPaths } from "./output-paths.js";
import {
  type ImageFormat,
  parseImageFormat,
  DEFAULT_DOCUMENT_FORMAT,
  type DocumentFormat,
} from "../export/image-export.js";
import { value, type ParsedArguments } from "./arguments.js";
import { terminalNotice } from "./terminal.js";

export function imageFormat(args: ParsedArguments): ImageFormat {
  return parseImageFormat(value(args, "image-format"));
}

/**
 * The format of separate card files: the image format given, or PDF without one
 * (DEFAULT_DOCUMENT_FORMAT). Page images (--images-dir) have their own default (imageFormat).
 */
export function cardFileFormat(args: ParsedArguments): DocumentFormat {
  return args["image-format"] === undefined ? DEFAULT_DOCUMENT_FORMAT : imageFormat(args);
}

/**
 * Refuses, before a mnemonic or other secret is read, image settings that do not go together or
 * an image format that does not exist, and says whether the outputs need the image renderer: page
 * images, or card files in a format that is given. The folders themselves are checked by
 * preflightOutputs, which owns that rule, and the renderer after them (AUD-014 recommendation 35).
 */
export async function validateImageOptions(
  args: ParsedArguments,
): Promise<{ readonly needsRenderer: boolean }> {
  const directory = value(args, "images-dir");
  const cards = value(args, "cards-dir");
  await validateOutputPaths(args);
  if (args["image-format"] !== undefined && directory === undefined && cards === undefined)
    throw new Error(
      "An image format can be selected only when an image output folder or individual-card output folder is provided.",
    );
  if (directory === undefined && args["image-format"] === undefined)
    return { needsRenderer: false };
  imageFormat(args);
  return { needsRenderer: true };
}

/**
 * Says that `count` pages were saved as images of the format the options give into `directory`;
 * `what` names them where a command saves more than one kind, such as "preview" or "SSKR".
 */
export function savedPagesNotice(
  args: ParsedArguments,
  count: number,
  directory: string,
  what?: string,
): void {
  const kind = what === undefined ? "" : `${what} `;
  terminalNotice(
    `Saved ${count} ${imageFormat(args).toUpperCase()} ${kind}pages to: ${directory}`,
    "success",
  );
}
