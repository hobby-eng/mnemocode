import { expect, it } from "vitest";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";

it("returns a stopped public repair plan when its signal is already aborted", async () => {
  const abort = new AbortController();
  abort.abort(new Error("Synthetic requested stop."));
  const plan = await planJointRepair(SSKR_SET_VECTOR.shares, {
    platform: nodeSharePlatform,
    signal: abort.signal,
  });
  try {
    expect(plan.assessment.verdict).toBe("stopped");
  } finally {
    plan.wipe();
  }
});
