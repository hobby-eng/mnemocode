/** Manual public-data comparison of two card builds; not part of normal CLI startup or CI. */
// Compares the pixels of every PDF of two folders, page by page at a fixed resolution, so that the
// dates and other metadata of a PDF play no part. The fixtures are what business-goldens.mjs
// wrote, so a new fixture needs no list here, and a file found in only one folder is a failure.
// Poppler's pdftoppm draws the pages (card-fixtures.mjs).
//
// Usage: node scripts/compare-business-goldens.mjs <before> <after>
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { pdfPageImage } from "./card-fixtures.mjs";

/** The resolution at which the pages of both folders are drawn and compared, in dots per inch. */
const RESOLUTION_DPI = 144;
/** The extension of the fixtures compared. */
const PDF = ".pdf";
/** The exit code of a call without its two folders, as for any other wrong usage. */
const USAGE_EXIT = 2;
/** The start of the name of the temporary folder that the page images are drawn into. */
const SCRATCH_PREFIX = "mnemocode-golden-";

/** The names of the PDF fixtures in `folder`, without their extension. */
async function fixtureNames(folder) {
  const files = await readdir(folder);
  return new Set(files.filter((file) => file.endsWith(PDF)).map((file) => basename(file, PDF)));
}

/** The number of pages of the PDF at `path`, read as it is, without changing its metadata. */
async function pageCount(path) {
  const pdf = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  return pdf.getPageCount();
}

/**
 * A failure for each of `names`, in order, that `others` lacks: a fixture found only in `folder`.
 * @param {ReadonlySet<string>} names
 * @param {ReadonlySet<string>} others
 * @param {string} folder
 */
function onlyIn(names, others, folder) {
  return [...names]
    .filter((name) => !others.has(name))
    .sort()
    .map((name) => `${name}: only in ${folder}`);
}

/** Whether two page images (pdfPageImage) have the same size and the same pixels. */
function samePixels(left, right) {
  return left.width === right.width && left.height === right.height && left.data.equals(right.data);
}

/**
 * The failures of the fixture `name` in the folders `before` and `after`: a page count that
 * differs, or each page whose pixels differ. The page images are drawn into `scratch`.
 */
async function fixtureFailures(name, before, after, scratch) {
  const [left, right] = [join(before, name + PDF), join(after, name + PDF)];
  const pages = await pageCount(left);
  if ((await pageCount(right)) !== pages) return [`${name}: page count differs`];
  const failures = [];
  for (let page = 1; page <= pages; page += 1) {
    const drawn = (pdf, side) =>
      pdfPageImage(pdf, page, RESOLUTION_DPI, join(scratch, `${name}-${side}`));
    if (!samePixels(await drawn(left, "before"), await drawn(right, "after")))
      failures.push(`${name} page ${page}: pixels differ`);
  }
  console.log(`${name}: ${pages} pages compared`);
  return failures;
}

const folders = process.argv.slice(2);
if (folders.length !== 2) {
  console.error("Usage: node scripts/compare-business-goldens.mjs <before> <after>");
  process.exit(USAGE_EXIT);
}
const [before, after] = folders;
const beforeNames = await fixtureNames(before);
const afterNames = await fixtureNames(after);
const failures = [
  ...onlyIn(beforeNames, afterNames, before),
  ...onlyIn(afterNames, beforeNames, after),
];
const names = [...beforeNames].filter((name) => afterNames.has(name)).sort();
if (names.length === 0) failures.push("no PDF fixture to compare");
const scratch = await mkdtemp(join(tmpdir(), SCRATCH_PREFIX));
try {
  for (const name of names) failures.push(...(await fixtureFailures(name, before, after, scratch)));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(`All ${names.length} public fixtures are pixel-identical at ${RESOLUTION_DPI} dpi.`);
