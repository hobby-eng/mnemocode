// The SSKR share functions for Node.js programs: each runs the SSKR self-test first, then the
// host-neutral share modules with the Node.js platform (share-platform-node.ts). Another host uses
// those modules with its own platform: ShareSplit (split.ts), ShareSet (share-set.ts) and
// JointRepair (joint-repair.ts).

import { assertSskrSelfTest } from "./self-test.js";
import { planJointRepair, type JointPlan } from "./joint-repair.js";
import { type RepairedSet } from "./joint-results.js";
import { ShareSet } from "./share-set.js";
// The Node.js platform and randomness that the functions below pass to the share modules.
import { nodeFillRandom, nodeSharePlatform } from "./share-platform-node.js";
import { type BackupSplit, type BackupSplitRequest, MAX_SHARES, ShareSplit } from "./split.js";
import { assertShareCount, normalizeShare } from "./transport.js";

export { MAX_SHARES };

/**
 * Refuses a threshold and a count of shares that SSKR does not take together
 * (ShareSplit.validateThreshold).
 */
export function validateThreshold(threshold: number, count: number): void {
  ShareSplit.validateThreshold(threshold, count);
}

/**
 * The shares of `mnemonic`, `count` of them of which any `threshold` restore it, made after the
 * engine's known answers with the system's randomness; refuses a threshold and a count that SSKR
 * does not take.
 */
export async function splitSskrMnemonic(
  mnemonic: string,
  threshold: number,
  count: number,
): Promise<string[]> {
  ShareSplit.validateThreshold(threshold, count);
  await assertSskrSelfTest();
  return new ShareSplit(nodeSharePlatform, nodeFillRandom).split(mnemonic, threshold, count);
}

/** The shares of a backup, masked first in its mode (ShareSplit.splitBackup). */
export async function splitSskrBackup(request: BackupSplitRequest): Promise<BackupSplit> {
  ShareSplit.validateThreshold(request.threshold, request.count);
  await assertSskrSelfTest();
  return new ShareSplit(nodeSharePlatform, nodeFillRandom).splitBackup(request);
}

/** Refuses too few or too many shares, and checks the SSKR engine, before any share is read. */
async function assertCheckedRecords(records: readonly string[]): Promise<void> {
  assertShareCount(records.length);
  await assertSskrSelfTest();
}

/** The phrase of complete shares, each as read, in the shape of a repair. */
export async function restoreShareSet(records: readonly string[]): Promise<RepairedSet> {
  await assertCheckedRecords(records);
  return (await ShareSet.restore(records, nodeSharePlatform)).toRepairedSet();
}

/**
 * Assesses shares with elements marked with ? where unreadable, all together (joint-repair.ts).
 * The plan's search finds every phrase they can restore. `signal` stops the assessment, which can
 * take a while for many marks; it then rejects with the signal's reason.
 */
export async function planShareRepair(
  records: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<JointPlan> {
  await assertCheckedRecords(records);
  return planJointRepair(records, { ...options, platform: nodeSharePlatform });
}

/**
 * Restores the one phrase that `records` hold, in any form, with elements marked with ? where
 * unreadable. A repair that needs a long search, or that more than one phrase passes, is refused
 * here; the command line shows the assessment, asks, and lists every phrase. The result keeps any
 * unchecked shares and unsettled elements, so that a caller can report them honestly.
 */
export async function combineSskrShareSet(records: readonly string[]): Promise<RepairedSet> {
  await assertCheckedRecords(records);
  return (await ShareSet.combine(records, nodeSharePlatform)).toRepairedSet();
}

/**
 * The phrase only, when every supplied share was checked. A string cannot disclose unchecked data:
 * callers that need partial recovery use combineSskrShareSet and report its metadata
 * (AUD-008-FUN001).
 */
export async function combineSskrShares(records: readonly string[]): Promise<string> {
  await assertCheckedRecords(records);
  const restored = await ShareSet.combine(records, nodeSharePlatform);
  if (!restored.checked)
    throw new Error(
      "Some shares or repaired elements could not be checked. Use combineSskrShareSet to inspect them, or restore on the command line.",
    );
  return restored.mnemonic;
}

export { normalizeShare };
