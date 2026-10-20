// A ShareInput ended while a restore awaits a host step: nothing the host answers afterwards is
// published, for complete and marked shares, in a restore and in a repair (AUD-037-API001).
// Public SSKR vector only.

import { describe, expect, it } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { writeShare } from "../src/sskr/transport.js";

const WIPED = { code: "core.secret-value.wiped" };
const [FIRST, SECOND] = sskrSetVector.shares;

/** The input of the vector's first two shares, the second with colour 6 marked when `marked`. */
function inputOf(marked: boolean): ShareInput {
  const input = new ShareInput({ decodeEntry: "Decode" });
  const colors = writeShare(String(SECOND), "colors").trim().split(/\s+/u);
  if (marked) colors[5] = "?";
  input.add([String(FIRST), colors.join(" ")]);
  return input;
}

describe("a restore whose input ends while a host step is awaited", () => {
  it("publishes no phrase of complete shares after the wallet check", async () => {
    const input = inputOf(false);
    const restoring = new ShareRestore(nodeSharePlatform).restore({
      input,
      mode: "direct",
      confirmed: true,
      walletCheck: async () => {
        input.wipe();
        return { matched: true };
      },
    });
    await expect(restoring).rejects.toMatchObject(WIPED);
  });

  it("publishes no phrase of marked shares after their search", async () => {
    const input = inputOf(true);
    const restoring = new ShareRestore(nodeSharePlatform).restore({
      input,
      mode: "direct",
      confirmed: true,
      onProgress: () => input.wipe(),
    });
    await expect(restoring).rejects.toMatchObject(WIPED);
  });

  it("publishes no Seedshift phrase after the wallet check of its date search", async () => {
    const input = inputOf(false);
    const restoring = new ShareRestore(nodeSharePlatform).restore({
      input,
      mode: "seedshift",
      confirmed: true,
      dates: DatesAnswer.parse("23-09-202?", { patterns: true }),
      walletCheck: async () => {
        input.wipe();
        return { matched: false };
      },
    });
    await expect(restoring).rejects.toMatchObject(WIPED);
  });

  it("writes no repaired shares after their search", async () => {
    const input = inputOf(true);
    const repairing = new ShareRestore(nodeSharePlatform).repair({
      input,
      mode: "direct",
      confirmed: true,
      fingerprintOf: masterFingerprint,
      onProgress: () => input.wipe(),
    });
    await expect(repairing).rejects.toMatchObject(WIPED);
  });

  it("writes no repaired shares after the wallet check", async () => {
    const input = inputOf(true);
    const repairing = new ShareRestore(nodeSharePlatform).repair({
      input,
      mode: "direct",
      confirmed: true,
      fingerprintOf: masterFingerprint,
      walletCheck: async () => {
        input.wipe();
        return { matched: true };
      },
    });
    await expect(repairing).rejects.toMatchObject(WIPED);
  });

  it("still restores while the input lives", async () => {
    using input = inputOf(true);
    const restored = await new ShareRestore(nodeSharePlatform).restore({
      input,
      mode: "direct",
      confirmed: true,
    });
    expect(restored.kind).toBe("phrases");
  });
});
