// S077: every card output of Encode draws the same content, built once by the library
// (backupCardContent). The renderers are replaced, so that no PDF is drawn.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardJob } from "../src/export/render.js";
import type { CardDrawing } from "../src/export/templates.js";

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

const PHRASE = `${"abandon ".repeat(11)}about`;
const DATES = [parseDate("23-09-2026")];

afterEach(() => {
  drawn.length = 0;
});

describe("the cards of Encode", () => {
  it("draws its PDF, its page images and its separate cards from one content", async () => {
    const encoding = EncodedBackup.encode(PHRASE, DATES, "colors", "seedshift");
    const outcome = { encoding, mode: "seedshift" as const, enteredDates: DATES };
    // One object of options for the run, as Encode keeps it (onlyResult), so that the random card
    // details are drawn once.
    const saving: Record<string, string> = { "page-size": "business", title: "Cards" };
    for (const output of ["pdf", "images-dir", "cards-dir"]) {
      for (const other of ["pdf", "images-dir", "cards-dir"]) delete saving[other];
      saving[output] = `unused-${output}`;
      await saveEncodeResult(saving, outcome);
    }
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
  });

  it("refuses a form that no card prints, Unicode codes among them", () => {
    const dates = [parseDate("23-09-2026")];
    const unicode = EncodedBackup.encode(PHRASE, dates, "unicode", "seedshift").backup;
    expect(() => backupCardContent(unicode)).toThrow("No card prints codes written as unicode.");
    const words = EncodedBackup.encode(PHRASE, [], "english", "direct").backup;
    expect(() => backupCardContent(words)).toThrow("No card prints codes written as english.");
  });
});
