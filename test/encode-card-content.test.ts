// S077: every card output of Encode draws the same content, built once by the library
// (backupCardContent) and planned once with its decoys (plannedCardJob). The cards are drawn and
// saved as they are, into a folder of the test's own, and read where they cross the program's edge:
// the texts that pdf-lib is asked to draw for each output, up to the notice that it was saved, and
// the files saved. pdftocairo, the external program that turns pages into images, is a fake on
// PATH that answers each page with a few bytes; Windows, which looks for pdftocairo.exe, makes no
// page images here.

import { readdir, readFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";
import { PDFDocument, PDFPage } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveEncodeResult } from "../src/cli/encode-export.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { separateCardName } from "../src/export/card-codes.js";
import { parseDate } from "../src/core/dates.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { codeColors } from "../src/export/card-palette.js";
import { fakeImageRenderer, numberedCodes, PAGE_IMAGES } from "./helpers/drawn-cards.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { testFolder } from "./helpers/test-folders.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

const DATES = [parseDate("23-09-2026")];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the cards of Encode", () => {
  it(
    "draws its PDF, its page images and its separate cards from one content",
    async () => {
      const folder = await testFolder("mnemocode-encode-cards-");
      if (PAGE_IMAGES) {
        await fakeImageRenderer(folder);
        vi.stubEnv("PATH", `${folder}${delimiter}${process.env["PATH"] ?? ""}`);
      }
      const drawText = vi.spyOn(PDFPage.prototype, "drawText");
      // Each notice of an output saved, with how many texts were drawn before it.
      const saved: { readonly notice: string; readonly drawn: number }[] = [];
      vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
        const notice = line.join(" ");
        if (notice.startsWith("Saved ")) saved.push({ notice, drawn: drawText.mock.calls.length });
      });
      const encoding = EncodedBackup.encode(TEST_PHRASE, DATES, "colors", "seedshift");
      const outcome = { encoding, mode: "seedshift" as const, enteredDates: DATES };
      // One object of options for the run, as Encode keeps it (onlyResult), so that the random card
      // details are drawn once.
      // Every output of one run, which plans the decoys once for all of them.
      const pdf = join(folder, "cards.pdf");
      const images = join(folder, "images");
      const cardFolder = join(folder, "cards");
      const saving: Record<string, string> = {
        "page-size": "business",
        pdf,
        ...(PAGE_IMAGES ? { "images-dir": images } : {}),
        "cards-dir": cardFolder,
      };
      await saveEncodeResult(saving, outcome);
      const texts = drawText.mock.calls.map(([text]) => text);
      // What each output drew, after the one saved before it.
      const [first, ...others] = saved.map(({ drawn }, at) =>
        texts.slice(saved[at - 1]?.drawn ?? 0, drawn),
      );
      // The same cards, with the same details, in every output.
      for (const output of others) expect(output).toEqual(first);
      const cards = numberedCodes(first!);
      // The codes of the backup first, then at least one decoy.
      const own = backupCardContent(encoding.backup);
      expect(cards.slice(0, 8)).toEqual(own.colors.map((_, index) => separateCardName(own, index)));
      expect(cards.length).toBeGreaterThan(8);
      expect(saved.map(({ notice }) => notice)).toEqual([
        `Saved PDF: ${pdf}`,
        ...(PAGE_IMAGES ? [`Saved ${cards.length} PNG pages to: ${images}`] : []),
        `Saved ${cards.length} individual card files to: ${cardFolder}`,
      ]);
      // Each output was saved where its option says: a business-card page for each card, and a
      // file for each card, named after it.
      expect((await PDFDocument.load(await readFile(pdf))).getPageCount()).toBe(cards.length);
      const files = await readdir(cardFolder);
      expect(files.map((file) => basename(file, ".pdf")).sort()).toEqual([...cards].sort());
      if (PAGE_IMAGES) expect(await readdir(images)).toHaveLength(cards.length);
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
