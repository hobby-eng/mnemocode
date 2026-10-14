// Five public-fixture pages only; never generate a complete card gallery.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  loadCardRenderer,
  officialShareContent,
  ordinaryContent,
  qrOfPdfPage,
  REVIEW_TEXTS,
} from "../../../scripts/card-fixtures.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// A fresh remediation destination preserves the baseline artifacts and their recorded hashes.
const relativeDestination = process.argv[2] ?? "output/aud021-representative";
const destination = resolve(root, relativeDestination);
await mkdir(destination, { recursive: true });
const renderer = await loadCardRenderer(root);
const content = {
  ...ordinaryContent(renderer, 32, "business"),
  presentation: { studioName: "Public Audit Studio", slogan: "Public fixture", ...REVIEW_TEXTS },
  profile: {
    company: "PUBLIC FIXTURE",
    role: "IT Solutions Director",
    name: "Alex Morgan",
    email: "alex@example.com",
  },
  cardQr: true,
};
const share = { ...content, ...officialShareContent(renderer) };
const cases = [
  ["business-collection", () => renderer.renderBusinessCards("it", content), content.payload],
  ["business-fragment", () => renderer.renderBusinessCards("it", content, 1), undefined],
  ["business-share", () => renderer.renderBusinessCards("it", share, 0), share.payload],
  ["material-collection", () => renderer.selectTemplate("material-kitchen").render(renderer.drawing, content), content.payload],
  ["material-a6", () => renderer.selectTemplate("material-kitchen").render(renderer.drawing, { ...content, pageSize: "a6" }), content.payload],
];
const manifest = [];
for (const [name, render, expected] of cases) {
  const bytes = await render();
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 1, `${name}: page count`);
  assert.equal(pdf.context.trailerInfo.Info, undefined, `${name}: no document metadata`);
  const path = resolve(destination, `${name}.pdf`);
  await writeFile(path, bytes, { mode: 0o600 });
  assert.equal(await qrOfPdfPage(path, 1, resolve(destination, name)), expected, `${name}: QR payload`);
  for (const extension of ["pdf", "png"]) {
    const artifact = await readFile(resolve(destination, `${name}.${extension}`));
    manifest.push({ path: `${relativeDestination}/${name}.${extension}`, bytes: artifact.length, sha256: createHash("sha256").update(artifact).digest("hex") });
  }
  console.log(`${name}: one page, metadata absent, QR ${expected === undefined ? "absent" : "exact"}`);
}
await writeFile(resolve(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Five representative pages passed; no full gallery generated.");
