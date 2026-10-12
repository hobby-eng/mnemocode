// AUD-010 "shares": a collection sheet of a 24-word share in Bytewords (16 cards of three words)
// that a design refuses or not depending on the share and on the random decorative colors. On a
// material sheet each card's caption holds its codes and the name of the finish that its color is
// matched to (material-cards.ts, drawMaterialStudy), and the widest caption sets the narrowest
// column (collection-sheet.ts, collectionSheetLayout). Codes of three Bytewords are wider than one
// color code, so some sheets no longer fit, and which ones depends on chance.
//
// Reproducible: the shares are splits of the public "abandon ... art" phrase made by ShareSplit with
// a fixed synthetic seed (every byte = the seed number), and the render platform's random choices
// (decorative colors, invented details) come from a seeded generator (mulberry32). For each seed it
// renders the A6 sheet with a QR code (ShareCardSet.renderShare) of the share in Bytewords and in
// colors. Expected (docs/SSKR.md: shares can be printed as cards with every template; A6 is the
// default): every sheet renders. Prints each refusal with its seeds.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-sheet-random.ts [style] [seeds]

import { configureRenderPlatform } from "../../../src/export/platform.ts";
import { nodeRenderPlatform } from "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";
import { readShare } from "../../../src/sskr/transport.ts";
import { reference } from "./shares-oracle.ts";

const PHRASE_24 = `${"abandon ".repeat(23)}art`;
const style = (process.argv[2] ?? "tile") as "tile";
const seeds = Number(process.argv[3] ?? "24");

/** mulberry32: a small seeded generator, so that each render's choices can be made again. */
function seeded(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return (limit) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    return Math.floor(unit * limit);
  };
}

async function render(
  shares: string[],
  place: number,
  form: "words" | "colors",
  seed: number,
): Promise<string> {
  configureRenderPlatform({ ...nodeRenderPlatform, randomInt: seeded(seed) });
  try {
    await new ShareCardSet(shares, { style, pageSize: "a6", cardQr: true, shareFormat: form }).renderShare(place);
    return "ok";
  } catch (error) {
    return (error as Error).message;
  } finally {
    configureRenderPlatform(nodeRenderPlatform);
  }
}

const refused: string[] = [];
let colorRefusals = 0;
let sheets = 0;
for (let seed = 0; seed < seeds; seed++) {
  const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(seed % 256)).split(
    PHRASE_24,
    2,
    3,
  );
  for (const place of [0, 1, 2]) {
    sheets += 1;
    const words = await render(shares, place, "words", seed);
    const colors = await render(shares, place, "colors", seed);
    const name = reference(shares[place]!);
    if (words !== "ok" || colors !== "ok")
      console.log(`split seed ${seed}, render seed ${seed}, share ${name}: words=${words === "ok" ? "ok" : "REFUSED"} colors=${colors === "ok" ? "ok" : "REFUSED"}`);
    if (words !== "ok") refused.push(`seed ${seed}, share ${name} (${readShare(shares[place]!).format}): ${words}`);
    if (colors !== "ok") colorRefusals += 1;
  }
}
console.log(`\n${style}, A6, QR code, 24-word shares: ${refused.length} of ${sheets} sheets in Bytewords refused; ${colorRefusals} in colors.`);
for (const line of refused) console.log(`  ${line}`);
process.exitCode = refused.length === 0 && colorRefusals === 0 ? 0 : 1;
