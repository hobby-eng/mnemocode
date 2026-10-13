import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIndividualCards, selectTemplate, type CardContent } from "../src/cards.js";
import { indexesToColors } from "../src/core.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";

// Reading the printed text needs Poppler; without it the check is skipped, not faked.
const hasPoppler = spawnSync("pdftotext", ["-v"]).error === undefined;

const colors = indexesToColors(Array.from({ length: 12 }, (_, index) => index * 7));
const content: CardContent = { kind: "colors", colors, payload: colors.join(" ") };

function printedText(bytes: Uint8Array): string {
  const directory = mkdtempSync(join(tmpdir(), "mnemocode-numbering-"));
  try {
    const file = join(directory, "card.pdf");
    writeFileSync(file, bytes);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPoppler)("numbers on separate cards", () => {
  for (const template of ["business-it", "material-tile"])
    it(`prints the position of every reference on ${template} cards`, async () => {
      const cards = await renderIndividualCards(
        nodeCardRenderer,
        selectTemplate(template, "colors"),
        { ...content },
      );
      // The codes, then at least one decoy, numbered on.
      expect(cards.length).toBeGreaterThan(colors.length);
      for (const [index, card] of cards.entries()) {
        const text = printedText(card.bytes).replace(/\s+/gu, " ");
        const number = String(index + 1).padStart(2, "0");
        // The number stands directly before its code; no card names the size of the set.
        const code = colors[index]?.slice(1).toUpperCase() ?? card.name.slice(3);
        expect(text).toContain(`${number} ${code}`);
        expect(text).not.toMatch(/\d{2} \/ \d{2}/u);
      }
    });
});
