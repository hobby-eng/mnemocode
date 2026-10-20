// One refusal condition, one code (AUD-037-API009): a host chooses its own words from the code
// alone, so that two conditions never share one. Public test data only.

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { walletEvidence } from "../src/cli/bitcoin-options.js";
import { inputFile } from "../src/cli/output-questions.js";
import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { runSskrCombine } from "../src/cli/sskr-restore-command.js";
import { addressCount } from "../src/core/address-scan.js";
import { KeptShares, ShareBackupCheck } from "../src/core/backup-check.js";
import { parseColors } from "../src/core/colors.js";
import { defined } from "../src/core/defined.js";
import { errorCode } from "../src/core/refusal.js";
import { checkedBitcoinProfiles } from "../src/core/wallet-evidence.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { isCompleteShareRefusal } from "../src/sskr/complete-shares.js";
import { SSKR_SET_VECTOR, SSKR_VECTOR } from "../src/sskr/known-answers.js";
import { readRepairableShare } from "../src/sskr/repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { SEED_BYTES } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { Share } from "../src/sskr/transport.js";
import { joinUnits, markUnits, shareUnits, VALUE_BYTE, wrongValue } from "./helpers/shares.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

/** The code of what `run` throws. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return errorCode(error);
  }
  return undefined;
}

/** What `run` throws or rejects with; undefined when it ends. */
async function failureOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The cause of `failure`, an Error's; undefined for anything else thrown. */
function causeOf(failure: unknown): unknown {
  return failure instanceof Error ? failure.cause : undefined;
}

/**
 * Shares of a secret of 16 zero bytes in `groups`, each [member threshold, member count], under
 * `groupThreshold`, from the SSKR engine seeded with sevens: synthetic public test data.
 */
async function groupShares(
  groupThreshold: number,
  groups: readonly (readonly number[])[],
): Promise<string[]> {
  const engine = await sskrEngine();
  return engine
    .create_sskr_shares(
      new Uint8Array(16),
      groupThreshold,
      Uint8Array.from(groups.flat()),
      new Uint8Array(SEED_BYTES).fill(7),
    )
    .trim()
    .split("\n");
}

/** Expects `failure` to be a refusal of the plain kind, no TypeError or RangeError, as worded. */
function expectRefusal(failure: unknown, code: string, message: string): void {
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(TypeError);
  expect(failure).not.toBeInstanceOf(RangeError);
  expect(failure).toMatchObject({ code, message });
}

describe("the codes of refusals", () => {
  it("tell a wrong first index from a wrong number of addresses", () => {
    expect(codeOf(() => addressCount(1, -1))).toBe("core.address-scan.first-index-refused");
    expect(codeOf(() => addressCount(0, 0))).toBe("core.address-scan.address-count-refused");
  });

  it("tell a Bitcoin profile named twice from a name that is no profile, in the library and on the command line", () => {
    expect(codeOf(() => checkedBitcoinProfiles(["native-segwit", "native-segwit"]))).toBe(
      "core.wallet-evidence.bitcoin-address-profile-given-twice",
    );
    expect(codeOf(() => checkedBitcoinProfiles(["native-segwit", "bip84"]))).toBe(
      "core.wallet-evidence.unknown-bitcoin-address-profile",
    );
    const given = (profiles: string) =>
      codeOf(() =>
        walletEvidence({
          "bitcoin-address": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
          "bitcoin-profile": profiles,
        }),
      );
    expect(given("native-segwit, taproot,native-segwit")).toBe(
      "core.wallet-evidence.bitcoin-address-profile-given-twice",
    );
    for (const syntax of ["bip84", "", "native-segwit,,taproot"])
      expect(given(syntax)).toBe(
        "cli.bitcoin-options.bitcoin-address-profile-auto-comma-separated-list",
      );
  });

  it("tell a seed phrase in words from an encoded one where shares are typed", () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    expect(codeOf(() => input.sharesOfAnswer(TEST_PHRASE))).toBe(
      "sskr.share-input.seed-phrase-in-words",
    );
    // Codes whose BIP39 checksum holds, as an encoded phrase's do: 1 for "abandon", 4 at the end.
    expect(codeOf(() => input.sharesOfAnswer("1 1 1 1 1 1 1 1 1 1 1 4"))).toBe(
      "sskr.share-input.encoded-seed-phrase",
    );
  });

  it("tell colours with # from colours run together", () => {
    expect(codeOf(() => parseColors("#12345 #000000"))).toBe("core.colors.hashed-colors-refused");
    expect(codeOf(() => parseColors("12345"))).toBe("core.colors.joined-colors-refused");
  });

  it("give each kind of set conflict its own code", () => {
    const [first, second] = SSKR_SET_VECTOR.shares;
    expect(codeOf(() => Share.readSet([first, SSKR_VECTOR.shares[0]], false))).toBe(
      "sskr.transport.shares-of-different-sets",
    );
    expect(codeOf(() => Share.readSet([first, wrongValue(first), second], false))).toBe(
      "sskr.transport.member-given-twice",
    );
  });

  it("tell a dash from a blank name where the menu asks for a file", async () => {
    await expect(inputFile("-", 1)).rejects.toMatchObject({
      code: "cli.output-questions.dash-path-refused",
    });
    // A quoted name of spaces, or of nothing, leaves a blank one.
    for (const blank of ["''", '" "'])
      await expect(inputFile(blank, 1)).rejects.toMatchObject({
        code: "cli.output-questions.blank-path-refused",
      });
  });

  it("tell too few shares, a share that cannot be read, shares of several groups, shares that do not fit and too much open in a combine", async () => {
    const [first, second] = SSKR_SET_VECTOR.shares;
    const marked = (share: string, places: readonly number[]) => markUnits(share, "colors", places);
    const combined = (records: readonly string[]) => ShareSet.combine(records, nodeSharePlatform);
    const refused = (code: string) => ({ code: `sskr.share-set.${code}` });
    // One share of a 2-of-3 set, or the same share twice.
    await expect(combined([marked(second, [5])])).rejects.toMatchObject(
      refused("more-shares-needed"),
    );
    await expect(combined([marked(first, [5]), first])).rejects.toMatchObject(
      refused("more-shares-needed"),
    );
    await expect(combined(["not a share at all", marked(second, [5])])).rejects.toMatchObject(
      refused("share-unreadable"),
    );
    // Two shares of the official vector, a set of several groups, which no joint repair takes.
    const [grouped, otherGrouped] = SSKR_VECTOR.shares;
    await expect(combined([marked(grouped, [5]), otherGrouped])).rejects.toMatchObject({
      ...refused("several-groups"),
      message:
        "These shares belong to a set of several groups; only sets of one group are repaired.",
    });
    // A share of another split of a secret of the same length: its identifier differs.
    const [, other] = await nodeSharePlatform.createShares(
      new Uint8Array(16),
      2,
      3,
      new Uint8Array(SEED_BYTES).fill(7),
    );
    await expect(combined([marked(first, [5]), defined(other)])).rejects.toMatchObject(
      refused("shares-do-not-fit"),
    );
    // 2^32 combinations, more than a combine tries, and 2^80, more than JointRepair searches.
    const open = {
      ...refused("too-many-combinations-open"),
      message: "Too many combinations are open: read more of the marked elements, or add a share.",
    };
    for (const places of [
      [5, 6],
      [4, 5, 6],
    ])
      await expect(combined([marked(first, places), marked(second, places)])).rejects.toMatchObject(
        open,
      );
  });

  it("tell a group that does not fit, a share that does not fit and shares that disagree with no digest to tell", async () => {
    const restored = (records: readonly string[]) => ShareSet.restore(records, nodeSharePlatform);
    // Group threshold 1: a group of one share of 1, wrong, before a group of 2 of 3, which its
    // digest checks.
    const [alone, member, otherMember] = await groupShares(1, [
      [1, 1],
      [2, 3],
    ]);
    const [first, second, third] = SSKR_SET_VECTOR.shares;
    // One group of 1 of 2: each share restores alone, and no digest tells which is wrong.
    const [one, two] = await nodeSharePlatform.createShares(
      new Uint8Array(16),
      1,
      2,
      new Uint8Array(SEED_BYTES).fill(7),
    );
    const cases = [
      [
        [wrongValue(defined(alone)), defined(member), defined(otherMember)],
        "group-does-not-fit",
        "Share 1 of another group does not fit with the others: leave it out, or check it.",
      ],
      [
        // The first two shares of a 2-of-3 set restore, checked by their digest; the third is wrong.
        [first, second, wrongValue(third)],
        "share-does-not-fit",
        "Share 3 does not fit with the others: with it they give another phrase or none. Leave it out, or check it.",
      ],
      [
        [defined(one), wrongValue(defined(two))],
        "unchecked-disagreement",
        "These shares give different secrets, and none of them can be checked on its own: MnemoCode cannot tell which is wrong. Check each of them.",
      ],
    ] as const;
    for (const [shares, code, message] of cases) {
      const failure = await failureOf(() => restored(shares));
      expectRefusal(failure, `sskr.complete-shares.${code}`, message);
      // A refusal of the shares given, which the shares as typed and a split's check take as one.
      expect(isCompleteShareRefusal(failure)).toBe(true);
      expect(ShareSet.isRefusal(failure)).toBe(true);
    }
  });
});

describe("the codes of refusals, with their kind and wording", () => {
  it("tell each reason why kept shares do not restore, each one to ask the shares again for, and a refused restore by the code of its cause", async () => {
    const [first, second] = SSKR_SET_VECTOR.shares;
    const [grouped, otherGrouped] = SSKR_VECTOR.shares;
    // Splits from one seed share their identifier: a 2-of-3 and a 3-of-3 split are one set whose
    // group then has two thresholds.
    const [ofTwo] = await groupShares(1, [[2, 3]]);
    const [, ofThree] = await groupShares(1, [[3, 3]]);
    const twoOfFive = (await groupShares(1, [[3, 5]])).slice(0, 2);
    using check = new ShareBackupCheck(
      { mnemonic: SSKR_SET_VECTOR.phrase, mode: "direct", threshold: 2 },
      nodeSharePlatform,
      { decodeEntry: "The Decode tab" },
    );
    const cases = [
      [[first], "too-few-shares", "This is one share; type 2, separated by ;.", undefined],
      [
        [first, first],
        "too-few-after-copies",
        "Once the copies are left out, one share is left; type 2 different shares.",
        undefined,
      ],
      // What sskr-combine says of complete shares before it tries, each condition in its words
      // and by its own code.
      [
        [first, second, grouped],
        "share-of-another-set",
        "Share 3 is of another set than share 1.",
        undefined,
      ],
      [
        [first, grouped],
        "shares-of-different-sets",
        "Shares 1 and 2 are of different sets, and nothing tells which is right.",
        undefined,
      ],
      [
        [first, wrongValue(first)],
        "member-given-twice",
        "Shares 1 and 2 are the same member of the set but differ, and nothing tells which is right.",
        undefined,
      ],
      [
        [defined(ofTwo), defined(ofThree)],
        "group-thresholds-conflict",
        "Shares 1 and 2 give their group different thresholds, and nothing tells which is right.",
        undefined,
      ],
      [
        twoOfFive,
        "too-few-for-threshold",
        "These 2 shares are not enough: this set needs 3.",
        undefined,
      ],
      [
        [grouped, otherGrouped],
        "too-few-groups",
        "These shares are not enough: this set needs 2 of its 2 groups, each with as many shares as its threshold.",
        undefined,
      ],
      // Refusals of the restore itself: each condition is the code of the cause.
      [
        [first, wrongValue(second)],
        "shares-do-not-restore",
        "These shares do not restore a secret: check them, and that all belong to one set.",
        "sskr.complete-shares.no-secret",
      ],
      [
        [markUnits(grouped, "colors", [5]), otherGrouped],
        "shares-do-not-restore",
        "These shares belong to a set of several groups; only sets of one group are repaired.",
        "sskr.share-set.several-groups",
      ],
    ] as const;
    for (const [shares, code, message, cause] of cases) {
      using kept = KeptShares.of(shares);
      const failure = await failureOf(() => check.restore(kept));
      expectRefusal(failure, `core.backup-check.${code}`, message);
      expect(errorCode(causeOf(failure))).toBe(cause);
      // A refusal of the shares typed, after which they are asked again: no fault of the host.
      expect(ShareBackupCheck.isRestoreRefusal(failure)).toBe(true);
    }
    // Another refusal of the same check, before any restore, and a fault are no such refusal.
    const answer = await failureOf(() => check.sharesOf(first));
    expectRefusal(
      answer,
      "core.backup-check.shares-refused",
      "This is one share; type 2, separated by ;.",
    );
    expect(ShareBackupCheck.isRestoreRefusal(answer)).toBe(false);
    expect(ShareBackupCheck.isRestoreRefusal(new Error("too-few-shares"))).toBe(false);
  });

  it("give a marked share that no share fits a code of its own", async () => {
    // An element changed beside the marked one: no value of the mark makes the CRC-32 hold.
    const units = shareUnits(SSKR_SET_VECTOR.shares[0], "ur");
    const [one, other] = MINIMAL_BYTEWORDS;
    units[VALUE_BYTE] = units[VALUE_BYTE] === one ? other! : one!;
    units[VALUE_BYTE + 1] = "?";
    expectRefusal(
      await failureOf(() => readRepairableShare(joinUnits(units, "ur"))),
      "sskr.repair.no-share-fits-marks",
      "No valid share fits the marked elements. Check their places and the other elements.",
    );
  });
});

describe("the codes of refusals off the private screen, with their kind and wording", () => {
  it("tell a share that cannot be read, a seed phrase typed for a share, one of another set, too few shares and shares that conflict", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-refusal-codes-"));
    try {
      const [first, second] = SSKR_SET_VECTOR.shares;
      // A share of another split of a secret of the same length: its identifier differs.
      const [, other] = await nodeSharePlatform.createShares(
        new Uint8Array(16),
        2,
        3,
        new Uint8Array(SEED_BYTES).fill(7),
      );
      const cases = [
        [
          [first, "not a share at all"],
          "share-unreadable",
          "Share 2 cannot be read: unknown SSKR Byteword.",
        ],
        [
          [
            first,
            "abandon ability able about above absent absorb abstract absurd abuse access accident",
          ],
          "seed-phrase-in-words",
          "Share 2 is a seed phrase in words, not a Shamir share: Decode numbers, codes or colors back into a seed phrase reads a masked one.",
        ],
        [[first, second, other], "share-of-another-set", "Share 3 is of another set than share 1."],
        [[first], "too-few-for-threshold", "One share is not enough: this set needs 2."],
        [
          [first, second, wrongValue(defined(second))],
          "member-given-twice",
          "Shares 2 and 3 are the same member of the set but differ, and nothing tells which is right.",
        ],
      ] as const;
      const path = join(directory, "shares.txt");
      for (const [shares, code, message] of cases) {
        await writeFile(path, `${shares.join("\n")}\n`);
        const combined = await failureOf(() => runSskrCombine({ "share-file": path }));
        expectRefusal(combined, `sskr.share-input.${code}`, message);
        // A share that cannot be read keeps the reader's own refusal as its cause.
        if (code === "share-unreadable")
          expect(errorCode(causeOf(combined))).toMatch(/^sskr\.transport\./u);
        // An export, which needs no quorum, refuses the others so too.
        if (code !== "too-few-for-threshold")
          expectRefusal(
            await failureOf(() => runSskrExport({ "share-file": path })),
            `sskr.share-input.${code}`,
            message,
          );
      }
    } finally {
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuse a wallet check with fewer shares than the threshold", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-refusal-codes-"));
    try {
      const path = join(directory, "share.txt");
      await writeFile(path, `${SSKR_SET_VECTOR.shares[0]}\n`);
      expectRefusal(
        await failureOf(() =>
          runSskrExport({ "share-file": path, "master-fingerprint": TEST_FINGERPRINT }),
        ),
        "cli.sskr-export-command.few-export-refused",
        "The wallet can be checked only with as many shares as the threshold.",
      );
    } finally {
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("the codes of refusals where the menu asks for a file", () => {
  it.skipIf(process.getuid?.() === 0)(
    "tell a file that is not there from one that cannot be looked at, where the menu asks for one",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-input-file-"));
      const closed = join(directory, "closed");
      try {
        await writeFile(join(directory, "record.txt"), "synthetic");
        const absent = { code: "cli.output-questions.there-no-such-file-check-name-folder" };
        await expect(inputFile(join(directory, "missing.txt"), 1)).rejects.toMatchObject(absent);
        // A name under a file: nothing can be there.
        await expect(inputFile(join(directory, "record.txt", "x"), 1)).rejects.toMatchObject(
          absent,
        );
        // A file in a folder that may not be searched may be there or not: unknown, not "none".
        await mkdir(closed);
        await writeFile(join(closed, "record.txt"), "synthetic");
        await chmod(closed, 0);
        const refused: unknown = await inputFile(join(closed, "record.txt"), 1).catch(
          (error: unknown) => error,
        );
        expect(errorCode(refused)).toBe("cli.output-questions.file-cannot-be-looked-at");
        expect(errorCode(refused instanceof Error ? refused.cause : undefined)).toBe("EACCES");
      } finally {
        await chmod(closed, 0o700).catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
