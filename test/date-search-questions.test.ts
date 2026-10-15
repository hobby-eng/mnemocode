// recover-date --ask-secrets on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts). Standard output is a terminal only with
// `terminal.stdoutTerminal`; the private screen then shows what fits in the window, which windowOf
// sets.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeMnemonic, encodeMnemonicLegacy, formatEncoded, parseDate } from "../src/core.js";
import { askEncodedBackup } from "../src/cli/backup-questions.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { writeShare } from "../src/sskr/transport.js";
import { MASKED } from "./helpers/phrase-questions.js";
import { questionsOnPrivateScreen, seen, terminal, windowOf } from "./helpers/question-terminal.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

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

const FOUND = `23-09-2026\t${TEST_PHRASE}\tmatched at m`;
/** The test phrase masked with the Original Seedshift and 23-09-2026, as word numbers. */
const LEGACY = formatEncoded(
  encodeMnemonicLegacy(TEST_PHRASE, [parseDate("23-09-2026")]),
  "indexes",
);
const DATES_PROMPT =
  "Dates with ? for what is forgotten (up to 4, one to three of them incomplete):";

/** Runs recover-date --ask-secrets with `options`, answering as the terminal says. */
function recover(options: Record<string, string>): Promise<Cancelled | undefined> {
  return runRecoverDate({ "ask-secrets": true, ...options });
}

/** Where each prompt appears on the screen, in order. */
function promptsShown(): string[] {
  return [
    ...seen.screen.matchAll(
      /(Encoded seed phrase, record or text file path:|Dates with \?[^:]*:|Original fingerprint of the wallet[^:]*:)/gu,
    ),
  ].map((match) => match[1]!);
}

questionsOnPrivateScreen();

describe("recover-date on the private screen", () => {
  it("asks again for each answer that cannot be used, keeping the others, and the wallet last", async () => {
    terminal.answers = [
      `${MASKED}\r`,
      "23-09-2O26\r",
      "23-09-2026\r",
      "2?-09-2026\r",
      "zz\r",
      `${TEST_FINGERPRINT}\r`,
    ];
    terminal.choices = ["fingerprint"];
    await recover({ mode: "seedshift" });
    expect(seen.out).toEqual([FOUND]);
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "Detected input format: indexes.",
        "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
        "At least one date must contain a forgotten digit represented by ?.",
        "A master fingerprint must be eight hexadecimal characters.",
      ]),
    );
    expect(promptsShown()).toEqual([
      "Encoded seed phrase, record or text file path:",
      DATES_PROMPT,
      DATES_PROMPT,
      DATES_PROMPT,
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
    ]);
    expect(terminal.questions).toEqual(["How can MnemoCode recognise the wallet?"]);
    // The private screen shows what is typed; no warning repeats it.
    expect(seen.notices.join("\n")).not.toContain("2O26");
  });

  it("offers the record's mode when it differs from the one given", async () => {
    terminal.answers = [`MNC1:seedshift:indexes:${MASKED}\r`, "2?-09-2026\r"];
    terminal.choices = ["record"];
    await recover({ mode: "seedshift-legacy", "master-fingerprint": TEST_FINGERPRINT });
    expect(terminal.questions).toEqual([
      "The record was made with MnemoCode Seedshift, not with the Original Seedshift.",
    ]);
    expect(seen.out).toEqual([FOUND]);
  });

  it("asks for a direct record again before the dates", async () => {
    terminal.answers = [
      `MNC1:direct:indexes:${"1 ".repeat(11)}4\r`,
      "MNC1:seedshift:english\r",
      `${MASKED}\r`,
      "2?-09-2026\r",
    ];
    await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "Date recovery is available only for records created with Seedshift.",
        "Malformed MnemoCode record header.",
      ]),
    );
    expect(promptsShown().slice(0, 4)).toEqual([
      "Encoded seed phrase, record or text file path:",
      "Encoded seed phrase, record or text file path:",
      "Encoded seed phrase, record or text file path:",
      DATES_PROMPT,
    ]);
    expect(seen.out).toEqual([FOUND]);
  });

  it("asks again for codes that are no phrase, naming only a count or a place", async () => {
    terminal.answers = [
      `${"2027 ".repeat(10)}\r`,
      `${MASKED} 4096\r`,
      `${MASKED}\r`,
      "2?-09-2026\r",
    ];
    await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.notices).toEqual(
      expect.arrayContaining([
        "These are 10 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
        "Indexes use Seedshift-compatible numbering from 1 through 2048.",
      ]),
    );
    expect(seen.out).toEqual([FOUND]);
  });

  it("says that a Shamir share is no encoded seed phrase, and which entry reads it", async () => {
    const vectors = JSON.parse(
      await readFile(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
    ) as { deterministic: { shares: string[] }[] };
    const share = writeShare(vectors.deterministic[0]!.shares[0]!, "indexes");
    terminal.answers = [`${share}\r`, `${MASKED}\r`, "2?-09-2026\r"];
    await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.notices).toContain(
      "This is a Shamir share, not an encoded seed phrase: Restore a seed phrase from Shamir shares reads it.",
    );
    expect(seen.out).toEqual([FOUND]);
  });
});

describe("recover-date on the private screen", () => {
  it("offers the Original Seedshift when the codes lack MnemoCode Seedshift's checksum", async () => {
    terminal.answers = [`${MASKED.replace(/377$/u, "378")}\r`, "2?-09-2026\r"];
    // The original Seedshift then; nothing fits, and Escape at "What now?" stops.
    terminal.choices = ["legacy"];
    await recover({ mode: "seedshift" });
    expect(terminal.questions).toEqual([
      "These codes lack the BIP39 checksum that MnemoCode Seedshift gives them.",
      "What now?",
    ]);
    expect(seen.out).toEqual(["No candidate with a valid BIP39 checksum was found."]);
  });

  it("says that none matched the wallet and lets the wallet change", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r", `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["change-wallet", "fingerprint"];
    await recover({ mode: "seedshift", "master-fingerprint": "00000000" });
    expect(seen.out).toEqual([
      "None of the 10 checksum-valid candidates matched the requested master fingerprint.",
      FOUND,
    ]);
    expect(terminal.questions).toEqual(["What now?", "How can MnemoCode recognise the wallet?"]);
    // The dates were asked once.
    expect(promptsShown().filter((prompt) => prompt === DATES_PROMPT)).toHaveLength(1);
  });

  it("offers no wallet only where that changes the search", async () => {
    // The original Seedshift lists checksum-valid candidates without a wallet. Asked for one to
    // check those not shown, "It cannot" would run the same search again.
    terminal.answers = [`${MASKED}\r`, "??-??-2026\r", `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["wallet", "fingerprint"];
    await recover({ mode: "seedshift-legacy", "max-results": "1" });
    expect(terminal.questions.slice(0, 2)).toEqual([
      "Not every candidate is shown. What now?",
      "How can MnemoCode recognise the wallet?",
    ]);
    expect(terminal.labels[1]).toEqual(["Fingerprint", "Address"]);
    const searches = () =>
      seen.notices.filter((line) => line.startsWith("Recovery search contains")).length;
    expect(searches()).toBe(2);

    // In place of a wallet that matched none, no wallet lists every candidate: another search.
    seen.notices = [];
    terminal.questions = [];
    terminal.labels = [];
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r"];
    terminal.choices = ["change-wallet", "none"];
    await recover({ mode: "seedshift-legacy", "master-fingerprint": "00000000" });
    expect(terminal.questions.slice(0, 2)).toEqual([
      "What now?",
      "How can MnemoCode recognise the wallet?",
    ]);
    expect(terminal.labels[1]).toEqual(["Fingerprint", "Address", "It cannot"]);
    expect(searches()).toBe(2);
  });

  it("offers the wallet when the candidates do not fit in the window", async () => {
    // The Original Seedshift lists the checksum-valid candidates without a wallet: more of them
    // than a window of 40 rows, which keeps no scrollback, can show.
    terminal.stdoutTerminal = true;
    windowOf(40, 80);
    terminal.answers = [`${LEGACY}\r`, "2?-0?-202?\r", `${TEST_FINGERPRINT}\r`];
    terminal.choices = ["wallet", "fingerprint"];
    await recover({ mode: "seedshift-legacy" });
    expect(terminal.questions).toEqual([
      "Not every candidate fits on the screen. What now?",
      "How can MnemoCode recognise the wallet?",
    ]);
    expect(terminal.labels[0]).toEqual([
      "Check them against the wallet",
      "Change the dates",
      "Done",
    ]);
    const listed = seen.out.filter((line) => /^\d{2}-\d{2}-\d{4}\t/u.test(line));
    expect(listed.length).toBeGreaterThan(40);
    expect(seen.out.at(-1)).toBe(FOUND);

    // They fit in a taller window, and every one goes to a file whatever the window.
    for (const [rows, stdoutTerminal] of [
      [400, true],
      [40, false],
    ] as const) {
      terminal.stdoutTerminal = stdoutTerminal;
      windowOf(rows, 80);
      terminal.questions = [];
      terminal.answers = [`${LEGACY}\r`, "2?-0?-202?\r"];
      await recover({ mode: "seedshift-legacy" });
      expect(terminal.questions).toEqual([]);
    }
  });
});

describe("recover-date on the private screen", () => {
  it("keeps the dates and the wallet when the encoded phrase is typed again", async () => {
    const other = formatEncoded(encodeMnemonic(TEST_PHRASE, [parseDate("23-09-2025")]), "indexes");
    terminal.answers = [`${other}\r`, "2?-09-2026\r", `${MASKED}\r`];
    terminal.choices = ["backup"];
    await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.out).toEqual([
      "None of the 10 checksum-valid candidates matched the requested master fingerprint.",
      FOUND,
    ]);
    expect(promptsShown()).toEqual([
      "Encoded seed phrase, record or text file path:",
      DATES_PROMPT,
      "Encoded seed phrase, record or text file path:",
    ]);
  });

  it("searches more than --max-candidates only when the person chooses it", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r", "2?-09-2026\r"];
    // No types the dates again; the same search is then asked for once more, and made.
    terminal.choices = ["no", "yes"];
    await recover({
      mode: "seedshift",
      "master-fingerprint": TEST_FINGERPRINT,
      "max-candidates": "5",
    });
    expect(terminal.questions).toEqual([
      "Search 10 date combinations?",
      "Search 10 date combinations?",
    ]);
    expect(promptsShown()).toEqual([
      "Encoded seed phrase, record or text file path:",
      DATES_PROMPT,
      DATES_PROMPT,
    ]);
    expect(seen.out).toEqual([FOUND]);
  });

  it("asks which Seedshift for plain codes in a file, and offers another source for a bad file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-questions-"));
    try {
      const plain = join(directory, "codes.txt");
      await writeFile(plain, `${MASKED}\n`);
      terminal.answers = ["2?-09-2026\r", `${TEST_FINGERPRINT}\r`];
      terminal.choices = ["seedshift", "fingerprint"];
      await recover({ "input-file": plain });
      expect(terminal.questions).toEqual([
        "Which Seedshift was used?",
        "How can MnemoCode recognise the wallet?",
      ]);
      expect(seen.out).toEqual([FOUND]);

      const bad = join(directory, "bad.txt");
      await writeFile(bad, "no codes here\n");
      seen.out = [];
      terminal.questions = [];
      terminal.answers = [`'${plain}'\r`, "2?-09-2026\r"];
      terminal.choices = ["file"];
      await recover({
        "input-file": bad,
        mode: "seedshift",
        "master-fingerprint": TEST_FINGERPRINT,
      });
      // Another file, dragged in with quotes.
      expect(terminal.questions).toEqual(["What now?"]);
      expect(seen.notices).toContain("Enter 12, 15, 18, 21 or 24 English BIP39 words.");
      expect(seen.out).toEqual([FOUND]);

      // Stop at "What now?" cancels.
      terminal.choices = ["stop"];
      expect(
        await recover({
          "input-file": bad,
          mode: "seedshift",
          "master-fingerprint": TEST_FINGERPRINT,
        }),
      ).toBe(CANCELLED);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("recover-date on the private screen", () => {
  it("asks whether Seedshift was used for codes in a record file without its header", async () => {
    // As decode reads them: the codes do not say how they were made, and taken as not masked a
    // masked phrase would be shown as the seed phrase.
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-questions-"));
    const decoding = async (args: Record<string, string>) => {
      const read = await askEncodedBackup({
        args: { "ask-secrets": true, ...args },
        seedshiftOnly: false,
      });
      if (read === CANCELLED) throw new Error("Cancelled, not the codes.");
      if (read.kind !== "codes") throw new Error(`Read ${read.kind}, not the codes.`);
      return read;
    };
    try {
      const plain = join(directory, "codes.txt");
      await writeFile(plain, `${MASKED}\n`);
      terminal.choices = ["seedshift"];
      expect((await decoding({ "input-file": plain })).backup.mode).toBe("seedshift");
      expect(terminal.questions).toEqual(["Was Seedshift used when it was encoded?"]);
      expect(terminal.labels[0]).toEqual(["No", "MnemoCode Seedshift", "Original Seedshift"]);
      expect(seen.notices).toContain(
        "These codes have no MNC1 record header, so they do not say how they were made.",
      );

      // Typed after a file that could not be used, they are asked about too; No is No.
      const bad = join(directory, "bad.txt");
      await writeFile(bad, "no codes here\n");
      terminal.questions = [];
      terminal.answers = [`${MASKED}\r`];
      terminal.choices = ["typed", "direct"];
      expect((await decoding({ "input-file": bad })).backup.mode).toBe("direct");
      expect(terminal.questions).toEqual(["What now?", "Was Seedshift used when it was encoded?"]);

      // A record names its mode, and so does --mode, which the menu passes, also for No.
      terminal.questions = [];
      await writeFile(plain, `MNC1:seedshift:indexes:${MASKED}\n`);
      expect((await decoding({ "input-file": plain })).backup.mode).toBe("seedshift");
      terminal.answers = [`${MASKED}\r`];
      expect((await decoding({ mode: "direct" })).backup.mode).toBe("direct");
      expect(terminal.questions).toEqual([]);

      // Typed codes without --mode do not say how they were made either: they are asked about.
      terminal.answers = [`${MASKED}\r`];
      terminal.choices = ["seedshift"];
      expect((await decoding({})).backup.mode).toBe("seedshift");
      expect(terminal.questions).toEqual(["Was Seedshift used when it was encoded?"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("shows the encoded fingerprint before the dates, as decode does", async () => {
    const encoded =
      "Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): 0d05289e";
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r"];
    await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.out).toEqual([FOUND]);
    expect(seen.notices).toContain(encoded);
    // Before the question for the dates, so that a mistyped code shows before a long search.
    const shownAt = vi
      .mocked(console.error)
      .mock.calls.findIndex((line) => line.join(" ") === encoded);
    const askedAt = vi.mocked(process.stderr).write.mock.calls.findIndex(([chunk]) =>
      Buffer.from(chunk as Uint8Array)
        .toString("utf8")
        .includes(DATES_PROMPT),
    );
    expect(vi.mocked(console.error).mock.invocationCallOrder[shownAt]).toBeLessThan(
      vi.mocked(process.stderr).write.mock.invocationCallOrder[askedAt]!,
    );
    // Codes of the Original Seedshift, which usually lack the checksum, show none.
    seen.notices = [];
    terminal.answers = [`${LEGACY}\r`, "2?-09-2026\r"];
    await recover({ mode: "seedshift-legacy" });
    expect(seen.notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
  });

  it("asks which Seedshift for typed codes without --mode", async () => {
    terminal.answers = [`${MASKED}\r`, "2?-09-2026\r"];
    terminal.choices = ["seedshift"];
    await recover({ "master-fingerprint": TEST_FINGERPRINT });
    expect(terminal.questions).toEqual(["Which Seedshift was used?"]);
    // A date search needs Seedshift: there is no No.
    expect(terminal.labels[0]).toEqual(["MnemoCode Seedshift", "Original Seedshift"]);
    expect(seen.out).toEqual([FOUND]);
  });

  it("refuses options that cannot be used before the first question", async () => {
    await expect(recover({ mode: "direct" })).rejects.toThrow("only when a Seedshift mode");
    await expect(recover({ input: MASKED })).rejects.toThrow("--ask-secrets cannot be combined");
    // The wallet asked on the screen would not be looked for where these options say.
    await expect(recover({ mode: "seedshift", network: "testnet" })).rejects.toThrow(
      "--network applies to a wallet given as an option",
    );
    expect(seen.screen).toBe("");
  });
});

describe("recover-date on the private screen", () => {
  it("cancels when the input ends", async () => {
    terminal.answers = [`${MASKED}\r`];
    expect(await recover({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT })).toBe(
      CANCELLED,
    );
  });
});
