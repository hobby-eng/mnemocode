import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import { pageFileName } from "./card-codes.js";
import { NewFolder, writeNewPrivateFile } from "./private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import {
  coveredPixels,
  DEFAULT_DOCUMENT_FORMAT,
  DEFAULT_IMAGE_FORMAT,
  DOCUMENT_FORMAT_FACTS,
  IMAGE_DPI,
  IMAGE_FORMATS,
  isImageFormat,
  parseImageFormat,
  type DocumentFormat,
  type ImageFormat,
} from "./document-formats.js";
import { defined } from "../core/defined.js";

// The formats and the drawing rules are document-formats.ts's, which a page takes too; here too
// for the modules of the command line that take them from here.
export {
  DEFAULT_DOCUMENT_FORMAT,
  IMAGE_FORMATS,
  isImageFormat,
  parseImageFormat,
  type DocumentFormat,
  type ImageFormat,
};
const execute = promisify(execFile);
/** The file of one page that the renderer writes, in any image format. */
const PAGE_FILE = new RegExp(`^page-\\d+\\.(?:${IMAGE_FORMATS.join("|")})$`, "u");

// Both come with Poppler. pdftocairo can leave the paper transparent, which pdftoppm cannot.
const IMAGE_RENDERER = "pdftocairo";
/** How long the renderer may take to say its version: long enough for a slow first start. */
const PROBE_TIMEOUT_MS = 10_000;
/** How long the renderer may take to draw one page. */
const PAGE_TIMEOUT_MS = 120_000;
/** The renderer's own messages kept: its pages go to files, so only a few lines come back. */
const RENDERER_OUTPUT_BYTES = 64 * 1024;

let renderer: Promise<void> | undefined;

/** Optional local Poppler adapter; never downloads a renderer or sends data online. */
export function assertImageRenderer(): Promise<void> {
  return (renderer ??= execute(IMAGE_RENDERER, ["-v"], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: RENDERER_OUTPUT_BYTES,
  })
    .then(() => undefined)
    .catch(() => {
      renderer = undefined;
      throw new Error(
        "PNG/JPEG export requires the local Poppler pdftocairo program. Install Poppler before using image export, or export PDF instead.",
      );
    }));
}

/** Why an image folder is refused: something is there already. */
export const IMAGE_FOLDER_TAKEN =
  "The image folder already exists. Choose a new folder for the exported images.";

/**
 * Claims the new image folder `directory`, refused with IMAGE_FOLDER_TAKEN (NewFolder). A claim
 * makes nothing, so the command line also asks it early, before anything is rendered.
 */
export function claimImageFolder(directory: string): Promise<NewFolder> {
  return NewFolder.claim(directory, IMAGE_FOLDER_TAKEN);
}

/**
 * Where the PDF for pdftocairo and its images wait: in memory on Linux (/dev/shm, a tmpfs), so
 * that these copies of a secret are not written to a file on a disk, swap aside (SECURITY.md);
 * where /dev/shm cannot be written, and on other systems, the system's temporary folder, which may
 * be on a disk (SECURITY.md says so).
 */
function rasterFolder(): string {
  const memory = "/dev/shm";
  if (process.platform !== "linux") return tmpdir();
  try {
    accessSync(memory, constants.W_OK);
    return memory;
  } catch {
    return tmpdir();
  }
}

/** Emits the unchanged PDF renderer's pages. Multipage documents get numbered image files. */
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
  await assertImageRenderer();
  const temporary = await mkdtemp(join(rasterFolder(), "mnemocode-raster-"));
  try {
    const input = join(temporary, "document.pdf");
    await writeNewPrivateFile(input, bytes);
    const pages = (await PDFDocument.load(bytes)).getPages();
    // Pages can differ in size, so each one is rendered with its own image size.
    for (const [index, page] of pages.entries()) {
      const number = String(index + 1);
      await execute(
        IMAGE_RENDERER,
        [
          "-r",
          String(IMAGE_DPI),
          "-f",
          number,
          "-l",
          number,
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
          input,
          join(temporary, `page-${number}`),
        ],
        { timeout: PAGE_TIMEOUT_MS, maxBuffer: RENDERER_OUTPUT_BYTES },
      );
    }
    const files = (await readdir(temporary))
      .filter((file) => PAGE_FILE.test(file))
      .sort((a, b) => Number(defined(a.match(/\d+/u))[0]) - Number(defined(b.match(/\d+/u))[0]));
    if (!files.length) throw new Error("The local PDF renderer produced no images.");
    for (const [index, file] of files.entries()) {
      // The page shows what the document shows: its bytes are wiped once written.
      await wipedAfterAsync(await readFile(join(temporary, file)), (page) =>
        writeNewPrivateFile(pageFileName(basePath, index, files.length, image), page),
      );
    }
    return files.length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error("An image destination already exists; nothing will be overwritten.");
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Publishes all pages together only after successful rendering. */
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
