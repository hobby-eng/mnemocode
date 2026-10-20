// A failing feature-first-use self-test must never become a cached successful check.
import { describe, expect, it, vi } from "vitest";
import type { ShareSplitPlatform } from "../src/sskr/share-platform.js";

const state = vi.hoisted(() => ({
  fails: true,
  calls: 0,
  platforms: [] as unknown[],
}));
vi.mock("../src/sskr/known-answers.js", async (original) => ({
  ...(await original<typeof import("../src/sskr/known-answers.js")>()),
  checkSskrKnownAnswers: async (platform: unknown) => {
    state.calls++;
    state.platforms.push(platform);
    if (state.fails) throw new Error("public SSKR check failure");
  },
}));
import { assertSskrSelfTest, SskrSelfTest } from "../src/sskr/self-test.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

describe("SSKR startup gate", () => {
  it("retries after each failed check and caches only a completed successful check", async () => {
    state.fails = true;
    state.calls = 0;
    await expect(assertSskrSelfTest()).rejects.toThrow("public SSKR check failure");
    await expect(assertSskrSelfTest()).rejects.toThrow("public SSKR check failure");
    expect(state.calls).toBe(2);
    state.fails = false;
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    expect(state.calls).toBe(3);
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    expect(state.calls).toBe(3);
    expect(state.platforms.every((platform) => platform === nodeSharePlatform)).toBe(true);
  });

  it("checks the platform it was given, and keeps a pass to itself", async () => {
    // A host's platform that is never called: the mocked known answers only record it.
    const platform: ShareSplitPlatform = {
      combineShares: () => Promise.reject(new Error("not called")),
      createShares: () => Promise.reject(new Error("not called")),
    };
    state.fails = true;
    state.calls = 0;
    state.platforms.length = 0;
    const selfTest = new SskrSelfTest(platform);
    await expect(selfTest.assert()).rejects.toThrow("public SSKR check failure");
    state.fails = false;
    await expect(selfTest.assert()).resolves.toBeUndefined();
    await expect(selfTest.assert()).resolves.toBeUndefined();
    expect(state.calls).toBe(2);
    expect(state.platforms).toEqual([platform, platform]);
    await expect(new SskrSelfTest(platform).assert()).resolves.toBeUndefined();
    expect(state.calls).toBe(3);
  });
});
