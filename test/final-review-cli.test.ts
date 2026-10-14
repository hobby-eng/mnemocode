// The command line's fixes of the final review of the DRY/OOP scan (2026-10-11): each case fails
// on the tree before its fix. Public test data only: the BIP39 test phrase and README dates.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mnemonicToEntropy } from "@scure/bip39";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArguments } from "../src/cli/arguments.js";
import { CandidatesFile } from "../src/cli/candidates-file.js";
import { runDecode } from "../src/cli/decode-command.js";
import { phraseAndDates } from "../src/cli/input.js";
import { runSskrSplit } from "../src/cli/sskr-split-command.js";
import { recoverySettings } from "../src/cli/sskr-restore-command.js";
import { exportColorPalette } from "../src/color-export.js";
import { decodeCandidateList } from "../src/core/candidate-list.js";
import { CandidateListWriter, type CandidateListFile } from "../src/core/candidate-list-writer.js";
import { englishWordlist } from "../src/core/english-words.js";
import { encodeMnemonic, indexesToColors, parseDate } from "../src/core.js";
import { searchDates } from "../src/cli/date-search.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { DATE_COUNT_WORDS, Masking, PHRASE_WORDS } from "../src/core/masking.js";
import { SearchPlan } from "../src/core/search-plan.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

vi.mock("../src/cli/terminal-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
  // No terminal: codes that fit several forms end the command instead of asking.
  terminalAvailable: () => false,
}));

/** Codes that are both word numbers and Unicode text (test/cli.test.ts). */
const AMBIGUOUS = "76 84 57 28 90 19 59 27 62 11 89 81 66 42 75 28 50 11 52 30 57 30 62 10";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-final-cli-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("CC-01: a saved candidate list leaves no copy of the entropies", () => {
  it("wipes the bytes of a list without encryption once they are written", async () => {
    // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
    const write = CandidateListWriter.prototype.write;
    let made: CandidateListFile | undefined;
    vi.spyOn(CandidateListWriter.prototype, "write").mockImplementation(async function (
      this: CandidateListWriter,
      entropies,
    ) {
      const outcome = await write.call(this, entropies);
      if (outcome.kind === "list") made = outcome.list;
      return outcome;
    });
    const path = join(directory, "open.mncl");
    const target = await CandidatesFile.of({
      "candidates-file": path,
      "plaintext-candidates": true,
    });
    await target!.savePhrases([TEST_PHRASE]);
    expect(made!.encrypted).toBe(false);
    expect(made!.bytes.every((byte) => byte === 0)).toBe(true);
    // The file was written before the wipe.
    const saved = decodeCandidateList(new Uint8Array(await readFile(path)));
    expect(saved.records.map((record) => [...record.entropy])).toEqual([
      [...mnemonicToEntropy(TEST_PHRASE, englishWordlist)],
    ]);
  });
});

describe("CC-03: a palette without designs", () => {
  it("is refused by the renderer's rule, not with a TypeError", async () => {
    const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
    await expect(
      exportColorPalette({ colors, templates: [], pdfPath: join(directory, "p.pdf") }),
    ).rejects.toThrow("No approved card templates are installed yet.");
  });
});

describe("CC-05: list options are looked up by their own names", () => {
  it.each(["constructor", "toString", "hasOwnProperty"])("keeps --%s an ordinary option", (key) => {
    const parsed = parseArguments([`--${key}`, "x"]);
    expect(Object.keys(parsed)).toEqual([key]);
    expect(parsed[key]).toBe("x");
  });
});

describe("CC-06: the date counts of shares in the words they always had", () => {
  it.each([
    [["--mode", "seedshift"], "Seedshift recovery requires its original dates."],
    [["--mode", "direct", "--date", "23-09-2026"], "Direct mode does not accept dates."],
  ])("restore and export from shares: %j", async (options, message) => {
    await expect(recoverySettings(parseArguments(options))).rejects.toThrow(message);
  });

  it.each([
    [["--mode", "seedshift"], "Seedshift requires at least one date."],
    [["--mode", "direct", "--date", "23-09-2026"], "Direct mode does not accept dates."],
  ])("a split into shares: %j", async (options, message) => {
    const args = ["--threshold", "2", "--shares", "3", "--mnemonic", TEST_PHRASE, ...options];
    await expect(runSskrSplit(parseArguments(args))).rejects.toThrow(message);
  });

  it("keeps the words of codes as the default, for encode, decode and every host", async () => {
    const args = parseArguments(["--mnemonic", TEST_PHRASE]);
    await expect(phraseAndDates(args, "seedshift")).rejects.toThrow(
      "seedshift requires at least one date.",
    );
    expect(() => Masking.of("direct").assertDateCount(1)).toThrow(DATE_COUNT_WORDS.codes.direct);
  });
});

describe("CC-14: the names of the original seed phrase come from PHRASE_WORDS", () => {
  it("keeps the words that results have always printed", () => {
    expect(PHRASE_WORDS.original).toBe("the original seed phrase, the wallet's");
    expect(PHRASE_WORDS.originalLabel).toBe("Original seed phrase, the wallet's");
  });
});

describe("CC-07: decode refuses a wrong date count before the form is settled", () => {
  it.each([
    [["--mode", "direct", "--date", "23-09-2026"], "Dates cannot be used in direct mode."],
    [["--mode", "seedshift"], "seedshift requires at least one date."],
  ])("%j", async (options, message) => {
    await expect(runDecode(parseArguments(["--input", AMBIGUOUS, ...options]))).rejects.toThrow(
      message,
    );
  });
});

describe("CC-09: the size of a search is said once, in the singular for one", () => {
  it("says one date combination", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      lines.push(line.join(" "));
    });
    const encoded = encodeMnemonic(TEST_PHRASE, [parseDate("23-09-2026")]);
    await searchDates({
      indexes: encoded.shiftedIndexes,
      dates: DatesAnswer.parse("23-09-2026", { wordCount: 12, patterns: true }),
      mode: "seedshift",
      passphrase: "",
      limits: { maxResults: 10 },
      report: { progressEvery: 1000 },
    });
    vi.unstubAllEnvs();
    expect(lines).toContain("Recovery search contains 1 date combination.");
  });

  it("says the time alone after the size", () => {
    const plan = SearchPlan.of("1 date combination", 1, 120);
    expect(plan.tell).toBe(true);
    expect(plan.timeNotice()).toBe("It takes about 2 minutes; progress is shown.");
  });
});
