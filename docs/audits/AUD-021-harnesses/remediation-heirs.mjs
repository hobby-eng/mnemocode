// Two worst-length public instructions only, not a gallery or an exhaustive renderer suite.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { heirSheetText } from "../../../dist/cli/heir-sheet.js";
import { A6, renderHeirSheet } from "../../../dist/export/heir-sheet.js";
import { nodeCardRenderer } from "../../../dist/export/platform-node.js";

const destination = resolve("output/aud021-remediation-heirs");
await mkdir(destination, { recursive: true });
const cases = [
  ["legacy", { backup: { kind: "encoded", format: "colors-unicode", words: 24 }, mode: "seedshift-legacy", dates: 8 }],
  ["shares", { backup: { kind: "shares", format: "unicode", threshold: 16, count: 16, codes: 33 }, mode: "seedshift", dates: 8 }],
];
const manifest = [];
for (const [name, facts] of cases) {
  const bytes = await renderHeirSheet(nodeCardRenderer, heirSheetText(facts), A6);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.context.trailerInfo.Info, undefined);
  const path = resolve(destination, `${name}.pdf`);
  await writeFile(path, bytes, { mode: 0o600 });
  const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
  const normalized = text.replace(/\s+/gu, " ");
  assert.ok(normalized.includes("valid checksum does not confirm the owner's wallet"));
  assert.ok(normalized.includes(name === "legacy" ? "Wrong dates may fail the checksum" : "Wrong dates can still give a valid seed phrase"));
  assert.ok(!normalized.includes("a wrong date gives no error"));
  execFileSync("pdftoppm", ["-f", "2", "-l", "2", "-singlefile", "-scale-to", "1000", "-png", path, resolve(destination, `${name}-back`)]);
  manifest.push({ path: `output/aud021-remediation-heirs/${name}.pdf`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  console.log(`${name}: A6 front/back, metadata absent, truthful wrong-date advice`);
}
await writeFile(resolve(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
