// The SSKR share functions for Node.js programs: each runs the SSKR self-test first, then the
// host-neutral share modules with the Node.js platform (share-platform-node.ts). Another host uses
// those modules with its own platform: ShareSplit (split.ts), ShareSet (share-set.ts) and
// JointRepair (joint-repair.ts).

import { assertSskrSelfTest } from "./self-test.js";
import { type RepairedSet } from "./joint-results.js";
import { ShareSet } from "./share-set.js";
// The Node.js platform and randomness that the functions below pass to the share modules.
import { nodeFillRandom, nodeSharePlatform } from "./share-platform-node.js";
import { type BackupSplit, type BackupSplitRequest, ShareSplit } from "./split.js";
import { assertShareCount } from "./transport.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("sskr.shares", {
  "some-shares-repaired-elements-could-not-checked-use": () =>
    "Some shares or repaired elements could not be checked. Use combineSskrShareSet to inspect them, or restore on the command line.",
  "no-digest-checked-phrase": () =>
    "No SSKR digest checks the phrase of these shares: each group that restores it takes one share. Use combineSskrShareSet, whose result says so, or restore on the command line.",
});

/**
 * Refuses a threshold and a count of shares that SSKR does not take together
 * (ShareSplit.validateThreshold).
 */
export function validateThreshold(threshold: number, count: number): void {
  ShareSplit.validateThreshold(threshold, count);
}

/**
 * The shares of `mnemonic`, `count` of them of which any `threshold` restore it, made after the
 * engine's known answers with the system's randomness. Refuses a threshold and a count that SSKR
 * does not take (sskr.split.split-threshold-from-number-shares-at-most-shares), first; a failed
 * SSKR self-test (assertSskrSelfTest), before any share is made; and what ShareSplit.split
 * refuses of the phrase and of the shares it makes, such as a phrase that is not valid English
 * BIP39 words (core.words codes).
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

/**
 * The phrase of complete shares, each as read, in the shape of a repair; every share given is
 * checked against the phrase (ShareSet.restore). Refuses a count of shares outside 1 to a whole
 * set (sskr.transport.assert-share-count-refused); a failed SSKR self-test, before any share is
 * read; shares that Share.readSet refuses, such as a text that is no share, shares of different
 * sets or too few for the recorded threshold
 * (sskr.transport.not-enough-sskr-shares-meet-recorded-threshold); and shares that restore no
 * phrase or disagree with it, named by their place (sskr.complete-shares).
 */
export async function restoreShareSet(records: readonly string[]): Promise<RepairedSet> {
  await assertCheckedRecords(records);
  using set = await ShareSet.restore(records, nodeSharePlatform);
  return set.toRepairedSet();
}

/**
 * Restores the one phrase that `records` hold, in any form, with elements marked with ? where
 * unreadable. A repair that needs a long search, or that more than one phrase passes, is refused
 * here; the command line shows the assessment, asks, and lists every phrase. The result keeps any
 * unchecked shares and unsettled elements, and digestUnchecked where no SSKR digest checked the
 * phrase, so that a caller can report them honestly.
 */
export async function combineSskrShareSet(records: readonly string[]): Promise<RepairedSet> {
  await assertCheckedRecords(records);
  using set = await ShareSet.combine(records, nodeSharePlatform);
  return set.toRepairedSet();
}

/**
 * The phrase only, when every supplied share was checked and an SSKR digest checked the phrase. A
 * string cannot disclose unchecked data: callers that need partial recovery use
 * combineSskrShareSet and report its metadata (AUD-008-FUN001, AUD-037-API004). Throws where no
 * SSKR digest checked the phrase (sskr.shares.no-digest-checked-phrase) and where a share or a
 * repaired element could not be checked
 * (sskr.shares.some-shares-repaired-elements-could-not-checked-use); before that, refuses what
 * combineSskrShareSet refuses, such as a count of shares outside 1 to a whole set, a failed SSKR
 * self-test, a share that does not read, and a repair that needs a long search or that more than
 * one phrase passes (ShareSet.combine).
 */
export async function combineSskrShares(records: readonly string[]): Promise<string> {
  await assertCheckedRecords(records);
  using restored = await ShareSet.combine(records, nodeSharePlatform);
  if (!restored.digestChecked) throw ERRORS.create("no-digest-checked-phrase", []);
  if (!restored.checked)
    throw ERRORS.create("some-shares-repaired-elements-could-not-checked-use", []);
  return restored.mnemonic;
}
