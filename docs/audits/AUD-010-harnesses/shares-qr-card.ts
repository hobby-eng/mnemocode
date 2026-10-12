// AUD-010 "shares": the QR card of one share (--card-layout qr) in the business size. The help of
// --card-layout says "qr: one document with a QR code per share, in any page size", and
// docs/SSKR.md's table gives "any | qr | One document with a QR code". The probe renders the QR
// card of one share (ShareCardSet.renderShare, layout qr, page size business) in every design and
// form, for 12- and 24-word shares, and records each refusal. Its check: no design that renders the
// share in colors (the form share cards printed before ab57e8d) refuses it in another form.
// Reproducible: splits of the public phrases made by ShareSplit with a fixed synthetic seed (every
// byte 7), and the render platform's random choices from a seeded generator (mulberry32, seed 1).
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-qr-card.ts [words=24] [styles=it,...]

import { configureRenderPlatform } from "../../../src/export/platform.ts";
import { nodeRenderPlatform } from "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";

const PHRASES = {
  12: `${"abandon ".repeat(11)}about`,
  24: `${"abandon ".repeat(23)}art`,
} as const;
const STYLES = [
  "architect",
  "it",
  "estate",
  "diagonal",
  "contact",
  "curves",
  "facets",
  "mixed",
  "kitchen",
  "switch",
  "tile",
  "vehicle",
  "enclosure",
  "glass-4in1",
  "glass-6in1",
  "glass-8in1",
] as const;
const FORMS = ["colors", "indexes", "unicode", "words"] as const;
const filter = (name: string): string[] | undefined =>
  process.argv
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .split(",");
const onlyWords = filter("words");
const onlyStyles = filter("styles");

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

const regressions: string[] = [];
for (const [words, phrase] of Object.entries(PHRASES)) {
  if (onlyWords !== undefined && !onlyWords.includes(words)) continue;
  const shares = await new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7)).split(phrase, 2, 3);
  for (const style of STYLES.filter((name) => onlyStyles === undefined || onlyStyles.includes(name))) {
    const outcome = new Map<string, string>();
    for (const form of FORMS) {
      configureRenderPlatform({ ...nodeRenderPlatform, randomInt: seeded(1) });
      try {
        await new ShareCardSet(shares, { style, layout: "qr", pageSize: "business", shareFormat: form }).renderShare(0);
        outcome.set(form, "ok");
      } catch (error) {
        outcome.set(form, (error as Error).message);
      } finally {
        configureRenderPlatform(nodeRenderPlatform);
      }
    }
    console.log(
      `${words} words / ${style} / qr card / business: ${FORMS.map((form) => `${form}=${outcome.get(form) === "ok" ? "ok" : `REFUSED (${outcome.get(form)})`}`).join(" ")}`,
    );
    for (const form of FORMS)
      if (form !== "colors" && outcome.get(form) !== "ok" && outcome.get("colors") === "ok")
        regressions.push(`${words}w ${style} ${form}: ${outcome.get(form)}`);
  }
}
console.log(`\nQR cards refused in a labelled form where the colors of the same share render: ${regressions.length}`);
for (const line of regressions) console.log(`  ${line}`);
process.exitCode = regressions.length === 0 ? 0 : 1;
