// How a set of cards is made (owner, 2026-10-13): the colors of cards that print codes, the
// brightness of the business artwork, sheets in full rows with the largest cards, the decoys after
// a backup's codes, and the codes before the decoys read back, for a phrase and for a share.
// Public test data only: the published BIP39 phrases, the SSKR test vectors and synthetic codes.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BackupReading } from "../src/core/backup-reading.js";
import { indexesToColors, RGB_REFERENCE_COUNTS } from "../src/core/colors.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { UNICODE_CODES } from "../src/core/words.js";
import { businessSheetShape } from "../src/export/business-cards.js";
import { artworkBrightness, ReferenceTint } from "../src/export/business-tint.js";
import { assertColorCardContent } from "../src/export/card-content.js";
import {
  assertDecoys,
  keptCards,
  MAX_DECOYS,
  ownCards,
  withDecoyPool,
} from "../src/export/card-decoys.js";
import { closestPair, codeColors } from "../src/export/card-palette.js";
import { withPlannedDecoys, type SheetShaper } from "../src/export/card-plan.js";
import {
  collectionSheetLayout,
  MAX_SHEET_CARDS,
  planCollectionSheet,
  StudyCaptions,
  studyCaptionWidth,
} from "../src/export/collection-sheet.js";
import { MM } from "../src/export/business-layout.js";
import { drawMaterialBackdrop } from "../src/export/study-backdrops.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { catalogSheetShape } from "../src/export/templates.js";
import { designOfStyle } from "../src/export/template-catalog.js";
import { ownUnitCount, WORD_FORM } from "../src/sskr/mixed-layout.js";
import {
  assertShareFormatHasCards,
  readShare,
  SHARE_FORMATS,
  shareFormatHasCards,
  writeShare,
} from "../src/sskr/transport.js";

const PUBLIC_PHRASE = `${"abandon ".repeat(11)}about`;
/** The Unicode codes of "abandon" and "about" (core/words.ts). */
const ABANDON = UNICODE_CODES[0]!;
const ABOUT = UNICODE_CODES[3]!;
const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
  readonly deterministic: readonly { readonly shares: readonly string[] }[];
};
const SHARE = vectors.deterministic[0]!.shares[0]!;

describe("the colors of cards that print codes", () => {
  it("are those of the independent reference, the same for every set", () => {
    const python = spawnSync("python3", ["--version"]);
    if (python.error !== undefined) return;
    const reference = execFileSync("python3", ["scripts/card-palette-reference.py", "64"], {
      encoding: "utf8",
    }).trim();
    const codes = Array.from({ length: 64 }, (_, index) => `code ${index}`);
    expect(codeColors(codes).join(" ")).toBe(reference);
  });

  it("give one color to each distinct code, in the order they first appear", () => {
    expect(codeColors(["B", "A", "B", "C"])).toEqual([
      codeColors(["x"])[0],
      codeColors(["x", "y"])[1],
      codeColors(["x"])[0],
      codeColors(["x", "y", "z"])[2],
    ]);
    // A larger set keeps the colors of a smaller one.
    const small = codeColors(["1", "2", "3"]);
    expect(codeColors(["1", "2", "3", "4", "5"]).slice(0, 3)).toEqual(small);
  });

  it("keep the codes of a 24-word phrase and its decoys far apart on every design", () => {
    // The closest two of 40 colors, in millionths of OKLab units: no design shows them alike.
    const colors = codeColors(Array.from({ length: 40 }, (_, index) => String(index)));
    expect(new Set(colors).size).toBe(40);
    expect(closestPair(colors)).toBeGreaterThan(60_000);
    expect(closestPair(["#123456", "#123456"])).toBe(0);
  });
});

describe("the brightness of the business artwork", () => {
  it("follows the brightest channel of the color", () => {
    expect(artworkBrightness("#000000")).toBe(0.35);
    expect(artworkBrightness("#FFFFFF")).toBe(1);
    expect(artworkBrightness("#FF0000")).toBe(1);
    expect(artworkBrightness("#808000")).toBeCloseTo(0.35 + 0.65 * (128 / 255), 12);
  });

  it("gives a dark color darker artwork than a light one of the same hue", () => {
    const [, , dark] = new ReferenceTint("#404000").typical("vivid");
    const [, , light] = new ReferenceTint("#FFFF00").typical("vivid");
    expect(dark).toBeLessThan(light);
    // Saturation within each design's range, from the color's own.
    expect(new ReferenceTint("#FFE0E0").typical("vivid")[1]).toBeCloseTo(0.9 * 0.4, 12);
    // A grey color turns the artwork grey.
    expect(new ReferenceTint("#FFF0F0").typical("vivid")[1]).toBe(0);
    expect(new ReferenceTint("#FF0000").typical("muted")[1]).toBeCloseTo(0.9 * 0.75, 12);
    // A neutral pixel of the photograph keeps its color.
    expect(ReferenceTint.keeps([0, 0.1, 0.5])).toBe(true);
    expect(ReferenceTint.keeps([0, 0.5, 0.05])).toBe(true);
    expect(ReferenceTint.keeps([0, 0.5, 0.5])).toBe(false);
  });
});

describe("a sheet of cards", () => {
  it("fills every row where a count of columns can, the largest such cards first", () => {
    const layout = collectionSheetLayout({ pageSize: "a6", orientation: "portrait" }, 28, 1.8, 1);
    expect([layout.columns, layout.rows]).toEqual([4, 7]);
    expect(28 % layout.columns).toBe(0);
    // 13 fills its rows only in one column, too narrow here: then the largest cards of any.
    const thirteen = collectionSheetLayout({ pageSize: "a6", orientation: "portrait" }, 13, 1.8, 1);
    expect(13 % thirteen.columns).not.toBe(0);
  });

  it("is planned with at least one decoy, full rows and the largest cards", async () => {
    const colors = indexesToColors(Array.from({ length: 24 }, (_, index) => index * 85));
    const content = { kind: "colors" as const, colors, payload: colors.join(" ") };
    const pool = withDecoyPool(content, () => 0);
    const shape = await businessSheetShape(nodeCardRenderer, pool);
    const plan = planCollectionSheet({ pageSize: "a6" }, colors.length, pool.colors.length, shape);
    expect(plan.count).toBeGreaterThan(colors.length);
    expect(plan.count).toBeLessThanOrEqual(colors.length + MAX_DECOYS);
    const drawn = collectionSheetLayout(
      { pageSize: "a6", orientation: plan.orientation },
      plan.count,
      shape.aspect,
      1,
    );
    expect(plan.count % drawn.columns).toBe(0);
    // An orientation given is kept.
    for (const orientation of ["landscape", "portrait"] as const)
      expect(
        planCollectionSheet({ pageSize: "a6", orientation }, 16, pool.colors.length, shape)
          .orientation,
      ).toBe(orientation);
  });

  it("splits a long name under a card in two lines rather than printing it small", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 8;
    const room = new StudyCaptions(font, [
      ["01  016451", "Racing green anodised"],
      ["02  1AE090", "Teal"],
      ["03  0A0B0C", "Unbreakablelongname"],
    ]);
    const nameWidth = font.widthOfTextAtSize("Racing green anodised", size) / MM;
    // Wide enough: every line keeps its size on one line.
    expect(room.lines(nameWidth + 1, size)).toBe(2);
    expect(room.wrapped(0, nameWidth + 1, size)).toEqual(["01  016451", "Racing green anodised"]);
    // Narrower: the name takes two lines, split where the halves balance best.
    expect(room.lines(nameWidth - 1, size)).toBe(3);
    expect(room.wrapped(0, nameWidth - 1, size)).toEqual([
      "01  016451",
      "Racing green",
      "anodised",
    ]);
    expect(room.wrapped(1, nameWidth - 1, size)).toEqual(["02  1AE090", "Teal"]);
    // A single word cannot be split, and the line with the code never is.
    expect(room.wrapped(2, 1, size)).toEqual(["03  0A0B0C", "Unbreakablelongname"]);
    // A column may be narrower than the whole name at the least size, as its halves fit.
    expect(room.minimumWidth).toBeLessThan(
      studyCaptionWidth(font, ["Unbreakablelongname", "Racing green anodised", "01  016451"]) + 1,
    );
    expect(room.minimumWidth).toBeGreaterThanOrEqual(
      studyCaptionWidth(font, ["Unbreakablelongname", "Racing green", "01  016451"]),
    );
  });
});

describe("a sheet of cards", () => {
  it("lays out a sheet with the room that its split names take", () => {
    const fixed = collectionSheetLayout({ pageSize: "a4", orientation: "portrait" }, 20, 1.2, 2);
    const split = collectionSheetLayout(
      { pageSize: "a4", orientation: "portrait" },
      20,
      1.2,
      (width) => (width < 50 ? 3 : 2),
    );
    // Columns narrower than 50 mm leave less room for each card, so the layout weighs them so.
    expect(split.cards[0]!.height).toBeLessThanOrEqual(fixed.cards[0]!.height);
  });

  it("lays the joints of a material's backdrop between the cards on every page size", async () => {
    const doc = await PDFDocument.create();
    for (const [pageSize, orientation] of [
      ["a5", "portrait"],
      ["a5", "landscape"],
      ["a6", "landscape"],
      ["a4", "portrait"],
    ] as const) {
      const layout = collectionSheetLayout({ pageSize, orientation }, 16, 1, 2);
      const { grid } = layout;
      for (const backdrop of ["concrete", "tiled"] as const) {
        const page = doc.addPage([layout.width * MM, layout.height * MM]);
        const lines: number[] = [];
        const drawLine = page.drawLine.bind(page);
        page.drawLine = (options) => {
          // The vertical joints, by where they run across the page, in millimetres.
          if (options.start.x === options.end.x) lines.push(options.start.x / MM);
          drawLine(options);
        };
        const rectangles: number[] = [];
        const drawRectangle = page.drawRectangle.bind(page);
        page.drawRectangle = (options) => {
          rectangles.push((options!.x ?? 0) / MM);
          drawRectangle(options);
        };
        drawMaterialBackdrop(page, backdrop, layout.width, layout.height, grid);
        // Concrete draws its joints as lines, tiles their edges as the tiles' own left sides.
        const joints = backdrop === "concrete" ? lines.filter((_, i) => i % 2 === 0) : rectangles;
        expect(joints.length, `${backdrop} ${pageSize}`).toBeGreaterThan(0);
        for (const x of joints) {
          const along = (x - grid.left) / grid.columnPitch;
          // Within the grout of half a millimetre of a joint between two columns of cards.
          expect(
            Math.abs(along - Math.round(along)) * grid.columnPitch,
            `${backdrop} ${x}`,
          ).toBeLessThan(0.5);
        }
      }
    }
  });

  it("has room for the longest share's Unicode codes with every decoy", () => {
    const longest = vectors.deterministic.at(-1)!.shares[0]!;
    expect(writeShare(longest, "unicode").split(" ").length + MAX_DECOYS).toBeLessThanOrEqual(
      MAX_SHEET_CARDS,
    );
  });
});

describe("decoys after a backup's codes", () => {
  it("look like the codes of a phrase or a share, and keep the codes before them", () => {
    const random = (limit: number) => limit - 1;
    const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
    const phrase = withDecoyPool({ kind: "colors", colors }, random);
    expect(phrase.colors.slice(0, colors.length)).toEqual(colors);
    expect(phrase.decoys).toBe(MAX_DECOYS);
    // A color of a phrase of 12 words: an even order tag and four-digit word positions.
    for (const decoy of phrase.colors.slice(colors.length))
      expect(Number.parseInt(decoy.slice(1), 16).toString().padStart(8, "0").slice(0, 2)).toMatch(
        /^(0|1)[02468]$/u,
      );
    const share = withDecoyPool({ kind: "sskr", colors: ["#41C47E"] }, random);
    expect(share.colors.slice(1)).toEqual(Array(MAX_DECOYS).fill("#FFFFFF"));
    const codes = withDecoyPool(
      { kind: "colors", colors: codeColors([ABANDON]), labels: [ABANDON] },
      random,
    );
    expect(codes.labels!.slice(1)).toEqual(Array(MAX_DECOYS).fill(UNICODE_CODES.at(-1)));
    expect(codes.colors).toEqual(codeColors(codes.labels!));
  });

  it("are counted, kept and refused by one rule", () => {
    const pool = withDecoyPool({ kind: "sskr", colors: ["#41C47E", "#42D1F0"] }, () => 0);
    expect(ownCards(pool)).toBe(2);
    const kept = keptCards(pool, 5);
    expect([kept.colors.length, kept.decoys, ownCards(kept)]).toEqual([5, 3, 2]);
    expect(() => keptCards(pool, 1)).toThrow("every code of the backup");
    expect(() => keptCards(pool, 2 + MAX_DECOYS + 1)).toThrow("every code of the backup");
    expect(() => withDecoyPool(kept, () => 0)).toThrow("have their decoys already");
    for (const decoys of [-1, 0.5, 5, Number.NaN])
      expect(() => assertDecoys({ ...kept, decoys }), String(decoys)).toThrow(
        "fewer than the cards",
      );
  });

  it("leave the QR code to the backup alone, which the cards' own codes must be", () => {
    const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
    const content = { kind: "colors" as const, colors, payload: colors.join(" ") };
    const kept = keptCards(
      withDecoyPool(content, () => 0),
      15,
    );
    expect(() => assertColorCardContent(kept)).not.toThrow();
    // Counting a decoy as a code of the backup, or a code as a decoy, is refused.
    expect(() => assertColorCardContent({ ...kept, decoys: 2 })).toThrow();
    expect(() => assertColorCardContent({ ...kept, decoys: 4 })).toThrow();
  });

  it("are planned once for every file of an export, also for separate cards", async () => {
    const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
    const design = designOfStyle("it")!;
    const shaper: SheetShaper = (drawing, cards, pageSize) =>
      catalogSheetShape(design, drawing, cards, pageSize);
    const content = { kind: "colors" as const, colors, payload: colors.join(" ") };
    const planned = await withPlannedDecoys(shaper, nodeCardRenderer, content, true);
    expect(planned.decoys).toBeGreaterThan(0);
    // Planned cards come back as they are, so that every file shows the same decoys.
    expect(await withPlannedDecoys(shaper, nodeCardRenderer, planned, false)).toBe(planned);
  });
});

describe("the codes before the decoys, read back", () => {
  const backup = EncodedBackup.read(PUBLIC_PHRASE, "english", "direct");

  it("are taken from the start in every form, marks kept", () => {
    for (const format of ["indexes", "unicode", "colors", "colors-unicode", "english"] as const) {
      const form = EncodedForm.of(format);
      const text = form.codes(backup.indexes);
      const decoys = form.codes(Array(12).fill(2047));
      const read = form.read(form.leadingCodes(`${text} ${decoys}`, 12));
      expect(read, format).toEqual([...backup.indexes]);
    }
    expect(EncodedForm.of("unicode").leadingCodes(`${ABANDON} 4E?0 ${ABOUT}`, 12)).toBe(
      `${ABANDON} 4E?0 ${ABOUT}`,
    );
    expect(EncodedForm.of("colors").elementCount(24)).toBe(RGB_REFERENCE_COUNTS.at(-1));
    expect(EncodedForm.of("unicode").elementCount(15)).toBe(15);
  });

  it("are read by the words of the phrase given, which detection follows", () => {
    // Four decoys: sixteen codes, which no phrase has.
    const codes = `${EncodedForm.of("unicode").codes(backup.indexes)} 4E00 5E7E 7684 7684`;
    const rules = { seedshiftOnly: false, shareReader: "the restore" } as const;
    expect(() => BackupReading.of(codes, rules).codes("unicode")).toThrow();
    const reading = BackupReading.of(codes, { ...rules, words: 12 });
    expect(reading.formats()).toEqual(["unicode"]);
    expect(reading.codes("unicode").indexes).toEqual(backup.indexes);
    expect(() => BackupReading.of(codes, { ...rules, words: 13 as never })).toThrow();
  });

  it("are found where the decoys make a longer phrase whose checksum fails", () => {
    const codes = [...backup.indexes, 2047, 5, 9];
    const longer = EncodedBackup.of(codes, "unicode", "direct");
    expect(longer.decode([]).checksumValid).toBe(false);
    expect(longer.shorterPhrases([]).map(({ words }) => words)).toEqual([12]);
    expect(longer.shorterPhrases([])[0]!.result.recoveredMnemonic).toBe(PUBLIC_PHRASE);
    expect(backup.shorterPhrases([])).toEqual([]);
  });
});

describe("the codes of a share before its decoys", () => {
  it("are read by the share's own length, the codes after them left out", () => {
    for (const format of ["unicode", "colors", "indexes"] as const) {
      const text = writeShare(SHARE, format);
      const decoys =
        format === "colors" ? "#123456 #ABCDEF" : format === "unicode" ? "7684 4E00" : "5 77";
      expect(readShare(`${text} ${decoys}`).ur, format).toBe(SHARE);
    }
    // A share cut short is refused still.
    const short = writeShare(SHARE, "unicode").split(" ").slice(0, -1).join(" ");
    expect(() => readShare(short)).toThrow();
    const indexes = writeShare(SHARE, "indexes")
      .split(" ")
      .map((number) => Number(number) - 1);
    expect(ownUnitCount(WORD_FORM, [...indexes, 0, 0])).toBe(indexes.length);
    expect(ownUnitCount(WORD_FORM, indexes.slice(0, 2))).toBeUndefined();
  });

  it("are printed on cards in colors and Unicode codes only", () => {
    expect(SHARE_FORMATS.filter(shareFormatHasCards)).toEqual([
      "unicode",
      "colors",
      "colors-unicode",
    ]);
    expect(() => assertShareFormatHasCards("words")).toThrow(
      "Shares written as words have no cards",
    );
    expect(() => shareFormatHasCards("nothing" as never)).toThrow(
      "The share format must be one of",
    );
  });
});
