import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { WordCandidateSearch } from "../src/core/candidates.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { questionsOnPrivateScreen, terminal, seen } from "./helpers/question-terminal.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
const watchEdge = vi.hoisted((): { failure: Error | undefined } => ({ failure: undefined }));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const input = harness.replacedTerminalInput(await importOriginal());
  class FailingWatch extends input.CtrlCWatch {
    static override async during<Value>(
      search: (signal: AbortSignal) => Promise<Value>,
    ): Promise<Value> {
      const result = await search(new AbortController().signal);
      if (watchEdge.failure !== undefined) throw watchEdge.failure;
      return result;
    }
  }
  return { ...input, CtrlCWatch: FailingWatch };
});

questionsOnPrivateScreen();

describe("The word-search result handoff through the terminal watch", () => {
  it("clears transferred candidates and entropy when terminal finalization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-watch-owner-"));
    const run = vi.spyOn(WordCandidateSearch.prototype, "run");
    const failure = new Error("Synthetic terminal finalization failure.");
    terminal.answers = ["abandon ".repeat(11) + "about|actual\r"];
    watchEdge.failure = failure;
    try {
      await expect(
        runRecoverWord({
          "ask-secrets": true,
          "candidates-file": join(directory, "public.mncl"),
          "plaintext-candidates": true,
        }),
      ).rejects.toBe(failure);
      expect(run).toHaveBeenCalledTimes(1);
      const call = run.mock.results[0]!;
      if (call.type !== "return")
        throw new Error("The real search must complete before the terminal fails.");
      const result = await call.value;
      expect(result.shown).toHaveLength(2);
      expect(result.entropies).toHaveLength(2);
      for (const { candidate } of result.shown)
        expect(() => candidate.phrase).toThrow("has been wiped");
      for (const entropy of result.entropies)
        expect(entropy.every((byte) => byte === 0)).toBe(true);
    } finally {
      watchEdge.failure = undefined;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the successful candidate display usable until the command ends", async () => {
    terminal.answers = ["abandon ".repeat(11) + "about|actual\r"];
    await runRecoverWord({ "ask-secrets": true });
    expect(seen.out.join("\n")).toContain(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
  });
});
