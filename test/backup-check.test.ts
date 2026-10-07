import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The check on the private screen runs with the terminal replaced, as in
// encode-decode-questions.test.ts: each question that reads a line takes the next of
// `terminal.answers`, and each list question the next of `terminal.choices`.
const terminal = vi.hoisted(() => ({ answers: [] as string[], choices: [] as unknown[] }));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => false,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => true,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
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
}));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async () => terminal.choices.shift(),
}));

import { checkShareBackup, offerShareCheck } from "../src/cli/backup-check.js";
import {
  EncodedBackupCheck,
  KeptShares,
  RESTORES_MESSAGE,
  ShareBackupCheck,
  type EncodedOriginal,
} from "../src/core/backup-check.js";
import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  parseDate,
  representMnemonic,
  type DateShiftDate,
} from "../src/core.js";
import { serializeRecord } from "../src/record.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { urToBytewords, writeShare } from "../src/sskr/transport.js";

/** The host's reader of an encoded seed phrase, which a phrase typed as shares is sent to. */
const TEXTS = { decodeEntry: "The Decode tab" };

// The public BIP39 test phrase and public dates of the examples.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DATE = "23-09-2026";
const OTHER_DATE = "24-09-2026";
const LATER_DATE = "01-10-2026";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { entropy: string; shares: string[] }[] };

/** The result that Encode shows for PHRASE with `dates` (none without Seedshift). */
function encoded(dates: readonly string[], format: EncodedOriginal["format"]): EncodedOriginal {
  const parsed = dates.map(parseDate);
  const result = parsed.length === 0 ? representMnemonic(PHRASE) : encodeMnemonic(PHRASE, parsed);
  return {
    mnemonic: PHRASE,
    format,
    mode: parsed.length === 0 ? "direct" : "seedshift",
    codes: result.shiftedIndexes,
    dates: parsed,
  };
}

/** The codes of `original` as written down, in its own form. */
function written(original: EncodedOriginal): string {
  return formatEncoded(
    original.mode === "direct" ? representMnemonic(PHRASE) : encodeMnemonic(PHRASE, original.dates),
    original.format,
  );
}

/** Word numbers with those at `places`, counted from 1, changed to other numbers. */
function changedAt(numbers: string, places: readonly number[]): string {
  return numbers
    .split(" ")
    .map((number, index) =>
      places.includes(index + 1) ? String((Number(number) % 2048) + 1) : number,
    )
    .join(" ");
}

describe("checking a written-down encoded seed phrase", () => {
  it("accepts the codes as written, with or without dates", async () => {
    const direct = new EncodedBackupCheck(encoded([], "indexes"));
    expect(direct.dated).toBe(false);
    expect(await direct.check({ backup: written(encoded([], "indexes")) })).toEqual({
      verdict: "restores",
      message: RESTORES_MESSAGE,
      notes: [],
    });
    const masked = encoded([DATE], "colors");
    const check = new EncodedBackupCheck(masked);
    expect(check.dated).toBe(true);
    expect((await check.check({ backup: written(masked), dates: DATE })).verdict).toBe("restores");
  });

  it("undoes the Original Seedshift too", async () => {
    const legacy = encodeMnemonicLegacy(PHRASE, [parseDate(DATE)]);
    const check = new EncodedBackupCheck({
      ...encoded([DATE], "indexes"),
      mode: "seedshift-legacy",
      codes: legacy.shiftedIndexes,
    });
    const backup = formatEncoded(legacy, "indexes");
    expect((await check.check({ backup, dates: DATE })).verdict).toBe("restores");
    expect((await check.check({ backup, dates: OTHER_DATE })).finding).toMatchObject({
      part: "dates",
      places: [1],
    });
  });

  it("names the codes that differ by their places", async () => {
    const original = encoded([DATE], "indexes");
    const check = new EncodedBackupCheck(original);
    const one = await check.check({ backup: changedAt(written(original), [5]), dates: DATE });
    expect(one.verdict).toBe("differs");
    expect(one.finding).toEqual({
      part: "codes",
      kind: "places",
      places: [5],
      message: "The code at place 5 differs from the result.",
    });
    const three = check.compareCodes(check.readCodes(changedAt(written(original), [2, 7, 12])));
    expect(three).toMatchObject({ places: [2, 7, 12] });
    expect(three?.message).toBe("The codes at places 2, 7 and 12 differ from the result.");
  });

  it("names a wrong date by its place, whatever the order of the dates", async () => {
    const original = encoded([DATE, LATER_DATE], "indexes");
    const check = new EncodedBackupCheck(original);
    const backup = written(original);
    expect((await check.check({ backup, dates: `${LATER_DATE} ${DATE}` })).verdict).toBe(
      "restores",
    );
    expect((await check.check({ backup, dates: `${LATER_DATE} ${OTHER_DATE}` })).finding).toEqual({
      part: "dates",
      kind: "places",
      places: [2],
      message: "Date 2 is not one of the dates of this backup.",
    });
    expect((await check.check({ backup, dates: DATE })).finding).toMatchObject({
      part: "dates",
      kind: "count",
      message: "The backup was made with 2 dates; 1 was typed.",
    });
    expect(check.compareDates([parseDate(OTHER_DATE), parseDate("02-10-2026")])?.message).toBe(
      "Dates 1 and 2 are not dates of this backup.",
    );
  });

  it("reads a record in its own form, and names a record of another mode", async () => {
    const original = encoded([DATE], "indexes");
    const check = new EncodedBackupCheck(original);
    const colors = formatEncoded(encodeMnemonic(PHRASE, original.dates), "colors");
    const record = serializeRecord("seedshift", "colors", colors);
    expect((await check.check({ backup: record, dates: DATE })).verdict).toBe("restores");
    const legacy = serializeRecord("seedshift-legacy", "indexes", written(original));
    expect((await check.check({ backup: legacy, dates: DATE })).finding).toEqual({
      part: "codes",
      kind: "mode",
      places: [],
      message:
        "This record names the Original Seedshift; the backup was made with MnemoCode Seedshift.",
    });
  });

  it("tells codes or dates that cannot be read, naming places only", async () => {
    const check = new EncodedBackupCheck(encoded([DATE], "indexes"));
    expect(await check.check({ backup: "1 2 3", dates: DATE })).toMatchObject({
      verdict: "unreadable",
      finding: {
        part: "codes",
        kind: "unreadable",
        message: "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      },
    });
    expect((await check.check({ backup: "not a backup", dates: DATE })).verdict).toBe("unreadable");
    const date = await check.check({ backup: written(encoded([DATE], "indexes")), dates: "32-09" });
    expect(date.finding).toMatchObject({ part: "dates", kind: "unreadable" });
    expect(date.message).toMatch(/^Date 1: /u);
    expect(date.message).not.toContain("32-09");
  });

  it("does not check the Original Seedshift with a valid last word", () => {
    expect(EncodedBackupCheck.supports("seedshift-legacy-valid")).toBe(false);
    expect(EncodedBackupCheck.supports("seedshift-legacy")).toBe(true);
    expect(
      () =>
        new EncodedBackupCheck({ ...encoded([DATE], "indexes"), mode: "seedshift-legacy-valid" }),
    ).toThrow(/cannot be checked/u);
  });
});

describe("checking written-down Shamir shares", () => {
  const masked = encodeMnemonic(PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
  const dates: readonly DateShiftDate[] = [parseDate(DATE)];

  it("accepts enough shares, in any written form, with the dates", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    expect(await checkShareBackup(PHRASE, `${shares[0]};${shares[2]}`, "direct", "")).toBe(
      "restores",
    );
    const words = `${urToBytewords(shares[1]!)};${urToBytewords(shares[2]!)}`;
    expect(await checkShareBackup(PHRASE, words, "direct", "")).toBe("restores");
    const maskedShares = await splitSskrMnemonic(masked, 2, 3);
    const typed = `${maskedShares[0]};${maskedShares[1]}`;
    expect(await checkShareBackup(PHRASE, typed, "seedshift", DATE)).toBe("restores");
    expect(await checkShareBackup(PHRASE, typed, "seedshift", OTHER_DATE)).toBe("differs");
    expect(await checkShareBackup(PHRASE, shares[0]!, "direct", "")).toBe("unreadable");
  });

  it("leaves out an exact copy of a share once, as sskr-combine does", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    // The same share in words is a copy too: it is the same share once read.
    const copy = await check.check({
      backup: `${shares[0]};${urToBytewords(shares[0]!)};${shares[1]}`,
    });
    expect(copy).toEqual({
      verdict: "restores",
      message: RESTORES_MESSAGE,
      notes: ["Share 2 is a copy of share 1: it is used once."],
    });
    expect(
      await checkShareBackup(PHRASE, `${shares[2]};${shares[0]};${shares[2]}`, "direct", ""),
    ).toBe("restores");
    const alone = await check.check({ backup: `${shares[1]};${shares[1]}` });
    expect(alone).toMatchObject({
      verdict: "unreadable",
      message: "Once the copies are left out, one share is left; type 2 different shares.",
      notes: ["Share 2 is a copy of share 1: it is used once."],
    });
  });

  it("names a share that cannot be read by its place", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    const result = await check.check({ backup: `${shares[0]};not a share` });
    expect(result.finding).toMatchObject({ part: "shares", kind: "unreadable", places: [2] });
    expect(result.message).toMatch(/^Share 2 cannot be read: /u);
    expect((await check.check({ backup: shares[0]! })).message).toBe(
      "This is one share; type 2, separated by ;.",
    );
  });

  it("reads the shares by the rules of the restore: line breaks, wrapped shares, phrases, marks", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    // One share per line, as a page's field holds them.
    expect((await check.check({ backup: `${shares[0]}\n${shares[2]}` })).verdict).toBe("restores");
    // A share in words that a paste wrapped over two lines, which the CLI hands on as ;.
    const words = urToBytewords(shares[1]!).split(" ");
    const wrapped = `${words.slice(0, 8).join(" ")};${words.slice(8).join(" ")}`;
    expect((await check.check({ backup: `${shares[0]};${wrapped}` })).verdict).toBe("restores");
    // A seed phrase typed in place of the shares is named as one, with the host's reader.
    expect((await check.check({ backup: PHRASE })).message).toBe(
      "This is a seed phrase in words, not a Shamir share: The Decode tab reads a masked one.",
    );
    // At most as many marks as a repair takes (JointRepair.MAX_MARKED_ELEMENTS).
    const many = Array.from({ length: 70 }, () => "?").join(" ");
    expect((await check.check({ backup: `${shares[0]};${many}` })).message).toBe(
      "Share 2: mark at most 64 unreadable elements with ?.",
    );
  });

  it("tells shares of another phrase from a wrong date", async () => {
    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "seedshift", threshold: 2, dates },
      nodeSharePlatform,
      TEXTS,
    );
    expect(check.dated).toBe(true);
    const maskedShares = await splitSskrMnemonic(masked, 2, 3);
    const typed = `${maskedShares[0]};${maskedShares[2]}`;
    expect((await check.check({ backup: typed, dates: DATE })).verdict).toBe("restores");
    expect((await check.check({ backup: typed, dates: OTHER_DATE })).finding).toEqual({
      part: "dates",
      kind: "places",
      places: [1],
      message: "Date 1 is not one of the dates of this backup.",
    });
    const others = await splitSskrMnemonic(PHRASE, 2, 3);
    expect(
      (await check.check({ backup: `${others[0]};${others[1]}`, dates: DATE })).finding,
    ).toEqual({
      part: "shares",
      kind: "other-phrase",
      places: [],
      message: "These shares restore another seed phrase: they are not of this backup.",
    });
    // Without the dates of the result, a wrong date gives another seed phrase.
    const unknown = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "seedshift", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    expect((await unknown.check({ backup: typed, dates: OTHER_DATE })).finding).toMatchObject({
      part: "dates",
      kind: "other-phrase",
    });
  });

  it("names unchecked shares by their places among those typed, also after a copy", async () => {
    const vector = vectors.deterministic[1]!;
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    // Every element of the third share unreadable: the phrase does not depend on it.
    const missing = writeShare(vector.shares[2]!, "indexes")
      .split(" ")
      .map(() => "?")
      .join(" ");
    const check = new ShareBackupCheck(
      { mnemonic: expected, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    );
    const typed = [vector.shares[0], vector.shares[0], vector.shares[1], missing].join(";");
    expect(await check.check({ backup: typed })).toEqual({
      verdict: "unchecked",
      message:
        "The phrase matches, but some shares or repaired elements were not checked. Supply complete groups and check the marks.",
      finding: {
        part: "shares",
        kind: "unchecked",
        places: [4],
        message:
          "The phrase matches, but some shares or repaired elements were not checked. Supply complete groups and check the marks.",
      },
      notes: ["Share 2 is a copy of share 1: it is used once."],
    });
  });
});

describe("what a backup check hands out", () => {
  const REDACTED = "[backup check: redacted]";

  it("shows no code, share or phrase through toString, toJSON or inspect", async () => {
    const original = encoded([DATE], "indexes");
    const codes = new EncodedBackupCheck(original).readCodes(written(original));
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const kept = KeptShares.of([shares[0]!, shares[1]!]);
    const restored = await new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      TEXTS,
    ).restore(kept);
    expect(restored.holds(PHRASE)).toBe(true);
    for (const value of [codes, kept, restored]) {
      expect(String(value)).toBe(REDACTED);
      expect(JSON.stringify({ value })).toBe(JSON.stringify({ value: REDACTED }));
      expect(inspect(value, { showHidden: true, getters: true })).toBe(REDACTED);
    }
  });
});

describe("the share check on the private screen", () => {
  let notices: string[];
  beforeEach(() => {
    terminal.answers = [];
    terminal.choices = [];
    notices = [];
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      notices.push(line.join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses a copy of a share once, with a note, and asks again when too few are left", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    terminal.answers = [
      `${shares[1]};${urToBytewords(shares[1]!)}\r`,
      `${shares[0]};${shares[0]};${shares[2]}\r`,
    ];
    terminal.choices = [true];
    await offerShareCheck(PHRASE, "direct", 2, () => undefined);
    expect(notices.filter((line) => line !== "")).toEqual([
      "Share 2 is a copy of share 1: it is used once.",
      "Once the copies are left out, one share is left; type 2 different shares.",
      "Share 2 is a copy of share 1: it is used once.",
      RESTORES_MESSAGE,
    ]);
  });
});
