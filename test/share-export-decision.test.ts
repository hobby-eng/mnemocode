import { describe, expect, it } from "vitest";
import { ShareRestore, WALLET_CHECK_NEEDS_THRESHOLD } from "../src/sskr/share-restore.js";
import { NO_PHRASE_FITS } from "../src/sskr/repair-report.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";

describe("The shared SSKR export decision", () => {
  it("repairs each share without a quorum and refuses a wallet check of those shares", () => {
    const few = { kind: "few", message: "More shares needed." } as const;
    expect(ShareRestore.exportDecision(few, false)).toEqual({ kind: "each", few });
    expect(ShareRestore.exportDecision(few, true)).toEqual({
      kind: "trouble",
      message: WALLET_CHECK_NEEDS_THRESHOLD,
    });
  });

  it("exports one restored set and gives no set to save when several fit", async () => {
    const set = (await ShareSet.restore(sskrSetVector.shares, nodeSharePlatform)).toRepairedSet();
    const found = {
      kind: "phrases",
      sets: [set],
      phrases: [],
      listed: [],
      places: [1, 2, 3],
    } as const;
    const one = ShareRestore.exportDecision(found, false);
    expect(one).toEqual({ kind: "set", found, set });
    if (one.kind === "set") expect(one.found.places).toEqual([1, 2, 3]);
    const variants = { ...found, sets: [set, { ...set }] };
    const many = ShareRestore.exportDecision(variants, false);
    expect(many).toEqual({ kind: "variants", found: variants });
    expect(many).not.toHaveProperty("set");
    expect(ShareRestore.exportDecision({ ...found, sets: [] }, false)).toEqual({
      kind: "trouble",
      message: NO_PHRASE_FITS,
    });
  });
});
