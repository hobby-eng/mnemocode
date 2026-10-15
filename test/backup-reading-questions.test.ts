import { describe, expect, it, vi } from "vitest";
import { BackupReading } from "../src/core/backup-reading.js";
import { askEncodedBackup } from "../src/cli/backup-questions.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { questionsOnPrivateScreen, terminal } from "./helpers/question-terminal.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);

questionsOnPrivateScreen();

describe("Backup reading lifetime across an asynchronous question", () => {
  it.each(["accepted", "cancelled", "refused"] as const)(
    "keeps the parent live until the marked-code mode question is %s",
    async (outcome) => {
      const made = vi.spyOn(BackupReading, "of");
      let accept: ((value: string | Cancelled) => void) | undefined;
      let refuse: ((error: Error) => void) | undefined;
      terminal.answers = ["abandon ".repeat(11) + "?\r"];
      terminal.choices = [
        new Promise<string | Cancelled>((resolve, reject) => {
          accept = resolve;
          refuse = reject;
        }),
      ];
      const pending = askEncodedBackup({
        args: { "ask-secrets": true, "input-kind": "codes", format: "english" },
        seedshiftOnly: false,
        marks: true,
      });
      await vi.waitFor(() =>
        expect(terminal.questions).toContain("Was Seedshift used when it was encoded?"),
      );
      const result = made.mock.results[0]!;
      expect(result.type).toBe("return");
      if (result.type !== "return") throw new Error("The reading must have been created.");
      const reading = result.value;
      expect(reading.marked).toBe(true);
      if (outcome === "refused") {
        const failure = new Error("Synthetic terminal service failure.");
        refuse!(failure);
        await expect(pending).rejects.toBe(failure);
      } else {
        accept!(outcome === "cancelled" ? CANCELLED : "direct");
        const read = await pending;
        if (outcome === "cancelled") expect(read).toBe(CANCELLED);
        else {
          expect(read).toHaveProperty("kind", "missing");
          if (read === CANCELLED || read.kind !== "missing")
            throw new Error("The marked-code child must be returned.");
          expect(read.codes.combinations).toBe(2048);
        }
      }
      expect(() => reading.marked).toThrow("has been wiped");
    },
  );
});
