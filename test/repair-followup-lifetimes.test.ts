import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupReading } from "../src/core/backup-reading.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { MarkedReading } from "../src/sskr/repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { Share } from "../src/sskr/transport.js";
import { deferred } from "./helpers/deferred.js";

// Public bip39-128-2-of-3 vector: no generated or private recovery material.
const ONE_MARK = SSKR_SET_VECTOR.colors[0].replace("#37B8CA", "?");
const PUBLIC_ENTROPY_BYTES = 16;
const WIPED_CODE = "core.secret-value.wiped";
const PLAN_WIPED_CODE = "sskr.joint-repair.plan-wiped";

async function pausedConfirmation(records: readonly string[] = SSKR_SET_VECTOR.shares) {
  const entered = deferred();
  const gate = deferred();
  // No implementation replacement: retain the real factory's actual owner results only.
  const readSet = vi.spyOn(Share, "readSet");
  const owners = (): Share[] =>
    readSet.mock.results.flatMap((result) => (result.type === "return" ? result.value : []));
  const entropyResults: { bytes: Uint8Array; nonzeroAtReturn: boolean }[] = [];
  let calls = 0;
  const plan = await planJointRepair(records, {
    platform: {
      ...nodeSharePlatform,
      combineShares: async (shares) => {
        calls += 1;
        if (calls === 1) {
          entered.release();
          await gate.promise;
        }
        const bytes = await nodeSharePlatform.combineShares(shares);
        entropyResults.push({ bytes, nonzeroAtReturn: bytes.some((byte) => byte !== 0) });
        return bytes;
      },
    },
  });
  const pending = plan.search();
  // Own rejection immediately, including when a stale-owner assertion fails before release.
  // Each case checks the original promise; this separate promise only drains final cleanup.
  const settled = pending.then(
    () => undefined,
    () => undefined,
  );
  return {
    plan,
    pending,
    owners,
    entropyResults,
    calls: () => calls,
    release: gate.release,
    waitForFirst: async (): Promise<void> => {
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error("The public fixture must reach its first host confirmation.");
        }),
      ]);
    },
    close: async (): Promise<void> => {
      plan.wipe();
      gate.release();
      await settled;
      for (const owner of new Set(owners())) owner.wipe();
      for (const { bytes } of entropyResults) bytes.fill(0);
      readSet.mockRestore();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AUD-029-SEC001: recovery follow-up lifetimes", () => {
  it("ends every classifier root reading while independent child readings stay live", () => {
    const roots: MarkedReading[] = [];
    const children: { reading: MarkedReading; before: readonly (number | undefined)[] }[] = [];
    const factory = MarkedReading.of.bind(MarkedReading);
    vi.spyOn(MarkedReading, "of").mockImplementation((text) => {
      const readings = factory(text);
      roots.push(...readings);
      // Observe the actual roots unchanged, with separate caller-owned child controls.
      for (const root of readings) {
        const reading = root.copy();
        children.push({ reading, before: reading.values });
      }
      return readings;
    });
    try {
      expect(BackupReading.shareKind(ONE_MARK)).toBe("share");
      expect(roots.length).toBeGreaterThan(0);
      expect(children).toHaveLength(roots.length);
      const color = children.find(({ reading }) => reading.format === "colors");
      expect(color).toBeDefined();
      expect(color!.reading.values[0]).toBe(0x8b0c06);
      for (const { reading, before } of children) expect(reading.values).toEqual(before);
      for (const root of roots)
        expect(() => root.values).toThrow(expect.objectContaining({ code: WIPED_CODE }));
    } finally {
      for (const root of roots) root.wipe();
      for (const { reading } of children) reading.wipe();
    }
  });

  it("ends internal share owners before an awaited confirmation returns after plan disposal", async () => {
    const run = await pausedConfirmation();
    try {
      expect(run.plan.assessment).toMatchObject({ verdict: "determined", combinations: 1 });
      await run.waitForFirst();
      expect(run.calls()).toBe(1);
      const owners = run.owners();
      expect(owners.length).toBeGreaterThan(0);
      run.plan.wipe();
      // The real host is still waiting: this must observe disposal before eventual finally.
      for (const owner of owners)
        expect(() => owner.ur).toThrow(expect.objectContaining({ code: WIPED_CODE }));
      run.release();
      await expect(run.pending).rejects.toHaveProperty("code", PLAN_WIPED_CODE);
    } finally {
      await run.close();
    }
  });

  it("starts no further combiner call after a disposed plan's first confirmation is released", async () => {
    const run = await pausedConfirmation();
    try {
      expect(run.plan.assessment).toMatchObject({ verdict: "determined", combinations: 1 });
      await run.waitForFirst();
      expect(run.calls()).toBe(1);
      run.plan.wipe();
      run.release();
      await expect(run.pending).rejects.toHaveProperty("code", PLAN_WIPED_CODE);
      expect(run.calls()).toBe(1);
    } finally {
      await run.close();
    }
  });

  it("wipes real mutable entropy returned by the host after the plan has ended", async () => {
    const run = await pausedConfirmation(SSKR_SET_VECTOR.shares.slice(0, 2));
    try {
      await run.waitForFirst();
      run.plan.wipe();
      run.release();
      await expect(run.pending).rejects.toHaveProperty("code", PLAN_WIPED_CODE);
      expect(run.entropyResults).toHaveLength(1);
      expect(run.entropyResults[0]!.nonzeroAtReturn).toBe(true);
      // The wrapper retains the exact host-returned object, not a zeroed test-side copy.
      expect(run.entropyResults[0]!.bytes).toEqual(new Uint8Array(PUBLIC_ENTROPY_BYTES));
    } finally {
      await run.close();
    }
  });

  it("checks surplus shares in a live plan and preserves its already transferred plain result", async () => {
    const run = await pausedConfirmation();
    try {
      await run.waitForFirst();
      expect(run.calls()).toBe(1);
      run.release();
      const result = await run.pending;
      // All three shares of the 2-of-3 set exercise the further verification call above.
      expect(run.calls()).toBeGreaterThan(1);
      expect(result.stopped).toBe(false);
      expect(result.sets).toHaveLength(1);
      run.plan.wipe();
      expect(result.sets[0]!.mnemonic).toBe(
        "abandon amount liar amount expire adjust cage candy arch gather drum buyer",
      );
      expect(result.sets[0]!.shares.map(({ ur }) => ur)).toEqual(SSKR_SET_VECTOR.shares);
    } finally {
      await run.close();
    }
  });
});
