// recover-word --ask-secrets on a terminal shows a short list of candidates whole, each a part of
// its own, whose page the private screen shows by pages where the parts are taller than the
// window (PrivatePage; scripts/terminal_result_checks.py reads them so in a pseudo-terminal): a
// list that fits on the screen as one row per candidate, as a file gets it. The terminal is
// replaced (test/helpers/question-terminal.ts). Public test data only: the "abandon … about"
// phrase.

import { describe, expect, it, vi } from "vitest";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { questionsOnPrivateScreen, seen, terminal, windowOf } from "./helpers/question-terminal.js";
import { replacedAt, TEST_PHRASE } from "./helpers/test-phrase.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

/** The last word of the test phrase known to start with a: eight words give a valid checksum. */
const LAST_WORD_STARTS_WITH_A = replacedAt(TEST_PHRASE, { 12: "a*" });

questionsOnPrivateScreen();

describe("recover-word on a terminal", () => {
  it("shows each of eight candidates as a part of its own, taller than a window of 30 rows", async () => {
    streamsAsTerminal();
    terminal.stdoutTerminal = true;
    windowOf(30, 80);
    terminal.answers = [`${LAST_WORD_STARTS_WITH_A}\r`];
    await runRecoverWord({ "ask-secrets": true });
    // Each line as the terminal shows it: a part starts after a blank line.
    const rows = seen.out.flatMap((line) => line.replace(STYLE_CODES, "").split("\n"));
    const parts = rows.filter((row) => row.startsWith("Candidate "));
    expect(parts).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((number) => `Candidate ${number}`));
    // Taller than the window: the private screen shows them by pages.
    expect(rows.length).toBeGreaterThan(30);
    expect(terminal.questions).toEqual([]);
    expect(seen.notices.join("\n")).not.toContain("do not fit");
  });

  it("offers the wallet check instead of a list that does not fit as one row per candidate", async () => {
    streamsAsTerminal();
    terminal.stdoutTerminal = true;
    windowOf(12, 80);
    terminal.answers = [`${LAST_WORD_STARTS_WITH_A}\r`];
    terminal.choices = ["Done"];
    await runRecoverWord({ "ask-secrets": true });
    expect(seen.out.some((line) => line.includes("Candidate "))).toBe(false);
    expect(seen.notices.join("\n")).toContain("8 candidates do not fit on this screen");
    expect(terminal.questions).toEqual(["What now?"]);
    expect(terminal.labels[0]).toContain("Check them against the wallet");
  });
});
