import { describe, expect, it } from "vitest";
import { defined } from "../src/core/defined.js";
import { combineSskrShares, combineSskrShareSet, restoreShareSet } from "../src/sskr/shares.js";
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
    expect(alone.uncheckedNote()).toMatch(/^No SSKR digest checked this phrase/u);
    await expect(combineSskrShares([defined(one)])).rejects.toMatchObject({
      code: "sskr.shares.no-digest-checked-phrase",
    });
    // The plain results say so too, for a caller that reports their limits.
    expect(await restoreShareSet([defined(one)])).toMatchObject({ digestUnchecked: true });
    expect(await combineSskrShareSet([defined(one)])).toMatchObject({ digestUnchecked: true });
    // A host's set that leaves the field out is not called checked: the shares say it too.
    const { digestUnchecked: _, ...silent } = alone.toRepairedSet();
    using hosted = ShareSet.of(silent);
    expect(hosted.digestChecked).toBe(false);
  });

  it("calls a restore that the digest checked checked", async () => {
    const shares = await nodeSharePlatform.createShares(SECRET, 2, 3, SEED.slice());
    using restored = await ShareSet.restore(shares.slice(0, 2), nodeSharePlatform);
    expect(restored.digestChecked).toBe(true);
    expect(restored.checked).toBe(true);
    expect(restored.uncheckedNote()).toBeUndefined();
    expect(await restoreShareSet(shares.slice(0, 2))).not.toHaveProperty("digestUnchecked");
  });

  it("counts copies of one share as one member, which completes no group", async () => {
    const shares = await nodeSharePlatform.createShares(SECRET, 2, 3, SEED.slice());
    using restored = await ShareSet.restore(shares.slice(0, 2), nodeSharePlatform);
    const set = restored.toRepairedSet();
    // A host's set of two members of a group whose threshold is 2: its digest checked the phrase.
    using members = ShareSet.of(set);
    expect(members.digestChecked).toBe(true);
    // Two copies of the first share are one member: the group is not complete, and no digest
    // checked the phrase.
    const copy = defined(set.shares[0]);
    using copies = ShareSet.of({ ...set, shares: [copy, copy] });
    expect(copies.digestChecked).toBe(false);
    expect(copies.uncheckedNote()).toMatch(/^No SSKR digest checked this phrase/u);
  });
});
