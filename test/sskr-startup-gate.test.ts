// A failing feature-first-use self-test must never become a cached successful check. The share
// engine is the host's platform, which the self-test takes as a parameter: here one that restores
// the known answers wrongly while `fails` is set, and counts how often the check called it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSskrSelfTest, SskrSelfTest } from "../src/sskr/self-test.js";
import type { ShareSplitPlatform } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

/** What the known answers report when the platform restores a wrong secret. */
const WRONG_RECOVERY = "SSKR recovery self-test failed. No secret was processed.";

/** Whether the platform restores a wrong secret. */
let engineFails = true;
/** How often the check called the platform's restore. */
let engineCalls = 0;

/** A restore of `records` that gives a wrong secret while `engineFails`, counted. */
function countedCombine(
  combine: ShareSplitPlatform["combineShares"],
): ShareSplitPlatform["combineShares"] {
  return async (records) => {
    engineCalls += 1;
    // Sixteen zero bytes: the length of the official vector's secret, but not its value.
    return engineFails ? new Uint8Array(16) : combine(records);
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  engineFails = true;
  engineCalls = 0;
});

describe("SSKR startup gate", () => {
  it("retries after each failed check and caches only a completed successful check", async () => {
    const combine = nodeSharePlatform.combineShares;
    // Fault: the SSKR engine of the Node.js platform, which the process's own self-test checks,
    // restores a wrong secret while `engineFails` is set; no input reaches its integrity-checked
    // WASM so. The gate must refuse each time and cache no failure.
    vi.spyOn(nodeSharePlatform, "combineShares").mockImplementation(countedCombine(combine));
    await expect(assertSskrSelfTest()).rejects.toThrow(WRONG_RECOVERY);
    const first = engineCalls;
    expect(first).toBeGreaterThan(0);
    await expect(assertSskrSelfTest()).rejects.toThrow(WRONG_RECOVERY);
    expect(engineCalls).toBe(2 * first);
    engineFails = false;
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    const passed = engineCalls;
    expect(passed).toBeGreaterThan(2 * first);
    // Passed once: the platform is not asked again.
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    expect(engineCalls).toBe(passed);
  });

  it("checks the platform it was given, and keeps a pass to itself", async () => {
    const platform: ShareSplitPlatform = {
      ...nodeSharePlatform,
      combineShares: countedCombine(nodeSharePlatform.combineShares),
    };
    const selfTest = new SskrSelfTest(platform);
    await expect(selfTest.assert()).rejects.toThrow(WRONG_RECOVERY);
    const failed = engineCalls;
    expect(failed).toBeGreaterThan(0);
    engineFails = false;
    // The failure left nothing behind: the check runs again.
    await expect(selfTest.assert()).resolves.toBeUndefined();
    const passed = engineCalls;
    expect(passed).toBeGreaterThan(failed);
    await expect(selfTest.assert()).resolves.toBeUndefined();
    expect(engineCalls).toBe(passed);
    // Another self-test of the same platform keeps no pass of this one's.
    await expect(new SskrSelfTest(platform).assert()).resolves.toBeUndefined();
    expect(engineCalls).toBeGreaterThan(passed);
  });
});
