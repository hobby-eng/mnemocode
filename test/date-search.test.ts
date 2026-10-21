import { mkdtemp, readdir, rm } from "node:fs/promises";
import { CandidatesFile } from "../src/cli/candidates-file.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { encodeMnemonic, encodeMnemonicLegacy, parseDate } from "../src/core.js";
import { reportDateMatches, searchDates } from "../src/cli/date-search.js";
import {
  DatesAnswer,
  HARD_MAX_COMBINATIONS,
  type DateSearchResult,
} from "../src/core/date-search.js";
import { FINGERPRINT_WARNING } from "../src/core/wallet-check.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { TEXT_WIDTH } from "../src/cli/terminal.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { refusalOf } from "./helpers/refusals.js";

// The clock of the searches is the test's own where a test spies on performance.now: then the
// host's PBKDF2, which each wallet check of a fingerprint runs once, moves it on by
// `clock.perCheck` milliseconds, as on a computer where one check takes that long.
const clock = vi.hoisted(() => ({ now: 0, perCheck: 0 }));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return {
    ...actual,
    pbkdf2Sync: (...derive: Parameters<typeof actual.pbkdf2Sync>) => {
      clock.now += clock.perCheck;
      return actual.pbkdf2Sync(...derive);
    },
  };
});

/** The result of a search that was made and not stopped. */
function made(result: DateSearchResult | undefined | Cancelled): DateSearchResult {
  if (result === undefined || result === CANCELLED) throw new Error("No search was made.");
  return result;
}
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { firstReceivingOf } from "./helpers/coin-addresses.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { p2wpkh } from "@scure/btc-signer";
import {
  DATE,
  MASKED,
  replacedAt,
  TEST_ADDRESS,
  TEST_FINGERPRINT,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";

/** The test phrase masked with the original Seedshift and 10-07-1963 and 23-09-2026. */
const LEGACY_MASKED =
  "voice abstract access wool abuse actual voice abstract access wool abuse addict";

describe("dates of one answer", () => {
  it("reads complete dates and, where they can be searched, dates with ?", () => {
    const answer = DatesAnswer.parse(`${DATE}, 2026-09-24 ?3-09-2026`, {
      wordCount: 12,
      patterns: true,
    });
    expect(answer.known).toEqual([parseDate(DATE), parseDate("24-09-2026")]);
    expect(answer.patterns.map((pattern) => pattern.days)).toEqual([[3, 13, 23]]);
    expect(answer.combinations).toBe(3);
    expect(DatesAnswer.parse(DATE, { patterns: false }).combinations).toBe(1);
  });

  /** Expects `line` refused with `message`, in one line that repeats no date as typed. */
  function refusedInOneLine(line: string, patterns: boolean, message: string): void {
    const thrown = refusalOf(() => DatesAnswer.parse(line, { wordCount: 12, patterns }));
    expect(thrown.message).toContain(message);
    expect(thrown.message).not.toContain("\n");
    for (const date of line.split(/[\s,;]+/u).filter(Boolean))
      expect(thrown.message).not.toContain(date);
  }

  it.each([
    // The example in the message is the public README date, not one typed.
    ["24-09-2026 24-09-26", true, "Date 2: use DD-MM-YYYY with a four-digit year"],
    ["31-02-2020", true, "Date 1: the day is outside the selected calendar month."],
    [`${DATE} 2?-13-2026`, true, "Date 2: the date pattern cannot match a valid month."],
    [`${DATE} 2?-09-26`, true, "Date 2: use DD-MM-YYYY with ? for each forgotten digit"],
  ])(
    "refuses %j (patterns %s) in one line that names the date by its place",
    (line, patterns, message) => refusedInOneLine(line, patterns, message),
  );

  it.each([
    ["", true, "Type at least one date."],
    [" ,; ", true, "Type at least one date."],
    [Array<string>(5).fill(DATE).join(" "), true, "at most 4 dates."],
    ["?1-01-2020 ?2-01-2020 ?3-01-2020 ?4-01-2020", true, "at most 3 incomplete dates."],
    ["? ?", true, "exceeds the safety limit"],
    ["2?-09-2026", false, "? and | stand for what is forgotten only where MnemoCode can search"],
  ])("refuses %j (patterns %s) in one line that repeats no date", (line, patterns, message) =>
    refusedInOneLine(line, patterns, message),
  );

  it("counts the combinations up to the limit", () => {
    const wide = DatesAnswer.parse("??-??-2026 ??-??-2027", { patterns: true });
    expect(wide.combinations).toBe(365 * 365);
    expect(wide.combinations).toBeLessThan(HARD_MAX_COMBINATIONS);
  });
});

describe("the original Seedshift", () => {
  it("masks the test phrase with 10-07-1963 and 23-09-2026 into its own output, which the searches below start from", () => {
    // LEGACY_MASKED, the fixture above, is the original Seedshift's own output for these dates.
    const legacy = encodeMnemonicLegacy(TEST_PHRASE, [parseDate("10-07-1963"), parseDate(DATE)]);
    expect(legacy.shiftedEnglish.join(" ")).toBe(LEGACY_MASKED);
  });
});

let lines: string[];

/** Records what each test writes, without colour, and puts the writers back after it. */
function recordLinesOfEachTest(): void {
  beforeEach(() => {
    lines = [];
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      lines.push(`out ${line.join(" ")}`);
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      lines.push(`err ${line.join(" ")}`);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
}

describe("the date search", () => {
  recordLinesOfEachTest();

  it("returns the matches, the checksum-valid candidates and every match for a list", async () => {
    const encoded = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);
    const dates = DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true });
    const search = {
      indexes: encoded.shiftedIndexes,
      dates,
      mode: "seedshift" as const,
      passphrase: "",
      limits: { maxResults: 100 },
      report: { progressEvery: 1000 },
    };
    const all = made(await searchDates(search));
    // MnemoCode Seedshift gives a valid phrase for every date.
    expect(all).toMatchObject({ combinations: 10, checksumValid: 10, matchCount: 10 });
    expect(all.kept).toEqual([]);
    const matched = made(
      await searchDates({
        ...search,
        evidence: { kind: "master-fingerprint", value: TEST_FINGERPRINT, network: "mainnet" },
        target: await CandidatesFile.of({
          "candidates-file": "unused.age",
          "plaintext-candidates": true,
        }),
      }),
    );
    expect(matched).toMatchObject({ checksumValid: 10, matchCount: 1, kept: [TEST_PHRASE] });
    expect(matched.shown).toEqual([
      {
        dates: DATE,
        allDates: [{ year: 2026, month: 9, day: 23 }],
        mnemonic: TEST_PHRASE,
        evidence: "m",
        warning: FINGERPRINT_WARNING,
      },
    ]);
    // The size of each search first, then its progress.
    expect(lines).toEqual([
      "err Recovery search contains 10 date combinations.",
      "err Checked 10/10 date combinations; found 10 matches.",
      "err Recovery search contains 10 date combinations.",
      "err Checked 10/10 date combinations; found 1 match.",
    ]);
  });

  it("asks for a search longer than twelve hours, which needs --max-candidates without a screen", async () => {
    const encoded = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);
    const search = {
      indexes: encoded.shiftedIndexes,
      dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
      mode: "seedshift" as const,
      evidence: {
        kind: "master-fingerprint" as const,
        value: TEST_FINGERPRINT,
        network: "mainnet" as const,
      },
      passphrase: "",
      limits: { maxResults: 100 },
      report: { progressEvery: 1000 },
    };
    // A wallet check of 5,000 seconds on this computer's clock, which nothing else moves on: ten
    // of them take longer than twelve hours.
    clock.perCheck = 5_000_000;
    onTestFinished(() => {
      clock.perCheck = 0;
    });
    vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    await expect(searchDates(search)).rejects.toThrow(
      "The search tries 10 date combinations, about 14 hours. Allow it with --max-candidates 10.",
    );
    // The person's own limit counts combinations instead.
    const allowed = await searchDates({
      ...search,
      limits: { maxResults: 100, maxCandidates: 10 },
    });
    expect(allowed).toMatchObject({ matchCount: 1 });
    // The size is said once, then the time alone (CC-09).
    expect(lines).toContain("err Recovery search contains 10 date combinations.");
    expect(lines).toContain("err It takes about 14 hours; progress is shown.");
    expect(lines.filter((line) => line.startsWith("err The search tries"))).toEqual([]);
  });

  it("says that no candidate matched the wallet when there were checksum-valid ones", () => {
    const evidence = { kind: "master-fingerprint", value: "00000000", network: "mainnet" } as const;
    const empty = {
      combinations: 10,
      checksumValid: 10,
      matchCount: 0,
      shown: [],
      kept: [],
      checked: 10,
      stopped: false,
    };
    reportDateMatches(empty, { mode: "seedshift", evidence, maxResults: 100 });
    reportDateMatches({ ...empty, checksumValid: 0 }, { mode: "seedshift-legacy", maxResults: 1 });
    expect(lines).toEqual([
      "out None of the 10 checksum-valid candidates matched the requested master fingerprint.",
      "out No candidate with a valid BIP39 checksum was found.",
    ]);
  });

  it("wraps that sentence at the text width on a terminal, and keeps it on one line elsewhere", () => {
    const evidence = {
      kind: "master-xpub",
      value: "xpub-public-fixture",
      network: "mainnet",
    } as const;
    const empty = {
      combinations: 10,
      checksumValid: 10,
      matchCount: 0,
      shown: [],
      kept: [],
      checked: 10,
      stopped: false,
    };
    const sentence =
      "None of the 10 checksum-valid candidates matched the requested master extended public key.";
    reportDateMatches(empty, { mode: "seedshift", evidence, maxResults: 100 });
    expect(lines).toEqual([`out ${sentence}`]);
    lines = [];
    vi.stubEnv("TERM", "xterm");
    streamsAsTerminal();
    reportDateMatches(empty, { mode: "seedshift", evidence, maxResults: 100 });
    const wrapped = lines.slice(lines.findIndex((line) => line.startsWith("out None of")));
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) expect(line.length - "out ".length).toBeLessThanOrEqual(TEXT_WIDTH);
    // Broken at spaces only: no word, nor the wallet's label, is cut inside.
    expect(wrapped.map((line) => line.slice("out ".length)).join(" ")).toBe(sentence);
  });

  it("opens a step screen of its own before it says the size of the search", async () => {
    const encoded = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]);
    PrivateSteps.open(
      () => lines.push("step screen"),
      () => undefined,
    );
    try {
      await searchDates({
        indexes: encoded.shiftedIndexes,
        dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
        mode: "seedshift",
        passphrase: "",
        limits: { maxResults: 100 },
        report: { progressEvery: 1000 },
      });
    } finally {
      PrivateSteps.close();
    }
    // The dates typed before are no longer on the screen while the search runs (CORE-39).
    expect(lines).toEqual([
      "step screen",
      "err Recovery search contains 10 date combinations.",
      "err Checked 10/10 date combinations; found 10 matches.",
    ]);
  });
});

describe("the date search", () => {
  recordLinesOfEachTest();

  // What recover-date printed before its search moved to date-search.ts (dist built 2026-10-06
  // 11:06 from 2c3ec5b and the earlier uncommitted work), standard output and standard error.
  it.each([
    [
      "the original Seedshift, two incomplete dates",
      [
        "--mode",
        "seedshift-legacy",
        "--input",
        LEGACY_MASKED,
        "--dates",
        "?0-07-1963",
        "2?-09-2026",
        "--max-candidates",
        "100",
      ],
      [
        "err Detected input format: english.",
        "err Recovery search contains 30 date combinations.",
        "err Checked 30/30 date combinations; found 2 matches.",
        `out 10-07-1963 22-09-2026\t${replacedAt(TEST_PHRASE, { 6: "ability", 12: "above" })}`,
        `out 10-07-1963 ${DATE}\t${TEST_PHRASE}`,
        "err A valid checksum does not prove the date: compare an address.",
        "err More: https://github.com/hobby-eng/mnemocode#exact-local-recovery-checks",
      ],
    ],
    [
      "MnemoCode Seedshift with the fingerprint",
      [
        "--mode",
        "seedshift",
        "--input",
        MASKED,
        "--dates",
        "2?-09-2026",
        "--master-fingerprint",
        TEST_FINGERPRINT,
        "--progress-every",
        "4",
      ],
      [
        "err Detected input format: indexes.",
        "err Recovery search contains 10 date combinations.",
        "err Checked 4/10 date combinations; found 1 match.",
        "err Checked 8/10 date combinations; found 1 match.",
        "err Checked 10/10 date combinations; found 1 match.",
        `out ${DATE}\t${TEST_PHRASE}\tmatched at m`,
        "err Each displayed candidate matched the requested master fingerprint locally.",
        `err ${FINGERPRINT_WARNING}`,
      ],
    ],
    [
      "more matches than are shown",
      [
        "--mode",
        "seedshift-legacy",
        "--input",
        LEGACY_MASKED,
        "--dates",
        "??-07-1963",
        DATE,
        "--max-results",
        "1",
      ],
      [
        "err Detected input format: english.",
        "err Recovery search contains 31 date combinations.",
        "err Checked 31/31 date combinations; found 3 matches.",
        `out 08-07-1963\t${replacedAt(TEST_PHRASE, { 3: "able", 9: "able" })}`,
        "err Displayed 1 of 3 checksum-valid candidates.",
        "err A valid checksum does not prove the date: compare an address.",
        "err More: https://github.com/hobby-eng/mnemocode#exact-local-recovery-checks",
      ],
    ],
  ])("prints from the command line as before: %s", async (_, argv, expected) => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    await runRecoverDate(parseArguments(argv));
    expect(lines).toEqual(expected);
  });
});

describe("the date search", () => {
  recordLinesOfEachTest();

  it("finds the dates by an address of another coin, at its path", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    // The Ethereum address of the public test phrase at m/44'/60'/0'/0/0 (mhfe's vectors).
    await runRecoverDate(
      parseArguments([
        "--mode",
        "seedshift",
        "--input",
        MASKED,
        "--format",
        "indexes",
        "--dates",
        "2?-09-2026",
        "--coin",
        "ethereum",
        "--coin-address",
        firstReceivingOf("ethereum"),
      ]),
    );
    expect(lines).toContain(`out ${DATE}\t${TEST_PHRASE}\tmatched at m/44'/60'/0'/0/0`);
    expect(lines).toContain(
      "err Each displayed candidate matched the requested address of Ethereum and EVM networks locally.",
    );
    // The coin's address tells its own network and type; --coin needs the address.
    await expect(
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--coin",
          "ethereum",
        ]),
      ),
    ).rejects.toThrow("--coin names the coin of --coin-address.");
    await expect(
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--coin",
          "ethereum",
          "--coin-address",
          firstReceivingOf("ethereum"),
          "--network",
          "testnet",
        ]),
      ),
    ).rejects.toThrow("--network is for Bitcoin evidence");
  });
});

describe("the date search", () => {
  recordLinesOfEachTest();

  it("compares an address with the first 20 from --index, or as many as --scan-gap says", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    // The twentieth receiving address of BIP84, written by @scure/btc-signer: the last of the 20.
    const key = HDKey.fromMasterSeed(mnemonicToSeedSync(TEST_PHRASE)).derive("m/84'/0'/0'/0/19");
    const twentieth = p2wpkh(key.publicKey!).address!;
    const search = (...more: string[]) =>
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--bitcoin-address",
          twentieth,
          ...more,
        ]),
      );
    const found = `out ${DATE}\t${TEST_PHRASE}\tmatched at m/84'/0'/0'/0/19`;
    await search();
    expect(lines).toContain(found);
    lines.length = 0;
    await search("--scan-gap", "19");
    expect(lines.filter((line) => line.startsWith("out "))).toEqual([
      "out None of the 10 checksum-valid candidates matched the requested address.",
    ]);
    lines.length = 0;
    await search("--index", "19", "--scan-gap", "1");
    expect(lines).toContain(found);
    await expect(search("--scan-gap", "0")).rejects.toThrow(
      "must be a base-10 integer from 1 through 1000",
    );
    await expect(
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--master-fingerprint",
          TEST_FINGERPRINT,
          "--scan-gap",
          "5",
        ]),
      ),
    ).rejects.toThrow("--scan-gap applies to an address, a compressed public key or a WIF");
  });

  it("refuses options that place a wallet where nothing would use them", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    const search = (...more: string[]) =>
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          ...more,
        ]),
      );
    // A master key has no place in an account.
    await expect(search("--master-fingerprint", TEST_FINGERPRINT, "--index", "7")).rejects.toThrow(
      "--index places an address, a key or a WIF; a master key has no place.",
    );
    // Without a wallet, from the command line as on the screen.
    await expect(
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift-legacy",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--account",
          "2",
        ]),
      ),
    ).rejects.toThrow(
      "--account applies to a wallet given as an option, such as --bitcoin-address.",
    );
    // The first 20 addresses never pass the last index: a high --index compares those left.
    lines.length = 0;
    await search("--bitcoin-address", TEST_ADDRESS, "--index", "2147483640");
    expect(lines.filter((line) => line.startsWith("out "))).toEqual([
      "out None of the 10 checksum-valid candidates matched the requested address.",
    ]);
  });
});

describe("the date search", () => {
  recordLinesOfEachTest();

  it("says that no list was written when nothing matched", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-date-list-"));
    try {
      await runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift",
          "--input",
          MASKED,
          "--dates",
          "2?-09-2026",
          "--master-fingerprint",
          "00000000",
          "--candidates-file",
          join(directory, "none.mncl"),
          "--plaintext-candidates",
        ]),
      );
      expect(lines.slice(-2)).toEqual([
        "out None of the 10 checksum-valid candidates matched the requested master fingerprint.",
        "err No candidate to save, so no list was written.",
      ]);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses options that cannot be used before it reads anything", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    const run = (...argv: string[]) => runRecoverDate(parseArguments(argv));
    await expect(run("--mode", "direct", "--input-file", "missing.txt")).rejects.toThrow(
      "only when a Seedshift mode is selected",
    );
    await expect(
      run("--mode", "seedshift", "--input-file", "missing.txt", "--master-fingerprint", "zz"),
    ).rejects.toThrow("eight hexadecimal characters");
    await expect(
      run(
        "--input-file",
        "missing.txt",
        "--bitcoin-address",
        "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      ),
    ).rejects.toThrow("it is a testnet address");
    await expect(run("--input-file", "missing.txt", "--format", "9")).rejects.toThrow(
      "representation format",
    );
    await expect(
      run("--mode", "seedshift", "--input", MASKED, "--dates", "2?-09-2026"),
    ).rejects.toThrow("Provide a master fingerprint");
  });

  it("names a wrong date by its place from the command line too", async () => {
    const { parseArguments } = await import("../src/cli/arguments.js");
    await expect(
      runRecoverDate(
        parseArguments([
          "--mode",
          "seedshift-legacy",
          "--input",
          LEGACY_MASKED,
          "--dates",
          "2?-09-2026",
          "31-02-2020",
        ]),
      ),
    ).rejects.toThrow("Date 2: the day is outside the selected calendar month.");
  });
});
