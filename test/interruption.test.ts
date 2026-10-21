import { afterEach, describe, expect, it, vi } from "vitest";
import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "../src/cli/exit-codes.js";
import { Interruption } from "../src/cli/interruption.js";

// Ctrl+C while a command works (interruption.ts): one SIGINT listener while any step runs, which
// undoes the steps innermost first and ends the command as cancelled. The process's exit is the
// edge that is stubbed, so that the test process goes on.

/** The SIGINT listeners that were added since `before` was taken. */
function addedSince(before: readonly unknown[]) {
  return process.listeners("SIGINT").filter((listener) => !before.includes(listener));
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("the handling of Ctrl+C while a command works", () => {
  it("listens for SIGINT exactly while a step runs, once for nested steps", async () => {
    const before = process.listeners("SIGINT");
    await Interruption.run(async () => {
      expect(addedSince(before)).toHaveLength(1);
      await Interruption.run(async () => {
        expect(addedSince(before)).toHaveLength(1);
      });
      expect(addedSince(before)).toHaveLength(1);
    });
    expect(addedSince(before)).toHaveLength(0);
  });

  it("stops listening when a step fails, and passes its failure on", async () => {
    const before = process.listeners("SIGINT");
    await expect(
      Interruption.run(async () => {
        throw new Error("the step failed");
      }),
    ).rejects.toThrow("the step failed");
    expect(addedSince(before)).toHaveLength(0);
  });

  it("undoes the steps innermost first at SIGINT, then ends the command as cancelled", async () => {
    const before = process.listeners("SIGINT");
    const undone: string[] = [];
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The process's exit never returns: here it throws, so that the test process goes on.
    vi.spyOn(process, "exit").mockImplementation((): never => {
      throw new Error("the process ended");
    });
    await Interruption.run(
      () =>
        Interruption.run(
          async () => {
            const [interrupted] = addedSince(before);
            expect(() => interrupted?.("SIGINT")).toThrow("the process ended");
          },
          () => undone.push("inner"),
        ),
      () => undone.push("outer"),
    );
    expect(undone).toEqual(["inner", "outer"]);
    expect(said.mock.calls.flat().join("\n")).toContain(CANCELLED_MESSAGE);
    expect(process.exitCode).toBe(CANCELLED_EXIT_CODE);
  });
});
