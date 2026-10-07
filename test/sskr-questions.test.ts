import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sskr-combine, sskr-export and sskr-split on the private screen, with the terminal replaced: each
// question that reads a line takes the next of `terminal.answers`, as a terminal in raw mode
// delivers it, and each list question (choose) the next of `terminal.choices`, or Escape when none
// is left. A save may be made to fail first (`terminal.failSaves`). Public test data only: the
// "abandon … about" phrase, its fingerprint 73c5da0a, and vectors/sskr-v1.json.
const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
  /** The labels of each list question, in order. */
  labels: [] as string[][],
  /**
   * In order: each list question, "drop" for each drop of the keys typed ahead, and "answered"
   * after each answer read.
   */
  events: [] as string[],
  /** Saves of a new private file that fail with ENOSPC before one succeeds. */
  failSaves: 0,
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => false,
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
    dropTypedAhead: async () => {
      terminal.events.push("drop");
    },
    // An answer arrives at once, as a paste does: a line break with more after it is inside it.
    withRawTerminal: async <T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ) => {
      const bytes = [...Buffer.from(terminal.answers.shift() ?? "", "utf8")];
      const result = await body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
      terminal.events.push("answered");
      return result;
    },
    // The searches watch no terminal here.
    withCtrlCWatch: <T>(search: (signal: AbortSignal) => Promise<T>) =>
      search(new AbortController().signal),
  };
});
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (question: string, choices: readonly { readonly label: string }[]) => {
    recordCutNotes(question, choices as never);
    terminal.questions.push(question);
    terminal.events.push(question);
    terminal.labels.push(choices.map((choice) => choice.label));
    return terminal.choices.shift();
  },
}));
vi.mock("../src/export/private-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/export/private-file.js")>();
  return {
    ...actual,
    publishNewPrivateFile: async (path: string, bytes: Uint8Array) => {
      if (terminal.failSaves > 0) {
        terminal.failSaves -= 1;
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }
      return actual.publishNewPrivateFile(path, bytes);
    },
  };
});

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { ParsedArguments } from "../src/cli/arguments.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { runSskrCombine, runSskrExport, runSskrSplit } from "../src/cli/sskr-command.js";
import { InputCancelled } from "../src/cli/terminal-input.js";
import { crc32 } from "../src/sskr/checksum.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { transportToUr, urToTransport, writeShare } from "../src/sskr/transport.js";
import "../src/sskr/share-platform-node.js";
import { recordCutNotes, takeCutNotes } from "./helpers/cut-notes.js";

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
const FINGERPRINT = "73c5da0a";
const TEST_DATE = "23-09-2026";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { entropy: string; shares: string[] }[] };
/** A 2-of-3 set of a 12-word phrase, and a share of a set of a 15-word one. */
const SHARES = vectors.deterministic[0]!.shares as [string, string, string];
const PHRASE = entropyToMnemonic(Buffer.from(vectors.deterministic[0]!.entropy, "hex"), wordlist);
const OTHER_SET_SHARE = vectors.deterministic[1]!.shares[0]!;
/** A byte of the share value: the header, identifier and member numbers come before it. */
const VALUE_BYTE = 10;
/** The CRC-32 at the end of a share's transport bytes. */
const CRC_BYTES = 4;
const SHARES_PROMPT =
  "Shamir shares (separate shares with ;, ? for each unreadable code or digit):";
const DATES_PROMPT = "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):";

/** `share` with one value byte flipped and its CRC-32 written anew: valid, but wrong. */
function wrongValue(share: string): string {
  const bytes = urToTransport(share);
  bytes[VALUE_BYTE]! ^= 1;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    bytes.length - CRC_BYTES,
    crc32(bytes.slice(0, -CRC_BYTES)),
  );
  return transportToUr(bytes);
}

/** `share` with one Bytewords pair of its UR replaced: its checksum then fails. */
function misread(share: string): string {
  const body = share.slice("ur:sskr/".length);
  const at = 2 * VALUE_BYTE;
  const pair = body.slice(at, at + 2) === "ae" ? "ad" : "ae";
  return `ur:sskr/${body.slice(0, at)}${pair}${body.slice(at + 2)}`;
}

/** `line` without its colour codes. */
function withoutColour(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/gu, "");
}

/** The second share in colours with the elements at `marks` unreadable. */
function marked(marks: readonly number[]): string {
  const parts = writeShare(SHARES[1], "colors").split(" ");
  for (const place of marks) parts[place] = "?";
  return parts.join(" ");
}

describe("shares on the private screen", () => {
  let screen: string;
  let out: string[];
  let notices: string[];
  beforeEach(() => {
    terminal.answers = [];
    terminal.choices = [];
    terminal.questions = [];
    terminal.labels = [];
    terminal.events = [];
    terminal.failSaves = 0;
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
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });

  /** The prompts of the questions that read a line, in the order shown. */
  function promptsShown(): string[] {
    return [
      ...screen.matchAll(
        /(Shamir shares[^:]*:|Share \d+ again:|More shares[^:]*:|Dates \([^:]*:|Original fingerprint of the wallet[^:]*:)/gu,
      ),
    ].map((match) => match[1]!);
  }

  /** Restores with --ask-secrets and `options`, answering as the terminal says. */
  function combine(options: ParsedArguments = {}): Promise<void> {
    return runSskrCombine({ "ask-secrets": true, ...options });
  }

  it("names a share that cannot be read and asks only for it again", async () => {
    const wrong = misread(SHARES[1]);
    // A ; at the end leaves an empty part, which is no share.
    terminal.answers = [`${SHARES[0]};${wrong};\r`, `${SHARES[2]}\r`];
    terminal.choices = ["again"];
    await combine();
    expect(out).toContain(PHRASE);
    expect(notices).toContain("Share 2 cannot be read: SSKR transport checksum does not match.");
    expect(terminal.labels).toEqual([["Leave share 2 out", "Type share 2 again"]]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again:"]);
    // The private screen shows what is typed; no warning repeats it.
    expect(notices.join("\n")).not.toContain(wrong.slice(8));
  });

  it("names a color written with too few symbols and asks only for that share again", async () => {
    const colors = writeShare(SHARES[1], "colors").split(" ");
    colors[2] = `${colors[2]!.slice(0, 5)}?`;
    terminal.answers = [`${SHARES[0]};${colors.join(" ")}\r`, `${SHARES[1]}\r`];
    terminal.choices = ["again"];
    await combine();
    expect(notices).toContain(
      "Share 2: color 3 has 5 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again:"]);
    expect(out).toContain(PHRASE);
  });

  it("restores colors with some of their digits unreadable", async () => {
    const colors = writeShare(SHARES[1], "colors").split(" ");
    for (const place of [4, 5, 6]) colors[place] = `${colors[place]!.slice(0, 5)}??`;
    terminal.answers = [`${SHARES[0]};${colors.join(" ")}\r`];
    await combine();
    expect(notices).toContain("✓ Marked elements: settled by the shares together");
    expect(out).toContain(PHRASE);
  });

  it("lets a pasted line that is no share be left out, also after it was typed again", async () => {
    // A heading copied with the shares, then typed again as something that is still no share.
    terminal.answers = [`${SHARES[0]}\n${SHARES[2]}\nSSKR share 3 of 3\r`, "nothing\r"];
    terminal.choices = ["again", "out"];
    await combine();
    expect(notices.filter((line) => line.startsWith("Share 3 cannot be read: "))).toHaveLength(2);
    expect(terminal.labels).toEqual([
      ["Leave share 3 out", "Type share 3 again"],
      ["Leave share 3 out", "Type share 3 again"],
    ]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 3 again:"]);
    expect(out).toContain(PHRASE);
  });

  it("joins a share that a paste wrapped over lines", async () => {
    // A UR cut in its middle, and Bytewords broken between two words.
    const cut = Math.floor(SHARES[0].length / 2);
    const words = writeShare(SHARES[2], "words").split(" ");
    const half = Math.floor(words.length / 2);
    terminal.answers = [
      [
        SHARES[0].slice(0, cut),
        SHARES[0].slice(cut),
        words.slice(0, half).join(" "),
        words.slice(half).join(" "),
      ].join("\n") + "\r",
    ];
    await combine();
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
    expect(terminal.labels).toEqual([]);
    expect(out).toContain(PHRASE);
  });

  it("says that a seed phrase is no share, typed in one line or one word per line", async () => {
    terminal.answers = [
      `${TEST_PHRASE}\r`,
      `${TEST_PHRASE.replaceAll(" ", "\n")}\r`,
      `${SHARES[0]};${SHARES[1]}\r`,
    ];
    await combine();
    const line =
      "This is a seed phrase in words, not a Shamir share: Decode numbers, codes or colors back into a seed phrase reads a masked one.";
    expect(notices.filter((notice) => notice === line)).toHaveLength(2);
    expect(promptsShown()).toEqual([SHARES_PROMPT, SHARES_PROMPT, SHARES_PROMPT]);
    expect(out).toContain(PHRASE);
  });

  it("names an encoded seed phrase given as a share on the command line", async () => {
    // "abandon … about" as word numbers.
    await expect(runSskrCombine({ share: "1 1 1 1 1 1 1 1 1 1 1 4" })).rejects.toThrow(
      "Share 1 is an encoded seed phrase, not a Shamir share: Decode numbers, codes or colors back into a seed phrase reads it.",
    );
  });

  it("takes a share file pasted as lines as one answer of several shares", async () => {
    terminal.answers = [`${SHARES[0]}\n${SHARES[2]}\r`];
    await combine();
    expect(out).toContain(PHRASE);
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
  });

  it("asks for an empty answer again", async () => {
    terminal.answers = ["\r", ` ; \r`, `${SHARES[0]};${SHARES[1]}\r`];
    await combine();
    expect(out).toContain(PHRASE);
    expect(notices).toContain("Type the shares, or press Ctrl+C to stop.");
    expect(notices).toContain("Type at least one share.");
  });

  it("leaves out a share of another set when the person chooses it", async () => {
    terminal.answers = [`${SHARES[0]};${OTHER_SET_SHARE};${SHARES[1]}\r`];
    terminal.choices = ["out"];
    await combine();
    expect(notices).toContain("Share 2 is of another set than share 1.");
    expect(terminal.labels).toEqual([["Leave share 2 out", "Type share 2 again"]]);
    expect(out).toContain(PHRASE);
  });

  it("lets either share be changed when nothing tells which set is right", async () => {
    // The wrong share first: one share of each set, so neither is named alone.
    terminal.answers = [`${OTHER_SET_SHARE};${SHARES[0]}\r`, `${SHARES[2]}\r`];
    terminal.choices = ["out", 1];
    await combine();
    expect(notices).toContain(
      "Shares 1 and 2 are of different sets, and nothing tells which is right.",
    );
    expect(terminal.labels.slice(0, 2)).toEqual([
      [
        "Type one share again",
        "Leave a share out",
        "Type every share again",
        "Add more shares",
        "Stop",
      ],
      ["Share 1", "Share 2"],
    ]);
    expect(notices).toContain("One share is not enough: this set needs 2.");
    expect(promptsShown()).toEqual([SHARES_PROMPT, "More shares (separate shares with ;):"]);
    expect(out).toContain(PHRASE);
  });

  it("names both shares that are the same member but differ, and lets either go", async () => {
    // A wrong copy of the first share typed before the right one.
    terminal.answers = [`${wrongValue(SHARES[0])};${SHARES[0]};${SHARES[1]}\r`];
    terminal.choices = ["out", 1];
    await combine();
    expect(notices).toContain(
      "Shares 1 and 2 are the same member of the set but differ, and nothing tells which is right.",
    );
    expect(terminal.labels[1]).toEqual(["Share 1", "Share 2", "Share 3"]);
    expect(out).toContain(PHRASE);
  });

  it("uses a share typed twice once", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[0]};${SHARES[2]}\r`];
    await combine();
    expect(notices).toContain("Share 2 is a copy of share 1: it is used once.");
    expect(out).toContain(PHRASE);
  });

  it("asks only for the missing shares when too few were typed", async () => {
    terminal.answers = [`${SHARES[0]}\r`, `${SHARES[2]}\r`];
    await combine();
    expect(notices).toContain("One share is not enough: this set needs 2.");
    expect(promptsShown()).toEqual([SHARES_PROMPT, "More shares (separate shares with ;):"]);
    expect(out).toContain(PHRASE);
  });

  it("offers to leave out a surplus share that gives another phrase", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[1]};${wrongValue(SHARES[2])}\r`];
    terminal.choices = ["out"];
    await combine();
    expect(notices).toContain(
      "Share 3 does not fit with the others: with it they give another phrase or none.",
    );
    expect(terminal.labels).toEqual([["Leave share 3 out", "Type share 3 again"]]);
    expect(out).toContain(PHRASE);
  });

  it("asks which shares to change after a refusal of the assessment", async () => {
    // A marked share of a 12-word set beside a share of a 15-word set.
    terminal.answers = [`${OTHER_SET_SHARE};${marked([5])}\r`, `${SHARES[0]};${SHARES[1]}\r`];
    terminal.choices = ["all"];
    await combine();
    expect(notices).toContain("These shares are of different lengths: not of one set.");
    expect(terminal.labels[0]).toEqual([
      "Type one share again",
      "Leave a share out",
      "Type every share again",
      "Add more shares",
      "Stop",
    ]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, SHARES_PROMPT]);
    expect(out).toContain(PHRASE);
  });

  it("lets several shares that a refusal names be left out one by one", async () => {
    // Two wrong shares of a 2-of-5 set: no single share left out mends the others.
    const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 5);
    const typed = [shares[0], shares[1], wrongValue(shares[2]!), wrongValue(shares[3]!)];
    terminal.answers = [`${typed.join(";")}\r`];
    terminal.choices = ["out", 3, "out"];
    await combine();
    expect(terminal.labels).toEqual([
      [
        "Type one share again",
        "Leave a share out",
        "Type every share again",
        "Add more shares",
        "Stop",
      ],
      ["Share 1", "Share 2", "Share 3", "Share 4"],
      ["Leave share 4 out", "Type share 4 again"],
    ]);
    expect(notices).toContain(
      "Share 4 does not fit with the others: with it they give another phrase or none.",
    );
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
    expect(out).toContain(TEST_PHRASE);
  });

  it("goes back to the shares when the search is not wanted", async () => {
    // Two unreadable colours leave 65,536 combinations, more than --max-tries 1 allows.
    terminal.answers = [`${SHARES[0]};${marked([5, 7])}\r`, `${SHARES[1]}\r`];
    terminal.choices = [false, "one", 2];
    await combine({ "max-tries": "1" });
    expect(terminal.questions[0]).toMatch(/^Search 65,536 combinations, .+\?$/u);
    // Keys typed during the assessment do not answer the question.
    expect(terminal.events[terminal.events.indexOf(terminal.questions[0]!) - 1]).toBe("drop");
    expect(terminal.questions.slice(1)).toEqual(["Which shares to change?", "Which share?"]);
    expect(terminal.labels[2]).toEqual(["Share 1", "Share 2"]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again:"]);
    expect(out).toContain(PHRASE);
  });

  it("goes back from the share question to the one after a wallet that nothing matched", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[1]}\r`, `${masterFingerprint(PHRASE)}\r`];
    // "Change a share", Escape at the share question, then "Change the wallet".
    terminal.choices = ["shares", undefined, "wallet", "fingerprint"];
    await combine({ "master-fingerprint": FINGERPRINT });
    expect(notices).toContain(
      "The phrase that these shares restore does not match the wallet given.",
    );
    expect(terminal.questions.slice(0, 3)).toEqual([
      "What now?",
      "Which shares to change?",
      "What now?",
    ]);
    expect(promptsShown()).toEqual([
      SHARES_PROMPT,
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
    ]);
    expect(out).toContain(PHRASE);
  });

  it("lists what a repair filled in as a table on a colour terminal", async () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    terminal.answers = [`${SHARES[0]};${marked([5])}\r`];
    await combine();
    const plain = notices.map(withoutColour);
    const heading = plain.indexOf("! Filled in where ? stood:");
    expect(heading).toBeGreaterThanOrEqual(0);
    // A row for the share, its element's position and what was filled in, then the advice.
    expect(plain[heading + 1]).toMatch(/^ {4}Share 2 {3}6 #[0-9A-F]{6}$/u);
    expect(plain[heading + 2]).toBe(
      "Correct the written copy; then check the wallet that comes back.",
    );
    expect(out.map(withoutColour)).toContain(PHRASE);
  });

  it("stops when the person chooses Stop", async () => {
    terminal.answers = [`${SHARES[0]};${marked([5, 7])}\r`];
    terminal.choices = [false, "stop"];
    await expect(combine({ "max-tries": "1" })).rejects.toBeInstanceOf(InputCancelled);
    expect(out).toEqual([]);
  });

  describe("with Seedshift", () => {
    const masked = encodeMnemonic(TEST_PHRASE, [parseDate(TEST_DATE)]).shiftedEnglish.join(" ");
    let shares: string[];
    beforeEach(async () => {
      shares = await splitSskrMnemonic(masked, 2, 3);
    });
    /** The fingerprint of the masked phrase, in the words that encode shows it with. */
    const encodedLine = (): string =>
      `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${masterFingerprint(masked)}`;

    it("shows the encoded fingerprint once the shares are read, before the dates", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "23-09-2O26\r", `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      const shown = notices.indexOf(encodedLine());
      expect(shown).toBeGreaterThanOrEqual(0);
      // Before the first answer to the dates, which is asked again.
      expect(shown).toBeLessThan(
        notices.indexOf("Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026."),
      );
      expect(notices.filter((line) => line.startsWith("Encoded BIP32"))).toHaveLength(1);
      expect(out).toContain(TEST_PHRASE);
    });

    it("shows the encoded fingerprint with the dates given, only on the private screen", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`];
      await combine({ mode: "seedshift", date: TEST_DATE });
      expect(notices).toContain(encodedLine());
      expect(out).toContain(TEST_PHRASE);
      // From the command line, as decode, and without Seedshift, none is shown.
      notices = [];
      await runSskrCombine({ share: [shares[0]!, shares[2]!], mode: "seedshift", date: TEST_DATE });
      expect(notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
      terminal.answers = [`${shares[0]};${shares[2]}\r`];
      await combine();
      expect(notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
      expect(out).toContain(masked);
    });

    it("shows each part of the result apart on a colour terminal, each phrase with its fingerprint", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${shares[0]};${shares[1]}\r`];
      await combine({ mode: "seedshift", date: TEST_DATE });
      const shown = out.map(withoutColour);
      const parts = [
        "\nMnemoCode · Restored from shares",
        "\nEnglish BIP39 words of the masked phrase (decoy)",
        masked,
        `Encoded fingerprint (of the masked phrase)  ${masterFingerprint(masked)}  (empty BIP39 passphrase)`,
        "\nThe original seed phrase, the wallet's",
        "    1. abandon      2. abandon      3. abandon      4. abandon",
        "    9. abandon     10. abandon     11. abandon     12. about",
        "On one line, for copying:",
        TEST_PHRASE,
        `Original fingerprint  ${FINGERPRINT}  (empty BIP39 passphrase)`,
      ];
      const places = parts.map((part) => shown.indexOf(part));
      expect(places).not.toContain(-1);
      // In this order, the original seed phrase last.
      expect(places).toEqual([...places].sort((a, b) => a - b));
    });

    it("shows the encoded fingerprint as a status line in colour", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${shares[0]};${shares[1]}\r`];
      await combine({ mode: "seedshift", date: TEST_DATE });
      const plain = notices.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      expect(plain).toContain(
        `✓ Encoded fingerprint (of the masked phrase) ${masterFingerprint(masked)}`,
      );
      expect(plain).toContain("Fingerprint uses an empty BIP39 passphrase.");
    });

    it("finds a forgotten digit of a date with the wallet asked for after the dates", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r", `${FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await combine({ mode: "seedshift" });
      expect(promptsShown()).toEqual([
        SHARES_PROMPT,
        "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):",
        "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
      ]);
      expect(
        notices.some((line) => line.startsWith("The search tries 10 date combinations:")),
      ).toBe(true);
      expect(out).toContain(`Original seed phrase, the wallet's (dates ${TEST_DATE}):`);
      expect(out).toContain(TEST_PHRASE);
    });

    it("asks for a date search beyond --max-candidates, and starts one within it", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r"];
      terminal.choices = [false];
      // The answers of the menu's wallet question are given as options: only the search is asked.
      await expect(
        combine({ mode: "seedshift", "master-fingerprint": FINGERPRINT, "max-candidates": "9" }),
      ).rejects.toThrow();
      expect(terminal.questions[0]).toMatch(/^Search 10 date combinations, /u);
      terminal.questions = [];
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r"];
      await combine({
        mode: "seedshift",
        "master-fingerprint": FINGERPRINT,
        "max-candidates": "10",
      });
      expect(terminal.questions).toEqual([]);
      expect(out).toContain(TEST_PHRASE);
    });

    it("searches the dates after the marked elements, and says how much both take", async () => {
      // One unreadable colour of the second share, which the shares settle together.
      const parts = writeShare(shares[1]!, "colors").split(" ");
      parts[5] = "?";
      terminal.answers = [`${shares[0]};${parts.join(" ")}\r`, "?3-09-2026\r", `${FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await combine({ mode: "seedshift" });
      expect(
        notices.some((line) =>
          line.startsWith(
            "The search tries 1 share combination, then 3 date combinations for each phrase found:",
          ),
        ),
      ).toBe(true);
      expect(notices.some((line) => /^Share 2: element 6 is #[0-9A-F]{6}\.$/u.test(line))).toBe(
        true,
      );
      expect(out).toContain(TEST_PHRASE);
    });

    it("asks for a date again that cannot be read, keeping the shares", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "23-09-2O26\r", `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      expect(notices).toContain(
        "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
      );
      expect(promptsShown().filter((prompt) => prompt === SHARES_PROMPT)).toHaveLength(1);
      expect(out).toContain(TEST_PHRASE);
    });

    it("asks what to change when no date gives the wallet", async () => {
      terminal.answers = [
        `${shares[1]};${shares[2]}\r`,
        "24-09-202?\r",
        `${FINGERPRINT}\r`,
        "23-09-202?\r",
      ];
      terminal.choices = ["fingerprint", "dates"];
      await combine({ mode: "seedshift" });
      expect(notices).toContain("None of the 10 date combinations gives the wallet given.");
      expect(terminal.labels[1]).toEqual([
        "Change the dates",
        "Change the wallet",
        "Change a share",
        "It was not masked with Seedshift",
        "Stop",
      ]);
      expect(out).toContain(TEST_PHRASE);
    });

    it("says why the dates are asked again when they are more than the phrase takes", async () => {
      const given = ["24-09-2026", "25-09-2026", "26-09-2026", "27-09-2026", "28-09-2026"];
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${TEST_DATE}\r`];
      await combine({ mode: "seedshift", date: given });
      expect(notices).toContain("12-word phrases support at most 4 dates.");
      expect(promptsShown()).toEqual([SHARES_PROMPT, DATES_PROMPT]);
      expect(out).toContain(TEST_PHRASE);
    });

    it("takes Seedshift when the wallet shows that the phrase was masked with it", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${TEST_DATE}\r`];
      terminal.choices = ["mode"];
      await combine({ "master-fingerprint": FINGERPRINT });
      expect(notices).toContain(
        "The phrase that these shares restore does not match the wallet given.",
      );
      expect(terminal.labels[0]).toEqual([
        "Change the wallet",
        "Change a share",
        "It was masked with Seedshift",
        "Stop",
      ]);
      expect(promptsShown()).toEqual([SHARES_PROMPT, DATES_PROMPT]);
      // Shown once the phrase is taken as masked, before its dates.
      expect(notices).toContain(encodedLine());
      expect(out).toContain(TEST_PHRASE);
    });

    it("leaves Seedshift when the wallet shows that the phrase was not masked", async () => {
      const plain = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      terminal.answers = [`${plain[0]};${plain[2]}\r`];
      terminal.choices = ["mode"];
      await combine({ mode: "seedshift", date: TEST_DATE, "master-fingerprint": FINGERPRINT });
      expect(terminal.labels[0]).toEqual([
        "Change the dates",
        "Change the wallet",
        "Change a share",
        "It was not masked with Seedshift",
        "Stop",
      ]);
      expect(promptsShown()).toEqual([SHARES_PROMPT]);
      expect(out).toContain(TEST_PHRASE);
    });
  });

  describe("exporting", () => {
    it("goes on without the wallet check when too few shares were typed for it", async () => {
      terminal.answers = [`${SHARES[0]}\r`];
      terminal.choices = ["without"];
      await runSskrExport({
        "ask-secrets": true,
        "master-fingerprint": FINGERPRINT,
        format: "indexes",
      });
      expect(notices).toContain(
        "The wallet can be checked only with as many shares as the threshold.",
      );
      expect(terminal.labels[0]).toEqual([
        "Add more shares",
        "Go on without the wallet check",
        "Stop",
      ]);
      expect(out).toContain(writeShare(SHARES[0], "indexes"));
    });

    it("keeps the wallet check at Escape, which stops before anything is written", async () => {
      terminal.answers = [`${SHARES[0]}\r`];
      // Escape at "What now?".
      terminal.choices = [undefined];
      await expect(
        runSskrExport({
          "ask-secrets": true,
          "master-fingerprint": FINGERPRINT,
          format: "indexes",
        }),
      ).rejects.toBeInstanceOf(InputCancelled);
      expect(terminal.questions).toEqual(["What now?"]);
      expect(out).toEqual([]);
    });

    /** The first share as word numbers, with the words at 5, 9 and 13 unreadable: 4 shares fit. */
    function ambiguous(): string {
      const words = writeShare(SHARES[0], "indexes").split(" ");
      for (const place of [5, 9, 13]) words[place] = "?";
      return words.join(" ");
    }

    it("shows the variants of a share that fits several ways, and lets it be typed again", async () => {
      terminal.answers = [`${ambiguous()}\r`, `${writeShare(SHARES[0], "indexes")}\r`];
      terminal.choices = ["again"];
      await runSskrExport({ "ask-secrets": true, format: "indexes" });
      expect(notices).toContain(
        "Share 1 fits 4 ways, so nothing is saved: use another copy of it, or more shares.",
      );
      expect(terminal.labels[0]).toEqual(["Type share 1 again", "Add more shares", "Done"]);
      expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 1 again:"]);
      // The four variants, then the share typed again.
      expect(out).toHaveLength(5);
      expect(out.at(-1)).toBe(writeShare(SHARES[0], "indexes"));
    });

    it("saves nothing when the variants are left as they are", async () => {
      terminal.answers = [`${ambiguous()}\r`];
      terminal.choices = ["done"];
      await runSskrExport({ "ask-secrets": true });
      expect(out).toHaveLength(4);
    });

    it("asks which form cards show for shares written in different forms", async () => {
      const folder = await mkdtemp(join(tmpdir(), "mnemocode-sskr-forms-"));
      try {
        const pdf = join(folder, "shares.pdf");
        terminal.answers = [`${SHARES[0]};${writeShare(SHARES[2], "colors")}\r`];
        terminal.choices = ["stop"];
        await expect(runSskrExport({ "ask-secrets": true, pdf })).rejects.toBeInstanceOf(
          InputCancelled,
        );
        expect(terminal.questions).toEqual([
          "The shares are written in different forms. Which form should the cards show?",
        ]);
        expect(terminal.labels[0]).toEqual([
          "Compact UR",
          "RGB hexadecimal codes (ordered)",
          "Stop",
        ]);
        expect(existsSync(pdf)).toBe(false);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("names shares of different sets before writing anything", async () => {
      terminal.answers = [`${SHARES[0]};${OTHER_SET_SHARE}\r`, `${SHARES[2]}\r`];
      terminal.choices = ["one", 2];
      await runSskrExport({ "ask-secrets": true, format: "indexes" });
      expect(notices).toContain(
        "Shares 1 and 2 are of different sets, and nothing tells which is right.",
      );
      expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again:"]);
      expect(out).toEqual([writeShare(SHARES[0], "indexes"), writeShare(SHARES[2], "indexes")]);
    });
  });

  describe("saving the shares of a split", () => {
    let folder: string;
    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "mnemocode-sskr-save-"));
    });
    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** Splits the test phrase into 2 of 3 shares saved at `output`; the backup check is skipped. */
    function split(output: string): Promise<void> {
      return runSskrSplit({ mnemonic: TEST_PHRASE, threshold: "2", shares: "3", output });
    }

    it("tries a failed save again and shows the shares", async () => {
      const output = join(folder, "shares.txt");
      terminal.failSaves = 1;
      terminal.choices = ["again"];
      await split(output);
      expect(notices).toContain(
        `The file of the shares could not be saved as ${output}: the disk is full.`,
      );
      expect(terminal.labels[0]).toEqual(["Try again", "Another file name", "Skip"]);
      const saved = readFileSync(output, "utf8").trim().split("\n");
      expect(saved).toHaveLength(3);
      for (const share of saved) expect(out).toContain(share);
    });

    it("saves under another name", async () => {
      const output = join(folder, "shares.txt");
      const other = join(folder, "other.txt");
      terminal.failSaves = 1;
      terminal.choices = ["other"];
      terminal.answers = [`${other}\r`];
      await split(output);
      expect(existsSync(output)).toBe(false);
      expect(readFileSync(other, "utf8").trim().split("\n")).toHaveLength(3);
      expect(notices.some((line) => line.startsWith(`Saved SSKR records: ${other} `))).toBe(true);
    });

    it("goes back to the choice, writing nothing, when no new name is given", async () => {
      const output = join(folder, "shares.txt");
      terminal.failSaves = 1;
      terminal.choices = ["other", "skip"];
      // Escape at the new name.
      terminal.answers = ["\x1b"];
      await split(output);
      expect(screen).toContain("New name for the file of the shares:");
      expect(
        notices.filter((line) => line.startsWith("The file of the shares could not be saved")),
      ).toHaveLength(1);
      expect(terminal.labels.slice(0, 2)).toEqual([
        ["Try again", "Another file name", "Skip"],
        ["Try again", "Another file name", "Skip"],
      ]);
      expect(existsSync(output)).toBe(false);
      expect(out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });

    it("offers the sheet for heirs again too, and still shows the shares", async () => {
      const sheet = join(folder, "heirs.pdf");
      terminal.failSaves = 1;
      terminal.choices = ["skip"];
      await runSskrSplit({
        mnemonic: TEST_PHRASE,
        threshold: "2",
        shares: "3",
        "heir-sheet": sheet,
      });
      expect(notices).toContain(
        `The sheet for heirs could not be saved as ${sheet}: the disk is full.`,
      );
      expect(notices).toContain("The sheet for heirs was not saved.");
      expect(existsSync(sheet)).toBe(false);
      expect(out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });

    it("shows the shares when the save is skipped", async () => {
      const output = join(folder, "shares.txt");
      terminal.failSaves = 1;
      terminal.choices = ["skip"];
      await split(output);
      expect(existsSync(output)).toBe(false);
      expect(notices).toContain("The file of the shares was not saved.");
      expect(out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });
  });
});
