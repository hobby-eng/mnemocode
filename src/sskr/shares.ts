import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { representMnemonic } from "../core.js";
import { secureSeed, sskrEngine } from "./runtime.js";
import {
  assertShareCount,
  normalizeShare,
  readShare,
  shareInfo,
  urToTransport,
  validateShareSet,
} from "./transport.js";
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

/** The entropy that the SSKR library restores from `records`, or undefined when it refuses them. */
function recoverWith(
  engine: Awaited<ReturnType<typeof sskrEngine>>,
  records: readonly string[],
): Uint8Array | undefined {
  try {
    return engine.recover_sskr_shares(records.join("\n"));
  } catch {
    return undefined;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * Restores the phrase from complete shares and checks that every share given agrees with it. The
 * SSKR library uses only the first `threshold` members of a group and the first groups that meet
 * the group threshold, so a surplus share would go unchecked, even a wrong one with a valid
 * checksum (AUD-008-FUN001). Each surplus member, and each surplus group, is therefore used once in
 * place of one of those, and must give the same secret. The shares of a group with fewer members
 * than its threshold take no part and cannot be checked: they are returned, counted from 0.
 */
async function restoreCompleteShares(
  records: readonly string[],
): Promise<{ readonly mnemonic: string; readonly unchecked: readonly number[] }> {
  const normalized = validateShareSet(records);
  const engine = await sskrEngine();
  const infos = normalized.map((record) => shareInfo(urToTransport(record)));
  const groups = new Map<number, number[]>();
  infos.forEach((info, index) =>
    groups.set(info.groupIndex, [...(groups.get(info.groupIndex) ?? []), index]),
  );
  const threshold = (group: readonly number[]) => infos[group[0]!]!.memberThreshold;
  const complete = [...groups.values()].filter((group) => group.length >= threshold(group));
  const unchecked = [...groups.values()]
    .filter((group) => group.length < threshold(group))
    .flat()
    .sort((a, b) => a - b);
  const groupThreshold = infos[0]!.groupThreshold;
  const used = complete.slice(0, groupThreshold);
  const recordsOf = (members: readonly number[]) => members.map((member) => normalized[member]!);
  const firstMembers = (group: readonly number[]) => group.slice(0, threshold(group));
  const entropy = recoverWith(
    engine,
    used.flatMap((group) => recordsOf(firstMembers(group))),
  );
  if (entropy === undefined)
    throw new Error(
      "These shares do not restore a secret: check them, and that all belong to one set.",
    );
  try {
    if (!BIP39_ENTROPY_BYTES.includes(entropy.length))
      throw new Error("Recovered SSKR secret is not BIP39 entropy.");
    /** The secret with `group` in place of one of the groups used: its own place, or the last. */
    const agrees = (group: number[], members: readonly number[]): boolean => {
      const at = used.includes(group) ? used.indexOf(group) : used.length - 1;
      const set = used.map((other, index) => (index === at ? members : firstMembers(other)));
      const again = recoverWith(
        engine,
        set.flatMap((members) => recordsOf(members)),
      );
      try {
        return again !== undefined && sameBytes(again, entropy);
      } finally {
        again?.fill(0);
      }
    };
    for (const group of complete) {
      if (!used.includes(group) && !agrees(group, firstMembers(group)))
        throw new Error(
          `Shares ${firstMembers(group)
            .map((member) => member + 1)
            .join(
              ", ",
            )} of another group do not fit with the others: leave them out, or check them.`,
        );
      const first = firstMembers(group);
      for (const member of group.slice(first.length))
        if (!agrees(group, [...first.slice(0, -1), member]))
          throw new Error(
            `Share ${member + 1} does not fit with the others: with it they give another secret or none. Leave it out, or check it.`,
          );
    }
    return { mnemonic: entropyToMnemonic(entropy, wordlist), unchecked };
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
  const { mnemonic, unchecked } = await restoreCompleteShares(shares.map((share) => share.ur));
  return {
    mnemonic,
    shares,
    unsettled: [],
    ...(unchecked.length === 0 ? {} : { unchecked: unchecked.map((index) => index + 1) }),
  };
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
 * here; the command line shows the assessment, asks, and lists every phrase. The result keeps any
 * unchecked shares and unsettled elements, so that a caller can report them honestly.
 */
export async function combineSskrShareSet(records: readonly string[]): Promise<RepairedSet> {
  if (!records.some((record) => record.includes("?"))) return restoreShareSet(records);
  const { assessment, search } = await planShareRepair(records);
  if (assessment.reason !== undefined) throw new Error(assessment.reason);
  if (assessment.combinations > MAX_LIBRARY_TRIES)
    throw new Error("Too many combinations are open: restore these shares on the command line.");
  const found = await search();
  if (found.length === 0)
    throw new Error("No phrase fits these shares: check the marks and the other elements.");
  if (found.length > 1)
    throw new Error("More than one phrase fits these shares: restore them on the command line.");
  return found[0]!;
}

/**
 * The phrase only, when every supplied share was checked. A string cannot disclose unchecked data:
 * callers that need partial recovery use combineSskrShareSet and report its metadata (AUD-008-FUN001).
 */
export async function combineSskrShares(records: readonly string[]): Promise<string> {
  const restored = await combineSskrShareSet(records);
  if (restored.unchecked?.length || restored.unsettled.length)
    throw new Error(
      "Some shares or repaired elements could not be checked. Use combineSskrShareSet to inspect them, or restore on the command line.",
    );
  return restored.mnemonic;
}

export { normalizeShare };
