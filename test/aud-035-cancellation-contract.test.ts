import { expect, it } from "vitest";
import { planShareRepair } from "../src/sskr/shares.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";

it("returns a stopped public repair plan when its signal is already aborted", async () => {
  const abort = new AbortController();
  abort.abort(new Error("Synthetic requested stop."));
  const plan = await planShareRepair(sskrSetVector.shares, { signal: abort.signal });
  try {
    expect(plan.assessment.verdict).toBe("stopped");
  } finally {
    plan.wipe();
  }
});
