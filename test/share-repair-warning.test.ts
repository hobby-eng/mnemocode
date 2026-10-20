// What the library's repair of shares with a wallet says of the wallet's match: the warning of its
// check, such as that a master fingerprint is only a filter, comes with the shares that the wallet
// chose and with the sets shown where it matched every one (AUD-037-SEC004), as sskr-export says
// it. Public test data only: the shares of vectors/sskr-v1.json ("bip39-128-2-of-3") and shares of
// the "abandon … about" phrase.

import { describe, expect, it } from "vitest";
import type { WalletCheck } from "../src/core/wallet-check.js";
import type { RepairedSet } from "../src/sskr/joint-results.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { unrepairedShare } from "../src/sskr/repair.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { matchWarnings, ShareRestore, type ShareRepairOutcome } from "../src/sskr/share-restore.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { testPhraseSet } from "./helpers/shares.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/** What the wallet of these tests says of each match: the text matters, not its wording. */
const WARNING = "A match of this wallet is only a filter.";

/** A wallet that matches the phrases of `warnings`, each with its warning, or none. */
function walletOf(warnings: Readonly<Record<string, string | undefined>>): WalletCheck {
  return (mnemonic) => {
    const warning = warnings[mnemonic];
    return {
      matched: Object.hasOwn(warnings, mnemonic),
      path: "m",
      ...(warning === undefined ? {} : { warning }),
    };
  };
}

/** Repairs `shares`, typed whole, in direct mode, with `walletCheck`. */
async function repaired(
  shares: readonly string[],
  walletCheck: WalletCheck,
): Promise<ShareRepairOutcome> {
  using input = new ShareInput({ decodeEntry: "Decode" });
  input.add(shares);
  // Awaited here: the input ends with this scope, after the repair.
  return await new ShareRestore(nodeSharePlatform).repair({
    input,
    mode: "direct",
    walletCheck,
    confirmed: true,
    fingerprintOf: () => "00000000",
  });
}

/**
 * Two sets that fit, as a repair restores them where a share is marked: those of SSKR_SET_VECTOR
 * and of TEST_PHRASE. No two sets of real shares pass both the CRC-32 and the digest, so no repair
 * of real shares gives them; the steps that decide what a repair gives take them as they are.
 */
async function twoSets(): Promise<RepairedSet[]> {
  return [
    {
      mnemonic: SSKR_SET_VECTOR.phrase,
      shares: SSKR_SET_VECTOR.shares.slice(0, 2).map(unrepairedShare),
      unsettled: [],
    },
    await testPhraseSet(),
  ];
}

/**
 * What a repair decides for `sets` with `walletCheck`, or with none: each phrase that the wallet
 * matched (ShareRestore.phrases), whether they are shown as variants (exportDecision), and the
 * warnings that come with them (matchWarnings), as ShareRestore.repair composes them.
 */
async function decided(sets: readonly RepairedSet[], walletCheck?: WalletCheck) {
  const unmasking = new ShareUnmasking({ mode: "direct", walletCheck });
  const restored = await ShareRestore.phrases(unmasking, sets, [1, 2]);
  if (restored.kind !== "phrases") throw new Error(`The sets gave ${restored.kind}.`);
  const decision = ShareRestore.exportDecision(restored, walletCheck !== undefined);
  return { kind: decision.kind, warnings: matchWarnings(restored.phrases) };
}

describe("a repair of shares with a wallet", () => {
  const shares = SSKR_SET_VECTOR.shares.slice(0, 2);

  it("gives the shares that the wallet chose with what its check said of the match", async () => {
    const outcome = await repaired(shares, walletOf({ [SSKR_SET_VECTOR.phrase]: WARNING }));
    expect(outcome).toMatchObject({ kind: "shares", warning: WARNING });
  });

  it("gives no warning where the wallet's check said nothing of its match", async () => {
    const outcome = await repaired(shares, walletOf({ [SSKR_SET_VECTOR.phrase]: undefined }));
    expect(outcome.kind).toBe("shares");
    expect(outcome).not.toHaveProperty("warning");
  });

  it("gives every set that the wallet matched with its warning, said once", async () => {
    const wallet = walletOf({ [SSKR_SET_VECTOR.phrase]: WARNING, [TEST_PHRASE]: WARNING });
    expect(await decided(await twoSets(), wallet)).toEqual({
      kind: "variants",
      warnings: [WARNING],
    });
  });

  it("gives each of two warnings once, in the order of the sets", async () => {
    const wallet = walletOf({
      [SSKR_SET_VECTOR.phrase]: "First warning.",
      [TEST_PHRASE]: "Second warning.",
    });
    expect(await decided(await twoSets(), wallet)).toEqual({
      kind: "variants",
      warnings: ["First warning.", "Second warning."],
    });
  });

  it("gives only the set that the wallet matched, with its warning", async () => {
    const wallet = walletOf({ [TEST_PHRASE]: WARNING });
    expect(await decided(await twoSets(), wallet)).toEqual({ kind: "set", warnings: [WARNING] });
  });

  it("gives the sets that no wallet told apart without a warning", async () => {
    expect(await decided(await twoSets())).toEqual({ kind: "variants", warnings: [] });
  });
});
