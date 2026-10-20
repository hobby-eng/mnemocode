// What a command that ran on the private screen leaves on the main screen once it has left it
// (CORE-39, private-screen.ts): what was saved and where, and the warnings that still hold, never
// the result. The terminal is replaced (test/helpers/question-terminal.ts); Encode runs as it is,
// inside the private screen as the command line runs it, and `terminal.saveFailures` makes its
// saves fail as a full disk would. Public test data only.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/private-screen.js", async (original) =>
  harness.replacedPrivateScreen(await original()),
);
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
vi.mock("../src/cli/terminal-choice.js", async (original) =>
  harness.replacedTerminalChoice(await original()),
);
vi.mock("node:fs/promises", async (original) => harness.replacedFiles(await original()));

import { type ParsedArguments } from "../src/cli/arguments.js";
import { warnOfCloudCopies } from "../src/cli/cloud-folders.js";
import { runEncode } from "../src/cli/encode-command.js";
import { withPrivateScreen } from "../src/cli/private-screen.js";
import { PrivateSummary } from "../src/cli/private-summary.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import {
  LEAVE_ALTERNATE_SCREEN,
  terminalLastingWarning,
  terminalNotice,
  terminalSaved,
  terminalWarningWithMore,
} from "../src/cli/terminal.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { encodeMnemonic, formatEncoded, parseDate } from "../src/core.js";
import { FINGERPRINT_WARNING } from "../src/core/wallet-check.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

/** The test phrase in word numbers, as Encode shows it with --format indexes. */
const WORD_NUMBERS = `${"1 ".repeat(11)}4`;
/** Enter, which clears the private screen after the result; Ctrl+C, which cancels a question. */
const ENTER = "\r";
const CTRL_C = "\x03";
const HEADING = "MnemoCode · encode";
const CLEARED = "The screen with the result was cleared.";
/** A warning given with its README section, as the swap and cloud warnings are. */
const SWAP = "Swap space is not encrypted: a secret may be written to the disk.";
const SWAP_MORE = "More: https://github.com/hobby-eng/mnemocode#unencrypted-swap";
/** What recover-word says under candidates that no wallet confirmed. */
const NOT_PROVEN = "A valid checksum does not prove the wallet: compare an address.";
/** The README's date, which masks the test phrase in the date search. */
const MASK_DATE = "23-09-2026";

questionsOnPrivateScreen();
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-private-summary-"));
  // Standard error in the order it was written, its notices included, as a terminal shows it.
  vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
    seen.notices.push(line.join(" "));
    process.stderr.write(`${line.join(" ")}\n`);
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The lines written to the main screen after the private screen was left. */
function mainScreen(): string[] {
  const left = seen.screen.indexOf(LEAVE_ALTERNATE_SCREEN);
  expect(left, "the private screen was left").toBeGreaterThanOrEqual(0);
  return seen.screen.slice(left + LEAVE_ALTERNATE_SCREEN.length).split("\n");
}

/** Encode's options with --ask-secrets, as the command line gives them, and more of them. */
function encodeArguments(more: ParsedArguments): ParsedArguments {
  return { "ask-secrets": true, mode: "direct", format: "indexes", ...more };
}

/** Runs Encode with `args` on the private screen, as the command line runs it (command-line.ts). */
function encodeOnPrivateScreen(args: ParsedArguments): ReturnType<typeof runEncode> {
  return withPrivateScreen(async () => {
    warnOfCloudCopies(args);
    return runEncode(args);
  }, "encode");
}

describe("the summary left on the main screen after the private screen", () => {
  it("holds what was saved and the warnings that still hold, each once, in their order", async () => {
    terminal.answers = [ENTER];
    const result = await withPrivateScreen(async () => {
      terminalWarningWithMore(SWAP, "unencrypted-swap");
      // A warning about an answer, which is then asked again, holds no longer.
      terminalNotice("Date 2: there is no such day.", "warning");
      terminalSaved("Saved MnemoCode record: record.txt");
      terminalLastingWarning(FINGERPRINT_WARNING);
      // Drawn again on another screen of the same command.
      terminalLastingWarning(FINGERPRINT_WARNING);
      return 7;
    }, "encode");
    expect(result).toBe(7);
    expect(mainScreen()).toEqual([
      "",
      HEADING,
      SWAP,
      SWAP_MORE,
      "Saved MnemoCode record: record.txt",
      FINGERPRINT_WARNING,
      CLEARED,
      "",
    ]);
  });

  it("names the record Encode saved, never its phrase, codes or fingerprint", async () => {
    const record = join(directory, "record.txt");
    terminal.answers = [`${TEST_PHRASE}${ENTER}`, ENTER];
    // No answer to "Check the backup now?": Escape skips it.
    expect(await encodeOnPrivateScreen(encodeArguments({ output: record }))).toBeUndefined();
    // The result was shown on the private screen, its fingerprint on standard error.
    expect(seen.out).toContain(WORD_NUMBERS);
    const privateScreen = seen.screen.slice(0, seen.screen.indexOf(LEAVE_ALTERNATE_SCREEN));
    expect(privateScreen).toContain(TEST_FINGERPRINT);
    const shown = mainScreen();
    expect(shown).toEqual(["", HEADING, `Saved MnemoCode record: ${record}`, CLEARED, ""]);
    for (const secret of [TEST_PHRASE, WORD_NUMBERS, TEST_FINGERPRINT])
      expect(shown.join("\n")).not.toContain(secret);
  });

  it("says that card files that were skipped were not saved", async () => {
    terminal.saveFailures = 1;
    terminal.answers = [`${TEST_PHRASE}${ENTER}`, ENTER];
    terminal.choices = ["skip"];
    const cards = join(directory, "cards");
    expect(
      await encodeOnPrivateScreen(encodeArguments({ format: "5", "cards-dir": cards })),
    ).toBeUndefined();
    expect(seen.notices).toContain(
      `The card files could not be saved as ${cards}: the disk is full.`,
    );
    expect(mainScreen()).toEqual(["", HEADING, "The card files were not saved.", CLEARED, ""]);
  });

  it("keeps the warnings of a cancelled command, whose one line comes after them", async () => {
    await mkdir(join(directory, "Dropbox"));
    const record = join(directory, "Dropbox", "record.txt");
    terminal.answers = [CTRL_C];
    expect(await encodeOnPrivateScreen(encodeArguments({ output: record }))).toBe(CANCELLED);
    expect(mainScreen()).toEqual([
      "",
      HEADING,
      `Dropbox keeps a copy of ${record}`,
      "More: https://github.com/hobby-eng/mnemocode#cloud-folders",
      "",
    ]);
  });

  it("keeps what a failed command saved, whose error comes after it", async () => {
    const failed = withPrivateScreen(async () => {
      terminalSaved("Saved PDF: cards.pdf");
      throw new Error("Synthetic failure.");
    }, "encode");
    await expect(failed).rejects.toThrow("Synthetic failure.");
    expect(mainScreen()).toEqual(["", HEADING, "Saved PDF: cards.pdf", ""]);
  });

  it("adds nothing for a command cancelled before it had anything to tell", async () => {
    expect(await withPrivateScreen(async () => CANCELLED, "encode")).toBe(CANCELLED);
    expect(mainScreen()).toEqual([""]);
  });

  it("keeps the warning under recover-word's candidates, never a candidate", async () => {
    terminal.answers = [`${"abandon ".repeat(11)}?${ENTER}`, ENTER];
    const found = withPrivateScreen(
      async () => runRecoverWord({ "ask-secrets": true }),
      "recover-word",
    );
    expect(await found).toBeUndefined();
    // The candidates were shown on the private screen, the test phrase among them.
    expect(seen.out.join("\n")).toContain(TEST_PHRASE);
    const shown = mainScreen();
    expect(shown).toEqual(["", "MnemoCode · recover-word", NOT_PROVEN, CLEARED, ""]);
    expect(shown.join("\n")).not.toContain("abandon");
  });

  it("keeps the warning of a date search confirmed by a fingerprint, never its match", async () => {
    terminal.answers = [ENTER];
    const masked = encodeMnemonic(TEST_PHRASE, [parseDate(MASK_DATE)]);
    const found = withPrivateScreen(
      async () =>
        runRecoverDate({
          input: formatEncoded(masked, "indexes"),
          format: "indexes",
          mode: "seedshift",
          date: "2?-09-2026",
          "master-fingerprint": TEST_FINGERPRINT,
        }),
      "recover-date",
    );
    expect(await found).toBeUndefined();
    expect(seen.out.join("\n")).toContain(`${MASK_DATE}\t${TEST_PHRASE}`);
    const shown = mainScreen();
    expect(shown).toEqual(["", "MnemoCode · recover-date", FINGERPRINT_WARNING, CLEARED, ""]);
    for (const secret of [MASK_DATE, TEST_PHRASE, TEST_FINGERPRINT])
      expect(shown.join("\n")).not.toContain(secret);
  });

  it("is not kept without a private screen, where each notice stays where it was written", () => {
    terminalSaved("Saved PDF: cards.pdf");
    terminalLastingWarning(FINGERPRINT_WARNING);
    expect(seen.notices).toEqual(["Saved PDF: cards.pdf", FINGERPRINT_WARNING]);
    expect(PrivateSummary.close()).toEqual([]);
  });
});
