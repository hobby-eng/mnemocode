// Real protected CLI exports and recovery using only the public all-zero BIP39 fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { decodeQrPngFile } from "../../../dist/cli/qr-input.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const destination = resolve(root, "docs/audits/AUD-032-evidence/media");
await mkdir(destination, { mode: 0o700 });
const phrase = "abandon ".repeat(11) + "about";
const pdf = resolve(destination, "public-cards.pdf");
const pngs = resolve(destination, "public-pages");
const record = resolve(destination, "public-record.txt");
const run = (...args) => execFileSync(process.execPath, [resolve(root, "dist/mnemocode.js"), ...args], {
  cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, NO_COLOR: "1" },
});
run("encode", "--mnemonic", phrase, "--mode", "direct", "--format", "5",
  "--template", "business-it", "--page-size", "a6", "--pdf", pdf,
  "--images-dir", pngs, "--image-format", "png", "--card-qr", "--output", record);
const decodedRecord = run("decode", "--input-file", record).trim();
assert.equal(decodedRecord, phrase);
const qr = resolve(destination, "public-cards-qr.png");
const decodedQr = run("decode", "--qr-file", qr, "--mode", "direct", "--format", "5").trim();
assert.equal(decodedQr, phrase);
const bytes = await readFile(pdf);
const document = await PDFDocument.load(bytes, { updateMetadata: false });
assert.equal(document.getPageCount(), 1);
assert.equal(document.context.trailerInfo.Info, undefined);
const pageFiles = (await readdir(pngs)).filter((file) => file.endsWith(".png"));
assert.equal(pageFiles.length, 1);
const pagePath = resolve(pngs, pageFiles[0]);
const pagePng = PNG.sync.read(await readFile(pagePath));
assert.ok(pagePng.width > 1000 && pagePng.height > 1000);
const qrPayload = await decodeQrPngFile(qr);
assert.equal(await decodeQrPngFile(pagePath), qrPayload);
assert.equal(run("decode", "--qr-file", pagePath, "--mode", "direct", "--format", "5").trim(), phrase);
for (const file of [pdf, qr, record, pagePath])
  assert.equal((await stat(file)).mode & 0o777, 0o600);
const jpgs = resolve(destination, "public-jpeg-pages");
run("preview", "--template", "business-it", "--page-size", "a6",
  "--images-dir", jpgs, "--image-format", "jpg");
const jpgFiles = (await readdir(jpgs)).filter((file) => file.endsWith(".jpg"));
assert.equal(jpgFiles.length, 1);
const jpg = await readFile(resolve(jpgs, jpgFiles[0]));
assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
const sharePdf = resolve(destination, "public-shares.pdf");
const split = execFileSync(process.execPath, [resolve(root, "dist/mnemocode.js"),
  "encode", "--sskr", "--mnemonic", phrase, "--threshold", "2", "--shares", "3",
  "--share-format", "colors", "--pdf", sharePdf, "--card-qr"], {
  cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" },
});
assert.ok(split.includes("#"));
const shareImages = (await readdir(destination))
  .filter((name) => /^public-shares-.+-qr\.png$/u.test(name)).sort();
assert.equal(shareImages.length, 3);
const restoredShares = run("sskr-combine", "--share-qr", resolve(destination, shareImages[0]),
  "--share-qr", resolve(destination, shareImages[2]));
assert.equal(restoredShares.trim().split("\n").at(-1), phrase);
const sharesDocument = await PDFDocument.load(await readFile(sharePdf), { updateMetadata: false });
assert.equal(sharesDocument.getPageCount(), 3);
assert.equal(sharesDocument.context.trailerInfo.Info, undefined);
const files = [pdf, qr, record, pagePath, resolve(jpgs, jpgFiles[0]), sharePdf,
  ...shareImages.map((name) => resolve(destination, name))];
const artifacts = await Promise.all(files.map(async (path) => ({
  path: path.slice(root.length), bytes: (await stat(path)).size,
  sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
})));
const summary = {
  auditId: "AUD-032", completedAtUtc: new Date().toISOString(),
  checks: ["Exact public-phrase record restore", "Exact standalone QR restore",
    "Actual 300-dpi PNG-page QR restore", "One-page PDF without Info metadata",
    "Private output modes", "Actual JPEG signature",
    "Three share QR files and exact recovery from members 1 and 3",
    "Three-page share PDF without Info metadata"],
  png: { width: pagePng.width, height: pagePng.height },
  artifacts, limits: "Synthetic Linux export/recovery only; no physical print, browser, every-pixel comparison or JPEG QR decoding claim.",
};
await writeFile(resolve(destination, "../media-summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(summary));
