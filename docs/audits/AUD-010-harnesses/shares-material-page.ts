// AUD-010 "shares": the page size of share sheets when no --page-size is given. The help of
// --page-size says "a6 (default) or a4 for one sheet", docs/SSKR.md's table gives "`a6` (default)"
// for a collection sheet per share, and the menu's "A6 sheets" passes no --page-size because "A6
// is the page size that the commands take when none is given" (menu.ts, askCardFiles). Ordinary
// cards get A6 (render.ts: "Without a page size every template uses the A6 sheet"); share sheets
// are rendered by ShareCardSet, which hands the material renderer no page size, and that renderer
// falls back to "business" (material-cards.ts). The probe runs `sskr-export` on the command line
// for each design family and measures the pages of the PDF with pdf-lib. Expected: 148 x 105 mm.
// Public data only: a 2-of-3 split of "abandon ... about" and of "abandon ... art" made with a
// fixed synthetic seed (every byte 7).
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-material-page.ts

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/material-page", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const MM_PER_POINT = 25.4 / 72;
const split = (phrase: string) =>
  new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(phrase, 2, 3);
const shares12 = await split(`${"abandon ".repeat(11)}about`);
const shares24 = await split(`${"abandon ".repeat(23)}art`);

let failures = 0;
function sskrExport(name: string, shares: readonly string[], extra: readonly string[]) {
  const pdf = join(OUT, `${name}.pdf`);
  const run = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "src/mnemocode.ts",
      "sskr-export",
      ...shares.flatMap((share) => ["--share", share]),
      "--pdf",
      pdf,
      ...extra,
    ],
    { env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  return { pdf, status: run.status, stderr: run.stderr.toString() };
}
async function pageSizes(pdf: string): Promise<string[]> {
  const document = await PDFDocument.load(readFileSync(pdf));
  return document
    .getPages()
    .map(
      (page) =>
        `${Math.round(page.getWidth() * MM_PER_POINT)}x${Math.round(page.getHeight() * MM_PER_POINT)}`,
    );
}
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}

for (const template of [
  "business-it",
  "business-glass-4in1",
  "material-tile",
  "material-kitchen",
]) {
  for (const size of [[], ["--page-size", "a6"]]) {
    const name = `${template}${size.length === 0 ? "-default" : "-a6"}`;
    const run = sskrExport(name, shares12.slice(0, 2), ["--template", template, ...size]);
    check(`${name}: exit status`, run.status, 0);
    if (run.status === 0)
      check(`${name}: page sizes in mm (12-word shares, no QR code)`, await pageSizes(run.pdf), [
        "148x105",
        "148x105",
      ]);
    else console.log(`  stderr: ${run.stderr.trim()}`);
  }
}
// A 24-word share in its default form (ur, printed as Bytewords) with a QR code on the sheet.
for (const size of [[], ["--page-size", "a6"]]) {
  const name = `material-tile-24-qr${size.length === 0 ? "-default" : "-a6"}`;
  const run = sskrExport(name, shares24.slice(0, 1), [
    "--template",
    "material-tile",
    "--card-qr",
    ...size,
  ]);
  check(`${name}: exit status`, run.status, 0);
  if (run.status === 0) check(`${name}: page size in mm`, await pageSizes(run.pdf), ["148x105"]);
  else console.log(`  stderr: ${JSON.stringify(run.stderr.trim().split("\n").slice(-2))}`);
}
console.log(
  `Share sheet page size checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`,
);
process.exitCode = failures === 0 ? 0 : 1;
