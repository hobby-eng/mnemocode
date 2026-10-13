/** Manual export check using public fixture data only. Not run at startup. */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  loadCardRenderer,
  officialShareContent,
  ordinaryContent,
  QR_DPI,
  qrOfPdfPage,
  REVIEW_TEXTS,
} from "./card-fixtures.mjs";
const destination = resolve(process.argv[2] ?? "goldens/current");
await mkdir(destination, { recursive: true });
// This checkout's build, which the command below runs too.
const root = fileURLToPath(new URL("..", import.meta.url));
const renderer = await loadCardRenderer(root);
const { cardTemplates, drawing, selectTemplate, writeShare, renderBusinessCards } = renderer;
const presentation = {
  studioName: "Orven Studio",
  slogan: "Details, deliberately.",
  ...REVIEW_TEXTS,
};
const base = {
  ...ordinaryContent(renderer, 32, "business"),
  presentation,
  profile: {
    company: "VECTOR SYSTEMS",
    role: "IT Solutions Director",
    name: "Alex Morgan",
    email: "alex@vector.com",
  },
  cardQr: true,
};
const share = { ...base, ...officialShareContent(renderer) };
const cases = [
  ["business-full", () => renderBusinessCards("it", base), base.payload],
  [
    "business-fragment",
    () => renderBusinessCards("it", { ...base, pageSize: "business" }, 1),
    undefined,
  ],
  ["business-sskr", () => renderBusinessCards("it", share, 0), share.payload],
  ["material-full", () => selectTemplate("material-kitchen").render(drawing, base), base.payload],
  [
    "material-fragment",
    () => selectTemplate("material-switch").renderIndividual(drawing, base, 1),
    undefined,
  ],
  ...cardTemplates.map((template) => [
    template.id + "-study",
    () => template.render(drawing, { ...base, pageSize: "business", orientation: "landscape" }),
    base.payload,
  ]),
];
const report = [];
for (const [name, render, expected] of cases) {
  const bytes = await render();
  // Loaded as it is: pdf-lib would otherwise write its own creator and dates into what it reads.
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  // No document information at all: no creator, no title, no dates (card-sets-self-test.ts).
  assert.equal(
    pdf.context.trailerInfo.Info,
    undefined,
    name + " must carry no document information",
  );
  const path = resolve(destination, name + ".pdf");
  await writeFile(path, bytes, { mode: 0o600 });
  const page = pdf.getPageCount();
  assert.equal(page, 1, name + " must remain a single page");
  const code = await qrOfPdfPage(path, page, resolve(destination, name));
  if (expected === undefined) {
    assert.equal(code, undefined, name + " must not contain an individual-card QR");
    report.push(`${name}: ${page} page, no individual-card QR`);
  } else {
    assert.equal(code, expected, name + " QR mismatch");
    report.push(`${name}: ${page} page, exact collection QR round-trip at ${QR_DPI} dpi`);
  }
  console.log(report.at(-1));
}
for (const id of ["business-it", "material-kitchen"]) {
  const doc = await PDFDocument.load(
    await selectTemplate(id).render(drawing, { ...base, pageSize: "a6", cardQr: false }),
  );
  assert.equal(doc.getPageCount(), 1, id + " default A6 page count");
  report.push(`${id}: default A6 without QR, 1 page`);
}
// The reported CLI regression: one member per page and the same-page QR in both export targets.
// The cards carry the details of the fixtures above, each given by its option.
const { COPY_OPTIONS, profileOption } = await renderer.load("dist/cli/business-options.js");
const detailOptions = [
  ...Object.entries(base.profile).flatMap(([field, text]) => [`--${profileOption(field)}`, text]),
  ...Object.entries(presentation).flatMap(([field, text]) => [`--${COPY_OPTIONS[field]}`, text]),
];
const cliDirectory = await mkdtemp(resolve(destination, "sskr-command-"));
const shares = renderer.vector.deterministic[0].shares;
const shareFile = resolve(cliDirectory, "public-shares.txt");
const proposal = resolve(cliDirectory, "sskr-2of3-study.pdf");
// Cards print shares in colors or in Unicode codes only (owner, 2026-10-13): given in colors.
const colorShares = shares.map((share) => writeShare(share, "colors"));
await writeFile(shareFile, colorShares.join("\n") + "\n", { mode: 0o600 });
execFileSync(
  process.execPath,
  [
    resolve(root, "dist/mnemocode.js"),
    "sskr-export",
    "--share-file",
    shareFile,
    "--card-layout",
    "collection",
    "--card-qr",
    "--template",
    "business-it",
    // A collection sheet needs A6 or A4; business size gives separate cards.
    "--page-size",
    "a6",
    "--orientation",
    "landscape",
    ...detailOptions,
    "--pdf",
    proposal,
    "--cards-dir",
    resolve(cliDirectory, "member-studies"),
  ],
  { stdio: "pipe" },
);
const combined = await PDFDocument.load(await readFile(proposal));
assert.equal(combined.getPageCount(), shares.length);
for (let i = 0; i < shares.length; i++) {
  assert.equal(
    await qrOfPdfPage(proposal, i + 1, resolve(cliDirectory, "page-" + (i + 1))),
    // Each page's QR code holds its own share as written, in colors, without the decoys.
    colorShares[i],
    "SSKR study must contain only its own member",
  );
}
report.push("SSKR command: three single-page member studies, exact same-page QR round-trips.");
console.log(report.at(-1));
console.log("Public-data proposal: " + proposal);
if (process.argv[3]) {
  const sampleOutput = resolve(process.argv[3]);
  await mkdir(dirname(sampleOutput), { recursive: true });
  await writeFile(sampleOutput, await readFile(proposal), { flag: "wx", mode: 0o600 });
  console.log("Saved verified public-data example: " + sampleOutput);
}
await writeFile(resolve(destination, "report.txt"), report.join("\n") + "\n");
console.log("Export checks completed; no full test suite executed.");
