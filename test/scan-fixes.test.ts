// The findings of the DRY/OOP scan of 2026-10-09, each with a case that would fail without its fix:
// S001 to S015 and the steps of ShareRestore (S002, S123, S139) here, the others in the files
// scan-fixes-*.test.ts. Public test data only: the BIP39 test phrase and the public SSKR vectors.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArguments } from "../src/cli/arguments.js";
import { runDecode } from "../src/cli/decode-command.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { Masking, SPLIT_MODES_ONLY } from "../src/core/masking.js";
import { MASKING_MODES } from "../src/core/types.js";
import { duration } from "../src/core/search-plan.js";
import { markUnits } from "./helpers/shares.js";
import { publicShare, sskrVectors } from "./helpers/vectors.js";
import {
  DATE,
  DATE_LAST_DIGIT_FORGOTTEN,
  MASKED_WORDS,
  OTHER_PHRASE,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";
import type { MoreWithin, NextByte } from "../src/cli/terminal-keys.js";

// The BIP39 library as it is, with the turning of a phrase into entropy watched: S005's case keeps
// the entropy of each phrase to see that it is wiped. Every other call works as without the spy.
vi.mock("@scure/bip39", async (importOriginal) => {
  const library = await importOriginal<typeof import("@scure/bip39")>();
  return { ...library, mnemonicToEntropy: vi.fn(library.mnemonicToEntropy) };
});

/** The first share of the public SSKR vectors (vectors/sskr-v1.json). */
const PUBLIC_SHARE = publicShare();

describe("S001, S019: the modes of shares, sheets for heirs and replaced last words are Masking's", () => {
  it("derives which modes split and which take a sheet from the variants", () => {
    expect(MASKING_MODES.filter((mode) => Masking.isSplitMode(mode))).toEqual([
      "direct",
      "seedshift",
    ]);
    expect(MASKING_MODES.filter((mode) => Masking.isHeirSheetMode(mode))).toEqual([
      "direct",
      "seedshift",
      "seedshift-legacy",
    ]);
    expect(() => Masking.assertSplitMode("seedshift-legacy")).toThrow(SPLIT_MODES_ONLY);
    expect(() => Masking.assertHeirSheetMode("seedshift-legacy-valid")).toThrow(
      "A sheet for heirs cannot be made for the Original Seedshift with a valid last word",
    );
    expect(MASKING_MODES.filter((mode) => Masking.isMaskedMode(mode))).toEqual([
      "seedshift",
      "seedshift-legacy",
      "seedshift-legacy-valid",
    ]);
  });

  it("knows which mode a replaced last word gives, and that it is not encoded directly", () => {
    expect(Masking.of("seedshift-legacy").withValidLastWord?.mode).toBe("seedshift-legacy-valid");
    expect(Masking.of("seedshift").withValidLastWord).toBeUndefined();
    expect(Masking.of("seedshift-legacy-valid").encodable).toBe(false);
    expect(() => EncodedBackup.assertEncodable("seedshift-legacy-valid")).toThrow(
      "select legacy Seedshift",
    );
    expect(() => EncodedBackup.assertEncodable("seedshift", { validLastWord: true })).toThrow(
      "available only in legacy Seedshift mode",
    );
  });
});

describe("S003: codes given with the options are read as typed ones are", () => {
  it("refuses a Shamir share in decode and recover-date, naming the share reader", async () => {
    await expect(runDecode(parseArguments(["--input", PUBLIC_SHARE]))).rejects.toThrow(
      "This is a Shamir share, not an encoded seed phrase: Restore a seed phrase from Shamir shares reads it.",
    );
    await expect(
      runRecoverDate(parseArguments(["--input", PUBLIC_SHARE, "--date", "2?-09-2026"])),
    ).rejects.toThrow(
      "This is a Shamir share, not an encoded seed phrase: Restore a seed phrase from Shamir shares reads it.",
    );
  });

  it("refuses codes that fit no form in decode and recover-date", async () => {
    // The library's reason for codes that fit no form, not a refusal of the date or the wallet.
    const codes = "not codes at all";
    await expect(
      runRecoverDate(parseArguments(["--input", codes, "--date", "2?-09-2026"])),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "core.words.enter-english-bip39-words",
        message: "Enter 12, 15, 18, 21 or 24 English BIP39 words.",
      }),
    );
  });
});

describe("S005: the candidate list is written by one library writer", () => {
  it("writes a list, tells an empty and a full one, and wipes every entropy", async () => {
    const { CandidateListWriter } = await import("../src/core/candidate-list-writer.js");
    const { NoProtection } = await import("../src/core/candidate-encryption.js");
    const { decodeCandidateList, LIST_KEEP, MAX_CANDIDATE_RECORDS, candidateListHolds } =
      await import("../src/core/candidate-list.js");
    const writer = new CandidateListWriter(new NoProtection(), "TREZOR");
    const made = await writer.writePhrases([TEST_PHRASE]);
    expect(made.kind).toBe("list");
    if (made.kind !== "list") return;
    expect(decodeCandidateList(made.list.bytes)).toMatchObject({ passphrase: "TREZOR" });
    expect(made.list.records).toBe(1);
    expect((await writer.writePhrases([])).kind).toBe("empty");
    expect(
      (await writer.writePhrases(Array.from({ length: LIST_KEEP }, () => TEST_PHRASE))).kind,
    ).toBe("full");
    expect(candidateListHolds(MAX_CANDIDATE_RECORDS)).toBe(true);
    expect(candidateListHolds(LIST_KEEP)).toBe(false);
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    await writer.write([entropy]);
    expect(entropy.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a bad phrase after the first and leaves nothing of the first", async () => {
    const { CandidateListWriter } = await import("../src/core/candidate-list-writer.js");
    const { NoProtection } = await import("../src/core/candidate-encryption.js");
    const { mnemonicToEntropy } = await import("@scure/bip39");
    const turned = vi.mocked(mnemonicToEntropy);
    turned.mockClear();
    // A public BIP39 vector whose entropy is not zero (0x7f repeated), so that a wipe shows.
    await expect(
      new CandidateListWriter(new NoProtection()).writePhrases([OTHER_PHRASE, "not a phrase"]),
    ).rejects.toHaveProperty("code", "core.bip39-sizes.expected-word-indexes");
    const made = turned.mock.results[0];
    if (made?.type !== "return")
      throw new Error("The first phrase must have been turned into entropy.");
    const entropy = made.value;
    expect(entropy).toHaveLength(16);
    expect(entropy.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a phrase that is none by the code of its condition, never naming a word", async () => {
    const { CandidateListWriter } = await import("../src/core/candidate-list-writer.js");
    const { NoProtection } = await import("../src/core/candidate-encryption.js");
    // What writing `phrase` ends with: its refusal, or "written", which no refusal below matches.
    const refusal = (phrase: string): Promise<unknown> =>
      new CandidateListWriter(new NoProtection()).writePhrases([phrase]).then(
        () => "written",
        (error: unknown) => error,
      );
    // @scure/bip39's own error names the word it does not know: neither it nor its text is kept.
    const unknown = await refusal(OTHER_PHRASE.replace("wave", "wavx"));
    expect(unknown).toMatchObject({
      code: "core.english-words.word-not-english-bip39-list",
      message: "A word is not in the English BIP39 list.",
    });
    expect(unknown).not.toHaveProperty("cause");
    const checksum = await refusal(OTHER_PHRASE.replace("yellow", "year"));
    expect(checksum).toMatchObject({
      code: "core.candidate-list-writer.phrase-fails-bip39-checksum",
      message: "A candidate's phrase fails its BIP39 checksum.",
    });
    expect(checksum).not.toHaveProperty("cause");
    // Two spaces leave an empty word, as the library splits a phrase.
    const spaced = await refusal(OTHER_PHRASE.replace(" ", "  "));
    expect(spaced).toHaveProperty("code", "core.bip39-sizes.expected-word-indexes");
  });
});

describe("S010: complete and marked codes are read with the same separators", () => {
  it("reads a complete share written with commas, as its marked text is", async () => {
    const { readShare, writeShare } = await import("../src/sskr/transport.js");
    for (const format of ["colors", "unicode", "indexes"] as const) {
      const written = writeShare(PUBLIC_SHARE, format);
      const elements = format === "unicode" ? written.match(/.{4}/gu)! : written.split(" ");
      expect(readShare(elements.join(", ")).ur, format).toBe(PUBLIC_SHARE);
      expect(readShare(elements.join(";")).ur, format).toBe(PUBLIC_SHARE);
    }
  });

  it("reads the codes of a phrase with the same separators", async () => {
    const { parseInput, formatEncoded, representMnemonic } = await import("../src/core.js");
    const result = representMnemonic(TEST_PHRASE);
    for (const format of ["indexes", "unicode", "colors"] as const) {
      const written = formatEncoded(result, format);
      const elements = format === "unicode" ? written.match(/.{4}/gu)! : written.split(" ");
      expect(parseInput(elements.join(", "), format), format).toEqual(result.shiftedIndexes);
    }
  });
});

describe("S015: a list question drops what was typed before it", () => {
  afterEach(() => {
    vi.doUnmock("../src/cli/terminal-input.js");
    vi.resetModules();
  });

  it("drops typed-ahead keys before it reads an answer", async () => {
    const events: string[] = [];
    vi.resetModules();
    vi.doMock("../src/cli/terminal-input.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
      class WatchedKeys extends actual.TerminalKeys {
        static override async dropTypedAhead(): Promise<undefined> {
          events.push("drop");
          return undefined;
        }

        static override async withRawMode<T>(
          body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
        ): Promise<T> {
          events.push("read");
          // Escape alone, as nothing follows it: the question goes back.
          const keys = [0x1b];
          return body(
            async () => keys.shift(),
            async () => false,
          );
        }
      }
      return { ...actual, TerminalKeys: WatchedKeys };
    });
    const { choose } = await import("../src/cli/terminal-choice.js");
    await choose("Which?", [{ label: "One", value: 1 }], { label: "Next" });
    expect(events.slice(0, 2)).toEqual(["drop", "read"]);
  });
});

describe("S002, S123: ShareRestore holds the steps of a restore and a repair", () => {
  const { shares } = sskrVectors().deterministic[0]!;
  const [first, second] = [shares[0]!, shares[1]!];

  async function restoreOf(texts: readonly string[], confirmed: boolean, limits = {}) {
    const { ShareInput } = await import("../src/sskr/share-input.js");
    const { ShareRestore } = await import("../src/sskr/share-restore.js");
    const { nodeSharePlatform } = await import("../src/sskr/share-platform-node.js");
    const input = new ShareInput({ decodeEntry: "Decode" });
    input.add(texts);
    return { input, restore: new ShareRestore(nodeSharePlatform), confirmed, limits };
  }

  it("restores the vector's phrase from complete shares without repair or another original-code block", async () => {
    const { writeShare } = await import("../src/sskr/transport.js");
    const { input, restore } = await restoreOf([writeShare(first, "indexes"), second], false);
    const outcome = await restore.restore({ input, mode: "direct", confirmed: false });
    expect(outcome.kind).toBe("phrases");
    if (outcome.kind !== "phrases") return;
    const vector = sskrVectors().deterministic[0]!;
    const phrase = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    expect(outcome.phrases).toHaveLength(1);
    expect(outcome.phrases[0]).toMatchObject({
      mnemonic: phrase,
      repairs: [],
    });
    expect(outcome.phrases[0]!.backup).toBeUndefined();
    expect(outcome.listed).toEqual([phrase]);
  });

  it("asks before a search longer than its limits allow, and searches once confirmed", async () => {
    const { writeShare } = await import("../src/sskr/transport.js");
    const parts = writeShare(second, "colors").split(" ");
    for (const place of [5, 7]) parts[place] = "?";
    const texts = [first, parts.join(" ")];
    const asked = await restoreOf(texts, false);
    const question = await asked.restore.restore({
      input: asked.input,
      mode: "direct",
      confirmed: false,
      limits: { shares: 1 },
    });
    expect(question.kind).toBe("question");
    const searched = await restoreOf(texts, true);
    const found = await searched.restore.restore({
      input: searched.input,
      mode: "direct",
      confirmed: true,
      limits: { shares: 1 },
    });
    expect(found.kind).toBe("phrases");
  });

  it("writes a marked share again whole, never the phrase", async () => {
    const { writeShare } = await import("../src/sskr/transport.js");
    const parts = writeShare(second, "colors").split(" ");
    parts[5] = "?";
    const { input, restore } = await restoreOf([first, parts.join(" ")], true);
    const outcome = await restore.repair({
      input,
      mode: "direct",
      confirmed: true,
      fingerprintOf: () => "00000000",
    });
    expect(outcome.kind).toBe("shares");
    if (outcome.kind !== "shares") return;
    expect(outcome.shares.map((share) => share.record)).toEqual([first, second]);
  });
});

const vectors = sskrVectors();
const { shares } = vectors.deterministic[0]!;
const [first, second] = [shares[0]!, shares[1]!];
// Shares 1 and 3 of a 2-of-3 split of "abandon ... about" masked with Seedshift and DATE, that is
// of MASKED_WORDS (scripts/verify-terminal-input.py).
const MASKED_SHARES = [
  "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh",
  "ur:sskr/gomuttaeadaojytnhyvtpaqdmobwreoyykutjtkofedicanladwm",
];
const noWallet = () => ({ matched: false });
// The bytes of a share of a 16-byte secret in UR form, as markUnits counts them: the head of the
// byte string (0), the identifier (1, 2), the rest of the metadata (3 to 5), the secret (6 to 21)
// and the checksum (22 to 25).
const UR_IDENTIFIER_UNIT = 1;
const UR_CHECKSUM_UNITS = [22, 23, 24, 25];

// Imported here, as the block above does: other blocks reset the modules, and a class checked
// with instanceof (DatesAnswer) must come from the same load as the restore that checks it.
async function modules() {
  const restore = await import("../src/sskr/share-restore.js");
  const { nodeSharePlatform } = await import("../src/sskr/share-platform-node.js");
  const { writeShare } = await import("../src/sskr/transport.js");
  const { ShareInput } = await import("../src/sskr/share-input.js");
  const { ShareUnmasking } = await import("../src/sskr/share-unmasking.js");
  const { DatesAnswer, walletReason } = await import("../src/core/date-search.js");
  const inputOf = (texts: readonly string[]) => {
    const input = new ShareInput({ decodeEntry: "Decode" });
    input.add(texts);
    return input;
  };
  return {
    ...restore,
    restorer: new restore.ShareRestore(nodeSharePlatform),
    writeShare,
    inputOf,
    ShareUnmasking,
    DatesAnswer,
    walletReason,
  };
}

/** The second share in colours with the elements at `marks` unreadable. */
async function marked(marks: readonly number[]): Promise<string> {
  const { writeShare } = await modules();
  const parts = writeShare(second, "colors").split(" ");
  for (const place of marks) parts[place] = "?";
  return parts.join(" ");
}

async function maskedSet() {
  const { restorer, inputOf } = await modules();
  const read = await restorer.read(inputOf(MASKED_SHARES));
  if (read.kind !== "complete") throw new Error("Expected complete shares.");
  return read;
}

/**
 * Counts the wipes of every plan of marked shares made until `restore` is called: one entry per
 * plan, in the order they were made.
 */
async function countWipes() {
  const { JointRepair } = await import("../src/sskr/joint-repair.js");
  const wipes: number[] = [];
  // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
  const plan = JointRepair.prototype.plan;
  const spy = vi.spyOn(JointRepair.prototype, "plan").mockImplementation(async function (
    this: InstanceType<typeof JointRepair>,
    ...args: Parameters<typeof plan>
  ) {
    const made = await plan.apply(this, args);
    const index = wipes.push(0) - 1;
    const wipe = made.wipe;
    // The plan itself, its wipe counted: a search, a caller or its disposal wipes through it.
    return Object.assign(made, {
      wipe: () => {
        wipes[index]! += 1;
        wipe();
      },
    });
  });
  return { wipes, restore: () => spy.mockRestore() };
}

describe("S123, S139: the command line takes ShareRestore's steps", () => {
  it("unmasks the phrases with the phrase held, the backup and the repairs", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const read = await maskedSet();
    const dates = DatesAnswer.parse(DATE, { patterns: true });
    const unmasking = new ShareUnmasking({ mode: "seedshift", dates });
    const result = await ShareRestore.phrases(unmasking, [read.set], read.places);
    expect(result.kind).toBe("phrases");
    if (result.kind !== "phrases") return;
    expect(result.phrases.map((phrase) => phrase.mnemonic)).toEqual([TEST_PHRASE]);
    expect(result.phrases[0]!.held).toBe(MASKED_WORDS);
    expect(result.phrases[0]!.backup).toEqual({ form: "english", text: MASKED_WORDS });
    expect(result.phrases[0]!.repairs).toEqual([]);
    expect(result.sets).toEqual([read.set]);
    expect(result.listed).toEqual([TEST_PHRASE]);
  });

  it("says why no phrase is the wallet's, with the dates searched", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const { ShareSet } = await import("../src/sskr/share-set.js");
    const read = await maskedSet();
    const whole = new ShareUnmasking({
      mode: "seedshift",
      dates: DatesAnswer.parse(DATE, { patterns: true }),
      walletCheck: noWallet,
    });
    expect(whole.searchedCombinations).toBeUndefined();
    expect(await ShareRestore.phrases(whole, [read.set], read.places)).toEqual({
      kind: "mismatch",
      message: ShareSet.walletMismatch(1),
    });
    const searched = new ShareUnmasking({
      mode: "seedshift",
      dates: DatesAnswer.parse(DATE_LAST_DIGIT_FORGOTTEN, { patterns: true }),
      walletCheck: noWallet,
    });
    expect(searched.searchedCombinations).toBe(10);
    expect(await ShareRestore.phrases(searched, [read.set], read.places)).toEqual({
      kind: "mismatch",
      message: "None of the 10 date combinations gives the wallet given.",
    });
  });

  it("refuses more dates than the phrase of a set takes", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const read = await maskedSet();
    const dates = DatesAnswer.parse("01-01-2001 02-02-2002 03-03-2003 04-04-2004 05-05-2005", {
      patterns: true,
    });
    const result = await ShareRestore.phrases(
      new ShareUnmasking({ mode: "seedshift", dates }),
      [read.set],
      read.places,
    );
    expect(result).toEqual({ kind: "dates", message: dates.tooManyFor(12) });
  });

  it("decides a search from the read alone, and names its extent for a refusal", async () => {
    const { releaseRead, restorer, searchDecision, inputOf } = await modules();
    const { RepairReport } = await import("../src/sskr/repair-report.js");
    const work = { combinations: 10, secondsEach: 0.001 };
    const complete = await maskedSet();
    // Complete shares restore one phrase, whose date search is all there is to time.
    expect(searchDecision(complete, work)).toEqual({
      notice: RepairReport.dateSearchNotice(work, 1),
    });
    expect(searchDecision(complete, undefined)).toEqual({});
    const read = await restorer.read(inputOf([first, await marked([5, 7])]));
    if (read.kind !== "marked") throw new Error("Expected marked shares.");
    expect(searchDecision(read, work, { shares: 1 })).toEqual({
      question: read.report.searchQuestion(work),
    });
    expect(read.report.searchExtent()).toBe(
      `The search takes 65,536 checks, ${duration(read.report.seconds())}.`,
    );
    releaseRead(read);
  });
});

describe("S123, S139: the command line takes ShareRestore's steps", () => {
  it("wipes the plan of a search that is not made", async () => {
    const { releaseRead, restorer, inputOf } = await modules();
    const { wipes, restore } = await countWipes();
    try {
      const texts = [first, await marked([5, 7])];
      // A restore that stops with its question wipes the plan it does not search.
      const question = await restorer.restore({
        input: inputOf(texts),
        mode: "direct",
        confirmed: false,
        limits: { shares: 1 },
      });
      expect(question.kind).toBe("question");
      expect(wipes).toEqual([1]);
      // A read released, as the command line releases one whose search was declined.
      const read = await restorer.read(inputOf(texts));
      releaseRead(read);
      expect(wipes).toEqual([1, 1]);
      // Complete shares keep nothing for a search.
      releaseRead(await maskedSet());
      expect(wipes).toEqual([1, 1]);
    } finally {
      restore();
    }
  });

  it("wipes a plan made inside a watch that then rejects", async () => {
    const { restorer, inputOf } = await modules();
    const { wipes, restore } = await countWipes();
    try {
      // As a Ctrl+C read just after the assessment's last turn: the step ends, the watch throws.
      const late = async <T>(step: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> => {
        await step(undefined);
        throw new Error("Stopped after the assessment.");
      };
      await expect(restorer.read(inputOf([first, await marked([5, 7])]), late)).rejects.toThrow(
        "Stopped after the assessment.",
      );
      expect(wipes).toEqual([1]);
    } finally {
      restore();
    }
  });

  it("names every option that allows a search it refuses", async () => {
    const { restorer, inputOf, releaseRead } = await modules();
    const { allowedBy } = await import("../src/cli/search-consent.js");
    const read = await restorer.read(inputOf([first, await marked([5, 7])]));
    if (read.kind !== "marked") throw new Error("Expected marked shares.");
    const work = { combinations: 10, secondsEach: 0.001 };
    expect(allowedBy(read.report.searchExtent(work), [["max-tries", 65_536]])).toBe(
      `The search takes 65,536 checks, ${duration(read.report.seconds(work))}. Allow it with --max-tries 65536.`,
    );
    expect(
      allowedBy(read.report.searchExtent(work), [
        ["max-tries", 65_536],
        ["max-candidates", 10],
      ]),
    ).toBe(
      `The search takes 65,536 checks, ${duration(read.report.seconds(work))}. Allow it with --max-tries 65536 and --max-candidates 10.`,
    );
    releaseRead(read);
  });

  it("decides a repair's refusal and a rewrite alone in the library", async () => {
    const { ShareRestore, SEEDSHIFT_REPAIR_NEEDS_WALLET, inputOf } = await modules();
    expect(ShareRestore.repairRefusal("seedshift", false)).toBe(SEEDSHIFT_REPAIR_NEEDS_WALLET);
    expect(ShareRestore.repairRefusal("seedshift", true)).toBeUndefined();
    expect(ShareRestore.repairRefusal("direct", false)).toBeUndefined();
    const complete = inputOf([first, second]);
    expect(ShareRestore.rewritesOnly(complete, false)).toBe(true);
    // A wallet check restores the phrase, and marked shares are repaired: neither only rewrites.
    expect(ShareRestore.rewritesOnly(complete, true)).toBe(false);
    expect(ShareRestore.rewritesOnly(inputOf([first, await marked([5])]), false)).toBe(false);
  });
});

describe("S123, S139: the command line takes ShareRestore's steps", () => {
  it("repairs each share on its own when too few are typed", async () => {
    const { restorer, inputOf, writeShare } = await modules();
    const fingerprintOf = () => "00000000";
    const lone = [await marked([5])];
    const few = await restorer.restore({ input: inputOf(lone), mode: "direct", confirmed: true });
    if (few.kind !== "few") throw new Error("Expected too few shares.");
    expect(
      await restorer.repair({
        input: inputOf(lone),
        mode: "direct",
        confirmed: true,
        fingerprintOf,
      }),
    ).toEqual({
      kind: "shares",
      shares: [
        {
          number: 1,
          text: writeShare(second, "colors"),
          format: "colors",
          record: second,
        },
      ],
      form: "colors",
      // The element at index 5, the sixth, filled in from the share's own checks.
      repairs: [
        {
          share: 1,
          elements: [
            { position: 6, value: writeShare(second, "colors").split(" ")[5], guess: false },
          ],
        },
      ],
      lines: [{ kind: "warning", text: few.message }],
      notes: [],
    });
  });

  it("writes no share that nothing settles, nor shares of two sets", async () => {
    const { restorer, inputOf, NO_SHARE_SETTLED, fingerprintOf } = {
      ...(await modules()),
      fingerprintOf: () => "00000000",
    };
    const { ShareInput } = await import("../src/sskr/share-input.js");
    const { unrepairedShare } = await import("../src/sskr/repair.js");
    const unsettled = { shares: [unrepairedShare(first)], unsettled: [{ share: 1, position: 3 }] };
    const none = ShareInput.checkedExport(unsettled, [1], undefined);
    expect(none.kind).toBe("none");
    const leftOut = none.written.leftOutMessages();
    expect(leftOut).toEqual([
      "Share 1 cannot be settled and is left out: read more of it, or use another copy.",
    ]);
    const other = vectors.deterministic[1]!.shares[0]!;
    const mixed = { shares: [first, other].map(unrepairedShare), unsettled: [] };
    // The same message as the same shares typed to be written again.
    const typed = inputOf([first, other]).rewritten();
    if (typed.kind !== "trouble") throw new Error("Expected shares of two sets.");
    expect(ShareInput.checkedExport(mixed, [1, 2], undefined)).toMatchObject({
      kind: "trouble",
      trouble: { message: typed.trouble.message },
    });
    // A repair says so in one message: why none is written, then why each is left out. The first
    // byte of the identifier and the four bytes of the checksum are marked on both shares: the
    // checksum settles nothing, and the identifier, the same on both, changes neither the secret
    // nor its digest, so no value of it is told apart and every share keeps an unsettled element.
    const marks = [UR_IDENTIFIER_UNIT, ...UR_CHECKSUM_UNITS];
    expect(
      await restorer.repair({
        input: inputOf([first, second].map((share) => markUnits(share, "ur", marks))),
        mode: "direct",
        confirmed: true,
        fingerprintOf,
      }),
    ).toMatchObject({
      kind: "trouble",
      message: [
        NO_SHARE_SETTLED,
        ...[1, 2].map(
          (share) =>
            `Share ${share} cannot be settled and is left out: read more of it, or use another copy.`,
        ),
      ].join(" "),
    });
  });
});

describe("S123, S139: the command line takes ShareRestore's steps", () => {
  it("gives each set that fits once, with the fingerprint of its unmasked phrase", async () => {
    const { ShareRestore } = await modules();
    const { unrepairedShare } = await import("../src/sskr/repair.js");
    const { RepairReport } = await import("../src/sskr/repair-report.js");
    const plain = {
      mnemonic: TEST_PHRASE,
      shares: [first, second].map(unrepairedShare),
      unsettled: [],
    };
    const masked = {
      mnemonic: MASKED_WORDS,
      shares: MASKED_SHARES.map(unrepairedShare),
      unsettled: [],
    };
    // Two phrases of the masked set, as a date search may find, then the plain set.
    const phrases = [
      { set: masked, mnemonic: TEST_PHRASE },
      { set: masked, mnemonic: "another phrase" },
      { set: plain, mnemonic: TEST_PHRASE },
    ];
    const places = [2, 3];
    const variants = ShareRestore.variants(phrases, places, "ur", (mnemonic) => `of ${mnemonic}`);
    expect(variants).toEqual(
      [masked, plain].map((set) => ({
        fingerprint: `of ${TEST_PHRASE}`,
        shares: set.shares.map((share, index) => ({
          number: places[index],
          text: share.ur,
          format: "ur",
          record: share.ur,
        })),
        repairs: RepairReport.repairs(set, places),
      })),
    );
  });

  it("refuses what a restore and a repair cannot do", async () => {
    const {
      restorer,
      inputOf,
      DatesAnswer,
      walletReason,
      SEEDSHIFT_REPAIR_NEEDS_WALLET,
      WALLET_CHECK_NEEDS_THRESHOLD,
    } = await modules();
    const fingerprintOf = () => "00000000";
    // Guessed dates need the wallet that tells the right ones.
    expect(
      await restorer.restore({
        input: inputOf(MASKED_SHARES),
        mode: "seedshift",
        dates: DatesAnswer.parse(DATE_LAST_DIGIT_FORGOTTEN, { patterns: true }),
        confirmed: true,
      }),
    ).toEqual({ kind: "trouble", message: walletReason("seedshift"), lines: [] });
    expect(
      await restorer.repair({
        input: inputOf(MASKED_SHARES),
        mode: "seedshift",
        dates: DatesAnswer.parse(DATE, { patterns: true }),
        confirmed: true,
        fingerprintOf,
      }),
    ).toEqual({ kind: "trouble", message: SEEDSHIFT_REPAIR_NEEDS_WALLET, lines: [] });
    const few = await restorer.restore({
      input: inputOf([first]),
      mode: "direct",
      confirmed: true,
    });
    expect(few.kind).toBe("few");
    const checked = await restorer.repair({
      input: inputOf([first]),
      mode: "direct",
      walletCheck: noWallet,
      confirmed: true,
      fingerprintOf,
    });
    expect(checked).toMatchObject({ kind: "trouble", message: WALLET_CHECK_NEEDS_THRESHOLD });
  });
});
