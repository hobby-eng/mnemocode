// The self-test of the split of a seed phrase into shares (sskr/split.ts), which encode --sskr,
// sskr-split and re-encode to shares run: the published phrase split with the engine's test-only
// seed gives shares every two of which restore it, and another seed gives other shares; the
// public phrase masked with Seedshift and a public date first, as a backup, gives shares that hold
// the masked phrase; and a threshold of 1 is refused (AUD-037-FUN005). No published vector gives
// the shares of a seeded split, so none is compared with them (CORE-27). It answers later, so
// core/self-test.ts runs it only in the full self-test.
//
// From the host it needs its ShareSplitPlatform (sskr/share-platform.ts). It holds public test
// data, no secret: the seeds are published test-only ones, never randomness.
//
// Host-neutral: it imports only core modules and other host-neutral sskr modules.

import { parseDate } from "../core/dates.js";
import { bytesOfHex, expectRefusedLater, expectSame } from "../core/self-test-check.js";
import { sharePairs, SSKR_SET_VECTOR } from "./known-answers.js";
import type { ShareSplitPlatform } from "./share-platform.js";
import { ShareSet } from "./share-set.js";
import { ShareSplit } from "./split.js";
import { MASKED_DATE, MASKED_ENGLISH, PUBLIC_MNEMONIC } from "../core/self-test-vectors.js";

/** A split that takes the published test-only `seed`, in hex, in place of randomness. */
function seededSplit(platform: ShareSplitPlatform, seed: string): ShareSplit {
  return new ShareSplit(platform, (bytes) => bytes.set(bytesOfHex(seed)));
}

/** The published phrase split by `split` into the set of SSKR_SET_VECTOR's threshold and count. */
function splitPublished(split: ShareSplit): Promise<string[]> {
  return split.split(SSKR_SET_VECTOR.phrase, SSKR_SET_VECTOR.threshold, SSKR_SET_VECTOR.count);
}

/** The split of the published phrase, of a masked backup, and a threshold refused. */
export async function checkShareSplit(platform: ShareSplitPlatform): Promise<void> {
  const split = seededSplit(platform, SSKR_SET_VECTOR.testOnlySeed);
  const shares = await splitPublished(split);
  for (const pair of sharePairs(shares)) {
    using fromPair = await ShareSet.restore(pair, platform);
    expectSame(fromPair.mnemonic, SSKR_SET_VECTOR.phrase, "Split restored by every two shares");
  }
  const reseeded = await splitPublished(seededSplit(platform, SSKR_SET_VECTOR.otherTestOnlySeed));
  expectSame(
    reseeded.some((share) => shares.includes(share)),
    false,
    "Split with another seed",
  );
  const backup = await split.splitBackup({
    mnemonic: PUBLIC_MNEMONIC,
    mode: "seedshift",
    dates: [parseDate(MASKED_DATE)],
    threshold: 2,
    count: 3,
  });
  expectSame(backup.held, MASKED_ENGLISH, "Split of a masked backup: the phrase held");
  using restored = await ShareSet.restore(backup.records.slice(1), platform);
  expectSame(restored.mnemonic, MASKED_ENGLISH, "Split of a masked backup restored");
  await expectRefusedLater(
    () => split.split(PUBLIC_MNEMONIC, 1, 3),
    /threshold of 1 no share would be checked/u,
    "A split with a threshold of 1",
  );
}
