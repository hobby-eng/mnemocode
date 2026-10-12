// Bounded public-fixture/synthetic-file baseline probe; no PDF rendering.
import { readFile } from "node:fs/promises";
import { assertColorCardContent } from "../../../src/export/card-content.ts";
import { printedCode } from "../../../src/export/card-codes.ts";
import { readShare, writeShare, assertShareQr } from "../../../src/sskr/transport.ts";
import { indexesToColors } from "../../../src/core/colors.ts";

const vectors = JSON.parse(await readFile("vectors/sskr-v1.json", "utf8"));
const shares = vectors.deterministic[0].shares;
const words = writeShare(shares[0], "words").split(" ");
const labels = [];
for (let i = 0; i < words.length; i += 3) labels.push(words.slice(i, i + 3).join(" "));
const outcome = (action) => {
  try {
    action();
    return { accepted: true };
  } catch (error) {
    return { accepted: false, error: error.message };
  }
};
const cases = [0, 1, labels.length, labels.length + 1].map((count) => {
  const content = {
    kind: "sskr",
    colors: Array.from({ length: count }, (_, i) => "#" + (i + 1).toString(16).padStart(6, "0")),
    labels,
    payload: shares[0],
  };
  const printed = content.colors.map((_, index) => printedCode(content, index));
  return {
    colorCount: count,
    labelCount: labels.length,
    validation: outcome(() => assertColorCardContent(content)),
    projectedCodeCount: printed.length,
    projectedOutputIsSameShare: outcome(() => {
      if (readShare(printed.join(" ")).ur !== shares[0]) throw new Error("Different share");
    }),
  };
});
const colors = indexesToColors([...Array(11).fill(0), 3]);
const phrase = {
  kind: "colors",
  colors,
  payload: colors.join(" "),
  labels: colors.map(() => "SYNTHETIC-OVERRIDE"),
};
const phrasePrinted = phrase.colors.map((_, index) => printedCode(phrase, index));
console.log(
  JSON.stringify(
    {
      input:
        "vectors/sskr-v1.json deterministic[0].shares[0], public; public BIP39 abandon x11 about indexes",
      cases,
      wrongShareControl: outcome(() =>
        assertColorCardContent({ kind: "sskr", colors: ["#000001"], labels, payload: shares[1] }),
      ),
      labelsOnlyTransportControl: outcome(() => assertShareQr([], shares[0], labels)),
      unexpectedPhraseLabels: {
        validation: outcome(() => assertColorCardContent(phrase)),
        allPrintedValuesOverridden: phrasePrinted.every((code) => code === "SYNTHETIC-OVERRIDE"),
        printedEqualsValidatedColors:
          phrasePrinted.join(" ") === colors.map((code) => code.slice(1).toUpperCase()).join(" "),
      },
    },
    null,
    2,
  ),
);
