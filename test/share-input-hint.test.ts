import { beforeEach, describe, expect, it, vi } from "vitest";
import { askEncodedBackup } from "../src/cli/backup-questions.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { CLEAR_SCREEN } from "../src/cli/terminal.js";
import { ENCODED_PROMPT } from "./helpers/prompts.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { ESCAPE } from "./helpers/keys.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
questionsOnPrivateScreen();
beforeEach(() => {
  // Notices use console.error in production; retain them on the simulated screen too.
  vi.mocked(console.error).mockImplementation((...line: unknown[]) => {
    const text = line.join(" ");
    seen.notices.push(text);
    process.stderr.write(`${text}\n`);
  });
});

const HINT = "Shamir shares are accepted too; separate them with ;.";
const MARKS_HINT = "Use ? for each missing or unreadable share code or digit.";

describe("mixed backup input explains how to paste shares", () => {
  it.each([false, true])(
    "shows the separator advice only when share input is enabled: %s",
    async (shares) => {
      terminal.answers = [ESCAPE];
      expect(await askEncodedBackup({ args: {}, seedshiftOnly: false, shares })).toBe(CANCELLED);
      const frames = seen.screen
        .split(CLEAR_SCREEN)
        .filter((frame) => frame.includes(ENCODED_PROMPT));
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.includes(HINT)).toBe(shares);
        expect(frame.includes(MARKS_HINT)).toBe(shares);
      }
    },
  );

  it("keeps the separator advice above the prompt after refused input", async () => {
    terminal.answers = ["not-a-unicode-backup\r", ESCAPE];
    expect(
      await askEncodedBackup({
        args: { mode: "direct", format: "unicode" },
        seedshiftOnly: false,
        shares: true,
      }),
    ).toBe(CANCELLED);
    const frames = seen.screen
      .split(CLEAR_SCREEN)
      .filter((frame) => frame.includes(ENCODED_PROMPT));
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toContain(HINT);
      expect(frame).toContain(MARKS_HINT);
      expect(frame.indexOf(HINT)).toBeLessThan(frame.indexOf(ENCODED_PROMPT));
      expect(frame.indexOf(MARKS_HINT)).toBeLessThan(frame.indexOf(ENCODED_PROMPT));
    }
  });

  it("does not offer shares when the input is explicitly read as codes", async () => {
    terminal.answers = [ESCAPE];
    expect(
      await askEncodedBackup({
        args: {},
        seedshiftOnly: false,
        shares: true,
        inputKind: "codes",
      }),
    ).toBe(CANCELLED);
    expect(seen.screen).not.toContain(HINT);
    expect(seen.screen).not.toContain(MARKS_HINT);
  });
});
