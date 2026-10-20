// S077: every card output of Encode draws the same content, built once by the library
// (backupCardContent) and planned once with its decoys (plannedCardJob). The cards are drawn and
// saved as they are, into a folder of the test's own; each renderer's job is noted on its way
// through. pdftocairo, the external program that turns pages into images, is a fake on PATH that
// answers each page with a few bytes; Windows, which looks for pdftocairo.exe, makes no page
// images here.

import { chmod, readdir, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardJob } from "../src/export/render.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { testFolder } from "./helpers/test-folders.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/** Each card output's job, in the order drawn. */
const drawn = vi.hoisted((): { readonly output: string; readonly job: CardJob }[] => []);

vi.mock("../src/export/pdf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/export/pdf.js")>();
  return {
    ...actual,
    exportCards: async (...draw: Parameters<typeof actual.exportCards>) => {
      drawn.push({ output: "pdf", job: draw[0][0]! });
      return actual.exportCards(...draw);
    },
    // The renderer that the command line draws with comes first (S108).
    renderCards: async (...draw: Parameters<typeof actual.renderCards>) => {
      drawn.push({ output: "images", job: draw[1][0]! });
      return actual.renderCards(...draw);
    },
  };
});
vi.mock("../src/export/individual-cards.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/export/individual-cards.js")>();
  return {
    ...actual,
    exportIndividualCards: async (...draw: Parameters<typeof actual.exportIndividualCards>) => {
      const [template, content] = draw;
      drawn.push({ output: "cards", job: { template, content } });
      return actual.exportIndividualCards(...draw);
    },
  };
});

const { saveEncodeResult } = await import("../src/cli/encode-export.js");
const { EncodedBackup } = await import("../src/core/encoded-backup.js");
const { backupCardContent } = await import("../src/export/backup-cards.js");
const { parseDate } = await import("../src/core/dates.js");
const { EncodedForm } = await import("../src/core/encoded-form.js");
const { codeColors } = await import("../src/export/card-palette.js");

const DATES = [parseDate("23-09-2026")];
/** Whether the fake pdftocairo can stand in for the real one here. */
const PAGE_IMAGES = process.platform !== "win32";

afterEach(() => {
  drawn.length = 0;
  vi.unstubAllEnvs();
});

/** A fake pdftocairo in `folder`: it reads a page's PDF and answers with a few bytes. */
async function fakeImageRenderer(folder: string): Promise<void> {
  const program = join(folder, "pdftocairo");
  await writeFile(
    program,
    `#!${process.execPath}
if (process.argv.includes("-v")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write("public fake page image"));
`,
  );
  await chmod(program, 0o700);
}

describe("the cards of Encode", () => {
  it(
    "draws its PDF, its page images and its separate cards from one content",
    async () => {
      const folder = await testFolder("mnemocode-encode-cards-");
      if (PAGE_IMAGES) {
        await fakeImageRenderer(folder);
        vi.stubEnv("PATH", `${folder}${delimiter}${process.env["PATH"] ?? ""}`);
      }
      const encoding = EncodedBackup.encode(TEST_PHRASE, DATES, "colors", "seedshift");
      const outcome = { encoding, mode: "seedshift" as const, enteredDates: DATES };
      // One object of options for the run, as Encode keeps it (onlyResult), so that the random card
      // details are drawn once.
      // Every output of one run, which plans the decoys once for all of them.
      const saving: Record<string, string> = {
        "page-size": "business",
        title: "Cards",
        pdf: join(folder, "cards.pdf"),
        ...(PAGE_IMAGES ? { "images-dir": join(folder, "images") } : {}),
        "cards-dir": join(folder, "cards"),
      };
      await saveEncodeResult(saving, outcome);
      expect(drawn.map((entry) => entry.output)).toEqual(
        PAGE_IMAGES ? ["pdf", "images", "cards"] : ["pdf", "cards"],
      );
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
      // Each output was saved where its option says.
      expect((await stat(join(folder, "cards.pdf"))).size).toBeGreaterThan(0);
      expect((await readdir(join(folder, "cards"))).length).toBeGreaterThan(8);
      if (PAGE_IMAGES) expect(await readdir(join(folder, "images"))).not.toEqual([]);
    },
    LONG_TEST_TIME_LIMIT_MS,
  );

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
