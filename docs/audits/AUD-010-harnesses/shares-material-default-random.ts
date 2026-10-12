// AUD-010 "shares": the collection sheet of a 24-word share in a material design when no page size
// is given (with and without --card-qr), the default that the help and docs/SSKR.md call A6 and that the menu's "A6 sheets"
// relies on. ShareCardSet hands the material renderer no page size, and the renderer falls back to
// the business size (material-cards.ts: options.pageSize ?? content.pageSize ?? "business"); see
// shares-material-page.ts for the page sizes on the command line. On that 90 x 50 mm page the 16
// captions of a share in Bytewords, the form a share written as ur:sskr is printed in, may not fit,
// and whether they do depends on the share. The probe renders the sheet of the first share
// (ShareCardSet.renderShare) for splits of the public "abandon ... art" phrase made by ShareSplit
// with fixed synthetic seeds (every byte = the seed), the render platform's random choices from a
// seeded generator (mulberry32); colors and the explicit A6 size are the controls. Expected: every
// sheet renders. Run: node --import tsx docs/audits/AUD-010-harnesses/shares-material-default-random.ts [seeds]

import { configureRenderPlatform } from "../../../src/export/platform.ts";
import { nodeRenderPlatform } from "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";

const PHRASE_24 = `${"abandon ".repeat(23)}art`;
const STYLES = ["kitchen", "switch", "tile", "vehicle", "enclosure"] as const;
const seeds = Number(process.argv[2] ?? "8");

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

const tally = new Map<string, { refused: number; sheets: number; message?: string }>();
for (let seed = 0; seed < seeds; seed++) {
  const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(seed % 256)).split(PHRASE_24, 2, 3);
  for (const style of STYLES)
    for (const [label, form, pageSize, cardQr] of [
      ["words, no page size", "words", undefined, false],
      ["words, no page size, QR code", "words", undefined, true],
      ["colors, no page size, QR code", "colors", undefined, true],
      ["words, a6, QR code", "words", "a6", true],
    ] as const) {
      configureRenderPlatform({ ...nodeRenderPlatform, randomInt: seeded(seed) });
      const key = `${style} / ${label}`;
      const entry = tally.get(key) ?? { refused: 0, sheets: 0 };
      entry.sheets += 1;
      try {
        await new ShareCardSet(shares, { style, shareFormat: form, cardQr, ...(pageSize ? { pageSize } : {}) }).renderShare(0);
      } catch (error) {
        entry.refused += 1;
        entry.message = (error as Error).message;
      } finally {
        configureRenderPlatform(nodeRenderPlatform);
      }
      tally.set(key, entry);
    }
}
let refusals = 0;
for (const [key, entry] of tally) {
  refusals += entry.refused;
  console.log(`${entry.refused === 0 ? "PASS" : "FAIL"}: ${key}: ${entry.refused} of ${entry.sheets} sheets refused${entry.message ? ` (${entry.message})` : ""}`);
}
console.log(`Material sheets without a page size: ${refusals === 0 ? "all rendered" : `${refusals} refused`}.`);
process.exitCode = refusals === 0 ? 0 : 1;
