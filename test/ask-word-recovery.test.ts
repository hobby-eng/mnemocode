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
import { PrivateSteps } from "../src/cli/private-steps.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { CTRL_C } from "./helpers/keys.js";
import { matching } from "./helpers/matchers.js";
import { promptsShown } from "./helpers/phrase-questions.js";
import { WALLET_QUESTION } from "./helpers/prompts.js";
import { questionsOnPrivateScreen, seen, terminal, windowOf } from "./helpers/question-terminal.js";
import {
  LAST_WORD_FORGOTTEN,
  LIST_PASSPHRASE,
  ONE_WORD_MISSING,
  replacedAt,
  TEST_FINGERPRINT,
  TEST_PHRASE,
  TEST_WORDS,
} from "./helpers/test-phrase.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("node:fs/promises", async (importOriginal) =>
  harness.replacedFiles(await importOriginal()),
);

const PHRASE_PROMPT = "Seed phrase or text file path, ? for each forgotten word:";
const LIST_PROMPT = "Enter the candidate list encryption passphrase (not the BIP39 passphrase):";
const REPEAT_LIST_PROMPT =
  "Repeat the candidate list encryption passphrase (not the BIP39 passphrase):";

let directory: string;

function recover(options: Record<string, string | boolean>): Promise<Cancelled | undefined> {
  return runRecoverWord({ "ask-secrets": true, ...options });
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
      `${replacedAt(TEST_PHRASE, { 11: "abandom", 12: "?" })}\r`,
      `${replacedAt(TEST_PHRASE, { 1: "?", 2: "?", 3: "?", 12: "abandon" })}\r`,
      `${LAST_WORD_FORGOTTEN}\r`,
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
    expect(promptsShown(PHRASE_PROMPT, LIST_PROMPT, REPEAT_LIST_PROMPT)).toEqual([
      PHRASE_PROMPT,
      PHRASE_PROMPT,
      PHRASE_PROMPT,
      LIST_PROMPT,
      LIST_PROMPT,
      REPEAT_LIST_PROMPT,
      LIST_PROMPT,
      REPEAT_LIST_PROMPT,
    ]);
    const list = decodeCandidateList(
      await decryptCandidates(await readFile(path), { passphrase: LIST_PASSPHRASE }),
    );
    expect(list.records).toHaveLength(128);
  });

  it("refuses a list that surely holds too many candidates before any passphrase", async () => {
    terminal.answers = [
      `${replacedAt(TEST_PHRASE, { 1: "?", 2: "abandon|ability|able", 12: "?" })}\r`,
      `${LAST_WORD_FORGOTTEN}\r`,
      `${LIST_PASSPHRASE}\r`,
      `${LIST_PASSPHRASE}\r`,
    ];
    const path = join(directory, "candidates.age");
    await recover({ "candidates-file": path });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "More than 524,288 candidates, more than one list holds: give more of the words, or a few letters of them.",
        `Saved 128 candidate phrases, encrypted with the passphrase: ${path} (record N is candidate N).`,
      ]),
    );
    // The list's passphrase is asked only for the words that a list holds.
    expect(promptsShown(PHRASE_PROMPT, LIST_PROMPT, REPEAT_LIST_PROMPT)).toEqual([
      PHRASE_PROMPT,
      PHRASE_PROMPT,
      LIST_PROMPT,
      REPEAT_LIST_PROMPT,
    ]);
  });

  it("lets Ctrl+C at the list's passphrase cancel at once", async () => {
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`, `public${CTRL_C}`];
    expect(await recover({ "candidates-file": join(directory, "c.age") })).toBe(CANCELLED);
    expect(seen.notices.join("\n")).not.toContain("Try again");
  });

  it("offers to type the words again when no phrase fits them", async () => {
    terminal.answers = [
      `${replacedAt(TEST_PHRASE, { 12: "abandon|ability" })}\r`,
      `${LAST_WORD_FORGOTTEN}\r`,
    ];
    terminal.choices = ["Type the words again"];
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
    terminal.answers = [`${replacedAt(TEST_PHRASE, { 1: "a*", 12: "?" })}\r`];
    terminal.choices = ["Done"];
    await recover({});
    expect(seen.notices.some((line) => line.includes("candidates are too many to show"))).toBe(
      true,
    );
    expect(terminal.questions).toEqual(["What now?"]);
    expect(terminal.labels[0]).toContain("Check them against the wallet");
    expect(seen.out).toEqual([]);
  });

  it("offers a wallet check when the candidates do not fit on the screen", async () => {
    // As the final review typed it: a word missing from 11 words gives 1,497 candidates, and a
    // window of 40 rows, without scrollback, would show only the last of them.
    terminal.stdoutTerminal = true;
    windowOf(40, 80);
    terminal.answers = [`${ONE_WORD_MISSING}\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["Check them against the wallet", "Fingerprint"];
    await recover({ "missing-word": true });
    expect(seen.notices).toContain(
      "1,497 candidates do not fit on this screen: check them against the wallet's fingerprint or an address, or give a few letters of the words.",
    );
    expect(terminal.questions).toEqual(["What now?", WALLET_QUESTION]);
    // Then only the candidate of the wallet is shown, with its number among all of them.
    expect(seen.out.filter((line) => !line.startsWith("candidate\t"))).toEqual([
      matching(new RegExp(`^\\d+\\t\\d+\\tabandon\\t1\\tmatched at m\\t${TEST_PHRASE}$`, "u")),
    ]);
  });

  it("shows every candidate that fits in the window, also in a file", async () => {
    // 128 rows of two lines each fit in a window of 300 rows, but not in one of 40.
    terminal.stdoutTerminal = true;
    windowOf(300, 80);
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`];
    await recover({});
    expect(seen.out).toHaveLength(129);
    expect(terminal.questions).toEqual([]);

    seen.out = [];
    windowOf(40, 80);
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`];
    terminal.choices = ["Done"];
    await recover({});
    expect(seen.out).toEqual([]);
    expect(terminal.questions).toEqual(["What now?"]);

    // Standard output in a file keeps every row, whatever the window.
    seen.out = [];
    terminal.stdoutTerminal = false;
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`];
    await recover({});
    expect(seen.out).toHaveLength(129);
  });

  it("heads the candidates with the forgotten places, or with a missing word at any position", async () => {
    // The heading's facts are printed only on a terminal (terminalLayout), and each candidate as
    // a part with its facts as grey labels, the phrase wrapped at its spaces (CORE-36).
    streamsAsTerminal();
    terminal.stdoutTerminal = true;
    windowOf(1000, 80);
    const shown = async (answer: string, options: Record<string, string | boolean> = {}) => {
      seen.out = [];
      terminal.answers = [`${answer}\r`];
      await recover(options);
      return seen.out.join("\n");
    };

    const last = await shown(LAST_WORD_FORGOTTEN);
    expect(last).toMatch(/Position\D*12\n/u);
    expect(last).toContain(
      [
        "\nCandidate 1",
        "  Word          about",
        "  Word number   4",
        "  Checksum bits 0011",
        `  Phrase        ${TEST_WORDS.slice(0, 7).join(" ")}`,
        `${" ".repeat(16)}${TEST_WORDS.slice(7).join(" ")}`,
      ].join("\n"),
    );
    expect(last).not.toContain("\t");
    const two = await shown(replacedAt(TEST_PHRASE, { 1: "ab*", 12: "abo*" }));
    expect(two).toMatch(/Positions\D*1, 12\n/u);
    expect(two).toContain(
      [
        "\nCandidate 1",
        "  Words  1:abandon 12:about",
        `  Phrase ${TEST_WORDS.slice(0, 8).join(" ")}`,
        `${" ".repeat(9)}${TEST_WORDS.slice(8).join(" ")}`,
      ].join("\n"),
    );
    // 1,497 candidates do not fit in the window: those that match the wallet are listed.
    const missing = await shown(ONE_WORD_MISSING, {
      "missing-word": true,
      "master-fingerprint": TEST_FINGERPRINT,
    });
    expect(missing).toMatch(/Missing word\W*at any position\n/u);
    expect(missing).toContain(
      [
        "\nCandidate 1",
        "  Position    1",
        "  Word        abandon",
        "  Word number 1",
        "  Wallet      matched at m",
        `  Phrase      ${TEST_WORDS.slice(0, 8).join(" ")}`,
        `${" ".repeat(14)}${TEST_WORDS.slice(8).join(" ")}`,
      ].join("\n"),
    );
  });

  it("lets the wallet change when none of the candidates matched it", async () => {
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["Change the wallet", "Fingerprint"];
    await recover({ "master-fingerprint": "00000000" });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "Matched 0 of 128 candidates against the requested master fingerprint locally.",
        "Matched 1 of 128 candidates against the requested master fingerprint locally.",
      ]),
    );
    expect(terminal.questions).toEqual(["What now?", WALLET_QUESTION]);
  });

  it("saves the list once, for the last words, when none matched the wallet", async () => {
    // Another wallet: the same candidates, saved once after the search that matched.
    const path = join(directory, "list.mncl");
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`, `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["Change the wallet", "Fingerprint"];
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
    terminal.answers = [
      `${LAST_WORD_FORGOTTEN}\r`,
      `${replacedAt(TEST_PHRASE, { 12: "about|abandon" })}\r`,
    ];
    terminal.choices = ["Type the words again"];
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
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`, `${other}\r`];
    terminal.choices = ["Another file name"];
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
    terminal.answers = [`${LAST_WORD_FORGOTTEN}\r`];
    terminal.choices = ["Try again", "Skip"];
    await recover({
      "candidates-file": join(directory, "skipped.mncl"),
      "plaintext-candidates": true,
    });
    expect(seen.notices).toContain("The candidate list was not saved.");
    expect(seen.out.filter((line) => line.startsWith("candidate\t"))).toHaveLength(2);

    // Off the private screen the failure ends the command, as before.
    PrivateSteps.close();
    terminal.saveFailures = 1;
    terminal.saveFailureCode = "EPERM";
    await expect(
      runRecoverWord({
        mnemonic: LAST_WORD_FORGOTTEN,
        "candidates-file": join(directory, "plain.mncl"),
        "plaintext-candidates": true,
      }),
    ).rejects.toThrow("EPERM");
  });
});
