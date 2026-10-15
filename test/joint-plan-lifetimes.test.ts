import { describe, expect, it, vi } from "vitest";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";

describe("The lifetime of an assessed joint repair", () => {
  it("refuses a later search through the original bound method after disposal", async () => {
    const plan = await planJointRepair(sskrSetVector.shares.slice(0, 2), {
      platform: nodeSharePlatform,
    });
    try {
      expect(plan.assessment).toMatchObject({ verdict: "determined", combinations: 1 });
      const search = plan.search;
      plan.wipe();
      plan.wipe();
      await expect(search()).rejects.toHaveProperty("code", "sskr.joint-repair.plan-wiped");
    } finally {
      plan.wipe();
    }
  });

  it("ends a refused plan too, rather than returning an ordinary empty result afterwards", async () => {
    const plan = await planJointRepair(sskrSetVector.shares.slice(0, 1), {
      platform: nodeSharePlatform,
    });
    try {
      expect(plan.assessment.verdict).toBe("not-enough");
      plan.wipe();
      await expect(plan.search()).rejects.toHaveProperty("code", "sskr.joint-repair.plan-wiped");
    } finally {
      plan.wipe();
    }
  });

  it("publishes no confirmation that settles after the plan was disposed", async () => {
    let finish: (() => void) | undefined;
    let waiting = true;
    const plan = await planJointRepair(sskrSetVector.shares.slice(0, 2), {
      platform: {
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
      },
    });
    const pending = plan.search();
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      plan.wipe();
      finish!();
      await expect(pending).rejects.toHaveProperty("code", "sskr.joint-repair.plan-wiped");
    } finally {
      finish?.();
      plan.wipe();
    }
  });

  it("keeps a caller's previously transferred result usable after the plan ends", async () => {
    const plan = await planJointRepair(sskrSetVector.shares.slice(0, 2), {
      platform: nodeSharePlatform,
    });
    try {
      const result = await plan.search();
      plan.wipe();
      expect(result.stopped).toBe(false);
      expect(result.sets).toHaveLength(1);
      expect(result.sets[0]!.mnemonic).toBe(
        "abandon amount liar amount expire adjust cage candy arch gather drum buyer",
      );
      expect(result.sets[0]!.shares.map(({ ur }) => ur)).toEqual(sskrSetVector.shares.slice(0, 2));
    } finally {
      plan.wipe();
    }
  });
});
