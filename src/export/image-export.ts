import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { PDFDocument, type PDFPage } from "pdf-lib";
import { pageFileName } from "./card-codes.js";
import { NewFolder, writeNewPrivateFile } from "./private-file.js";
import { RGBA_CHANNELS } from "./platform.js";
import { wipeAll, wipedAfterAsync } from "../core/bits.js";
import {
  coveredPixels,
  DEFAULT_DOCUMENT_FORMAT,
  DEFAULT_IMAGE_FORMAT,
  DOCUMENT_FORMAT_FACTS,
  IMAGE_DPI,
  parseImageFormat,
  type DocumentFormat,
  type ImageFormat,
} from "./document-formats.js";
import { errorCode } from "../core/refusal.js";
import { MILLISECONDS_PER_SECOND } from "../core/search-turns.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.image-export", {
  "png-jpeg-export-requires-local-poppler-pdftocairo-program": () =>
    "PNG/JPEG export requires the local Poppler pdftocairo program in a folder of PATH. Install Poppler before using image export, or export PDF instead.",
  "local-pdf-renderer-produced-no-images": () => "The local PDF renderer produced no images.",
  "local-pdf-renderer-failed": (ending: string) => `The local PDF renderer failed: ${ending}.`,
  "local-pdf-renderer-took-too-long": (seconds: string) =>
    `The local PDF renderer took longer than ${seconds} seconds for one page.`,
  "local-pdf-renderer-wrote-too-much": (bytes: string) =>
    `The local PDF renderer wrote more than ${bytes} bytes for one page.`,
  "image-destination-already-exists-nothing-will-overwritten": () =>
    "An image destination already exists; nothing will be overwritten.",
});

// The formats and the drawing rules are document-formats.ts's, which a page takes too; here too
// for the modules of the command line that take them from here.
export { DEFAULT_DOCUMENT_FORMAT, parseImageFormat, type DocumentFormat, type ImageFormat };
const execute = promisify(execFile);

// Both come with Poppler. pdftocairo can leave the paper transparent, which pdftoppm cannot.
const IMAGE_RENDERER = "pdftocairo";
/**
 * An absolute folder on Windows: a drive and a separator, or a network share. \tools without a
 * drive follows the drive of the working folder.
 */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
/** How long the renderer may take to say its version: long enough for a slow first start. */
const PROBE_TIMEOUT_MS = 10_000;
/** How long the renderer may take to draw one page, in seconds. */
const PAGE_TIMEOUT_SECONDS = 120;
/** What the renderer may say for its version: a few lines. */
const RENDERER_OUTPUT_BYTES = 64 * 1024;
/**
 * The most bytes that the image of a page may take for each of its pixels: twice a pixel without
 * compression (RGBA_CHANNELS bytes), far more than PNG or JPEG adds to the pixels. A renderer that
 * writes more is stopped (local-pdf-renderer-wrote-too-much).
 */
const IMAGE_BYTES_PER_PIXEL = 2 * RGBA_CHANNELS;

let renderer: Promise<string> | undefined;

/**
 * The local Poppler renderer by its absolute name, found and answering for its version
 * (foundRenderer) once; never downloads a renderer or sends data online.
 */
function imageRenderer(): Promise<string> {
  return (renderer ??= foundRenderer().catch((error: unknown) => {
    renderer = undefined;
    throw error;
  }));
}

/**
 * The renderer's program in the first folder of PATH that holds it, by its absolute name, once it
 * has answered for its version. Only absolute folders count: an empty or a relative entry, and the
 * working folder, which Windows searches first for a bare name, could hold a program that someone
 * else put there, which would then receive the private PDF.
 */
async function foundRenderer(): Promise<string> {
  const windows = process.platform === "win32";
  const name = windows ? `${IMAGE_RENDERER}.exe` : IMAGE_RENDERER;
  // On Windows process.env gives Path under this name too, and an entry may be quoted.
  const folders = (process.env["PATH"] ?? "")
    .split(delimiter)
    .map((folder) => (windows ? folder.replace(/^"(.*)"$/u, "$1") : folder));
  const program = folders
    .filter((folder) => (windows ? WINDOWS_ABSOLUTE.test(folder) : isAbsolute(folder)))
    .map((folder) => join(folder, name))
    .find(isRunnable);
  const refused = ERRORS.create("png-jpeg-export-requires-local-poppler-pdftocairo-program", []);
  if (program === undefined) throw refused;
  try {
    // In its own folder, where it finds the libraries that come with it, and no others.
    await execute(program, ["-v"], {
      cwd: dirname(program),
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: RENDERER_OUTPUT_BYTES,
    });
  } catch {
    throw refused;
  }
  return program;
}

/** Whether `file` is a file that this process may run. */
function isRunnable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Refuses image export where no local Poppler renderer can be run (foundRenderer;
 * export.image-export.png-jpeg-export-requires-local-poppler-pdftocairo-program).
 */
export async function assertImageRenderer(): Promise<void> {
  await imageRenderer();
}

/** Why an image folder is refused: something is there already. */
export const IMAGE_FOLDER_TAKEN =
  "The image folder already exists. Choose a new folder for the exported images.";

/**
 * Claims the new image folder `directory`, refused with IMAGE_FOLDER_TAKEN where something is
 * there (export.private-file.absent-path-refused) and refused when it is blank
 * (export.private-file.new-folder-path-empty-one-refused), as NewFolder refuses it. A claim makes
 * nothing, so the command line also asks it early, before anything is rendered.
 */
export function claimImageFolder(directory: string): Promise<NewFolder> {
  return NewFolder.claim(directory, IMAGE_FOLDER_TAKEN);
}

/** The renderer's options that draw page `number` of the document as one image in `image`. */
function pageOptions(page: PDFPage, number: number, image: ImageFormat): string[] {
  const pageNumber = String(number);
  return [
    "-r",
    String(IMAGE_DPI),
    "-f",
    pageNumber,
    "-l",
    pageNumber,
    "-singlefile",
    "-x",
    "0",
    "-y",
    "0",
    "-W",
    String(coveredPixels(page.getWidth())),
    "-H",
    String(coveredPixels(page.getHeight())),
    // Unpainted paper, such as the rounded corners of a separate card, stays
    // transparent in PNG. JPEG has no transparency and shows it white.
    ...(DOCUMENT_FORMAT_FACTS[image].transparentPaper
      ? ["-png", "-transp"]
      : ["-jpeg", "-jpegopt", `quality=${DOCUMENT_FORMAT_FACTS[image].qualityPercent}`]),
    // "-" twice: the document comes on standard input and the image goes to standard output
    // (-singlefile allows it), so that neither is ever a file outside the destination (CORE-24).
    "-",
    "-",
  ];
}

/** The `length` bytes of `pieces` in one array of their own, which can be wiped alone. */
function joined(pieces: readonly Uint8Array[], length: number): Uint8Array {
  const whole = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    whole.set(piece, offset);
    offset += piece.length;
  }
  return whole;
}

/**
 * The image of `page`, page `number` of the PDF `document`, that `program` draws in `image`, as
 * bytes that the caller owns and wipes; each piece read from the renderer is wiped once joined.
 * Refuses when the renderer ends with an error or a signal (local-pdf-renderer-failed), takes
 * longer than PAGE_TIMEOUT_SECONDS (local-pdf-renderer-took-too-long), writes more than
 * IMAGE_BYTES_PER_PIXEL for each pixel (local-pdf-renderer-wrote-too-much) or writes nothing
 * (local-pdf-renderer-produced-no-images); rejects with the system's error when it cannot start.
 */
function drawnPage(
  program: string,
  document: Uint8Array,
  page: PDFPage,
  number: number,
  image: ImageFormat,
): Promise<Uint8Array> {
  const limit =
    coveredPixels(page.getWidth()) * coveredPixels(page.getHeight()) * IMAGE_BYTES_PER_PIXEL;
  return new Promise((resolve, reject) => {
    const child = spawn(program, pageOptions(page, number, image), {
      // In its own folder, where it finds the libraries that come with it, as for its version.
      cwd: dirname(program),
      // Its own messages are not kept: the code of a refusal says what went wrong.
      stdio: ["pipe", "pipe", "ignore"],
    });
    const pieces: Buffer[] = [];
    let length = 0;
    let refusal: Error | undefined;
    let settled = false;
    // At once and for sure: the renderer writes nothing but its output, which is then refused.
    const stop = (error: Error): void => {
      refusal ??= error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      stop(ERRORS.create("local-pdf-renderer-took-too-long", [`${PAGE_TIMEOUT_SECONDS}`]));
    }, PAGE_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND);
    // "error" when it cannot start, which "close" may follow: the first one settles.
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        finish();
      } finally {
        wipeAll(pieces);
      }
    };
    child.stdout.on("data", (piece: Buffer) => {
      // Nothing more is kept once the page is refused, so that the pieces stay within the limit.
      if (refusal !== undefined) {
        piece.fill(0);
        return;
      }
      pieces.push(piece);
      length += piece.length;
      if (length > limit) stop(ERRORS.create("local-pdf-renderer-wrote-too-much", [`${limit}`]));
    });
    // A renderer that ends before it has read the whole document closes its input (EPIPE): how it
    // ended says what happened. Any other failure to give it the document is passed on.
    child.stdin.on("error", (error) => {
      if (errorCode(error) !== "EPIPE") stop(error);
    });
    child.once("error", (error) => {
      settle(() => reject(error));
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() => {
        if (refusal !== undefined) reject(refusal);
        else if (signal !== null)
          reject(ERRORS.create("local-pdf-renderer-failed", [`stopped by ${signal}`]));
        else if (code !== 0)
          reject(ERRORS.create("local-pdf-renderer-failed", [`exit code ${String(code)}`]));
        else if (length === 0) reject(ERRORS.create("local-pdf-renderer-produced-no-images", []));
        else resolve(joined(pieces, length));
      });
    });
    child.stdin.end(document);
  });
}

/**
 * Writes the PDF `bytes` at `basePath` in `format`: the PDF itself, or the image of each page,
 * drawn by the local Poppler renderer, numbered when there are several (pageFileName); returns
 * how many files it wrote. Each image goes straight to its file at `basePath`, in the staging
 * folder beside the destination, and its bytes are wiped once written: no copy of the document
 * or of a page is kept in a temporary folder (CORE-24). Refuses a format that is none
 * (export.document-formats.image-format-one-accepted-as-alias), a computer without the renderer
 * (export.image-export.png-jpeg-export-requires-local-poppler-pdftocairo-program), a document
 * without pages (export.image-export.local-pdf-renderer-produced-no-images), a page that the
 * renderer does not draw, as drawnPage refuses it (export.image-export.local-pdf-renderer-failed,
 * local-pdf-renderer-took-too-long, local-pdf-renderer-wrote-too-much,
 * local-pdf-renderer-produced-no-images), and an image file that exists already
 * (export.image-export.image-destination-already-exists-nothing-will-overwritten). A PDF file that
 * exists already fails with the file system's own error (EEXIST); so does any other failure to
 * write.
 */
export async function writeRenderedDocument(
  bytes: Uint8Array,
  basePath: string,
  format: DocumentFormat = DEFAULT_DOCUMENT_FORMAT,
): Promise<number> {
  if (format === "pdf") {
    await writeNewPrivateFile(pageFileName(basePath, 0, 1, format), bytes);
    return 1;
  }
  // A JavaScript host may pass any value: it is read as a person's answer is.
  const image = parseImageFormat(format);
  const program = await imageRenderer();
  const pages = (await PDFDocument.load(bytes)).getPages();
  if (!pages.length) throw ERRORS.create("local-pdf-renderer-produced-no-images", []);
  try {
    // Pages can differ in size, so each one is rendered with its own image size.
    for (const [index, page] of pages.entries()) {
      // The page shows what the document shows: its bytes are wiped once written.
      await wipedAfterAsync(await drawnPage(program, bytes, page, index + 1, image), (drawn) =>
        writeNewPrivateFile(pageFileName(basePath, index, pages.length, image), drawn),
      );
    }
    return pages.length;
  } catch (error) {
    if (errorCode(error) === "EEXIST")
      throw ERRORS.create("image-destination-already-exists-nothing-will-overwritten", []);
    throw error;
  }
}

/**
 * Saves each page of the PDF `bytes` as an image in `format`, in the new folder `directory`;
 * returns how many image files it wrote. The pages are written into a staging folder beside
 * `directory`, and published together under its name only once every page is written
 * (NewFolder.publish). Refuses, before anything is written, a computer without the local Poppler
 * renderer (assertImageRenderer;
 * export.image-export.png-jpeg-export-requires-local-poppler-pdftocairo-program), then a folder
 * that exists already (IMAGE_FOLDER_TAKEN, export.private-file.absent-path-refused) or is blank
 * (export.private-file.new-folder-path-empty-one-refused), as claimImageFolder refuses it. Then
 * what writeRenderedDocument refuses passes on, and so do the other failures of NewFolder.publish.
 */
export async function exportPageImages(
  bytes: Uint8Array,
  directory: string,
  format: ImageFormat = DEFAULT_IMAGE_FORMAT,
): Promise<number> {
  await assertImageRenderer();
  const folder = await claimImageFolder(directory);
  return folder.publish(".mnemocode-images-", (staging) =>
    writeRenderedDocument(bytes, join(staging, "page"), format),
  );
}
