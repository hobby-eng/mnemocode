// A failing feature-first-use self-test must never become a cached successful check.
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fails: true, calls: 0 }));
vi.mock("../src/sskr/known-answers.js", async (original) => ({
  ...(await original<typeof import("../src/sskr/known-answers.js")>()),
  checkSskrKnownAnswers: async () => {
    state.calls++;
    if (state.fails) throw new Error("public SSKR check failure");
  },
}));
import { assertSskrSelfTest } from "../src/sskr/self-test.js";

describe("SSKR startup gate", () => {
  it("retries after each failed check and caches only a completed successful check", async () => {
    await expect(assertSskrSelfTest()).rejects.toThrow("public SSKR check failure");
    await expect(assertSskrSelfTest()).rejects.toThrow("public SSKR check failure");
    expect(state.calls).toBe(2);
    state.fails = false;
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    expect(state.calls).toBe(3);
    await expect(assertSskrSelfTest()).resolves.toBeUndefined();
    expect(state.calls).toBe(3);
  });
});
