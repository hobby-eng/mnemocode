/** AUD-008: actual PDF/PNG/JPEG payload probe using one public fixture and one design. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { parseRecord } from "../../../dist/record.js";
import { parseInput, indexesToColors } from "../../../dist/core.js";
import { writeRenderedDocument } from "../../../dist/export/image-export.js";

const root = resolve(import.meta.dirname, "../../..");
const evidence = resolve(root, "docs/audits/AUD-008-evidence");
const mnemonic = `${"abandon ".repeat(11)}about`;
const pdfPath = resolve(evidence, "interface-card.pdf");
const imagesPath = resolve(evidence, "interface-card-images");
const argv = [
  "dist/mnemocode.js",
  "encode",
  "--mnemonic",
  mnemonic,
  "--date",
  "23-09-2026",
  "--format",
  "colors-unicode",
  "--template",
  "business-glass-4in1",
  "--page-size",
  "a6",
  "--orientation",
  "portrait",
  "--card-qr",
  "--studio-name",
  "AUDIT STUDIO",
  "--card-name",
  "Alex Morgan",
  "--pdf",
  pdfPath,
  "--images-dir",
  imagesPath,
];
const result = spawnSync(process.execPath, argv, {
  cwd: root,
  encoding: "utf8",
  timeout: 70_000,
  env: { ...process.env, NO_COLOR: "1" },
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const record = parseRecord(
  readFileSync(resolve(evidence, "interface-contract-outputs/colors-unicode.txt"), "utf8"),
);
const colors = indexesToColors(parseInput(record.payload, record.format));
const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
  encoding: "utf8",
  timeout: 10_000,
});
assert.match(text, /AUDIT STUDIO/u);
for (const [index, color] of colors.entries()) {
  assert(
    text.includes(color.slice(1).toUpperCase()),
    `Missing printed reference ${index + 1}: ${color}`,
  );
}
const pdfBytes = readFileSync(pdfPath);
const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
assert.equal(doc.getPageCount(), 1);
assert.equal(Math.round((doc.getPage(0).getWidth() * 25.4) / 72), 105);
assert.equal(Math.round((doc.getPage(0).getHeight() * 25.4) / 72), 148);
for (const value of [
  doc.getTitle(),
  doc.getAuthor(),
  doc.getSubject(),
  doc.getKeywords(),
  doc.getCreator(),
  doc.getProducer(),
]) {
  assert.equal(value ?? "", "");
}
const pngPath = resolve(imagesPath, "page.png");
const pngBytes = readFileSync(pngPath);
const image = PNG.sync.read(pngBytes);
const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
assert.equal(
  decoded?.data,
  record.payload,
  "Actual CLI PNG QR must retain exact selected payload bytes",
);
assert.equal(image.width, Math.floor((105 / 25.4) * 300));
assert.equal(image.height, Math.floor((148 / 25.4) * 300));
const jpegBase = resolve(evidence, "interface-card-jpeg");
assert.equal(await writeRenderedDocument(pdfBytes, jpegBase, "jpg"), 1);
const jpegBytes = readFileSync(`${jpegBase}.jpg`);
assert.equal(jpegBytes.subarray(0, 2).toString("hex"), "ffd8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const summary = {
  fixture: "Public BIP39 zero-entropy vector; 23-09-2026 public date",
  argv,
  template: "business-glass-4in1",
  wordCount: 12,
  printedReferences: colors.length,
  pageMm: [105, 148],
  imagePixels: [image.width, image.height],
  imageDpi: 300,
  actualPngQrBytesExact: true,
  pdfMetadataEmpty: true,
  pdfSha256: sha256(pdfBytes),
  pngSha256: sha256(pngBytes),
  jpegSha256: sha256(jpegBytes),
  limits:
    "One supported template at A6 portrait. JPEG container checked; no independent JPEG QR decoding.",
};
writeFileSync(resolve(evidence, "interface-card.text.txt"), text);
writeFileSync(
  resolve(evidence, "interface-artifact-results.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));
