// Public synthetic fixtures only. Initial lifetime controls do not draw; async controls delay
// the real host font read, and one draws a single card to test a late rendering result.
import { describe, expect, it } from "vitest";
import { CardRenderer } from "../src/export/card-renderer.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { EncodeCardExport } from "../src/cli/encode-export.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { SSKR_VECTOR } from "../src/sskr/known-answers.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { CardValues } from "../src/export/card-values.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import type { CardDrawing } from "../src/export/templates.js";
import { deferred } from "./helpers/deferred.js";
import { endLifetimeIfPresent, WIPED_CODE } from "./helpers/owner-lifetime.js";

const WIPED = { code: WIPED_CODE };
const noDrawing = (): never => {
  throw new Error("This lifetime test must not render or read an asset.");
};
const drawing = new CardRenderer({
  randomInt: () => 0,
  readAsset: noDrawing,
  decodePng: noDrawing,
  encodePng: noDrawing,
  qrModules: noDrawing,
});
const OPTIONS = { style: "it", layout: "individual", pageSize: "business" } as const;

function heldFont() {
  const entered = deferred();
  const held = deferred();
  let reads = 0;
  const host = new CardRenderer({
    ...nodeRenderPlatform,
    randomInt: () => 0,
    readAsset: async (path) => {
      reads += 1;
      entered.release();
      await held.promise;
      return nodeRenderPlatform.readAsset(path);
    },
  });
  return { host, entered, held, reads: () => reads };
}

describe("card result owners", () => {
  it.each([
    { value: null },
    { value: undefined },
    { value: [] },
    { value: 42 },
    { value: "synthetic fixture" },
    { value: { colors: "synthetic fixture", payload: "synthetic fixture" } },
  ])("refuses an untyped malformed card value object: $value", ({ value }) => {
    expect(() => {
      Reflect.construct(CardValues, [value]);
    }).toThrow(expect.objectContaining({ code: "export.card-values.shape" }));
  });

  it("keeps the public share codes and one decoy while its plan is live", async () => {
    const cards = await ShareCardSet.create(drawing, [SSKR_VECTOR.shares[0]!], OPTIONS);
    try {
      expect(cards.printedCodes(0)).toEqual([
        ...SSKR_VECTOR.firstShareColors.map((color) => color.slice(1)),
        "000000",
      ]);
      expect(cards.shares[0]?.reference).toBe("4BBF-1-1");
      expect(cards.qrCodes).toEqual([]);
    } finally {
      endLifetimeIfPresent(cards, "dispose");
    }
  });

  it("keeps Encode's borrowed backup and repeated job values live before disposal", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
    using backup = encoding.backup;
    const cards = new EncodeCardExport(
      { "page-size": "business" },
      { encoding, mode: "direct", enteredDates: [] },
    );
    try {
      const first = await cards.job();
      expect(first.content.payload).toBe(backup.text());
      expect((await cards.job()).content).toEqual(first.content);
      expect((await cards.separateJob()).content.payload).toBe(first.content.payload);
    } finally {
      endLifetimeIfPresent(cards, "dispose");
    }
    expect(backup.text()).not.toBe("");
  });

  it("ends a share plan idempotently and refuses every later secret operation", async () => {
    const cards = await ShareCardSet.create(drawing, [SSKR_VECTOR.shares[0]!], OPTIONS);
    try {
      const metadata = cards.shares;
      cards.wipe();
      cards[Symbol.dispose]();
      expect(cards.shares).toEqual(metadata);
      expect(cards.layout).toBe("individual");
      expect(() => cards.printedCodes(0)).toThrow(expect.objectContaining(WIPED));
      expect(() => cards.ownCodes(0)).toThrow(expect.objectContaining(WIPED));
      expect(() => cards.qrCodes).toThrow(expect.objectContaining(WIPED));
      expect(() => cards.forIndividualCards()).toThrow(expect.objectContaining(WIPED));
      await expect(cards.renderShare(0)).rejects.toMatchObject(WIPED);
      await expect(cards.renderAll()).rejects.toMatchObject(WIPED);
      await expect(cards.documents(0).next()).rejects.toMatchObject(WIPED);
    } finally {
      endLifetimeIfPresent(cards, "dispose");
    }
  });

  it("gives a converted share plan a lifetime independent of its parent", async () => {
    const parent = await ShareCardSet.create(drawing, [SSKR_VECTOR.shares[0]!], OPTIONS);
    const child = parent.forIndividualCards();
    try {
      const codes = child.printedCodes(0);
      parent.wipe();
      expect(child.printedCodes(0)).toEqual(codes);
      const another = child.forIndividualCards();
      try {
        child.wipe();
        expect(another.printedCodes(0)).toEqual(codes);
      } finally {
        endLifetimeIfPresent(another, "dispose");
      }
      expect(() => child.printedCodes(0)).toThrow(expect.objectContaining(WIPED));
    } finally {
      endLifetimeIfPresent(child, "dispose");
      endLifetimeIfPresent(parent, "dispose");
    }
  });

  it("ends Encode's cached plan without ending its borrowed backup", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
    using backup = encoding.backup;
    const cards = new EncodeCardExport(
      { "page-size": "business" },
      { encoding, mode: "direct", enteredDates: [] },
    );
    try {
      const view = await cards.job();
      cards.wipe();
      cards[Symbol.dispose]();
      expect(backup.text()).toBe(view.content.payload);
      // A previously decoded caller view cannot be recalled by wiping its producer.
      expect(view.content.colors.length).toBeGreaterThan(0);
      await expect(cards.job()).rejects.toMatchObject(WIPED);
      await expect(cards.separateJob()).rejects.toMatchObject(WIPED);
    } finally {
      endLifetimeIfPresent(cards, "dispose");
    }
  });
});

describe("Card planning and publication", () => {
  it("shares the first pending Encode plan and refuses it if the owner ends", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "unicode", "direct");
    using backup = encoding.backup;
    const font = heldFont();
    const cards = new EncodeCardExport(
      { "page-size": "a6", template: "business-it" },
      { encoding, mode: "direct", enteredDates: [] },
      font.host,
    );
    try {
      const first = cards.job();
      const second = cards.job();
      const completed = Promise.allSettled([first, second]);
      await Promise.race([font.entered.promise, completed]);
      expect(font.reads()).toBe(1);
      cards.wipe();
      font.held.release();
      const results = await completed;
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") expect(result.reason).toMatchObject(WIPED);
      }
      await expect(cards.job()).rejects.toMatchObject(WIPED);
      expect(backup.text()).not.toBe("");
    } finally {
      font.held.release();
      endLifetimeIfPresent(cards, "dispose");
    }
  });

  it("can retry a failed Encode plan without caching the failure", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "unicode", "direct");
    using backup = encoding.backup;
    let reads = 0;
    const failure = new Error("Synthetic font read failure");
    const host: CardDrawing = {
      randomInt: (limit) => drawing.randomInt(limit),
      qrModules: (payload) => drawing.qrModules(payload),
      businessArtwork: drawing.businessArtwork,
      readAsset: (path) => {
        reads += 1;
        if (reads === 1) return Promise.reject(failure);
        return nodeRenderPlatform.readAsset(path);
      },
    };
    using cards = new EncodeCardExport(
      { "page-size": "a6", template: "business-it" },
      { encoding, mode: "direct", enteredDates: [] },
      host,
    );
    await expect(cards.job()).rejects.toBe(failure);
    expect((await cards.job()).content.payload).toBe(backup.text());
    const afterRetry = reads;
    expect((await cards.job()).content.payload).toBe(backup.text());
    expect(reads).toBe(afterRetry);
  });

  it("shares successful pending planning but returns independent decoded job views", async () => {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "unicode", "direct");
    using backup = encoding.backup;
    const font = heldFont();
    const options = { "page-size": "a6", template: "business-it", title: "Original title" };
    using cards = new EncodeCardExport(
      options,
      { encoding, mode: "direct", enteredDates: [] },
      font.host,
    );
    options.title = "Changed after admission";
    const pending = Promise.all([cards.job(), cards.job()]);
    try {
      await Promise.race([font.entered.promise, pending]);
      expect(font.reads()).toBe(1);
    } finally {
      font.held.release();
    }
    const [first, second] = await pending;
    expect(first.content).toEqual(second.content);
    expect(first.content).not.toBe(second.content);
    expect(first.content.colors).not.toBe(second.content.colors);
    expect(first.content.title).toBe("Original title");
    expect(first.content.payload).toBe(backup.text());
    expect(font.reads()).toBe(1);
  });

  it("refuses a share render that finishes after its owner was wiped", async () => {
    const font = heldFont();
    using cards = await ShareCardSet.create(font.host, [SSKR_VECTOR.shares[0]!], OPTIONS);
    const pending = cards.renderShare(0);
    const completed = Promise.allSettled([pending]);
    try {
      await Promise.race([font.entered.promise, completed]);
      cards.wipe();
    } finally {
      font.held.release();
    }
    const [result] = await completed;
    expect(result?.status).toBe("rejected");
    if (result?.status === "rejected") expect(result.reason).toMatchObject(WIPED);
  });

  it("preserves opaque code units and wipes owned late bytes without recalling a view", () => {
    using values = new CardValues({
      colors: ["#000000"],
      labels: ["\ud800"],
      payload: "\ufeff\udfff",
    });
    using copy = values.copy();
    const view = values.view;
    const healthy = new Uint8Array([1, 2, 3]);
    expect(values.checkedBytes(healthy)).toBe(healthy);
    expect([...healthy]).toEqual([1, 2, 3]);
    values.wipe();
    expect(copy.view.labels).toEqual(["\ud800"]);
    expect(copy.view.payload).toBe("\ufeff\udfff");
    expect(view.payload).toBe("\ufeff\udfff");
    expect(() => values.view).toThrow(expect.objectContaining(WIPED));
    const late = new Uint8Array([4, 5, 6]);
    expect(() => values.checkedBytes(late)).toThrow(expect.objectContaining(WIPED));
    expect([...late]).toEqual([0, 0, 0]);
  });
});
