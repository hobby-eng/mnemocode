// A result requested again after a written-share mismatch must restore the whole display,
// including the optional complete backup and fingerprints. Only the terminal is replaced.

import { describe, expect, it, vi } from "vitest";
import { runEncode } from "../src/cli/encode-command.js";
import { CLEAR_SCREEN } from "../src/cli/terminal.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { SHARES } from "./helpers/share-questions.js";
import { TEST_FINGERPRINT, TEST_NUMBERS, TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

questionsOnPrivateScreen();

describe("showing a Shamir split again", () => {
  it("restores the complete backup, fingerprints and shares after the mismatch screen is cleared", async () => {
    streamsAsTerminal();
    terminal.stdoutTerminal = true;
    terminal.answers = [`${TEST_PHRASE}\r`, `${SHARES[0]};${SHARES[1]}\r`];
    terminal.choices = [
      "Yes",
      async () => {
        // Retire the first result's observations: only output after this choice can satisfy
        // the regression, and the real clear and show callback must both still run.
        seen.out = [];
        seen.notices = [];
        seen.screen = "";
        return "Show the result again";
      },
      "No",
    ];
    await expect(
      runEncode({
        "ask-secrets": true,
        mode: "direct",
        sskr: true,
        threshold: "2",
        shares: "3",
        format: "indexes",
      }),
    ).resolves.toBeUndefined();
    expect(terminal.questions).toContain("What now?");
    expect(seen.screen).toContain(CLEAR_SCREEN);
    const output = seen.out.join("\n");
    expect(output).toContain("MnemoCode · SSKR export");
    expect(output).toContain("MnemoCode · Encoded result");
    expect(output).toContain(TEST_NUMBERS);
    expect(output).toContain("SSKR share 1 of 3");
    expect(output).toContain("SSKR share 3 of 3");
    const notices = seen.notices.join("\n");
    expect(notices).toContain(`Original fingerprint ${TEST_FINGERPRINT}`);
    expect(notices).toContain(`Encoded fingerprint ${TEST_FINGERPRINT}`);
    expect(notices).toContain("This is the whole seed phrase");
  });
});
