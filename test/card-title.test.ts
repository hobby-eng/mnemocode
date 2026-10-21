// The title of a sheet of cards is a text of a card like the studio name it replaces (CORE-48):
// one line, no control or format character, at most MAX_CARD_TEXT_LENGTH characters once drawn,
// trimmed and in NFC; refused before anything is drawn, from a host and from --title alike, on the
// sheets of a backup and of a share, and in content that a host draws itself. No file is written.
// Public test data only.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPreview } from "../src/cli/preview-command.js";
import { parseDate } from "../src/core/dates.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import { MAX_CARD_TEXT_LENGTH } from "../src/export/card-settings.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { renderCards } from "../src/export/render.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { DEFAULT_SHARE_TEMPLATE_ID } from "../src/export/template-catalog.js";
import { CARD_TEMPLATES } from "../src/export/templates.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";
import { publicShare } from "./helpers/vectors.js";
import { testFolder } from "./helpers/test-folders.js";

const BLANK = "export.card-settings.card-non-empty-text-on-one-line";
const LONG = "export.card-settings.card-too-long-maximum-characters";
const BLANK_MESSAGE =
  "Card title must be non-empty text on one line; leave it out to print the studio name.";

/** The cards of the test phrase written in colours, with `title`. */
function cardsTitled(title: string): ReturnType<typeof backupCardContent> {
  const backup = EncodedBackup.encode(TEST_PHRASE, [parseDate(DATE)], "colors", "seedshift");
  return backupCardContent(backup.backup, { title });
}

afterEach(() => vi.restoreAllMocks());

describe("the title of a sheet of cards", () => {
  it.each([
    ["a line separator", "Studio\u2028Two", BLANK],
    ["a soft hyphen", "Stu\u00ADdio", BLANK],
    ["a zero-width space", "Stu\u200Bdio", BLANK],
    ["spaces only", "   ", BLANK],
    ["nothing", "", BLANK],
    ["a line break", "Studio\nTwo", BLANK],
    ["one character too many", "i".repeat(MAX_CARD_TEXT_LENGTH + 1), LONG],
    // Combining accents have no width of their own, so the fit of the heading never stops them.
    // NFC joins the first to the S; the others stay, one too many.
    ["a run of combining accents", `S${"\u0301".repeat(MAX_CARD_TEXT_LENGTH + 1)}`, LONG],
  ])("is refused with %s", (_name, title, code) => {
    expect(() => cardsTitled(title)).toThrow(expect.objectContaining({ code }));
  });

  it("says why a blank title is refused, and how long a title may be", () => {
    expect(() => cardsTitled("   ")).toThrow(BLANK_MESSAGE);
    expect(() => cardsTitled("i".repeat(MAX_CARD_TEXT_LENGTH + 1))).toThrow(
      `Card title is too long (maximum ${MAX_CARD_TEXT_LENGTH} characters).`,
    );
  });

  it("is kept as it is drawn: trimmed, in NFC, up to the longest", () => {
    expect(cardsTitled("  Atelier  ").title).toBe("Atelier");
    expect(cardsTitled("Cafe\u0301").title).toBe("Caf\u00E9");
    const longest = "i".repeat(MAX_CARD_TEXT_LENGTH);
    expect(cardsTitled(longest).title).toBe(longest);
    // None given: the sheet names the studio.
    const backup = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
    expect(backupCardContent(backup.backup)).not.toHaveProperty("title");
  });

  it("from --title is refused before the preview writes its file", async () => {
    const folder = await testFolder("mnemocode-card-title-");
    const pdf = join(folder, "preview.pdf");
    await expect(runPreview({ title: "Studio\u2028Two", pdf })).rejects.toMatchObject({
      code: BLANK,
      message: BLANK_MESSAGE,
    });
    expect(existsSync(pdf)).toBe(false);
  });
});

describe("the title that a host gives cards without backupCardContent", () => {
  it("is refused for the sheets of a share before any choice is made", async () => {
    let choices = 0;
    const renderer = new CardRenderer({
      ...nodeRenderPlatform,
      randomInt: (limit) => {
        choices++;
        return nodeRenderPlatform.randomInt(limit);
      },
    });
    await expect(
      ShareCardSet.create(renderer, [publicShare()], { style: "it", title: "Studio\u2028Two" }),
    ).rejects.toMatchObject({ code: BLANK, message: BLANK_MESSAGE });
    await expect(
      ShareCardSet.create(renderer, [publicShare()], {
        style: "it",
        title: "i".repeat(MAX_CARD_TEXT_LENGTH + 1),
      }),
    ).rejects.toMatchObject({ code: LONG });
    expect(choices).toBe(0);
  });

  it("is refused in content that a host draws itself, before a card is drawn", async () => {
    // A card is drawn on a page of a PDF document: none is added before the refusal.
    const pages = vi.spyOn(PDFDocument.prototype, "addPage");
    const template = CARD_TEMPLATES.find((known) => known.id === DEFAULT_SHARE_TEMPLATE_ID)!;
    const content = { ...cardsTitled("Atelier"), title: "Studio\u2028Two" };
    await expect(renderCards(nodeCardRenderer, [{ template, content }])).rejects.toMatchObject({
      code: BLANK,
      message: BLANK_MESSAGE,
    });
    expect(pages).not.toHaveBeenCalled();
  });
});
