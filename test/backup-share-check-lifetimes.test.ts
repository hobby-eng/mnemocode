import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeptShares, RestoredShares, ShareBackupCheck } from "../src/core/backup-check.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareCombineRefusalError } from "../src/sskr/share-platform.js";
import { ShareSplit } from "../src/sskr/split.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

// Public bip39-128-2-of-3 shares and independently specified phrase from sskr-v1.json.
const SHARES = [
  "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf",
  "ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls",
] as const;
const SHARE_PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer";
// Public checksum-valid-seedshift-12 known answer, masked with 23-09-2026.
const MASKED_PHRASE = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const DATE = { year: 2026, month: 9, day: 23 };
const TEXTS = { decodeEntry: "Decode" };
const WIPED_CODE = "core.secret-value.wiped";
let maskedShares: readonly string[] = [];

function deferredTurn(): { promise: Promise<void>; release: () => void } {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release!() };
}

function observeSets() {
  // Both public factories keep their real implementations and return their actual promises.
  const combine = vi.spyOn(ShareSet, "combine");
  const restore = vi.spyOn(ShareSet, "restore");
  return () =>
    [combine, restore].map((factory) => {
      expect(factory).toHaveBeenCalledTimes(1);
      const result = factory.mock.results[0]!;
      if (result.type !== "return") throw new Error("The async factory must return its promise.");
      return result.value;
    });
}

beforeAll(async () => {
  // One tiny deterministic fixture of public data; no production randomness is replaced.
  const split = new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7));
  maskedShares = await split.split(MASKED_PHRASE, 2, 2);
});
afterEach(() => vi.restoreAllMocks());

describe("A share backup check across an awaited host recovery", () => {
  it.each([
    ["restore", "success"],
    ["restore", "refusal"],
    ["check", "success"],
    ["check", "refusal"],
  ] as const)(
    "refuses late %s publication when the disposed check's host completes with %s",
    async (operation, outcome) => {
      const entered = deferredTurn();
      const gate = deferredTurn();
      const setPromises = observeSets();
      const published = vi.spyOn(RestoredShares, "of");
      const check = new ShareBackupCheck(
        { mnemonic: SHARE_PHRASE, mode: "direct", threshold: 2 },
        {
          ...nodeSharePlatform,
          combineShares: async (records) => {
            entered.release();
            await gate.promise;
            if (outcome === "refusal") throw new ShareCombineRefusalError();
            return nodeSharePlatform.combineShares(records);
          },
        },
        TEXTS,
      );
      using kept = KeptShares.of(SHARES);
      const pending =
        operation === "restore" ? check.restore(kept) : check.check({ backup: SHARES.join(";") });
      const refused = expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
      try {
        await entered.promise;
        check.wipe();
        gate.release();
        await refused;
        expect(published).not.toHaveBeenCalled();
        const promises = setPromises();
        if (outcome === "success") {
          const sets = await Promise.all(promises);
          expect(sets[0]).toBe(sets[1]);
          for (const set of sets) {
            expect(() => set.mnemonic).toThrow("has been wiped");
            expect(() => set.shares).toThrow("has been wiped");
          }
        } else {
          for (const promise of promises)
            await expect(promise).rejects.toThrow("These shares do not restore a secret");
        }
        // restore borrows this owner; a whole check also leaves this separate caller owner alone.
        expect(kept.texts).toEqual(SHARES);
      } finally {
        gate.release();
        check.wipe();
        // If publication regresses, still release the unexpectedly returned public-data child.
        await pending.then(
          (value) => {
            if (value instanceof RestoredShares) value.wipe();
          },
          () => undefined,
        );
      }
    },
  );

  it("closes the successful temporary set while transferring an independent restored child", async () => {
    const setPromises = observeSets();
    using check = new ShareBackupCheck(
      { mnemonic: SHARE_PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    using kept = KeptShares.of(SHARES);
    using child = await check.restore(kept);
    expect(child.holds(SHARE_PHRASE)).toBe(true);
    expect(child.holds(TEST_PHRASE)).toBe(false);
    for (const set of await Promise.all(setPromises()))
      expect(() => set.mnemonic).toThrow("has been wiped");
    check.wipe();
    expect(kept.texts).toEqual(SHARES);
    expect(child.holds(SHARE_PHRASE)).toBe(true);
  });

  it("closes a whole successful check's temporary kept shares, restored phrase and set", async () => {
    const setPromises = observeSets();
    const kept = vi.spyOn(KeptShares, "of");
    const restored = vi.spyOn(RestoredShares, "of");
    using check = new ShareBackupCheck(
      { mnemonic: SHARE_PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    expect(await check.check({ backup: SHARES.join(";") })).toEqual({
      verdict: "restores",
      message: "The backup restores this seed phrase.",
      notes: [],
    });
    expect(kept).toHaveBeenCalledTimes(1);
    expect(restored).toHaveBeenCalledTimes(1);
    const keptOwner = kept.mock.results[0]!;
    const restoredOwner = restored.mock.results[0]!;
    if (keptOwner.type !== "return" || restoredOwner.type !== "return")
      throw new Error("The public factories must return their owners.");
    expect(() => keptOwner.value.texts).toThrow("has been wiped");
    expect(() => restoredOwner.value.holds(SHARE_PHRASE)).toThrow("has been wiped");
    for (const set of await Promise.all(setPromises()))
      expect(() => set.mnemonic).toThrow("has been wiped");
  });
});

describe("An independent restored-share snapshot", () => {
  it.each(["set", "kept"] as const)(
    "survives disposal of the borrowed %s first and leaves sibling owners independent",
    async (first) => {
      using set = await ShareSet.combine(maskedShares, nodeSharePlatform);
      using kept = KeptShares.of(maskedShares);
      using child = RestoredShares.of(set, kept);
      using sibling = RestoredShares.of(set, kept);
      expect(set.mnemonic).toBe(MASKED_PHRASE);
      expect(child.holds(MASKED_PHRASE)).toBe(true);
      expect(child.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toBe(true);
      expect(child.unmasksTo(SHARE_PHRASE, "seedshift", [DATE])).toBe(false);
      child.wipe();
      child[Symbol.dispose]();
      expect(() => child.holds(MASKED_PHRASE)).toThrow("has been wiped");
      expect(() => child.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toThrow("has been wiped");
      expect(child.unchecked).toEqual([]);
      expect(set.mnemonic).toBe(MASKED_PHRASE);
      expect(kept.texts).toEqual(maskedShares);
      expect(sibling.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toBe(true);

      if (first === "set") set.wipe();
      else kept.wipe();
      expect(sibling.holds(MASKED_PHRASE)).toBe(true);
      expect(sibling.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toBe(true);
      if (first === "set") expect(kept.texts).toEqual(maskedShares);
      else expect(set.mnemonic).toBe(MASKED_PHRASE);

      set.wipe();
      kept.wipe();
      expect(sibling.holds(MASKED_PHRASE)).toBe(true);
      expect(sibling.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toBe(true);
      sibling.wipe();
      expect(() => sibling.holds(MASKED_PHRASE)).toThrow("has been wiped");
      expect(() => sibling.unmasksTo(TEST_PHRASE, "seedshift", [DATE])).toThrow("has been wiped");
      expect(sibling.unchecked).toEqual([]);
    },
  );
});
