import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareExport, ShareSet } from "../src/sskr/share-set.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import type { RepairedSet } from "../src/sskr/joint-results.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SecretValue } from "../src/core/secret-value.js";
import { endLifetimeIfPresent as endIfPresent } from "./helpers/owner-lifetime.js";

function publicSet(): RepairedSet {
  return {
    mnemonic: sskrSetVector.phrase,
    shares: sskrSetVector.shares.slice(0, 2).map((ur) => ({
      ur,
      format: "ur",
      repaired: true,
      filled: [{ position: 1, value: "go" }],
    })),
    unsettled: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Owned SSKR input, restored sets and exports", () => {
  it("ends a restored set without changing its borrowed input or an earlier caller view", () => {
    const given = publicSet();
    const set = ShareSet.of(given);
    try {
      const before = set.toRepairedSet();
      expect(before.mnemonic).toBe(
        "abandon amount liar amount expire adjust cage candy arch gather drum buyer",
      );
      expect(before.shares[0]!.filled).toEqual([{ position: 1, value: "go" }]);
      endIfPresent(set);
      expect(() => set.mnemonic).toThrow("has been wiped");
      expect(() => set.shares).toThrow("has been wiped");
      expect(() => set.toRepairedSet()).toThrow("has been wiped");
      expect(before).toEqual(given);
      expect(given.shares[0]!.ur).toBe(sskrSetVector.shares[0]);
    } finally {
      endIfPresent(set);
    }
  });

  it("gives a reformatted export an independent lifetime", () => {
    const set = publicSet();
    const written = ShareExport.of(set, [1, 3]);
    const copy = written.inForm("indexes");
    try {
      const before = written.shown;
      endIfPresent(written);
      expect(() => written.shown).toThrow("has been wiped");
      expect(() => written.saved).toThrow("has been wiped");
      expect(() => written.inForm("ur")).toThrow("has been wiped");
      expect(copy.saved.map(({ ur }) => ur)).toEqual(sskrSetVector.shares.slice(0, 2));
      expect(before.map(({ number }) => number)).toEqual([1, 3]);
      expect(set.shares[0]!.ur).toBe(sskrSetVector.shares[0]);
    } finally {
      endIfPresent(written);
      endIfPresent(copy);
    }
  });

  it("ends replaced input storage before ending all remaining shares", () => {
    // Raw typed input preserves even malformed UTF-16, rather than normalizing it through UTF-8.
    // Observe actual owned storage; SecretValue's own tests separately check byte overwriting.
    const made = vi.spyOn(SecretValue, "utf16Texts");
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    try {
      input.add([sskrSetVector.shares[0], sskrSetVector.shares[1]]);
      const before = input.list;
      const retained = made.mock.results.filter(
        (owner, index) =>
          owner.type === "return" && made.mock.calls[index]?.[0].includes(sskrSetVector.shares[0]),
      );
      expect(retained.length).toBeGreaterThan(0);
      input.replace(1, sskrSetVector.shares[2]);
      for (const owner of retained)
        if (owner.type === "return") expect(() => owner.value.value).toThrow("has been wiped");
      input.leaveOut(1);
      expect(input.places()).toEqual([2]);
      endIfPresent(input);
      expect(() => input.texts()).toThrow("has been wiped");
      expect(() => input.add([sskrSetVector.shares[0]])).toThrow("has been wiped");
      expect(before.map(({ text }) => text)).toEqual(sskrSetVector.shares.slice(0, 2));
    } finally {
      endIfPresent(input);
    }
  });

  it("refuses a restored set returned after its input owner was disposed", async () => {
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add(sskrSetVector.shares.slice(0, 2));
    let finish: (() => void) | undefined;
    let waiting = true;
    const pending = input.restoreComplete({
      ...nodeSharePlatform,
      combineShares: async (shares) => {
        if (waiting) {
          waiting = false;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
        return nodeSharePlatform.combineShares(shares);
      },
    });
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      endIfPresent(input);
      finish!();
      await expect(pending).rejects.toThrow("has been wiped");
    } finally {
      finish?.();
      endIfPresent(input);
    }
  });
});
