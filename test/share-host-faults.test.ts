// A failure of the host's SSKR library is the host's, never a fault of the shares: the split's
// self-check and the check of written shares let it pass through, and only a refusal of the
// shares is said of them (AUD-037-API002). Public test phrase only.

import { describe, expect, it } from "vitest";
import { ShareBackupCheck } from "../src/core/backup-check.js";
import { ShareCombineRefusalError, type SharePlatform } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { ShareSplit } from "../src/sskr/split.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

const TEXTS = { decodeEntry: "The Decode tab" };
const FAULT = new Error("The host's SSKR library could not be loaded.");

/** The node platform with a combiner that fails with `failure`. */
function failing(failure: unknown): SharePlatform {
  return {
    ...nodeSharePlatform,
    combineShares: async () => {
      throw failure;
    },
  };
}

describe("a failure of the host's combiner", () => {
  it("passes through the split's self-check, while a refusal stays the split's", async () => {
    const split = (failure: unknown) =>
      new ShareSplit(failing(failure), (seed) => seed.fill(7)).split(TEST_PHRASE, 2, 3);
    await expect(split(FAULT)).rejects.toBe(FAULT);
    await expect(split("not an Error")).rejects.toBe("not an Error");
    await expect(split(new ShareCombineRefusalError())).rejects.toMatchObject({
      code: "sskr.split.sskr-generated-shares-did-not-reconstruct-source-entropy",
    });
    // A combiner that gives back another secret did not reconstruct it, whatever its length.
    for (const length of [15, 17]) {
      const wrong = {
        ...nodeSharePlatform,
        combineShares: async () => new Uint8Array(length).fill(1),
      };
      await expect(
        new ShareSplit(wrong, (seed) => seed.fill(7)).split(TEST_PHRASE, 2, 3),
      ).rejects.toMatchObject({
        code: "sskr.split.sskr-generated-shares-did-not-reconstruct-source-entropy",
      });
    }
  });

  it("passes through the check of written shares, while a refusal is a finding", async () => {
    const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
    const check = (failure: unknown) =>
      new ShareBackupCheck(
        { mnemonic: TEST_PHRASE, mode: "direct", threshold: 2 },
        failing(failure),
        TEXTS,
      ).check({ backup: `${shares[0]};${shares[1]}` });
    await expect(check(FAULT)).rejects.toBe(FAULT);
    expect((await check(new ShareCombineRefusalError())).verdict).toBe("unreadable");
  });

  it("is no refusal of the shares", () => {
    expect(ShareSet.isRefusal(new ShareCombineRefusalError())).toBe(true);
    expect(ShareSet.isRefusal(FAULT)).toBe(false);
    expect(ShareSet.isRefusal("not an Error")).toBe(false);
    const programming = Object.assign(new TypeError("A share repair needs a platform."), {
      code: "sskr.joint-repair.share-repair-host-s-share-platform",
    });
    expect(ShareSet.isRefusal(programming)).toBe(false);
    const ended = Object.assign(new Error("This joint repair plan has been wiped."), {
      code: "sskr.joint-repair.plan-wiped",
    });
    expect(ShareSet.isRefusal(ended)).toBe(false);
  });
});
