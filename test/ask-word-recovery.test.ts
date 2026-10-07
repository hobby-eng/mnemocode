import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// recover-word --ask-secrets and its candidate list on the private screen, with the terminal
// replaced: each question that reads a line takes the next of `terminal.answers`, as a terminal in
// raw mode delivers it, and each list question (choose) the entry whose label is the next of
// `terminal.choices`, or Escape when none is left. `terminal.saveFailures` saves fail with EACCES.
// Standard output is a terminal only with `terminal.stdoutTerminal`; the private screen then shows
// what fits in the window, which windowOf sets.
const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as string[],
  questions: [] as string[],
  privateScreen: true,
  stdoutTerminal: false,
  saveFailures: 0,
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 1 && terminal.stdoutTerminal,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => terminal.privateScreen,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  return {
    ...actual,
    terminalAvailable: () => true,
    withRawTerminal: async <T>(body: (next: () => Promise<number | undefined>) => Promise<T>) => {
      const bytes = [...Buffer.from(terminal.answers.shift() ?? "", "utf8")];
      return body(async () => bytes.shift());
    },
    withCtrlCWatch: <T>(search: (signal: AbortSignal) => Promise<T>) =>
      search(new AbortController().signal),
  };
});
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (
    question: string,
    choices: readonly { readonly label: string; readonly value: unknown }[],
  ) => {
    recordCutNotes(question, choices as never);
    terminal.questions.push(question);
    const wanted = terminal.choices.shift();
    if (wanted === undefined) return undefined;
    const choice = choices.find((item) => item.label === wanted || item.value === wanted);
    if (choice === undefined) throw new Error(`No choice ${wanted} at ${question}`);
    return choice.value;
  },
}));
vi.mock("../src/export/private-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/export/private-file.js")>();
  return {
    ...actual,
    publishNewPrivateFile: async (path: string, bytes: Uint8Array) => {
      if (terminal.saveFailures > 0) {
        terminal.saveFailures -= 1;
        throw Object.assign(new Error("EACCES: permission denied, mkdtemp"), { code: "EACCES" });
      }
      return actual.publishNewPrivateFile(path, bytes);
    },
  };
});

import { decryptCandidates } from "../src/core/candidate-encryption.js";
import { decodeCandidateList } from "../src/core/candidate-list.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { InputCancelled } from "../src/cli/terminal-input.js";
import { recordCutNotes, takeCutNotes } from "./helpers/cut-notes.js";

const FINGERPRINT = "73c5da0a";
const ELEVEN = "abandon ".repeat(11);
/** The test phrase with its last word forgotten: 128 checksum-valid candidates. */
const LAST_FORGOTTEN = `${ELEVEN}?`;
const PHRASE_PROMPT = "Seed phrase, ? for each forgotten word:";
const LIST_PROMPT = "Passphrase for the candidates list:";
const LIST_PASSPHRASE = "public candidate test passphrase";

describe("recover-word on the private screen", () => {
  let screen: string;
  let out: string[];
  let notices: string[];
  let directory: string;
  /** The window's size before a test, given back after it. */
  let window: { rows: number; columns: number };
  beforeEach(async () => {
    terminal.answers = [];
    terminal.choices = [];
    terminal.questions = [];
    terminal.privateScreen = true;
    terminal.stdoutTerminal = false;
    terminal.saveFailures = 0;
    window = { rows: process.stderr.rows, columns: process.stderr.columns };
    screen = "";
    out = [];
    notices = [];
    directory = await mkdtemp(join(tmpdir(), "mnemocode-word-questions-"));
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      screen += Buffer.from(chunk as Uint8Array).toString("utf8");
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      out.push(line.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      notices.push(line.join(" "));
    });
  });
  afterEach(async () => {
    Object.assign(process.stderr, window);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });

  function windowOf(rows: number, columns: number): void {
    Object.assign(process.stderr, { rows, columns });
  }

  function recover(options: Record<string, string | boolean>): Promise<void> {
    return runRecoverWord({ "ask-secrets": true, ...options });
  }

  /** The prompts shown, in order. */
  function promptsShown(): string[] {
    return [
      ...screen.matchAll(
        /(Seed phrase, \? for each forgotten word:|Passphrase for the candidates list:|The same passphrase again:)/gu,
      ),
    ].map((match) => match[1]!);
  }

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
    expect(notices).toEqual(
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
    expect(notices).toEqual(
      expect.arrayContaining([
        "More than 524,288 candidates, more than one list holds: give more of the words, or a few letters of them.",
        `Saved 128 candidate phrases, NOT encrypted: ${path} (record N is candidate N).`,
      ]),
    );
  });

  it("lets Ctrl+C at the list's passphrase cancel at once", async () => {
    terminal.answers = [`${LAST_FORGOTTEN}\r`, "public\x03"];
    await expect(recover({ "candidates-file": join(directory, "c.age") })).rejects.toBeInstanceOf(
      InputCancelled,
    );
    expect(notices.join("\n")).not.toContain("Try again");
  });

  it("offers to type the words again when no phrase fits them", async () => {
    terminal.answers = [`${ELEVEN}abandon|ability\r`, `${LAST_FORGOTTEN}\r`];
    terminal.choices = ["Type the words again"];
    await recover({});
    expect(notices).toContain(
      "No valid phrase fits these words: check them, their order and the ? places.",
    );
    expect(terminal.questions).toEqual(["What now?"]);
    expect(out).toHaveLength(129);
  });

  it("says that ? is no word for the legacy last word, and asks again", async () => {
    const legacy =
      "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";
    terminal.answers = [`${legacy.replace(/hospital$/u, "?")}\r`, `${legacy}\r`];
    await recover({ "legacy-valid-last-word": true });
    expect(notices).toContain(
      "This mode needs the exact old final word: ? stands for no word here.",
    );
    expect(out).toHaveLength(129);
  });

  it("offers a wallet check when the candidates are too many to show", async () => {
    terminal.answers = [`a* ${"abandon ".repeat(10)}?\r`];
    terminal.choices = ["Done"];
    await recover({});
    expect(notices.some((line) => line.includes("candidates are too many to show"))).toBe(true);
    expect(terminal.questions).toEqual(["What now?"]);
    expect(out).toEqual([]);
  });

  it("offers a wallet check when the candidates do not fit on the screen", async () => {
    // As the final review typed it: a word missing from 11 words gives 1,497 candidates, and a
    // window of 40 rows, without scrollback, would show only the last of them.
    terminal.stdoutTerminal = true;
    windowOf(40, 80);
    terminal.answers = [`${"abandon ".repeat(10)}about\r`, `${FINGERPRINT}\r`];
    terminal.choices = ["Check them against the wallet", "Fingerprint"];
    await recover({ "missing-word": true });
    expect(notices).toContain(
      "1,497 candidates do not fit on this screen: check them against the wallet's fingerprint or an address, or give a few letters of the words.",
    );
    expect(terminal.questions).toEqual(["What now?", "How can MnemoCode recognise the wallet?"]);
    // Then only the candidate of the wallet is shown, with its number among all of them.
    expect(out.filter((line) => !line.startsWith("candidate\t"))).toEqual([
      expect.stringMatching(/^\d+\t\d+\tabandon\t1\tmatched at m\t(abandon ){11}about$/u),
    ]);
  });

  it("shows every candidate that fits in the window, also in a file", async () => {
    // 128 rows of two lines each fit in a window of 300 rows, but not in one of 40.
    terminal.stdoutTerminal = true;
    windowOf(300, 80);
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    await recover({});
    expect(out).toHaveLength(129);
    expect(terminal.questions).toEqual([]);

    out = [];
    windowOf(40, 80);
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    terminal.choices = ["Done"];
    await recover({});
    expect(out).toEqual([]);
    expect(terminal.questions).toEqual(["What now?"]);

    // Standard output in a file keeps every row, whatever the window.
    out = [];
    terminal.stdoutTerminal = false;
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    await recover({});
    expect(out).toHaveLength(129);
  });

  it("lets the wallet change when none of the candidates matched it", async () => {
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${FINGERPRINT}\r`];
    terminal.choices = ["Change the wallet", "Fingerprint"];
    await recover({ "master-fingerprint": "00000000" });
    expect(notices).toEqual(
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
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${FINGERPRINT}\r`];
    terminal.choices = ["Change the wallet", "Fingerprint"];
    const wrongWallet = { "plaintext-candidates": true, "master-fingerprint": "00000000" };
    await recover({ "candidates-file": path, ...wrongWallet });
    const saved = (line: string) => line.startsWith("Saved ");
    expect(notices.filter((line) => saved(line) || line.startsWith("Matched "))).toEqual([
      "Matched 0 of 128 candidates against the requested master fingerprint locally.",
      `Saved 128 candidate phrases, NOT encrypted: ${path} (record N is candidate N).`,
      "Matched 1 of 128 candidates against the requested master fingerprint locally.",
    ]);
    expect(notices.join("\n")).not.toContain("could not be saved");
    expect(decodeCandidateList(await readFile(path)).records).toHaveLength(128);

    // Other words: only their candidates are saved, when the person is done (Escape).
    notices = [];
    terminal.questions = [];
    const other = join(directory, "other.mncl");
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${ELEVEN}about|abandon\r`];
    terminal.choices = ["Type the words again"];
    await recover({ "candidates-file": other, ...wrongWallet });
    expect(notices.filter(saved)).toEqual([
      `Saved 1 candidate phrase, NOT encrypted: ${other} (record N is candidate N).`,
    ]);
    expect(decodeCandidateList(await readFile(other)).records).toHaveLength(1);
    expect(terminal.questions).toEqual(["What now?", "What now?"]);
  });

  it("keeps the candidates when the list cannot be saved: try again, another name, or skip", async () => {
    const path = join(directory, "first.mncl");
    const other = join(directory, "other.mncl");
    terminal.saveFailures = 1;
    terminal.answers = [`${LAST_FORGOTTEN}\r`, `${other}\r`];
    terminal.choices = ["Another file name"];
    await recover({ "candidates-file": path, "plaintext-candidates": true });
    expect(notices).toEqual(
      expect.arrayContaining([
        `The candidate list could not be saved as ${path}: there is no permission to write there.`,
        `Saved 128 candidate phrases, NOT encrypted: ${other} (record N is candidate N).`,
      ]),
    );
    expect(decodeCandidateList(await readFile(other)).records).toHaveLength(128);

    notices = [];
    terminal.saveFailures = 2;
    terminal.answers = [`${LAST_FORGOTTEN}\r`];
    terminal.choices = ["Try again", "Skip"];
    await recover({
      "candidates-file": join(directory, "skipped.mncl"),
      "plaintext-candidates": true,
    });
    expect(notices).toContain("The candidate list was not saved.");
    expect(out.filter((line) => line.startsWith("candidate\t"))).toHaveLength(2);

    // Off the private screen the failure ends the command, as before.
    terminal.privateScreen = false;
    terminal.saveFailures = 1;
    await expect(
      runRecoverWord({
        mnemonic: LAST_FORGOTTEN,
        "candidates-file": join(directory, "plain.mncl"),
        "plaintext-candidates": true,
      }),
    ).rejects.toThrow("EACCES");
  });
});
