import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";

export type ImageFormat = "png" | "jpg";
export type DocumentFormat = "pdf" | ImageFormat;
const execute = promisify(execFile);
const IMAGE_DPI = 300;
const POINTS_PER_INCH = 72;

// Both come with Poppler. pdftocairo can leave the paper transparent, which pdftoppm cannot.
const IMAGE_RENDERER = "pdftocairo";

/**
 * Whole pixels that a page covers completely.
 *
 * Poppler rounds the image size up, so the last row and column of pixels are covered only
 * in part and show the paper as a thin line. Rounding down leaves them out.
 */
function coveredPixels(points: number): number {
  return Math.max(1, Math.floor((points * IMAGE_DPI) / POINTS_PER_INCH));
}
let renderer: Promise<void> | undefined;

/** Optional local Poppler adapter; never downloads a renderer or sends data online. */
export function assertImageRenderer(): Promise<void> {
  return (renderer ??= execute(IMAGE_RENDERER, ["-v"], { timeout: 10_000, maxBuffer: 64 * 1024 })
    .then(() => undefined)
    .catch(() => {
      renderer = undefined;
      throw new Error(
        "PNG/JPEG export requires the local Poppler pdftocairo program. Install Poppler before using image export, or export PDF instead.",
      );
    }));
}

export async function requireNewImageDirectory(path: string): Promise<string> {
  if (!path.trim() || path === "-") throw new Error("Image export requires a new folder path.");
  const target = resolve(path);
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return target;
    throw error;
  }
  throw new Error("The image folder already exists. Choose a new folder for the exported images.");
}

/** Emits the unchanged PDF renderer's pages. Multipage documents get numbered image files. */
export async function writeRenderedDocument(
  bytes: Uint8Array,
  basePath: string,
  format: DocumentFormat = "pdf",
): Promise<number> {
  if (format === "pdf") {
    await writeFile(`${basePath}.pdf`, bytes, { flag: "wx", mode: 0o600 });
    return 1;
  }
  if (format !== "png" && format !== "jpg") throw new Error("Image format must be png or jpg.");
  await assertImageRenderer();
  const temporary = await mkdtemp(join(tmpdir(), "mnemocode-raster-"));
  try {
    const input = join(temporary, "document.pdf");
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    const pages = (await PDFDocument.load(bytes)).getPages();
    // Pages can differ in size, so each one is rendered with its own image size.
    for (const [index, page] of pages.entries()) {
      const number = String(index + 1);
      await execute(
        IMAGE_RENDERER,
        [
          "-r",
          String(IMAGE_DPI),
          ...["-f", number, "-l", number, "-singlefile"],
          ...["-x", "0", "-y", "0"],
          ...["-W", String(coveredPixels(page.getWidth()))],
          ...["-H", String(coveredPixels(page.getHeight()))],
          // Unpainted paper, such as the rounded corners of a separate card, stays
          // transparent in PNG. JPEG has no transparency and shows it white.
          ...(format === "png" ? ["-png", "-transp"] : ["-jpeg", "-jpegopt", "quality=90"]),
          input,
          join(temporary, `page-${number}`),
        ],
        { timeout: 120_000, maxBuffer: 64 * 1024 },
      );
    }
    const files = (await readdir(temporary))
      .filter((file) => /^page-\d+\.(png|jpg)$/u.test(file))
      .sort((a, b) => Number(a.match(/\d+/u)![0]) - Number(b.match(/\d+/u)![0]));
    if (!files.length) throw new Error("The local PDF renderer produced no images.");
    for (const [index, file] of files.entries()) {
      const suffix = files.length === 1 ? "" : `-${String(index + 1).padStart(2, "0")}`;
      await writeFile(`${basePath}${suffix}.${format}`, await readFile(join(temporary, file)), {
        flag: "wx",
        mode: 0o600,
      });
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
  format: ImageFormat = "png",
): Promise<number> {
  await assertImageRenderer();
  const target = await requireNewImageDirectory(directory);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".mnemocode-images-"));
  try {
    const count = await writeRenderedDocument(bytes, join(staging, "page"), format);
    await requireNewImageDirectory(target);
    await rename(staging, target);
    await chmod(target, 0o700);
    return count;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
