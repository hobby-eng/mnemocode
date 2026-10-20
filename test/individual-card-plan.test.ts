// Card-count and layout planning only: no PDF painting or image generation.
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it, vi } from "vitest";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { ownCards, keptCards, withDecoyPool } from "../src/export/card-decoys.js";
import { withPlannedDecoys, type SheetShaper } from "../src/export/card-plan.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import { plannedCardJob, separateCardJob } from "../src/export/render.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { selectTemplate } from "../src/export/templates.js";
import { SSKR_VECTOR } from "../src/sskr/known-answers.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

const refuseDrawing = (): never => {
  throw new Error(
    "An individual count plan must not read assets, lay out sheets or render images.",
  );
};
const drawing = new CardRenderer({
  randomInt: () => 0,
  readAsset: refuseDrawing,
  decodePng: refuseDrawing,
  encodePng: refuseDrawing,
  qrModules: refuseDrawing,
});

/**
 * How many codes a share of SSKR_VECTOR has in each form that has cards, from the vector's
 * independent values: 21 Unicode codes (firstShareUnicode), and ten colours (firstShareColors),
 * one card each whether the cards print the colours or their Color Unicode codes. Every share of
 * the vector is as long as the first.
 */
const OWN_SHARE_CODES = { unicode: 21, colors: 10, "colors-unicode": 10 } as const;

describe("converting a retained share sheet to individual cards", () => {
  // Only font metrics and bundled image dimensions may be read while the sheet is planned.
  // Conversion itself may call none of the host's services, and no test paints a PDF.
  const random = vi.fn(() => 0);
  const readAsset = vi.fn((path: Parameters<typeof nodeRenderPlatform.readAsset>[0]) =>
    nodeRenderPlatform.readAsset(path),
  );
  const host = new CardRenderer({
    randomInt: random,
    readAsset,
    decodePng: refuseDrawing,
    encodePng: refuseDrawing,
    qrModules: (payload) => nodeRenderPlatform.qrModules(payload),
  });

  it.each(["unicode", "colors", "colors-unicode"] as const)(
    "keeps each %s share's codes and first decoy without drawing or choosing again",
    async (shareFormat) => {
      const sheet = await ShareCardSet.create(host, [...SSKR_VECTOR.shares], {
        style: "it",
        layout: "collection",
        shareFormat,
        orientation: "portrait",
        cardQr: true,
      });
      const before = sheet.shares.map((_, at) => [...sheet.printedCodes(at)]);
      const qrs = sheet.qrCodes;
      random.mockClear();
      readAsset.mockClear();
      const cards = sheet.forIndividualCards();
      expect(cards.layout).toBe("individual");
      expect(cards.qrCodes).toEqual([]);
      for (const [at, metadata] of cards.shares.entries()) {
        const own = OWN_SHARE_CODES[shareFormat];
        expect(sheet.ownCodes(at)).toBe(own);
        expect(cards.ownCodes(at)).toBe(own);
        expect(cards.printedCodes(at)).toEqual(before[at]!.slice(0, own + 1));
        expect(metadata).toEqual({
          ...sheet.shares[at],
          documents: own + 1,
          folder: metadata.name,
        });
        expect(sheet.printedCodes(at)).toEqual(before[at]);
        expect(sheet.shares[at]!.documents).toBe(1);
      }
      expect(sheet.qrCodes).toEqual(qrs);
      expect(
        cards
          .forIndividualCards({ pageSize: "business", orientation: "landscape" })
          .printedCodes(0),
      ).toEqual(cards.printedCodes(0));
      expect(random).not.toHaveBeenCalled();
      expect(readAsset).not.toHaveBeenCalled();
      expect(() => cards.forIndividualCards({ pageSize: "a4" })).toThrow("business");
      // Settings that no type allows, fed on purpose as an untyped browser host could: they must
      // be refused, not defaulted.
      expect(() => cards.forIndividualCards({ orientation: "diagonal" as never })).toThrow(
        "Orientation must be portrait or landscape.",
      );
      for (const settings of [null, [], true])
        expect(() => cards.forIndividualCards(settings as never)).toThrow("must be an object");
      expect(() => cards.forIndividualCards({ pageSize: null as never })).toThrow("Page size");
    },
  );

  it("refuses to turn a whole-share QR card into individual fragments", async () => {
    const qr = await ShareCardSet.create(host, [SSKR_VECTOR.shares[0]!], {
      style: "it",
      layout: "qr",
    });
    random.mockClear();
    readAsset.mockClear();
    expect(() => qr.forIndividualCards()).toThrow("QR");
    expect(random).not.toHaveBeenCalled();
    expect(readAsset).not.toHaveBeenCalled();
  });

  it("refuses a material sheet whose design has no separate cards", async () => {
    const sheet = await ShareCardSet.create(host, [SSKR_VECTOR.shares[0]!], { style: "switch" });
    random.mockClear();
    readAsset.mockClear();
    expect(() => sheet.forIndividualCards()).toThrow("sheets only");
    expect(random).not.toHaveBeenCalled();
    expect(readAsset).not.toHaveBeenCalled();
  });
});
const shaper: SheetShaper = refuseDrawing;

describe("individual card counts", () => {
  it.each([12, 15, 18, 21, 24])(
    "keeps one decoy for every printable form of %i words",
    async (words) => {
      const phrase = entropyToMnemonic(new Uint8Array((words * 4) / 3), wordlist);
      for (const format of ["unicode", "colors", "colors-unicode"] as const) {
        const backup = EncodedBackup.encode(phrase, [], format, "direct").backup;
        const original = backupCardContent(backup);
        const planned = await withPlannedDecoys(shaper, drawing, original, true);
        const own = format === "unicode" ? words : (words * 2) / 3;
        expect(planned.decoys).toBe(1);
        expect(planned.colors).toHaveLength(own + 1);
        expect(planned.colors.slice(0, own)).toEqual(original.colors);
        expect(planned.labels?.slice(0, own)).toEqual(original.labels);
        expect(planned.payload).toBe(original.payload);
        expect(ownCards(planned)).toBe(own);
        expect(await withPlannedDecoys(shaper, drawing, planned, true)).toBe(planned);
      }
    },
  );

  it("trims a 28-card sheet to 25 individual cards without changing the sheet or real codes", async () => {
    const phrase = entropyToMnemonic(new Uint8Array(32), wordlist);
    const content = backupCardContent(EncodedBackup.encode(phrase, [], "unicode", "direct").backup);
    const sheet = {
      ...keptCards(
        withDecoyPool(content, () => 0),
        28,
      ),
      orientation: "portrait" as const,
    };
    const random = vi.fn(refuseDrawing);
    const individual = await withPlannedDecoys(shaper, drawing, sheet, true, random);
    expect(individual.decoys).toBe(1);
    expect(individual.labels).toEqual(sheet.labels!.slice(0, 25));
    expect(individual.colors).toEqual(sheet.colors.slice(0, 25));
    expect(individual.payload).toBe(sheet.payload);
    expect(sheet.colors).toHaveLength(28);
    expect(await withPlannedDecoys(shaper, drawing, sheet, false, random)).toBe(sheet);
    expect(random).not.toHaveBeenCalled();
    const job = { template: selectTemplate("business-it"), content: sheet };
    const separate = separateCardJob(job, undefined);
    expect(separate.content.colors).toHaveLength(25);
    expect(separate.content).not.toHaveProperty("orientation");
    expect(separateCardJob(job, "landscape").content.orientation).toBe("landscape");
  });

  it("plans card-sized PDFs without a sheet layout", async () => {
    const phrase = entropyToMnemonic(new Uint8Array(32), wordlist);
    const content = backupCardContent(EncodedBackup.encode(phrase, [], "unicode", "direct").backup);
    const job = await plannedCardJob(drawing, {
      template: selectTemplate("business-it"),
      content: { ...content, pageSize: "business" },
    });
    expect(job.content.colors).toHaveLength(25);
    expect(job.content.decoys).toBe(1);
  });

  it.each(["unicode", "colors", "colors-unicode"] as const)(
    "adds one decoy per separate Shamir share in %s",
    async (shareFormat) => {
      const set = await ShareCardSet.create(drawing, [SSKR_VECTOR.shares[0]!], {
        style: "it",
        layout: "individual",
        shareFormat,
      });
      const own = OWN_SHARE_CODES[shareFormat];
      expect(set.ownCodes(0)).toBe(own);
      expect(set.shares[0]!.documents).toBe(own + 1);
      expect(set.printedCodes(0)).toHaveLength(own + 1);
      expect(set.qrCodes).toEqual([]);
    },
  );
});
