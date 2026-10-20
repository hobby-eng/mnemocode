import { describe, expect, it, vi } from "vitest";
import { assessShares, TypedShares } from "../src/cli/share-repair.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { releaseRead, ShareRestore } from "../src/sskr/share-restore.js";
import { JointRepair } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { questionsOnPrivateScreen, seen } from "./helpers/question-terminal.js";
import { endLifetimeIfPresent } from "./helpers/owner-lifetime.js";
import { marked, SHARES } from "./helpers/share-questions.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
const watch = vi.hoisted(() => ({ cancelAfterAssessment: false }));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const input = harness.replacedTerminalInput(await importOriginal());
  class CancellingWatch extends input.CtrlCWatch {
    static override async during<T>(step: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController();
      const result = await step(controller.signal);
      if (watch.cancelAfterAssessment) controller.abort();
      return result;
    }
  }
  return { ...input, CtrlCWatch: CancellingWatch };
});
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);

questionsOnPrivateScreen();

describe("Marked assessment ownership where terminal output fails", () => {
  it("releases the new marked plan when printing its assessment fails", async () => {
    using shares = new TypedShares();
    const records = [SHARES[0], marked([5])];
    shares.input.add(records);
    // This public wrapper still returns its real read and plan; only terminal output fails.
    const reads = vi.spyOn(ShareRestore.prototype, "read");
    const failure = Object.assign(new Error("Synthetic terminal reporting failure."), {
      code: "EIO",
    });
    const printing = vi.spyOn(console, "error").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      await expect(assessShares(shares)).rejects.toBe(failure);
      expect(printing).toHaveBeenCalledWith(expect.stringContaining("Marked elements:"));
      expect(reads).toHaveBeenCalledTimes(1);
      const captured = reads.mock.results[0]!;
      if (captured.type !== "return")
        throw new Error("The real assessment must return its promise.");
      const read = await captured.value;
      expect(read.kind).toBe("marked");
      if (read.kind !== "marked") throw new Error("The public fixture must produce a marked plan.");
      expect(read.lines).toEqual([
        {
          kind: "status",
          label: "Marked elements:",
          value: "settled by the shares together",
          good: true,
        },
      ]);
      await expect(read.plan.search()).rejects.toHaveProperty(
        "code",
        "sskr.joint-repair.plan-wiped",
      );
      expect(shares.input.texts()).toEqual(records);
    } finally {
      printing.mockRestore();
      // Assertions precede fallback cleanup, which also runs when the red regression fails.
      for (const result of reads.mock.results)
        if (result.type === "return") await result.value.then(releaseRead, () => undefined);
    }
  });

  it("transfers a successfully reported marked plan to a real search", async () => {
    using shares = new TypedShares();
    const records = [SHARES[0], marked([5])];
    shares.input.add(records);
    const reads = vi.spyOn(ShareRestore.prototype, "read");
    try {
      const read = await assessShares(shares);
      expect(read).toHaveProperty("kind", "marked");
      if (typeof read !== "object" || read.kind !== "marked")
        throw new Error("The public fixture must transfer its marked assessment.");
      const found = await new ShareRestore(nodeSharePlatform).search(read);
      expect(found.kind).toBe("sets");
      if (found.kind !== "sets")
        throw new Error("The public fixture must restore its known phrase.");
      expect(found.sets.map(({ mnemonic }) => mnemonic)).toEqual([SSKR_SET_VECTOR.phrase]);
      expect(shares.input.texts()).toEqual(records);
    } finally {
      for (const result of reads.mock.results)
        if (result.type === "return") await result.value.then(releaseRead, () => undefined);
    }
  });

  it("releases a real assessment cancelled by its watch before reporting it", async () => {
    using shares = new TypedShares();
    const records = [SHARES[0], marked([5])];
    shares.input.add(records);
    const plans = vi.spyOn(JointRepair.prototype, "plan");
    watch.cancelAfterAssessment = true;
    try {
      expect(await assessShares(shares)).toBe(CANCELLED);
      expect(plans).toHaveBeenCalledTimes(1);
      const captured = plans.mock.results[0]!;
      if (captured.type !== "return") throw new Error("The real assessment must create its plan.");
      const plan = await captured.value;
      await expect(plan.search()).rejects.toHaveProperty("code", "sskr.joint-repair.plan-wiped");
      expect(seen.notices).toEqual([]);
      expect(shares.input.texts()).toEqual(records);
    } finally {
      watch.cancelAfterAssessment = false;
      for (const result of plans.mock.results)
        if (result.type === "return")
          await result.value.then(
            (plan) => endLifetimeIfPresent(plan),
            () => undefined,
          );
    }
  });
});
