// recover-word --ask-secrets and its candidate list on the private screen, with the terminal
// replaced (test/helpers/question-terminal.ts). `terminal.saveFailures` makes that many saves of
// the list fail as a full disk would. Standard output is a terminal only with
// `terminal.stdoutTerminal`; the private screen then shows what fits in the window, which windowOf
// sets.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptCandidates } from "../src/core/candidate-encryption.js";
import { decodeCandidateList } from "../src/core/candidate-list.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { matching } from "./helpers/matchers.js";
import {
  byLabel,
  questionsOnPrivateScreen,
  seen,
  terminal,
  windowOf,
} from "./helpers/question-terminal.js";
import { TEST_FINGERPRINT } from "./helpers/test-phrase.js";

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
vi.mock("../src/export/private-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/export/private-file.js")>();
  return {
    ...actual,
    publishNewPrivateFile: async (path: string, bytes: Uint8Array) =>
      harness.failingSave(() => actual.publishNewPrivateFile(path, bytes)),
  };
});

const ELEVEN = "abandon ".repeat(11);
/** The test phrase with its last word forgotten: 128 checksum-valid candidates. */
const LAST_FORGOTTEN = `${ELEVEN}?`;
const PHRASE_PROMPT = "Seed phrase, ? for each forgotten word:";
const LIST_PROMPT = "Passphrase for the candidates list:";
const LIST_PASSPHRASE = "public candidate test passphrase";

let directory: string;

function recover(options: Record<string, string | boolean>): Promise<Cancelled | undefined> {
  return runRecoverWord({ "ask-secrets": true, ...options });
}

/** The prompts shown, in order. */
function promptsShown(): string[] {
  return [
    ...seen.screen.matchAll(
      /(Seed phrase, \? for each forgotten word:|Passphrase for the candidates list:|The same passphrase again:)/gu,
    ),
  ].map((match) => match[1]!);
}

questionsOnPrivateScreen();
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-word-questions-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("recover-word on the private screen", () => {
  it("checks the phrase before the list's passphrase, which is asked again without a limit", async () => {
    const path = join(directory, "candidates.age");
    terminal.answers = [
      `${"abandon ".repeat(10)}abandom ?\r`,
      `? ? ? ${"abandon ".repeat(9)}\r`,
      `${LAST_FORGOTTEN}\r`,
      "short\r",
      `${LIST_PASSPHRASE}\r`,
      "a different passphrase\r",
      `${LIST_PASSPHRASE}\r`,
      `${LIST_PASSPHRASE}\r`,
    ];
    await recover({ "candidates-file": path });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "Unknown English BIP39 word at place 11.",
        "This search has more than 16,777,216 combinations: give more of the words, or a few letters of them.",
        "Use at least 12 characters for the passphrase: it is all that protects these seed phrases.",
        "The two passphrases differ: type both again.",
        `Saved 128 candidate phrases, encrypted with the passphrase: ${path} (record N is candidate N).`,
      ]),
    );
    expect(promptsShown()).toEqual([
      PHRASE_PROMPT,
      PHRASE_PROMPT,
      PHRASE_PROMPT,
      LIST_PROMPT,
      LIST_PROMPT,
      "The same passphrase again:",
      LIST_PROMPT,
      "The same passphrase again:",
    ]);
    const list = decodeCandidateList(
      await decryptCandidates(await readFile(path), { passphrase: LIST_PASSPHRASE }),
    );
    expect(list.records).toHaveLength(128);
  });

  it("refuses a list that surely holds too many candidates before any passphrase", async () => {
    terminal.answers = [`? abandon|ability|able ${"abandon ".repeat(9)}?\r`, `${LAST_FORGOTTEN}\r`];
    const path = join(directory, "open.mncl");
    await recover({ "candidates-file": path, "plaintext-candidates": true });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "More than 524,288 candidates, more than one list holds: give more of the words, or a few letters of them.",
        `Saved 128 candidate phrases, NOT encrypted: ${path} (record N is candidate N).`,
      ]),
    );
  });

  it("lets Ctrl+C at the list's passphrase cancel at once", async () => {
    terminal.answers = [`${LAST_FORGOTTEN}\r`, "public\x03"];
    expect(await recover({ "candidates-file": join(directory, "c.age") })).toBe(CANCELLED);
    expect(seen.notices.join("\n")).not.toContain("Try again");
  });

  it("offers to type the words again when no phrase fits them", async () => {
    terminal.answers = [`${ELEVEN}abandon|ability\r`, `${LAST_FORGOTTEN}\r`];
    terminal.choices = [byLabel("Type the words again")];
    await recover({});
    expect(seen.notices).toContain(
      "No valid phrase fits these words: check them, their order and the ? places.",
    );
    expect(terminal.questions).toEqual(["What now?"]);
    expect(seen.out).toHaveLength(129);
  });

  it("says that ? is no word for the legacy last word, and asks again", async () => {
    const legacy =
      "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";
    terminal.answers = [`${legacy.replace(/hospital$/u, "?")}\r`, `${legacy}\r`];
    await recover({ "legacy-valid-last-word": true });
    expect(seen.notices).toContain(
      "This mode needs the exact old final word: ? stands for no word here.",
    );
    expect(seen.out).toHaveLength(129);
  });
});

describe("recover-word on the private screen", () => {
  it("offers a wallet check when the candidates are too many to show", async () => {
    terminal.answers = [`a* ${"abandon ".repeat(10)}?\r`];
    terminal.choices = [byLabel("Done")];
    await recover({});
    expect(seen.notices.some((line) => line.includes("candidates are too many to show"))).toBe(
      true,
    );
    expect(terminal.questions).toEqual(["What now?"]);
    expect(seen.out).toEqual([]);
  });

  it("offers a wallet check when the candidates do not fit on the screen", async () => {
    // As the final review typed it: a word missing from 11 words gives 1,497 candidates, and a
    // window of 40 rows, without scrollback, would show only the last of them.
    terminal.stdoutTerminal = true;
    windowOf(40, 80);
    terminal.answers = [`${"abandon ".repeat(10)}about\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = [byLabel("Check them against the wallet"), byLabel("Fingerprint")];
    await recover({ "missing-word": true });
    expect(seen.notices).toContain(
      "1,497 candidates do not fit on this screen: check them against the wallet's fingerprint or an address, or give a few letters of the words.",
    );
    expect(terminal.questions).toEqual(["What now?", "How can MnemoCode recognise the wallet?"]);
    // Then only the candidate of the wallet is shown, with its number among all of them.
    expect(seen.out.filter((line) => !line.startsWith("candidate\t"))).toEqual([
      matching(/^\d+\t\d+\tabandon\t1\tmatched at m\t(abandon ){11}about$/u),
    ]);
  });

  it("shows every candidate that fits in the window, also in a file", async () => {
    // 128 rows of two lines each fit in a window of 300 rows, but not in one of 40.
    terminal.stdoutTerminal = true;
    windowOf(300, 80);
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    await recover({});
    expect(seen.out).toHaveLength(129);
    expect(terminal.questions).toEqual([]);

    seen.out = [];
    windowOf(40, 80);
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    terminal.choices = [byLabel("Done")];
    await recover({});
    expect(seen.out).toEqual([]);
    expect(terminal.questions).toEqual(["What now?"]);

    // Standard output in a file keeps every row, whatever the window.
    seen.out = [];
    terminal.stdoutTerminal = false;
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    await recover({});
    expect(seen.out).toHaveLength(129);
  });

  it("lets the wallet change when none of the candidates matched it", async () => {
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = [byLabel("Change the wallet"), byLabel("Fingerprint")];
    await recover({ "master-fingerprint": "00000000" });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "Matched 0 of 128 candidates against the requested master fingerprint locally.",
        "Matched 1 of 128 candidates against the requested master fingerprint locally.",
      ]),
    );
    expect(terminal.questions).toEqual(["What now?", "How can MnemoCode recognise the wallet?"]);
  });

  it("saves the list once, for the last words, when none matched the wallet", async () => {
    // Another wallet: the same candidates, saved once after the search that matched.
    const path = join(directory, "list.mncl");
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = [byLabel("Change the wallet"), byLabel("Fingerprint")];
    const wrongWallet = { "plaintext-candidates": true, "master-fingerprint": "00000000" };
    await recover({ "candidates-file": path, ...wrongWallet });
    const saved = (line: string) => line.startsWith("Saved ");
    expect(seen.notices.filter((line) => saved(line) || line.startsWith("Matched "))).toEqual([
      "Matched 0 of 128 candidates against the requested master fingerprint locally.",
      `Saved 128 candidate phrases, NOT encrypted: ${path} (record N is candidate N).`,
      "Matched 1 of 128 candidates against the requested master fingerprint locally.",
    ]);
    expect(seen.notices.join("\n")).not.toContain("could not be saved");
    expect(decodeCandidateList(await readFile(path)).records).toHaveLength(128);

    // Other words: only their candidates are saved, when the person is done (Escape).
    seen.notices = [];
    terminal.questions = [];
    const other = join(directory, "other.mncl");
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${ELEVEN}about|abandon\r`];
    terminal.choices = [byLabel("Type the words again")];
    await recover({ "candidates-file": other, ...wrongWallet });
    expect(seen.notices.filter(saved)).toEqual([
      `Saved 1 candidate phrase, NOT encrypted: ${other} (record N is candidate N).`,
    ]);
    expect(decodeCandidateList(await readFile(other)).records).toHaveLength(1);
    expect(terminal.questions).toEqual(["What now?", "What now?"]);
  });
});

describe("recover-word on the private screen", () => {
  it("keeps the candidates when the list cannot be saved: try again, another name, or skip", async () => {
    const path = join(directory, "first.mncl");
    const other = join(directory, "other.mncl");
    // A folder without the right to write, the usual failure (AUD-024-ARC002).
    terminal.saveFailures = 1;
    terminal.saveFailureCode = "EACCES";
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${other}\r`];
    terminal.choices = [byLabel("Another file name")];
    await recover({ "candidates-file": path, "plaintext-candidates": true });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        `The candidate list could not be saved as ${path}: there is no permission to write there.`,
        `Saved 128 candidate phrases, NOT encrypted: ${other} (record N is candidate N).`,
      ]),
    );
    expect(decodeCandidateList(await readFile(other)).records).toHaveLength(128);

    seen.notices = [];
    terminal.saveFailures = 2;
    terminal.saveFailureCode = "ENOSPC";
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    terminal.choices = [byLabel("Try again"), byLabel("Skip")];
    await recover({
      "candidates-file": join(directory, "skipped.mncl"),
      "plaintext-candidates": true,
    });
    expect(seen.notices).toContain("The candidate list was not saved.");
    expect(seen.out.filter((line) => line.startsWith("candidate\t"))).toHaveLength(2);

    // Off the private screen the failure ends the command, as before.
    terminal.privateScreen = false;
    terminal.saveFailures = 1;
    terminal.saveFailureCode = "EPERM";
    await expect(
      runRecoverWord({
        mnemonic: LAST_FORGOTTEN,
        "candidates-file": join(directory, "plain.mncl"),
        "plaintext-candidates": true,
      }),
    ).rejects.toThrow("EPERM");
  });
});
