import { describe, expect, it } from "vitest";
import { defined } from "../src/core/defined.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { SEED_BYTES } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSet } from "../src/sskr/share-set.js";

// Public test data only: a secret of zeros, split with a seed of sevens.
const SECRET = new Uint8Array(16);
const SEED = new Uint8Array(SEED_BYTES).fill(7);

describe("a restore that no SSKR digest checks (AUD-037-API004)", () => {
  it("says the phrase is not checked where each group restores from one share", async () => {
    const [one] = await nodeSharePlatform.createShares(SECRET, 1, 2, SEED.slice());
    using alone = await ShareSet.restore([defined(one)], nodeSharePlatform);
    expect(alone.digestChecked).toBe(false);
    expect(alone.checked).toBe(false);
    expect(alone.uncheckedNote()).toMatch(/SSKR keeps no digest: the phrase is not checked/u);
    await expect(combineSskrShares([defined(one)])).rejects.toMatchObject({
      code: "sskr.shares.some-shares-repaired-elements-could-not-checked-use",
    });
  });

  it("calls a restore that the digest checked checked", async () => {
    const shares = await nodeSharePlatform.createShares(SECRET, 2, 3, SEED.slice());
    using restored = await ShareSet.restore(shares.slice(0, 2), nodeSharePlatform);
    expect(restored.digestChecked).toBe(true);
    expect(restored.checked).toBe(true);
    expect(restored.uncheckedNote()).toBeUndefined();
  });
});
