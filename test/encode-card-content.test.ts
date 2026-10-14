// S077: every card output of Encode draws the same content, built once by the library
// (backupCardContent) and planned once with its decoys (plannedCardJob). The renderers are
// replaced, so that no PDF is drawn.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardJob } from "../src/export/render.js";
import type { CardDrawing } from "../src/export/templates.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

const drawn: { readonly output: string; readonly job: CardJob }[] = [];

vi.mock("../src/export/pdf.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/export/pdf.js")>()),
  exportCards: async (jobs: readonly CardJob[]) => {
    drawn.push({ output: "pdf", job: jobs[0]! });
  },
  // The renderer that the command line draws with comes first (S108).
  renderCards: async (_drawing: CardDrawing, jobs: readonly CardJob[]) => {
    drawn.push({ output: "images", job: jobs[0]! });
    return new Uint8Array();
  },
}));
vi.mock("../src/export/image-export.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/export/image-export.js")>()),
  exportPageImages: async () => 1,
}));
vi.mock("../src/export/individual-cards.js", () => ({
  exportIndividualCards: async (template: CardJob["template"], content: CardJob["content"]) => {
    drawn.push({ output: "cards", job: { template, content } });
    return 1;
  },
}));

const { saveEncodeResult } = await import("../src/cli/encode-export.js");
const { EncodedBackup } = await import("../src/core/encoded-backup.js");
const { backupCardContent } = await import("../src/export/backup-cards.js");
const { parseDate } = await import("../src/core/dates.js");
const { EncodedForm } = await import("../src/core/encoded-form.js");
const { codeColors } = await import("../src/export/card-palette.js");

const DATES = [parseDate("23-09-2026")];

afterEach(() => {
  drawn.length = 0;
});

describe("the cards of Encode", () => {
  it("draws its PDF, its page images and its separate cards from one content", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, DATES, "colors", "seedshift");
    const outcome = { encoding, mode: "seedshift" as const, enteredDates: DATES };
    // One object of options for the run, as Encode keeps it (onlyResult), so that the random card
    // details are drawn once.
    // Every output of one run, which plans the decoys once for all of them.
    const saving: Record<string, string> = {
      "page-size": "business",
      title: "Cards",
      pdf: "unused-pdf",
      "images-dir": "unused-images-dir",
      "cards-dir": "unused-cards-dir",
    };
    await saveEncodeResult(saving, outcome);
    expect(drawn.map((entry) => entry.output)).toEqual(["pdf", "images", "cards"]);
    const [first, ...others] = drawn.map(({ job }) => job);
    for (const job of others) {
      expect(job.template.id).toBe(first!.template.id);
      expect(job.content).toEqual(first!.content);
    }
    expect(first!.content).toMatchObject({
      kind: "colors",
      payload: encoding.backup.text(),
      title: "Cards",
      pageSize: "business",
    });
    // The colors of the backup first, then at least one decoy.
    expect(first!.content.colors.slice(0, 8).join(" ")).toBe(encoding.backup.text());
    expect(first!.content.decoys).toBeGreaterThan(0);
  });

  it("prints Unicode codes in colors that decorate them, and refuses a form without cards", () => {
    const dates = [parseDate("23-09-2026")];
    const unicode = EncodedBackup.encode(TEST_PHRASE, dates, "unicode", "seedshift").backup;
    const content = backupCardContent(unicode);
    expect(content.labels).toEqual(EncodedForm.of("unicode").cardCodes(unicode.indexes));
    expect(content.colors).toEqual(codeColors(content.labels!));
    expect(content.payload).toBe(unicode.text());
    const words = EncodedBackup.encode(TEST_PHRASE, [], "english", "direct").backup;
    expect(() => backupCardContent(words)).toThrow("No card prints codes written as english.");
    const numbers = EncodedBackup.encode(TEST_PHRASE, dates, "indexes", "seedshift").backup;
    expect(() => backupCardContent(numbers)).toThrow("No card prints codes written as indexes.");
  });
});
