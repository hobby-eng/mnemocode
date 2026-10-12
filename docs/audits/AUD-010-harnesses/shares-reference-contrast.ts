// AUD-010 "shares": whether the reference line of a separate share card stays on plain background.
// A separate business card prints "Ref. NN / MM  <codes>  |  <share reference>" from 7.2 mm at the
// bottom (business-cards.ts; the "it" design right-aligns it at 55.5 mm). Three Bytewords or word
// numbers make the line longer than one color code, and on some designs its end then runs onto the
// artwork. The probe renders the first separate card of one share in each business design, in
// colors and in Bytewords, rasterises it at 300 dpi (pdftoppm), finds each word of the line with
// `pdftotext -bbox`, and measures the contrast between the word's ink (its pixel farthest in
// luminance from the background) and the background just above the word (median luminance of a
// strip 0.3 to 1.0 mm above it), as a WCAG 2 ratio. Expected: every word at least 3:1 (the WCAG
// minimum for large text; the line is small text, for which WCAG asks 4.5:1).
// Reproducible: a split of the public "abandon ... art" phrase made by ShareSplit with a fixed
// synthetic seed (every byte 7), and the render platform's random choices from a seeded generator.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-reference-contrast.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { configureRenderPlatform } from "../../../src/export/platform.ts";
import { nodeRenderPlatform } from "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/contrast", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const DPI = 300;
const PX_PER_POINT = DPI / 72;
const PX_PER_MM = DPI / 25.4;
const MINIMUM_RATIO = 3;
const STYLES = ["architect", "it", "estate", "diagonal", "contact", "curves", "facets"] as const;

function seeded(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return (limit) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * limit);
  };
}
/** WCAG 2 relative luminance of an sRGB pixel. */
function luminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(
  `${"abandon ".repeat(23)}art`,
  2,
  3,
);
const low: string[] = [];
for (const style of STYLES)
  for (const form of ["colors", "words"] as const) {
    configureRenderPlatform({ ...nodeRenderPlatform, randomInt: seeded(3) });
    const cards = new ShareCardSet(shares, { style, shareFormat: form, pageSize: "business" });
    const iterator = cards.documents(0);
    const { bytes } = (await iterator.next()).value!;
    await iterator.return(undefined);
    configureRenderPlatform(nodeRenderPlatform);
    const stem = `${style}-${form}`;
    const pdf = join(OUT, `${stem}.pdf`);
    writeFileSync(pdf, bytes);
    execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", pdf, join(OUT, stem)]);
    const image = PNG.sync.read(readFileSync(join(OUT, `${stem}.png`)));
    const html = execFileSync("pdftotext", ["-bbox", pdf, "-"]).toString();
    const words = [
      ...html.matchAll(
        /<word xMin="([-\d.]+)" yMin="([-\d.]+)" xMax="([-\d.]+)" yMax="([-\d.]+)">([^<]*)<\/word>/gu,
      ),
    ].map((m) => ({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, word: m[5]! }));
    const lowest = Math.max(...words.map((word) => word.y0));
    const line = words.filter((word) => Math.abs(word.y0 - lowest) < 1);
    const measured = line.map((word) => {
      const [x0, x1] = [
        Math.max(0, Math.floor(word.x0 * PX_PER_POINT)),
        Math.min(image.width - 1, Math.ceil(word.x1 * PX_PER_POINT)),
      ];
      const [y0, y1] = [Math.floor(word.y0 * PX_PER_POINT), Math.ceil(word.y1 * PX_PER_POINT)];
      const lum = (x: number, y: number) => {
        const at = (y * image.width + x) * 4;
        return luminance(image.data[at]!, image.data[at + 1]!, image.data[at + 2]!);
      };
      const background: number[] = [];
      for (let y = Math.max(0, Math.floor(y0 - 1.0 * PX_PER_MM)); y < y0 - 0.3 * PX_PER_MM; y++)
        for (let x = x0; x <= x1; x++) background.push(lum(x, y));
      background.sort((a, b) => a - b);
      const ground = background[Math.floor(background.length / 2)]!;
      let ink = ground;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (Math.abs(lum(x, y) - ground) > Math.abs(ink - ground)) ink = lum(x, y);
      return {
        word: word.word,
        x: Math.round((word.x0 / 72) * 254) / 10,
        ratio: Math.round(ratio(ink, ground) * 10) / 10,
      };
    });
    const weak = measured.filter((word) => word.ratio < MINIMUM_RATIO);
    console.log(
      `${weak.length === 0 ? "PASS" : "FAIL"}: ${stem}: ${measured.map((word) => `${word.word}@${word.x}mm=${word.ratio}:1`).join("  ")}`,
    );
    for (const word of weak)
      low.push(`${stem}: "${word.word}" at ${word.x} mm, contrast ${word.ratio}:1`);
  }
console.log(`\nWords of the reference line below ${MINIMUM_RATIO}:1: ${low.length}`);
for (const line of low) console.log(`  ${line}`);
process.exitCode = low.length === 0 ? 0 : 1;
