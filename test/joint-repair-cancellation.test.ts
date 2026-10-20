import { describe, expect, it } from "vitest";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

describe("Direct joint repair cancellation", () => {
  it("keeps no confirmation that completes after its host cancels", async () => {
    for (const cancel of [false, true]) {
      const stop = new AbortController();
      let armed = false;
      let confirmations = 0;
      const platform = {
        ...nodeSharePlatform,
        combineShares: async (shares: readonly string[]) => {
          const secret = await nodeSharePlatform.combineShares(shares);
          if (armed) {
            confirmations += 1;
            if (cancel) stop.abort();
          }
          return secret;
        },
      };
      const plan = await planJointRepair(SSKR_SET_VECTOR.shares.slice(0, 2), { platform });
      try {
        expect(plan.assessment.verdict).toBe("determined");
        armed = true;
        const result = await plan.search({ signal: stop.signal });
        expect(confirmations).toBe(1);
        expect(result.stopped).toBe(cancel);
        expect(result.sets).toHaveLength(cancel ? 0 : 1);
        if (!cancel) expect(result.sets[0]!.mnemonic).toBe(SSKR_SET_VECTOR.phrase);
      } finally {
        plan.wipe();
      }
    }
  });

  it("retains a confirmation made before cancellation from the final progress report", async () => {
    const stop = new AbortController();
    const plan = await planJointRepair(SSKR_SET_VECTOR.shares.slice(0, 2), {
      platform: nodeSharePlatform,
    });
    try {
      const result = await plan.search({ signal: stop.signal, onProgress: () => stop.abort() });
      expect(result.stopped).toBe(true);
      expect(result.sets.map((set) => set.mnemonic)).toEqual([SSKR_SET_VECTOR.phrase]);
    } finally {
      plan.wipe();
    }
  });
});
