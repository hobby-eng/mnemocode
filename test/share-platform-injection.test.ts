// The share parts with a platform of the host's own, as a browser page passes it, in a module graph
// that never loads the Node.js platform (share-platform-node.ts), which would configure the global
// one: every repair, search and measure must use the platform it was given (JointRepair), and the
// restore of a masked phrase from shares runs with the host's wallet check (ShareUnmasking).
// Published SSKR vectors and the public test phrase only.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it, vi } from "vitest";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { ShareBackupCheck } from "../src/core/backup-check.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { JointRepair, measureTriesPerSecond } from "../src/sskr/joint-repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { sharePlatform, type SharePlatform } from "../src/sskr/share-platform.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { writeShare } from "../src/sskr/transport.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { entropy: string; shares: string[] }[] };
const VECTOR = vectors.deterministic[0]!;
const PHRASE = entropyToMnemonic(Uint8Array.from(Buffer.from(VECTOR.entropy, "hex")), wordlist);
const [FIRST, SECOND] = VECTOR.shares as [string, string, string];
const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
const DATE = parseDate("23-09-2026");

/** The host's own platform, which counts its calls: node:crypto's HMAC and the bundled SSKR. */
function hostPlatform(): SharePlatform & { readonly calls: { hmac: number; combine: number } } {
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
    createShares: async () => {
      throw new Error("No split here.");
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
  it("never configure a platform themselves", () => {
    expect(() => sharePlatform()).toThrow("Share repair has no platform.");
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

  it("plan, search and measure with the platform of a JointRepair", async () => {
    const platform = hostPlatform();
    const repair = new JointRepair(platform);
    const plan = await repair.plan([FIRST, marked(5), marked(9)]);
    expect(plan.assessment.verdict).not.toBe("no-fit");
    const found = await plan.search();
    expect(found.map((one) => one.mnemonic)).toEqual([PHRASE]);
    const searched = platform.calls.hmac;
    expect(searched).toBeGreaterThan(0);
    expect(repair.triesPerSecond()).toBeGreaterThan(0);
    expect(platform.calls.hmac).toBeGreaterThan(searched);
    expect(measureTriesPerSecond(platform)).toBeGreaterThan(0);
    expect(() => new JointRepair({} as SharePlatform)).toThrow(TypeError);
  });
});

describe("ShareUnmasking", () => {
  const masked = encodeMnemonic(TEST_PHRASE, [DATE]).shiftedEnglish.join(" ");
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
    const set = setOf(masked);
    const whole = DatesAnswer.of([DATE]);
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
      phrases: [{ set, mnemonic: TEST_PHRASE, dates: "23-09-2026", matchedAt: "m" }],
      listed: [TEST_PHRASE],
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ checked: 10, combinations: 10, matchCount: 1 }),
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
      await new ShareUnmasking({ mode: "seedshift", dates: five }).unmask([setOf(masked)]),
    ).toEqual({
      kind: "dates",
      message: "12-word phrases support at most 4 dates.",
    });
    expect(() => new ShareUnmasking({ mode: "seedshift-legacy" as never })).toThrow(
      "Shares are made without Seedshift or with MnemoCode Seedshift.",
    );
    expect(() => new ShareUnmasking({ mode: "seedshift" })).toThrow(TypeError);
    expect(String(new ShareUnmasking({ mode: "seedshift", dates: five }))).toBe(
      "[ShareUnmasking: redacted]",
    );
  });
});
