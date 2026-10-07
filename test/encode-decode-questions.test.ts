import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Encode, decode and the backup check with --ask-secrets on the private screen, with the terminal
// replaced: each question that reads a line takes the next of `terminal.answers`, as a terminal in
// raw mode delivers it (a lone Escape goes back), and each list question (choose) the next of
// `terminal.choices`, or Escape when none is left. `terminal.saveFailures` makes that many saves
// fail as a full disk would. Standard output is a terminal only with `terminal.stdoutTerminal`;
// the private screen then shows what fits in the window, which windowOf sets. Nothing reads the
// real terminal.
const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
  /** The labels of each list question, in order. */
  labels: [] as string[][],
  /** The notes of each list question's entries, in order. */
  notes: [] as (string | undefined)[][],
  /** What Escape does at each list question, as its key hint says. */
  escapes: [] as (string | undefined)[],
  saveFailures: 0,
  stdoutTerminal: false,
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 1 && terminal.stdoutTerminal,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => true,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  return {
    ...actual,
    terminalAvailable: () => true,
    withRawTerminal: async <T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ) => {
      const bytes = [...Buffer.from(terminal.answers.shift() ?? "", "utf8")];
      return body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
    },
    // The search watches no terminal here.
    withCtrlCWatch: <T>(search: (signal: AbortSignal) => Promise<T>) =>
      search(new AbortController().signal),
  };
});
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (
    question: string,
    choices: readonly { readonly label: string; readonly note?: string }[],
    options: { readonly quit?: string },
  ) => {
    recordCutNotes(question, choices as never);
    terminal.questions.push(question);
    terminal.labels.push(choices.map((choice) => choice.label));
    terminal.notes.push(choices.map((choice) => choice.note));
    terminal.escapes.push(options.quit);
    return terminal.choices.shift();
  },
}));
vi.mock("../src/cli/encode-export.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/encode-export.js")>();
  return {
    ...actual,
    saveEncodeResult: async (...save: Parameters<typeof actual.saveEncodeResult>) => {
      if (terminal.saveFailures > 0) {
        terminal.saveFailures -= 1;
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
          code: "ENOSPC",
        });
      }
      return actual.saveEncodeResult(...save);
    },
  };
});

import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  parseDate,
  representMnemonic,
} from "../src/core.js";
import { backupCheckAnswer, offerEncodedCheck, offerShareCheck } from "../src/cli/backup-check.js";
import { runDecode } from "../src/cli/decode-command.js";
import { exportQrPayload } from "../src/cli/qr-export.js";
import { runEncode } from "../src/cli/encode-command.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { promptedEncodeInputs } from "../src/cli/input.js";
import { InputCancelled } from "../src/cli/terminal-input.js";
import { bytewords } from "../src/sskr/bytewords-list.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { writeShare } from "../src/sskr/transport.js";
import { recordCutNotes, takeCutNotes } from "./helpers/cut-notes.js";

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
const FINGERPRINT = "73c5da0a";
const DATE = "23-09-2026";
/** The test phrase masked with MnemoCode Seedshift and 23-09-2026, as word numbers. */
const MASKED = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";
/** The fingerprint of MASKED read as a phrase itself, as encode shows it ("Encoded fingerprint"). */
const ENCODED_FINGERPRINT = "0d05289e";
/** The test phrase masked with the Original Seedshift and 23-09-2026, as word numbers. */
const LEGACY = formatEncoded(encodeMnemonicLegacy(TEST_PHRASE, [parseDate(DATE)]), "indexes");
const ESCAPE = "\x1b";
const SEED_PROMPT = "Seed phrase (English BIP39 words):";
const DATES_PROMPT = "Dates (up to 4, DD-MM-YYYY, separated by spaces):";
const DECODE_DATES_PROMPT =
  "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):";
const WALLET_QUESTION = "How can MnemoCode recognise the wallet?";
/** The start of a share as a UR, before its minimal bytewords. */
const SSKR_UR_PREFIX = "ur:sskr/";
/** The size of the pseudo-terminal of scripts/verify-terminal-input.py. */
const TERMINAL_ROWS = 40;
const TERMINAL_COLUMNS = 80;

describe("encode, decode and the backup check on the private screen", () => {
  let screen: string;
  let out: string[];
  let notices: string[];
  beforeEach(() => {
    terminal.answers = [];
    terminal.choices = [];
    terminal.questions = [];
    terminal.labels = [];
    terminal.notes = [];
    terminal.escapes = [];
    terminal.saveFailures = 0;
    terminal.stdoutTerminal = false;
    screen = "";
    out = [];
    notices = [];
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // The window size that a test gave standard error.
    delete (process.stderr as { rows?: number }).rows;
    delete (process.stderr as { columns?: number }).columns;
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });

  /** Gives standard error the size of a terminal window, as a test of what fits on it needs. */
  function windowOf(rows: number, columns: number): void {
    Object.assign(process.stderr, { rows, columns });
  }

  /** Where each of `prompts` appears on the screen, in order. */
  function promptsShown(...prompts: string[]): string[] {
    const pattern = new RegExp(
      prompts.map((prompt) => prompt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"),
      "gu",
    );
    return [...screen.matchAll(pattern)].map((match) => match[0]);
  }

  describe("encode", () => {
    it("asks for the seed phrase again before the dates, and then for the dates alone", async () => {
      terminal.answers = [
        `${"abandon ".repeat(11)}abandonn\r`,
        `${"abandon ".repeat(12)}\r`,
        `  ${TEST_PHRASE.toUpperCase()}  \r`,
        "23-9-2026\r",
        "23-09-2026 24-09-2026 25-09-2026 26-09-2026 27-09-2026\r",
        "2?-09-2026\r",
        "31-09-2026\r",
        `${DATE}\r`,
      ];
      const inputs = await promptedEncodeInputs({ "ask-secrets": true }, "seedshift");
      expect(inputs).toEqual({ mnemonic: TEST_PHRASE, dates: [parseDate(DATE)] });
      expect(notices).toEqual([
        "Unknown English BIP39 word at position 12.",
        "These words fail the BIP39 checksum: check each word and their order.",
        "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
        "12-word phrases support at most 4 dates.",
        "? and | stand for what is forgotten only where MnemoCode can search dates; type every date in full.",
        "Date 1: the day is outside the selected calendar month.",
      ]);
      expect(promptsShown(SEED_PROMPT, DATES_PROMPT)).toEqual([
        SEED_PROMPT,
        SEED_PROMPT,
        SEED_PROMPT,
        ...Array.from({ length: 5 }, () => DATES_PROMPT),
      ]);
      // No warning repeats what was typed.
      expect(notices.join("\n")).not.toMatch(/abandon|23-9-2026|31-09/u);
    });

    it("asks no dates without Seedshift, and wants a date for each event label", async () => {
      terminal.answers = [`${TEST_PHRASE}\r`];
      expect(await promptedEncodeInputs({ "ask-secrets": true }, "direct")).toEqual({
        mnemonic: TEST_PHRASE,
        dates: [],
      });
      terminal.answers = [`${TEST_PHRASE}\r`, `${DATE}\r`, `${DATE} 24-09-2026\r`];
      const inputs = await promptedEncodeInputs(
        { "ask-secrets": true, event: ["Wedding", "Trip"] },
        "seedshift",
      );
      expect(inputs?.dates).toHaveLength(2);
      expect(notices).toEqual(["There are 2 event labels (--event): type a date for each."]);
    });

    it("keeps the result when a file cannot be saved, and saves it under another name", async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-save-"));
      try {
        const record = join(directory, "record.txt");
        const other = join(directory, "other.txt");
        terminal.saveFailures = 2;
        terminal.answers = [`${TEST_PHRASE}\r`, `${DATE}\r`, ESCAPE, `'${other}'\r`];
        // Try again (it fails again), another name, Escape there (back to the choice, nothing is
        // saved), another name again; the backup check is not wanted.
        terminal.choices = ["again", "other", "other"];
        await runEncode({
          "ask-secrets": true,
          mode: "seedshift",
          format: "indexes",
          output: record,
        });
        expect(out).toContain(MASKED);
        expect(
          notices.filter(
            (line) => line === `The record could not be saved as ${record}: the disk is full.`,
          ),
        ).toHaveLength(2);
        expect(terminal.questions).toEqual([
          "What now?",
          "What now?",
          "What now?",
          "Check the backup now?",
        ]);
        expect(terminal.labels[0]).toEqual(["Try again", "Another file name", "Skip"]);
        expect(promptsShown("New name for the record:")).toHaveLength(2);
        expect(notices).toContain(`Saved MnemoCode record: ${other}`);
        // The quotes of a dragged file name are not part of it.
        expect(await readFile(other, "utf8")).toBe(`MNC1:seedshift:indexes:${MASKED}\n`);
        await expect(readFile(record, "utf8")).rejects.toThrow();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("goes on after a file is skipped", async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-save-"));
      try {
        terminal.saveFailures = 1;
        terminal.answers = [`${TEST_PHRASE}\r`];
        terminal.choices = ["skip"];
        await runEncode({
          "ask-secrets": true,
          mode: "direct",
          format: "indexes",
          output: join(directory, "record.txt"),
          qr: join(directory, "qr.png"),
        });
        expect(notices).toContain("The record was not saved.");
        expect(notices.filter((line) => line.startsWith("Saved"))).toEqual([
          `Saved QR code (indexes): ${join(directory, "qr.png")}`,
        ]);
        expect(terminal.questions).toEqual(["What now?", "Check the backup now?"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("refuses cards that cannot be printed before the seed phrase is asked", async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-cards-"));
      try {
        await expect(
          runEncode({
            "ask-secrets": true,
            mode: "direct",
            format: "5",
            pdf: join(directory, "cards.pdf"),
            "page-size": "business",
            "card-qr": true,
          }),
        ).rejects.toThrow("A QR code is printed on a sheet only");
        // A detail typed for the cards that does not fit them.
        await expect(
          runEncode({
            "ask-secrets": true,
            mode: "direct",
            format: "5",
            pdf: join(directory, "cards.pdf"),
            "card-company": "Northwind ".repeat(9).trim(),
          }),
        ).rejects.toThrow(/too long/u);
        expect(screen).not.toContain(SEED_PROMPT);

        // Cards that can be printed are, after the seed phrase.
        const pdf = join(directory, "sheet.pdf");
        terminal.answers = [`${TEST_PHRASE}\r`];
        await runEncode({ "ask-secrets": true, mode: "direct", format: "5", pdf, "card-qr": true });
        expect(promptsShown(SEED_PROMPT)).toHaveLength(1);
        expect((await readFile(pdf)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("refuses a wrong date with the words that the dates of a search use", async () => {
      const wrong = [
        "23-9-2026",
        "1-1-1 2-2-2 3-3-3 4-4-4 5-5-5",
        "2?-09-2026",
        "31-09-2026",
        "23-09-2026 30-02-2026",
        "23-09-26",
      ];
      terminal.answers = [`${TEST_PHRASE}\r`, ...wrong.map((line) => `${line}\r`), `${DATE}\r`];
      await promptedEncodeInputs({ "ask-secrets": true }, "seedshift");
      // Encode takes the core's rules (DatesAnswer.parse without ?), as every search does.
      const searched = wrong.map((line) => {
        try {
          DatesAnswer.parse(line, { wordCount: 12, patterns: false });
          return "accepted";
        } catch (error) {
          return (error as Error).message;
        }
      });
      expect(searched).not.toContain("accepted");
      expect(notices).toEqual(searched);
    });
  });

  describe("decode", () => {
    it("asks for a mistyped date again and keeps the codes", async () => {
      terminal.answers = [
        `${MASKED}\r`,
        "23-9-2026\r",
        "23-09-2026 24-09-2026 1-1-1 2-2-2 3-3-3\r",
        `${DATE}\r`,
      ];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      expect(out).toEqual([TEST_PHRASE]);
      expect(notices).toEqual(
        expect.arrayContaining([
          "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
          "12-word phrases support at most 4 dates.",
        ]),
      );
      expect(promptsShown("Encoded seed phrase or record:", DECODE_DATES_PROMPT)).toEqual([
        "Encoded seed phrase or record:",
        DECODE_DATES_PROMPT,
        DECODE_DATES_PROMPT,
        DECODE_DATES_PROMPT,
      ]);
      expect(notices.join("\n")).not.toContain("23-9-2026");
    });

    it("finds a code that cannot be read by the encoded fingerprint, then decodes it", async () => {
      const codes = MASKED.split(" ");
      codes[5] = "?";
      terminal.answers = [`${codes.join(" ")}\r`, `${ENCODED_FINGERPRINT}\r`, `${DATE}\r`];
      terminal.choices = ["encoded"];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      expect(terminal.questions).toEqual(["How can MnemoCode tell the right codes?"]);
      expect(terminal.labels[0]).toEqual(["Encoded fingerprint", "The wallet"]);
      expect(notices).toContain("Code 6 cannot be read: 2,048 combinations, about 128 candidates.");
      expect(notices).toContain(`✓ Code 6 found: ${MASKED}`);
      expect(out).toEqual([TEST_PHRASE]);
    });

    it("finds a code and a forgotten date digit together by the wallet", async () => {
      const codes = MASKED.split(" ");
      codes[5] = "?";
      terminal.answers = [`${codes.join(" ")}\r`, "2?-09-2026\r", `${FINGERPRINT}\r`];
      terminal.choices = ["wallet", "fingerprint"];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      expect(terminal.questions).toEqual([
        "How can MnemoCode tell the right codes?",
        WALLET_QUESTION,
      ]);
      expect(notices).toContain(`✓ Dates found: ${DATE}`);
      expect(out).toEqual([TEST_PHRASE]);
    });

    it("sends a Shamir share typed for the codes to the restore, the share kept", async () => {
      const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
      const shares = await splitSskrMnemonic(masked, 2, 3);
      const first = writeShare(shares[0]!, "indexes").split(" ");
      first[6] = "?";
      terminal.answers = [
        `${first.join(" ")}\r`,
        `${writeShare(shares[1]!, "indexes")}\r`,
        `${DATE}\r`,
      ];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      // Surely a share: it goes to the restore at once, kept as the first share.
      expect(terminal.questions).toEqual([]);
      expect(notices).toContain(
        'These are the codes of a Shamir share: they go to "Restore a seed phrase from Shamir shares" as its first share.',
      );
      expect(out.at(-1)).toBe(TEST_PHRASE);
    });

    it("keeps a share read from a QR code image, shows it, and offers the next from one", async () => {
      const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
      const shares = await splitSskrMnemonic(masked, 2, 3);
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-share-qr-"));
      try {
        const [first, second] = [0, 1].map((index) => join(directory, `share ${index + 1}.png`));
        await exportQrPayload(writeShare(shares[0]!, "indexes"), first!);
        await exportQrPayload(writeShare(shares[1]!, "indexes"), second!);
        terminal.answers = [`'${second}'\r`, `${DATE}\r`];
        terminal.choices = ["qr"];
        await runDecode({ "ask-secrets": true, mode: "seedshift", "qr-file": first! });
        expect(terminal.questions).toEqual(["The next share?"]);
        expect(terminal.labels[0]).toEqual(["Read another QR code image", "Type the shares"]);
        expect(notices).toContain(
          `✓ Share 1, from its QR code: ${writeShare(shares[0]!, "indexes")}`,
        );
        expect(notices).toContain(
          `✓ Share 2, from its QR code: ${writeShare(shares[1]!, "indexes")}`,
        );
        expect(out.at(-1)).toBe(TEST_PHRASE);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("takes the answers of its options instead of asking them", async () => {
      const codes = MASKED.split(" ");
      codes[5] = "?";
      // The encoded fingerprint tells the codes; nothing is asked but the codes and the dates.
      terminal.answers = [`${codes.join(" ")}\r`, `${DATE}\r`];
      await runDecode({
        "ask-secrets": true,
        mode: "seedshift",
        "encoded-fingerprint": ENCODED_FINGERPRINT,
      });
      expect(terminal.questions).toEqual([]);
      expect(out).toEqual([TEST_PHRASE]);
      // The wallet of the options tells the codes and the dates together.
      out = [];
      terminal.answers = [`${codes.join(" ")}\r`, "2?-09-2026\r"];
      await runDecode({
        "ask-secrets": true,
        mode: "seedshift",
        "master-fingerprint": FINGERPRINT,
      });
      expect(terminal.questions).toEqual([]);
      expect(notices).toContain(`✓ Dates found: ${DATE}`);
      expect(out).toEqual([TEST_PHRASE]);
      // A wallet given for dates with ?, and --list-candidates for the Original Seedshift.
      out = [];
      terminal.answers = [`${MASKED}\r`, "2?-09-2026\r"];
      await runDecode({
        "ask-secrets": true,
        mode: "seedshift",
        "master-fingerprint": FINGERPRINT,
      });
      expect(out).toEqual([`${DATE}\t${TEST_PHRASE}\tmatched at m`]);
      out = [];
      windowOf(TERMINAL_ROWS, TERMINAL_COLUMNS);
      terminal.answers = [`${LEGACY}\r`, "2?-09-2026\r"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy", "list-candidates": true });
      expect(terminal.questions).toEqual([]);
      expect(out).toContain(`${DATE}\t${TEST_PHRASE}`);
    });

    it("tells codes without Seedshift by --encoded-fingerprint, the wallet's own", async () => {
      const direct = formatEncoded(representMnemonic(TEST_PHRASE), "indexes").split(" ");
      direct[3] = "?";
      terminal.answers = [`${direct.join(" ")}\r`];
      await runDecode({ "ask-secrets": true, mode: "direct", "encoded-fingerprint": FINGERPRINT });
      expect(terminal.questions).toEqual([]);
      expect(notices.join("\n")).not.toContain("cannot tell these codes");
      expect(out).toEqual([TEST_PHRASE]);
    });

    it("restores from a share without asking with --input-kind share", async () => {
      const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
      const shares = await splitSskrMnemonic(masked, 2, 3);
      terminal.answers = [
        `${writeShare(shares[0]!, "indexes")}\r`,
        `${writeShare(shares[1]!, "indexes")}\r`,
        `${DATE}\r`,
      ];
      await runDecode({ "ask-secrets": true, mode: "seedshift", "input-kind": "share" });
      expect(terminal.questions).toEqual([]);
      expect(out.at(-1)).toBe(TEST_PHRASE);
    });

    it("refuses the answers of the private screen from the command line, and wrong values", async () => {
      await expect(
        runDecode({ mode: "seedshift", input: MASKED, date: [DATE], "list-candidates": true }),
      ).rejects.toThrow("--list-candidates answers a question of decode --ask-secrets");
      await expect(runDecode({ "ask-secrets": true, "input-kind": "both" })).rejects.toThrow(
        "--input-kind must be codes or share.",
      );
      await expect(
        runDecode({ "ask-secrets": true, "encoded-fingerprint": "1234" }),
      ).rejects.toThrow("A master fingerprint must be eight hexadecimal characters.");
      await expect(
        runDecode({
          "ask-secrets": true,
          "list-candidates": true,
          "master-fingerprint": FINGERPRINT,
        }),
      ).rejects.toThrow("--list-candidates lists the candidates instead of a wallet check.");
    });

    it("refuses before the first question what the share restore would refuse later", async () => {
      // Place options without a wallet, and --max-tries, which only a restore from shares reads.
      await expect(runDecode({ "ask-secrets": true, network: "testnet" })).rejects.toThrow(
        "--network applies to a wallet given as an option",
      );
      await expect(runDecode({ "ask-secrets": true, "max-tries": "abc" })).rejects.toThrow(
        "share repair search limit",
      );
      expect(terminal.questions).toEqual([]);
      expect(promptsShown("Encoded seed phrase or record:")).toEqual([]);
    });

    it("goes back from a share's Seedshift question to the codes, and says when a list cannot help", async () => {
      const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      // Escape at "Was Seedshift used before it was split?" asks for the codes again.
      terminal.answers = [`${writeShare(shares[0]!, "indexes")}\r`, `${MASKED}\r`, `${DATE}\r`];
      terminal.choices = [undefined, "seedshift"];
      await runDecode({ "ask-secrets": true });
      expect(terminal.questions[0]).toBe("Was Seedshift used before it was split?");
      expect(out).toEqual([TEST_PHRASE]);
      expect(promptsShown("Encoded seed phrase or record:")).toHaveLength(2);
      // --list-candidates where the codes have more candidates than a list shows.
      const codes = MASKED.split(" ");
      codes[11] = "?";
      notices = [];
      terminal.questions = [];
      terminal.answers = [`${codes.join(" ")}\r`, `${ENCODED_FINGERPRINT}\r`, `${DATE}\r`];
      terminal.choices = ["encoded"];
      await runDecode({ "ask-secrets": true, mode: "seedshift", "list-candidates": true });
      expect(notices).toContain(
        "--list-candidates lists at most 16 candidates; these codes have about 128 candidates.",
      );
    });

    it("searches dates with ?, asking for the wallet first when the mode needs it", async () => {
      terminal.answers = [`${MASKED}\r`, "2?-09-2026\r", `${FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      expect(terminal.questions).toEqual([WALLET_QUESTION]);
      // Every guessed date gives a valid phrase: only the wallet tells the right one.
      expect(terminal.labels[0]).toEqual([
        "Fingerprint",
        "Bitcoin address",
        "Address of another coin",
      ]);
      expect(out).toEqual([`${DATE}\t${TEST_PHRASE}\tmatched at m`]);
      expect(notices).toContain("Recovery search contains 10 date combinations.");
    });

    it("offers the wallet to the Original Seedshift's search, and lists every candidate without", async () => {
      windowOf(TERMINAL_ROWS, TERMINAL_COLUMNS);
      terminal.answers = [`${LEGACY}\r`, "2?-09-2026\r"];
      terminal.choices = ["none"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      // The checksum leaves only some dates: the wallet may be left out, as for recover-date.
      expect(terminal.questions).toEqual([WALLET_QUESTION]);
      expect(terminal.labels[0]).toEqual([
        "Fingerprint",
        "Bitcoin address",
        "Address of another coin",
        "It cannot",
      ]);
      expect(out).toContain(`${DATE}\t${TEST_PHRASE}`);

      // With the wallet, only the phrase of the wallet is shown.
      out = [];
      terminal.answers = [`${LEGACY}\r`, "2?-09-2026\r", `${FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(out).toEqual([`${DATE}\t${TEST_PHRASE}\tmatched at m`]);
    });

    it("offers the wallet when the candidates do not fit in the window", async () => {
      terminal.stdoutTerminal = true;
      windowOf(TERMINAL_ROWS, TERMINAL_COLUMNS);
      // Dates with three ?, as the final review typed them: 893 date combinations.
      terminal.answers = [`${LEGACY}\r`, "2?-0?-202?\r", `${FINGERPRINT}\r`];
      terminal.choices = ["none", "wallet", "fingerprint"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(notices).toContain("Recovery search contains 893 date combinations.");
      expect(terminal.questions).toEqual([
        WALLET_QUESTION,
        "Not every candidate fits on the screen. What now?",
        WALLET_QUESTION,
      ]);
      expect(terminal.labels[1]).toEqual([
        "Check them against the wallet",
        "Change the dates",
        "Done",
      ]);
      // The candidates listed first are more than the window holds; the wallet picks one.
      const listed = out.filter((line) => /^\d{2}-\d{2}-\d{4}\t/u.test(line));
      expect(listed.length).toBeGreaterThan(TERMINAL_ROWS);
      expect(out.at(-1)).toBe(`${DATE}\t${TEST_PHRASE}\tmatched at m`);
      // The dates were typed once.
      expect(promptsShown(DECODE_DATES_PROMPT)).toHaveLength(1);

      // Standard output in a file takes every candidate, as recover-date's does.
      terminal.stdoutTerminal = false;
      terminal.questions = [];
      terminal.answers = [`${LEGACY}\r`, "2?-0?-202?\r"];
      terminal.choices = ["none"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(terminal.questions).toEqual([WALLET_QUESTION]);
    });

    it("keeps 'It cannot' when the dates are changed after too many candidates", async () => {
      terminal.stdoutTerminal = true;
      windowOf(TERMINAL_ROWS, TERMINAL_COLUMNS);
      terminal.answers = [`${LEGACY}\r`, "2?-0?-202?\r", "2?-09-2026\r"];
      terminal.choices = ["none", "dates"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      // The wallet is not asked again for the new dates, and their candidates fit.
      expect(terminal.questions).toEqual([
        WALLET_QUESTION,
        "Not every candidate fits on the screen. What now?",
      ]);
      expect(out).toContain(`${DATE}\t${TEST_PHRASE}`);
      expect(promptsShown(DECODE_DATES_PROMPT)).toHaveLength(2);
    });

    it("offers the dates or the codes again after a result without a valid checksum", async () => {
      // A wrong date gives the Original Seedshift's phrase an invalid checksum.
      terminal.answers = [`${LEGACY}\r`, "24-09-2026\r", `${DATE}\r`];
      terminal.choices = ["dates"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(terminal.questions).toEqual(["What now?"]);
      expect(terminal.labels[0]).toEqual([
        "Type the dates again",
        "Type the encoded seed phrase again",
        "Done",
      ]);
      expect(out.at(-1)).toBe(TEST_PHRASE);
      expect(notices).toContain("BIP39 checksum: valid.");
      // The codes were typed once.
      expect(promptsShown("Encoded seed phrase or record:")).toHaveLength(1);
    });

    it("keeps the dates when the codes are typed again, and ends when the person is done", async () => {
      const wrong = LEGACY.replace(/^\d+/u, (first) => String((Number(first) % 2048) + 1));
      terminal.answers = [`${wrong}\r`, `${DATE}\r`, `${LEGACY}\r`];
      terminal.choices = ["backup"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(out.at(-1)).toBe(TEST_PHRASE);
      expect(promptsShown(DECODE_DATES_PROMPT)).toHaveLength(1);

      terminal.answers = [`${wrong}\r`, `${DATE}\r`];
      terminal.choices = [];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(terminal.questions).toEqual(["What now?", "What now?"]);
    });

    it("keeps a record's mode when the codes are typed after the record file", async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-decode-"));
      try {
        const file = join(directory, "record.txt");
        await writeFile(file, `MNC1:seedshift-legacy:indexes:${LEGACY}\n`);
        // A wrong date, then the codes typed without the header, then the right date.
        terminal.answers = ["24-09-2026\r", `${LEGACY}\r`, `${DATE}\r`];
        terminal.choices = ["backup", "dates"];
        await runDecode({ "ask-secrets": true, "input-file": file });
        expect(terminal.labels).toEqual([
          ["Type the dates again", "Type the encoded seed phrase", "Done"],
          // Still the Original Seedshift: the codes typed alone were not taken as unmasked.
          ["Type the dates again", "Type the encoded seed phrase again", "Done"],
        ]);
        expect(out.at(-1)).toBe(TEST_PHRASE);
        // The date typed first was kept for the codes typed again.
        expect(promptsShown(DECODE_DATES_PROMPT)).toHaveLength(2);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("shows the encoded fingerprint by the rule of encode: when the codes are a valid phrase", async () => {
      // 16-09-2026, a public date, happens to give the Original Seedshift's codes of the test
      // phrase a valid checksum, which it gives once in 16 for 12 words; 23-09-2026 does not.
      await runEncode({
        mnemonic: TEST_PHRASE,
        mode: "seedshift-legacy",
        format: "indexes",
        date: ["16-09-2026"],
      });
      const encodedLine = notices.find((line) => line.startsWith("Encoded BIP32"))!;
      expect(encodedLine).toMatch(
        /^Encoded BIP32 master fingerprint of the masked phrase \(empty BIP39 passphrase\): [0-9a-f]{8}$/u,
      );
      const codes = out.at(-1)!;
      notices = [];
      out = [];
      terminal.answers = [`${codes}\r`, "16-09-2026\r"];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(notices).toContain(encodedLine);
      expect(out.at(-1)).toBe(TEST_PHRASE);

      notices = [];
      await runEncode({ mnemonic: TEST_PHRASE, mode: "seedshift-legacy", date: [DATE] });
      expect(notices).toContain(
        "Encoded BIP32 master fingerprint: unavailable because legacy Seedshift output may have an invalid BIP39 checksum.",
      );
      notices = [];
      terminal.answers = [`${LEGACY}\r`, `${DATE}\r`];
      await runDecode({ "ask-secrets": true, mode: "seedshift-legacy" });
      expect(notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
    });

    it("asks about Seedshift again for codes typed again after an answer given on the screen", async () => {
      const seedshift = "Was Seedshift used when it was encoded?";
      // The Original Seedshift's codes, said to be not masked: the checksum fails, and the codes
      // typed again are asked about again rather than read as not masked once more.
      terminal.answers = [`${LEGACY}\r`, `${LEGACY}\r`, `${DATE}\r`];
      terminal.choices = ["direct", "backup", "seedshift-legacy"];
      await runDecode({ "ask-secrets": true });
      expect(terminal.questions).toEqual([seedshift, "What now?", seedshift]);
      expect(out.at(-1)).toBe(TEST_PHRASE);

      // MnemoCode Seedshift's codes with a typo, taken for the Original Seedshift's: typed again
      // correctly, they are asked about again, and the date typed first is kept.
      const typo = MASKED.replace(/ 24 /u, " 25 ");
      out = [];
      screen = "";
      terminal.questions = [];
      terminal.answers = [`${typo}\r`, `${DATE}\r`, `${MASKED}\r`];
      terminal.choices = ["seedshift", "legacy", "backup", "seedshift"];
      await runDecode({ "ask-secrets": true });
      expect(terminal.questions).toEqual([
        seedshift,
        "These codes lack the BIP39 checksum that MnemoCode Seedshift gives them.",
        "What now?",
        seedshift,
      ]);
      expect(out.at(-1)).toBe(TEST_PHRASE);
      expect(promptsShown(DECODE_DATES_PROMPT)).toHaveLength(1);
      expect(notices).toContain(
        `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${ENCODED_FINGERPRINT}`,
      );
    });

    it("shows the encoded fingerprint once the codes are checked, before the dates", async () => {
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      expect(out).toEqual([TEST_PHRASE]);
      const fingerprintLine = `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${ENCODED_FINGERPRINT}`;
      expect(notices).toContain(fingerprintLine);
      // Shown before the question for the dates.
      const shownAt = vi
        .mocked(console.error)
        .mock.calls.findIndex((line) => line.join(" ") === fingerprintLine);
      const askedAt = vi.mocked(process.stderr.write).mock.calls.findIndex(([chunk]) =>
        Buffer.from(chunk as Uint8Array)
          .toString("utf8")
          .includes(DECODE_DATES_PROMPT),
      );
      expect(vi.mocked(console.error).mock.invocationCallOrder[shownAt]).toBeLessThan(
        vi.mocked(process.stderr.write).mock.invocationCallOrder[askedAt]!,
      );

      // Not for codes without the BIP39 checksum, as the Original Seedshift's usually are, and not
      // without Seedshift, whose result shows the same fingerprint.
      for (const [codes, mode] of [
        [LEGACY, "seedshift-legacy"],
        [MASKED, "direct"],
      ] as const) {
        notices = [];
        terminal.answers = [`${codes}\r`, `${DATE}\r`];
        await runDecode({ "ask-secrets": true, mode });
        expect(notices.join("\n")).not.toContain("Encoded BIP32 master fingerprint");
      }
    });

    it("shows the encoded fingerprint as encode does on a colour terminal", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      const plain = notices.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      expect(plain).toEqual(
        expect.arrayContaining([
          `✓ Encoded fingerprint (of the masked phrase) ${ENCODED_FINGERPRINT}`,
          "Fingerprint uses an empty BIP39 passphrase.",
        ]),
      );
    });

    it("shows the decoded phrase numbered, and its fingerprint apart, on a colour terminal", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await runDecode({ "ask-secrets": true, mode: "seedshift" });
      const shown = out.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const parts = [
        "\nMnemoCode · Recovered result",
        "\nThe original seed phrase, the wallet's",
        "    1. abandon      2. abandon      3. abandon      4. abandon",
        "    9. abandon     10. abandon     11. abandon     12. about",
        "On one line, for copying:",
        TEST_PHRASE,
        `Original fingerprint  ${FINGERPRINT}  (empty BIP39 passphrase)`,
      ];
      const places = parts.map((part) => shown.indexOf(part));
      expect(places).not.toContain(-1);
      expect(places).toEqual([...places].sort((a, b) => a - b));
    });

    it("asks whether Seedshift was used for typed codes without --mode", async () => {
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      terminal.choices = ["seedshift"];
      await runDecode({ "ask-secrets": true });
      expect(terminal.questions).toEqual(["Was Seedshift used when it was encoded?"]);
      expect(terminal.labels[0]).toEqual(["No", "MnemoCode Seedshift", "Original Seedshift"]);
      expect(notices).toContain(
        "These codes have no MNC1 record header, so they do not say how they were made.",
      );
      expect(out).toEqual([TEST_PHRASE]);

      // No reads them as the words themselves; --mode direct, as the menu passes it, asks nothing.
      for (const [options, choices] of [
        [{}, ["direct"]],
        [{ mode: "direct" }, []],
      ] as const) {
        out = [];
        terminal.questions = [];
        terminal.answers = [`${MASKED}\r`];
        terminal.choices = [...choices];
        await runDecode({ "ask-secrets": true, ...options });
        expect(terminal.questions).toHaveLength(choices.length);
        expect(out).toEqual([
          "wool abuse actual wool abuse actual wool abuse actual wool abuse congress",
        ]);
      }
    });

    it("refuses an unknown mode or format before the first question", async () => {
      await expect(runDecode({ "ask-secrets": true, mode: "shifted" })).rejects.toThrow(
        "The transformation mode must be",
      );
      await expect(runDecode({ "ask-secrets": true, format: "9" })).rejects.toThrow(
        "The representation format must be one of",
      );
      await expect(
        runDecode({ "ask-secrets": true, "input-file": "a.txt", "qr-file": "b.png" }),
      ).rejects.toThrow("Choose one encoded input source");
      expect(screen).toBe("");
    });
  });

  describe("the backup check", () => {
    const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);
    const original = {
      mnemonic: TEST_PHRASE,
      format: "indexes" as const,
      mode: "seedshift" as const,
      codes: masked.shiftedIndexes,
      dates: [parseDate(DATE)],
    };

    it("names the codes and the date that differ, and asks only that part again", async () => {
      const codes = MASKED.split(" ");
      codes[2] = "25";
      terminal.answers = [
        "\r",
        "1 2 3\r",
        `${codes.join(" ")}\r`,
        `${MASKED}\r`,
        "24-09-2026\r",
        `${DATE}\r`,
      ];
      terminal.choices = [true, "again", "again"];
      await offerEncodedCheck(original, () => undefined);
      expect(notices).toEqual([
        "",
        "Type the codes you wrote down, or press Ctrl+C to stop.",
        "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
        "The code at place 3 differs from the result.",
        "Date 1 is not one of the dates of this backup.",
        "The backup restores this seed phrase.",
      ]);
      expect(terminal.labels[1]).toEqual([
        "Type the codes again",
        "Show the result again",
        "Stop checking",
      ]);
      expect(terminal.labels[2]![0]).toBe("Type the dates again");
      // The codes that fitted were not asked again with the dates.
      expect(promptsShown("Your backup, as written down:")).toHaveLength(4);
    });

    it("names the dates in the offer only where the backup has them, and Escape skips it", async () => {
      await offerEncodedCheck(original, () => undefined);
      const direct = representMnemonic(TEST_PHRASE).shiftedIndexes;
      await offerEncodedCheck(
        { mnemonic: TEST_PHRASE, format: "indexes", mode: "direct", codes: direct, dates: [] },
        () => undefined,
      );
      await offerShareCheck(TEST_PHRASE, "direct", 2, () => undefined);
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined);
      expect(terminal.notes.map((notes) => notes[0])).toEqual([
        "type the codes from what you wrote down, and the dates",
        "type the codes from what you wrote down",
        "type 2 shares from what you wrote down",
        "type 2 shares from what you wrote down, and the dates",
      ]);
      // Nothing came before the offer: Escape answers No.
      expect(terminal.escapes).toEqual(Array.from({ length: 4 }, () => "skips the check"));
      expect(promptsShown("Your backup, as written down:", "shares as written down")).toEqual([]);
    });

    it("takes the answer of --backup-check: no leaves the check out, yes starts it at once", async () => {
      await offerEncodedCheck(original, () => undefined, "no");
      await offerShareCheck(TEST_PHRASE, "direct", 2, () => undefined, "no");
      expect(terminal.notes).toEqual([]);
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await offerEncodedCheck(original, () => undefined, "yes");
      expect(notices).toContain("The backup restores this seed phrase.");
      // Only the first offer was answered; none was asked.
      expect(terminal.notes).toEqual([]);
      expect(() => backupCheckAnswer({ "backup-check": "maybe" })).toThrow(
        "--backup-check must be yes or no.",
      );
      // It answers a question of the private screen, which a record with a new last word lacks.
      expect(() => backupCheckAnswer({ "backup-check": "yes" })).toThrow(
        "--backup-check answers a question of --ask-secrets",
      );
      expect(() =>
        backupCheckAnswer({
          "backup-check": "no",
          "ask-secrets": true,
          "legacy-valid-last-word": true,
        }),
      ).toThrow("a record with a replaced last word cannot be checked");
    });

    it("shows the result again on request and then offers the check once more", async () => {
      const direct = formatEncoded(representMnemonic(TEST_PHRASE), "indexes");
      const wrong = direct.replace(/^\d+/u, "2");
      const show = vi.fn();
      terminal.answers = [`${wrong}\r`, `${direct}\r`];
      terminal.choices = [true, "show", true];
      await offerEncodedCheck(
        {
          mnemonic: TEST_PHRASE,
          format: "indexes",
          mode: "direct",
          codes: representMnemonic(TEST_PHRASE).shiftedIndexes,
          dates: [],
        },
        show,
      );
      expect(show).toHaveBeenCalledTimes(1);
      expect(terminal.questions).toEqual([
        "Check the backup now?",
        "What now?",
        "Check the backup now?",
      ]);
      expect(notices).toContain("The backup restores this seed phrase.");
    });

    it("types an unreadable share again alone, and keeps the others", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      terminal.answers = [
        `${shares[0]}\r`,
        `${shares[0]};not a share\r`,
        "still none\r",
        `${shares[2]}\r`,
        "24-09-2026\r",
        `${DATE}\r`,
      ];
      terminal.choices = [true, "again"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(notices.filter((line) => line !== "")).toEqual([
        "This is one share; type 2, separated by ;.",
        expect.stringMatching(/^Share 2 cannot be read: /u),
        expect.stringMatching(/^Share 2 cannot be read: /u),
        "Date 1 is not one of the dates of this backup.",
        "The backup restores this seed phrase.",
      ]);
      expect(promptsShown("Share 2 as written down:")).toHaveLength(2);
    });

    it("keeps an abbreviation at the start of a share's problem", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      // One byte of share 2 changed to another, a valid minimal byteword (its first and last
      // letters): the share reads, but its checksum does not match.
      const body = shares[1]!.slice(SSKR_UR_PREFIX.length);
      const at = 2 * 6;
      const pair = body.slice(at, at + 2);
      const other = bytewords.map((word) => `${word[0]}${word[3]}`).find((word) => word !== pair)!;
      const changed = `${SSKR_UR_PREFIX}${body.slice(0, at)}${other}${body.slice(at + 2)}`;
      terminal.answers = [`${shares[0]};${changed}\r`, `${shares[1]}\r`, `${DATE}\r`];
      terminal.choices = [true];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(notices.filter((line) => line !== "")).toEqual([
        "Share 2 cannot be read: SSKR transport checksum does not match.",
        "The backup restores this seed phrase.",
      ]);
    });

    it("tells shares of another phrase from wrong dates without the dates of the result", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "24-09-2026\r", `${DATE}\r`];
      terminal.choices = [true, "again"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined);
      expect(notices.filter((line) => line !== "")).toEqual([
        "The shares with these dates give another seed phrase: check the dates and the shares.",
        "The backup restores this seed phrase.",
      ]);

      const others = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      notices = [];
      terminal.answers = [`${others[0]};${others[1]}\r`];
      terminal.choices = [true];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(notices).toContain(
        "These shares restore another seed phrase: they are not of this backup.",
      );
    });

    it("stops at Ctrl+C inside the check", async () => {
      terminal.answers = ["12\x03"];
      terminal.choices = [true];
      await expect(offerEncodedCheck(original, () => undefined)).rejects.toBeInstanceOf(
        InputCancelled,
      );
    });
  });
});
