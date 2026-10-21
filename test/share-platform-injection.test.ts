// The share parts with a platform of the host's own, as a browser page passes it, in a module graph
// that never loads the Node.js platform (share-platform-node.ts): every repair, search and measure
// must use the platform it was given (JointRepair, planJointRepair), none keeps one of its own
// (scan finding S108), and the restore of a masked phrase from shares runs with the host's wallet
// check (ShareUnmasking).
// Published SSKR vectors and the public test phrase only.
import { createHmac } from "node:crypto";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it, vi } from "vitest";
import { parseDate } from "../src/core.js";
import { ShareBackupCheck } from "../src/core/backup-check.js";
import { DatesAnswer } from "../src/core/date-search.js";
import {
  JointRepair,
  measureTriesPerSecond,
  planJointRepair,
  type PlanOptions,
} from "../src/sskr/joint-repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { ONE_GROUP, type ShareRepairPlatform } from "../src/sskr/share-platform.js";
import { CheckedSskrBridge } from "../src/sskr/bridge.js";
import { ShareSplit } from "../src/sskr/split.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { writeShare } from "../src/sskr/transport.js";
import { DATE, MASKED_WORDS, TEST_PHRASE } from "./helpers/test-phrase.js";
import { sskrVectors } from "./helpers/vectors.js";

const VECTOR = sskrVectors().deterministic[0]!;
const PHRASE = entropyToMnemonic(Uint8Array.from(Buffer.from(VECTOR.entropy, "hex")), wordlist);
const [FIRST, SECOND] = [VECTOR.shares[0]!, VECTOR.shares[1]!];

/** The host's own platform, which counts its calls: node:crypto's HMAC and the bundled SSKR. */
function hostPlatform(): ShareRepairPlatform & {
  readonly calls: { hmac: number; combine: number };
} {
  const calls = { hmac: 0, combine: 0 };
  return {
    calls,
    hmacSha256: (key, message) => {
      calls.hmac += 1;
      return createHmac("sha256", key).update(message).digest();
    },
    combineShares: async (records) => {
      calls.combine += 1;
      return (await sskrEngine()).recover_sskr_shares(records.join("\n"));
    },
  };
}

/** The second share with the element at `place`, counted from 0, unreadable. */
function marked(place: number): string {
  const parts = writeShare(SECOND, "indexes").split(" ");
  parts[place] = "?";
  return parts.join(" ");
}

describe("the share parts with the host's platform", () => {
  it("keep no platform of their own, and refuse a plan without the host's", async () => {
    // The refusal contract and constants, not a platform configured for later calls.
    expect(Object.keys(await import("../src/sskr/share-platform.js")).sort()).toEqual([
      "ONE_GROUP",
      "SEED_BYTES",
      "ShareCombineRefusalError",
    ]);
    // A host in JavaScript may leave it out, as these options do on purpose; the plan refuses
    // before any share is read.
    await expect(planJointRepair([FIRST, marked(5)], {} as PlanOptions)).rejects.toThrow(
      "A share repair needs the host's SharePlatform.",
    );
    const platform = hostPlatform();
    const plan = await planJointRepair([FIRST, marked(5)], { platform });
    expect((await plan.search()).sets.map((one) => one.mnemonic)).toEqual([PHRASE]);
    expect(platform.calls.hmac).toBeGreaterThan(0);
  });

  it("repair marked shares with the platform given, for a set and for a backup check", async () => {
    const platform = hostPlatform();
    const set = await ShareSet.combine([FIRST, marked(5)], platform);
    expect(set.mnemonic).toBe(PHRASE);
    expect(platform.calls.hmac).toBeGreaterThan(0);
    expect(platform.calls.combine).toBeGreaterThan(0);

    const check = new ShareBackupCheck(
      { mnemonic: PHRASE, mode: "direct", threshold: 2 },
      platform,
      {
        decodeEntry: "The Decode tab",
      },
    );
    const before = platform.calls.combine;
    expect((await check.check({ backup: `${FIRST};${marked(7)}` })).verdict).toBe("restores");
    expect(platform.calls.combine).toBeGreaterThan(before);
  });

  it("restores, repairs and splits with only the host services each operation uses", async () => {
    const { combineShares, hmacSha256 } = hostPlatform();
    const combined = await ShareSet.restore([FIRST, SECOND], { combineShares });
    expect(combined.mnemonic).toBe(PHRASE);

    const plan = await new JointRepair({ combineShares, hmacSha256 }).plan([FIRST, marked(5)]);
    expect((await plan.search()).sets.map((one) => one.mnemonic)).toEqual([PHRASE]);

    const createShares = async (
      secret: Uint8Array,
      threshold: number,
      count: number,
      seed: Uint8Array,
    ) =>
      (await sskrEngine())
        .create_sskr_shares(
          secret,
          ONE_GROUP,
          CheckedSskrBridge.groupSpecifications(threshold, count),
          seed,
        )
        .trim()
        .split("\n");
    const split = new ShareSplit({ combineShares, createShares }, (seed) => seed.fill(7));
    const records = await split.split(PHRASE, 2, 3);
    expect((await ShareSet.restore(records, { combineShares })).mnemonic).toBe(PHRASE);
    // Randomness that leaves the seed unfilled makes no share (AUD-037-SEC003).
    const unfilled = new ShareSplit({ combineShares, createShares }, () => undefined);
    await expect(unfilled.split(PHRASE, 2, 3)).rejects.toHaveProperty(
      "code",
      "sskr.split.randomness-left-seed-unfilled",
    );
  });

  it("plan, search and measure with the platform of a JointRepair", async () => {
    const platform = hostPlatform();
    const repair = new JointRepair(platform);
    const plan = await repair.plan([FIRST, marked(5), marked(9)]);
    expect(plan.assessment.verdict).not.toBe("no-fit");
    const found = (await plan.search()).sets;
    expect(found.map((one) => one.mnemonic)).toEqual([PHRASE]);
    const searched = platform.calls.hmac;
    expect(searched).toBeGreaterThan(0);
    expect(repair.triesPerSecond()).toBeGreaterThan(0);
    expect(platform.calls.hmac).toBeGreaterThan(searched);
    expect(measureTriesPerSecond(platform)).toBeGreaterThan(0);
    const beforeMeasure = platform.calls.hmac;
    let milliseconds = 0;
    const rate = repair.triesPerSecond(() => (milliseconds += 2_000));
    expect(rate).toBe((platform.calls.hmac - beforeMeasure) / 2);
    // A platform without its functions, given on purpose as a JavaScript host could.
    expect(() => new JointRepair({} as ShareRepairPlatform)).toThrow(TypeError);
  });
});

describe("ShareUnmasking", () => {
  /** A set as a restore gives it: the phrase that the shares hold. */
  const setOf = (mnemonic: string) => ({ mnemonic, shares: [], unsettled: [] });
  const testWallet = vi.fn((mnemonic: string) => ({
    matched: mnemonic === TEST_PHRASE,
    path: "m",
  }));

  it("gives the phrase of shares made without Seedshift, only the wallet's when one is given", async () => {
    const own = setOf(TEST_PHRASE);
    expect(await new ShareUnmasking({ mode: "direct" }).unmask([own])).toEqual({
      kind: "phrases",
      phrases: [{ set: own, mnemonic: TEST_PHRASE }],
      listed: [TEST_PHRASE],
    });
    const other = setOf(PHRASE);
    expect(
      await new ShareUnmasking({ mode: "direct", walletCheck: testWallet }).unmask([other, own]),
    ).toEqual({
      kind: "phrases",
      phrases: [{ set: own, mnemonic: TEST_PHRASE }],
      listed: [TEST_PHRASE],
    });
  });

  it("unmasks with whole dates, and searches dates with ? with the host's wallet check", async () => {
    const set = setOf(MASKED_WORDS);
    const whole = DatesAnswer.of([parseDate(DATE)]);
    expect(await new ShareUnmasking({ mode: "seedshift", dates: whole }).unmask([set])).toEqual({
      kind: "phrases",
      phrases: [{ set, mnemonic: TEST_PHRASE }],
      listed: [TEST_PHRASE],
    });
    const searched = new ShareUnmasking({
      mode: "seedshift",
      dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
      walletCheck: async (mnemonic) => testWallet(mnemonic),
      keep: 5,
    });
    expect(searched.searches).toBe(true);
    const progress = vi.fn();
    expect(await searched.unmask([set], { onProgress: progress })).toEqual({
      kind: "phrases",
      phrases: [{ set, mnemonic: TEST_PHRASE, dates: DATE, matchedAt: "m" }],
      listed: [TEST_PHRASE],
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ checked: 10, total: 10, matched: 1 }),
    );
    // The time of each phrase's search: 10 combinations, one wallet check each.
    const work = await searched.dateWork();
    expect(work?.combinations).toBe(10);
    expect(work!.secondsEach).toBeGreaterThan(0);
    expect(
      await new ShareUnmasking({ mode: "seedshift", dates: whole }).dateWork(),
    ).toBeUndefined();
  });

  it("refuses dates that the phrase of a set cannot take, and a mode that no share is made in", async () => {
    const five = DatesAnswer.of([1, 2, 3, 4, 5].map((day) => parseDate(`0${day}-01-2020`)));
    expect(
      await new ShareUnmasking({ mode: "seedshift", dates: five }).unmask([setOf(MASKED_WORDS)]),
    ).toEqual({
      kind: "dates",
      message: "12-word phrases support at most 4 dates.",
    });
    // A mode that shares are not made with, given on purpose as a JavaScript host could.
    expect(() => new ShareUnmasking({ mode: "seedshift-legacy" as never })).toThrow(
      "Shares are made without Seedshift or with MnemoCode Seedshift.",
    );
    expect(() => new ShareUnmasking({ mode: "seedshift" })).toThrow(TypeError);
    expect(String(new ShareUnmasking({ mode: "seedshift", dates: five }))).toBe(
      "[ShareUnmasking: redacted]",
    );
  });
});
