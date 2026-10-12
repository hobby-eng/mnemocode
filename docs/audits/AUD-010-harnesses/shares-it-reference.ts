// AUD-010 "shares": where the reference line of a separate card of the "it" design starts. The
// line ("<label> NN / MM  <codes>  |  <reference>") is fitted to at most 76 mm
// (business-cards.ts, fit) but right-aligned at 55.5 mm from the left edge of the 90 mm card, so a
// line wider than 55.5 mm starts before the left edge and is cut off. The probe renders the first
// separate card of a share through ShareCardSet, and of ordinary color cards through the template,
// with the default label "Ref." and with longer labels that the card options accept
// (--card-reference-label, up to 100 characters), and reads where the first word starts with
// `pdftotext -bbox`. Expected: every word of the line lies on the card (x >= 0). Public data only.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-it-reference.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { CardPreview } from "../../../src/export/card-preview.ts";
import { renderIndividualCards } from "../../../src/export/render.ts";
import { selectTemplate } from "../../../src/export/templates.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/it-reference", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const POINTS_PER_MM = 72 / 25.4;
const presentation = (referenceLabel: string) => ({
  studioName: "Test Studio",
  slogan: "Test slogan.",
  subtitle: "Test subtitle.",
  footer: "Test footer.",
  referenceLabel,
});

let failures = 0;
/** The words of the bottom line of a one-page PDF, with their left edges in mm. */
function bottomLine(pdf: Uint8Array, stem: string): { word: string; xMm: number }[] {
  const path = join(OUT, `${stem}.pdf`);
  writeFileSync(path, pdf);
  const html = execFileSync("pdftotext", ["-bbox", path, "-"]).toString();
  const words = [
    ...html.matchAll(/<word xMin="([-\d.]+)" yMin="([-\d.]+)"[^>]*>([^<]*)<\/word>/gu),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]), word: match[3]! }));
  const lowest = Math.max(...words.map((word) => word.y));
  return words
    .filter((word) => Math.abs(word.y - lowest) < 1)
    .map((word) => ({ word: word.word, xMm: Math.round((word.x / POINTS_PER_MM) * 10) / 10 }));
}
function check(name: string, line: { word: string; xMm: number }[], expectInside: boolean): void {
  const first = Math.min(...line.map((word) => word.xMm));
  const inside = first >= 0;
  const ok = inside === expectInside;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}\n  line: ${line.map((word) => word.word).join(" ")}\n  first word starts at ${first} mm (card 0 to 90 mm); expected ${expectInside ? "on the card" : "off the card (control)"}`,
  );
}

const shares = await splitSskrMnemonic(`${"abandon ".repeat(23)}art`, 2, 3);
for (const label of ["Ref.", "Reference", "Collection reference"]) {
  for (const form of ["words", "indexes"] as const) {
    const cards = new ShareCardSet(shares, {
      style: "it",
      shareFormat: form,
      pageSize: "business",
      presentation: presentation(label),
    });
    const iterator = cards.documents(0);
    const document = (await iterator.next()).value!;
    await iterator.return(undefined);
    check(
      `share card, it, ${form}, label ${JSON.stringify(label)}`,
      bottomLine(document.bytes, `share-${form}-${label.length}`),
      true,
    );
  }
}
// Ordinary color cards of the same design, for comparison: a label of 30 characters.
const template = selectTemplate("business-it");
for (const label of ["Ref.", "Reference number of the sample"]) {
  const content = {
    ...new CardPreview().content(template),
    pageSize: "business" as const,
    presentation: presentation(label),
  };
  const [first] = await renderIndividualCards(template, content as never);
  check(
    `color card, it, label ${JSON.stringify(label)}`,
    bottomLine(first!.bytes, `colors-${label.length}`),
    true,
  );
}
console.log(`IT reference line checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`);
process.exitCode = failures === 0 ? 0 : 1;
