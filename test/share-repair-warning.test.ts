// What the library's repair of shares with a wallet says of the wallet's match: the warning of its
// check, such as that a master fingerprint is only a filter, comes with the shares that the wallet
// chose and with the sets shown where it matched every one (AUD-037-SEC004), as sskr-export says
// it. Public test data only: the shares of vectors/sskr-v1.json ("bip39-128-2-of-3") and shares of
// the "abandon … about" phrase.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletCheck } from "../src/core/wallet-check.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { unrepairedShare } from "../src/sskr/repair.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareRestore, type ShareRepairOutcome } from "../src/sskr/share-restore.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { markUnits } from "./helpers/shares.js";
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
 * Gives the sets of every restore a second one beside its own: two shares of TEST_PHRASE. No two
 * sets of real shares pass both the CRC-32 and the digest, as a set of one share marked would
 * have to, so the step is given it, as a wallet of 32 bits lets a wrong set match too.
 */
async function withSecondSet(): Promise<void> {
  const others = (await splitSskrMnemonic(TEST_PHRASE, 2, 3)).slice(0, 2);
  const other = { mnemonic: TEST_PHRASE, shares: others.map(unrepairedShare), unsettled: [] };
  const phrases = ShareRestore.phrases.bind(ShareRestore);
  vi.spyOn(ShareRestore, "phrases").mockImplementation(async (unmasking, sets, places, run) =>
    phrases(unmasking, [...sets, other], places, run),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a repair of shares with a wallet", () => {
  const shares = sskrSetVector.shares.slice(0, 2);

  it("gives the shares that the wallet chose with what its check said of the match", async () => {
    const outcome = await repaired(shares, walletOf({ [sskrSetVector.phrase]: WARNING }));
    expect(outcome).toMatchObject({ kind: "shares", warning: WARNING });
  });

  it("gives no warning where the wallet's check said nothing of its match", async () => {
    const outcome = await repaired(shares, walletOf({ [sskrSetVector.phrase]: undefined }));
    expect(outcome.kind).toBe("shares");
    expect(outcome).not.toHaveProperty("warning");
  });

  it("gives every set that the wallet matched with its warning, said once", async () => {
    await withSecondSet();
    const outcome = await repaired(
      shares,
      walletOf({ [sskrSetVector.phrase]: WARNING, [TEST_PHRASE]: WARNING }),
    );
    expect(outcome).toMatchObject({ kind: "variants", variants: [{}, {}], warning: WARNING });
  });

  it("gives each of two warnings once, in the order of the sets", async () => {
    await withSecondSet();
    const outcome = await repaired(
      shares,
      walletOf({ [sskrSetVector.phrase]: "First warning.", [TEST_PHRASE]: "Second warning." }),
    );
    expect(outcome).toMatchObject({
      kind: "variants",
      warning: "First warning. Second warning.",
    });
  });

  it("gives the sets that no wallet told apart without a warning", async () => {
    await withSecondSet();
    // A marked share, so that the repair restores sets without a wallet too.
    using input = new ShareInput({ decodeEntry: "Decode" });
    input.add([String(shares[0]), markUnits(String(shares[1]), "colors", [5])]);
    const outcome = await new ShareRestore(nodeSharePlatform).repair({
      input,
      mode: "direct",
      confirmed: true,
      fingerprintOf: () => "00000000",
    });
    expect(outcome).toMatchObject({ kind: "variants", variants: [{}, {}] });
    expect(outcome).not.toHaveProperty("warning");
  });
});
