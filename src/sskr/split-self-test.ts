// The self-test of the split of a seed phrase into shares (sskr/split.ts), which encode --sskr,
// sskr-split and re-encode to shares run: the published phrase split with the engine's test-only
// seed gives the published shares; the public phrase masked with Seedshift and a public date
// first, as a backup, gives shares that hold the masked phrase; and a threshold of 1 is refused
// (AUD-037-FUN005). It answers later, so core/self-test.ts runs it only in the full self-test.
//
// From the host it needs its SharePlatform (sskr/share-platform.ts). It holds public test data, no
// secret: the seed is the published test-only one, never randomness.
//
// Host-neutral: it imports only core modules and other host-neutral sskr modules.

import { parseDate } from "../core/dates.js";
import { bytesOfHex, expectRefusedLater, expectSame } from "../core/self-test-check.js";
import { sskrSetVector } from "./known-answers.js";
import type { SharePlatform } from "./share-platform.js";
import { ShareSet } from "./share-set.js";
import { ShareSplit } from "./split.js";

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** It masked with MnemoCode Seedshift and 23-09-2026 (vectors/mnemocode-v1.json). */
const MASKED_ENGLISH = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const MASKED_DATE = "23-09-2026";

/** A split that takes the published test-only seed of the engine in place of randomness. */
function seededSplit(platform: SharePlatform): ShareSplit {
  return new ShareSplit(platform, (seed) => seed.set(bytesOfHex(sskrSetVector.testOnlySeed)));
}

/** The split of the published phrase, of a masked backup, and a threshold refused. */
export async function checkShareSplit(platform: SharePlatform): Promise<void> {
  const split = seededSplit(platform);
  const shares = await split.split(sskrSetVector.phrase, 2, 3);
  expectSame(shares.join("\n"), sskrSetVector.shares.join("\n"), "Split known answer");
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
