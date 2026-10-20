// The kinds of content of colour cards (content-kinds.ts): every place that depends on the kind,
// the QR check, the decoys, the series, the whole-backup QR code, the separate card's reference
// and the QR code on separate cards, asks the rules of that kind, and refuses a kind of none
// rather than draw it as a seed phrase's colours. Public test data only.

import { describe, expect, it } from "vitest";
import { assertColorCardContent } from "../src/export/card-content.js";
import { withDecoyPool } from "../src/export/card-decoys.js";
import { collectionPayload, collectionSeries } from "../src/export/collection-sheet.js";
import { assertSheetQr, contentKindRules, type ContentKind } from "../src/export/content-kinds.js";
import { SSKR_VECTOR } from "../src/sskr/known-answers.js";

/** A kind of none, fed on purpose as a JavaScript host could: no type allows it. */
const NO_KIND = "words" as ContentKind;
/** The colors of the official SSKR vector's first share, as its cards print them. */
const SHARE_COLORS = SSKR_VECTOR.firstShareColors;
/** A count of colors that no seed phrase has: phrases have 8, 10, 12, 14 or 16. */
const NO_PHRASE_COUNT = 9;
/** A random source that always gives its first choice. */
const FIRST = (): number => 0;

describe("kinds of content of colour cards", () => {
  it("refuses a kind of none wherever the kind decides, instead of drawing a seed phrase", () => {
    const refusals = [
      () => contentKindRules(NO_KIND),
      () =>
        assertColorCardContent({
          kind: NO_KIND,
          colors: SHARE_COLORS,
          payload: SHARE_COLORS.join(" "),
        }),
      () => withDecoyPool({ kind: NO_KIND, colors: SHARE_COLORS }, FIRST),
      () => collectionSeries({ kind: NO_KIND }),
      () => collectionPayload({ kind: NO_KIND, payload: "p", qrCard: true }),
      () => assertSheetQr({ kind: NO_KIND, pageSize: "a6" }),
    ];
    for (const refusal of refusals)
      expect(refusal).toThrow(
        expect.objectContaining({ code: "export.content-kinds.cards-draw-color-references" }),
      );
  });

  it("gives each kind its own series, separate card reference and whole-backup QR code", () => {
    const phrase = contentKindRules("colors");
    const share = contentKindRules("sskr");
    expect(phrase.series(undefined)).toBe("01");
    expect(share.series("4BBF-1")).toBe("4BBF-1");
    expect(phrase.separateReference("01  41C47E", "01")).toBe("01  41C47E");
    expect(share.separateReference("01  41C47E", "4BBF-1")).toBe("01  41C47E  |  4BBF-1");
    expect([phrase.wholeBackupQr, share.wholeBackupQr]).toEqual([false, true]);
    expect([phrase.qrOnSheetsOnly, share.qrOnSheetsOnly]).toEqual([true, false]);
  });

  it("refuses a QR code on a seed phrase's separate cards, and leaves share cards to their layout", () => {
    const separate = { pageSize: "business", cardQr: true } as const;
    expect(() => assertSheetQr({ kind: "colors", ...separate })).toThrow(
      expect.objectContaining({
        code: "export.content-kinds.qr-code-printed-on-sheet-only-choose-size",
        message:
          "A QR code is printed on a sheet only. Choose the A6, A5 or A4 size for a QR code; separate cards never carry one.",
      }),
    );
    expect(() => assertSheetQr({ kind: "sskr", ...separate })).not.toThrow();
    // A value that no type allows, fed on purpose as a JavaScript host could: only true asks for
    // a QR code, as collectionPayload reads it.
    expect(() =>
      assertSheetQr({ kind: "colors", pageSize: "business", cardQr: "yes" as never }),
    ).not.toThrow();
  });

  it("draws a share's decoys from any color and refuses a phrase's beside no phrase", () => {
    // Color 0 of the 2^24 colors: black.
    expect(contentKindRules("sskr").decoyColor(FIRST, SHARE_COLORS.length)).toBe("#000000");
    expect(() => contentKindRules("colors").decoyColor(FIRST, NO_PHRASE_COUNT)).toThrow(
      expect.objectContaining({ code: "export.content-kinds.decoys-added-colors-whole-phrase" }),
    );
  });
});
