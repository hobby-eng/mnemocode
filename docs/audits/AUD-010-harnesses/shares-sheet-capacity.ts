// AUD-010 "shares": which share sheets the production renderers refuse, by design, page size,
// QR code and share form. A share of a 24-word phrase in Bytewords takes 46 words, 16 cards of three
// (the most a collection sheet holds); in colors it takes 15 cards. The probe renders the sheet of
// one share (ShareCardSet.renderShare) for each combination and records the refusals. Its check:
// no combination that renders in colors (the form shares were printed in before ab57e8d) is refused
// in a labelled form, since docs/SSKR.md says shares can be printed as cards with every template.
// Public data only: shares of the all-zero-entropy phrases of 12 and 24 words.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-sheet-capacity.ts [words=24] [styles=tile,...]

import "../../../src/export/platform-node.ts";
import { ShareCardSet } from "../../../src/export/sskr-render.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";

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
const FORMS = ["colors", "indexes", "unicode", "words", "ur"] as const;
// Optional filters, for a shorter run: words=24 styles=tile,kitchen (default: everything).
const filter = (name: string): string[] | undefined =>
  process.argv
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .split(",");
const onlyWords = filter("words");
const onlyStyles = filter("styles");

const refusals: string[] = [];
const regressions: string[] = [];
let renders = 0;
for (const [words, phrase] of Object.entries(PHRASES)) {
  if (onlyWords !== undefined && !onlyWords.includes(words)) continue;
  const shares = await splitSskrMnemonic(phrase, 2, 2);
  for (const style of STYLES.filter((name) => onlyStyles === undefined || onlyStyles.includes(name)))
    for (const pageSize of ["a6", "a4"] as const)
      for (const cardQr of [false, true]) {
        const outcome = new Map<string, string>();
        for (const form of FORMS) {
          renders += 1;
          try {
            await new ShareCardSet(shares, { style, pageSize, cardQr, shareFormat: form }).renderShare(0);
            outcome.set(form, "ok");
          } catch (error) {
            outcome.set(form, (error as Error).message);
          }
        }
        const line = `${words} words / ${style} / ${pageSize} / QR ${cardQr ? "on" : "off"}: ${FORMS.map((form) => `${form}=${outcome.get(form) === "ok" ? "ok" : "REFUSED"}`).join(" ")}`;
        console.log(line);
        for (const form of FORMS)
          if (outcome.get(form) !== "ok") {
            refusals.push(`${line}\n    ${form}: ${outcome.get(form)}`);
            if (outcome.get("colors") === "ok") regressions.push(`${words}w ${style} ${pageSize} QR=${cardQr} ${form}`);
          }
      }
}
console.log(`\nRenders: ${renders}. Refusals: ${refusals.length}.`);
for (const refusal of refusals) console.log(refusal);
console.log(`\nRefused in a labelled form where the colors of the same share render: ${regressions.length}`);
for (const regression of regressions) console.log(`  ${regression}`);
process.exitCode = regressions.length === 0 ? 0 : 1;
