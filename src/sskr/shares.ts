import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { representMnemonic } from "../core.js";
import { secureSeed, sskrEngine } from "./runtime.js";
import { assertShareCount, normalizeShare, readShare, validateShareSet } from "./transport.js";
import { assertSskrSelfTest } from "./self-test.js";
import { planJointRepair, type JointPlan, type RepairedSet } from "./joint-repair.js";
// Share repair takes HMAC-SHA256 and the SSKR library from Node.js here.
import "./share-platform-node.js";

/** SSKR allows at most 16 members in a group. */
export const MAX_SHARES = 16;

export function validateThreshold(threshold: number, count: number): void {
  if (
    !Number.isSafeInteger(threshold) ||
    !Number.isSafeInteger(count) ||
    threshold < 2 ||
    count < threshold ||
    count > MAX_SHARES
  )
    throw new Error(`SSKR requires 2 <= threshold <= shares <= ${MAX_SHARES}.`);
}

export async function splitSskrMnemonic(
  mnemonic: string,
  threshold: number,
  count: number,
): Promise<string[]> {
  validateThreshold(threshold, count);
  await assertSskrSelfTest();
  const normalized = representMnemonic(mnemonic).sourceMnemonic;
  const engine = await sskrEngine();
  const entropy = mnemonicToEntropy(normalized, wordlist);
  let random: Uint8Array | undefined;
  try {
    random = secureSeed();
    const records = engine
      .create_sskr_shares(entropy, 1, Uint8Array.of(threshold, count), random)
      .trim()
      .split("\n");
    if (records.length !== count)
      throw new Error("SSKR engine returned an unexpected share count.");
    const validated = validateShareSet(records);
    const restored = engine.recover_sskr_shares(validated.slice(0, threshold).join("\n"));
    try {
      if (
        restored.length !== entropy.length ||
        restored.some((byte, index) => byte !== entropy[index])
      )
        throw new Error("SSKR generated shares did not reconstruct the source entropy.");
    } finally {
      restored.fill(0);
    }
    return validated;
  } finally {
    entropy.fill(0);
    random?.fill(0);
  }
}

/** BIP39 entropy lengths: 12 to 24 words. */
const BIP39_ENTROPY_BYTES = [16, 20, 24, 28, 32];
/** Digest checks that combineSskrShares makes on its own: well under a second. */
const MAX_LIBRARY_TRIES = 2 ** 16;

/** Restores the phrase from complete shares; the SSKR library checks them and their quorum. */
async function restoreCompleteShares(records: readonly string[]): Promise<string> {
  const normalized = validateShareSet(records);
  const engine = await sskrEngine();
  const entropy = engine.recover_sskr_shares(normalized.join("\n"));
  try {
    if (!BIP39_ENTROPY_BYTES.includes(entropy.length))
      throw new Error("Recovered SSKR secret is not BIP39 entropy.");
    return entropyToMnemonic(entropy, wordlist);
  } finally {
    entropy.fill(0);
  }
}

/** The phrase of complete shares, each as read, in the shape of a repair. */
export async function restoreShareSet(records: readonly string[]): Promise<RepairedSet> {
  assertShareCount(records.length);
  await assertSskrSelfTest();
  const shares = records.map((record) => ({
    ...readShare(record),
    repaired: false,
    filled: [],
  }));
  const mnemonic = await restoreCompleteShares(shares.map((share) => share.ur));
  return { mnemonic, shares, unsettled: [] };
}

/**
 * Assesses shares with elements marked with ? where unreadable, all together (joint-repair.ts).
 * The plan's search finds every phrase they can restore.
 */
export async function planShareRepair(records: readonly string[]): Promise<JointPlan> {
  assertShareCount(records.length);
  await assertSskrSelfTest();
  return planJointRepair(records);
}

/**
 * Restores the one phrase that `records` hold, in any form, with elements marked with ? where
 * unreadable. A repair that needs a long search, or that more than one phrase passes, is refused
 * here; the command line shows the assessment, asks, and lists every phrase.
 */
export async function combineSskrShares(records: readonly string[]): Promise<string> {
  if (!records.some((record) => record.includes("?")))
    return (await restoreShareSet(records)).mnemonic;
  const { assessment, search } = await planShareRepair(records);
  if (assessment.reason !== undefined) throw new Error(assessment.reason);
  if (assessment.combinations > MAX_LIBRARY_TRIES)
    throw new Error("Too many combinations are open: restore these shares on the command line.");
  const found = await search();
  if (found.length === 0)
    throw new Error("No phrase fits these shares: check the marks and the other elements.");
  if (found.length > 1)
    throw new Error("More than one phrase fits these shares: restore them on the command line.");
  return found[0]!.mnemonic;
}

export { normalizeShare };
