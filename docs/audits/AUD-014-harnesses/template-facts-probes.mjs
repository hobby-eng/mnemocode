// AUD-014: narrow the runtime reproductions to otherwise complete production template/route objects.
// Rendering is bounded by a sentinel before any document can be produced.
import { cardTemplates } from "../../../dist/export/templates.js";
import { renderIndividualCards } from "../../../dist/export/render.js";
import { nodeCardRenderer } from "../../../dist/export/platform-node.js";
import { heirSheetText } from "../../../dist/cli/heir-sheet.js";
import { indexesToColors } from "../../../dist/core.js";

const base = cardTemplates.find(
  (template) => template.kind === "colors" && template.renderIndividual,
);
const colors = indexesToColors([...Array(11).fill(0), 3]);
const content = {
  kind: "colors",
  title: "Public fixture",
  colors,
  payload: colors.join(" "),
  pageSize: "business",
};
const checks = [];
const sentinel = new Error("audit stopped before rendering");
for (const referencesPerCard of [-1, 0, 0.5, Infinity, Number.NaN, 1]) {
  let invoked = 0;
  let result;
  let refusal;
  const template = {
    ...base,
    referencesPerCard,
    renderIndividual: async () => {
      invoked++;
      throw sentinel;
    },
  };
  try {
    result = await renderIndividualCards(nodeCardRenderer, template, content);
  } catch (error) {
    refusal = error;
  }
  const valid = referencesPerCard === 1;
  checks.push({
    name: `complete template capacity ${String(referencesPerCard)}`,
    passed: valid ? invoked === 1 && refusal === sentinel : invoked === 0 && refusal !== undefined,
    details: {
      renderCalls: invoked,
      cards: result?.length,
      refusalBeforeRendering: refusal !== undefined && refusal !== sentinel,
    },
  });
}
for (const backup of [
  { kind: "shares", format: "ur", threshold: 4, count: 3 },
  { kind: "encoded", format: "unknown" },
  { kind: "shares", format: "ur", threshold: 2, count: 3 },
]) {
  let text;
  let refused = false;
  try {
    text = heirSheetText({ backup, mode: "direct", dates: 0 });
  } catch {
    refused = true;
  }
  const valid = backup.kind === "shares" && backup.threshold === 2;
  checks.push({
    name: `production heir route ${backup.kind}/${backup.format}/${backup.threshold ?? ""}`,
    passed: valid ? !refused && text.needs[0].startsWith("Any 2 of the 3") : refused,
    details: { refused, needs: text?.needs },
  });
}
console.log(JSON.stringify({ checks }, null, 2));
if (checks.some((check) => !check.passed)) process.exitCode = 1;
