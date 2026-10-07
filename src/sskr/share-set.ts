// Restores the seed phrase of a set of SSKR shares, and checks every share given against it.
//
// Needs from the host: a SharePlatform (share-platform.ts) whose combineShares is the host's SSKR
// library; shares with elements marked with ? are assessed and searched with the same platform
// (JointRepair, joint-repair.ts).
// Also: the names of the share forms, the form in which a restored backup is shown, the rule that
// tells a copy of a share, the texts for shares that took no part and for a wallet that no phrase
// restored matches, and the rules by which an export writes the shares of a set again
// (ShareExport).
// Does not: run the SSKR self-test (the Node.js wrapper in shares.ts does, and another host checks
// its own library first), ask for shares, name them by where they were typed (share-input.ts), or
// say what a repair filled in (repair-report.ts).

import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { OutputFormat } from "../core/types.js";
import { JointRepair, type MarkedElement, type RepairedSet } from "./joint-repair.js";
import type { ReadRepairableShare } from "./repair.js";
import { RepairReport } from "./repair-report.js";
import type { SharePlatform } from "./share-platform.js";
import {
  assertShareCount,
  readShare,
  shareInfo,
  urToTransport,
  validateShareSet,
  type ShareFormat,
  type ShareInfo,
} from "./transport.js";

/** The share forms as a person reads their names (ShareFormat, transport.ts). */
export const SHARE_FORMAT_NAMES: Readonly<Record<ShareFormat, string>> = {
  ur: "Compact UR",
  words: "Bytewords",
  indexes: "BIP39 word numbers (1-2048)",
  unicode: "Unicode codes",
  colors: "RGB hexadecimal codes (ordered)",
  "colors-unicode": "Colors as Unicode codes",
};

/**
 * The form of an encoded seed phrase that matches a share's form, in which the restored backup is
 * shown; shares in Bytewords or as a UR give it back as words.
 */
export const RESTORED_FORM: Readonly<Record<ShareFormat, Exclude<OutputFormat, "json">>> = {
  ur: "english",
  words: "english",
  indexes: "indexes",
  unicode: "unicode",
  colors: "colors",
  "colors-unicode": "colors-unicode",
};

/** BIP39 entropy lengths: 12 to 24 words. */
const BIP39_ENTROPY_BYTES = [16, 20, 24, 28, 32];
/** BIP39 writes every 4 bytes of entropy as 3 words. */
const WORDS_PER_ENTROPY_BYTE = 3 / 4;
/** Digest checks that a combine makes on its own: well under a second. */
const MAX_LIBRARY_TRIES = 2 ** 16;
/**
 * The least threshold that keeps a digest beside the secret. A split with threshold 1 copies the
 * secret into every share, and its recovery returns the one share as it is (bc-shamir 0.13.0,
 * shamir.rs, split_secret and recover_secret), so nothing checks it.
 */
const MIN_DIGEST_THRESHOLD = 2;
/**
 * Choices of groups tried as the reference: about a second of recoveries for the largest sets.
 * Only a set of 13 groups or more has more choices than this (13 choose 6 is 1716).
 */
const MAX_REFERENCE_TRIES = 2 ** 10;
/** What toString, toJSON and Node.js's inspect show of a share set: never its phrase. */
const REDACTED = "[ShareSet: redacted]";
const UNCHECKED_DISAGREEMENT =
  "These shares give different secrets, and none of them can be checked on its own: MnemoCode cannot tell which is wrong. Check each of them.";
const NO_SECRET =
  "These shares do not restore a secret: check them, and that all belong to one set.";
const TOO_MANY_FAILING =
  "Too many combinations of these groups fail to restore a secret: leave out the groups you doubt, or check them.";

/** A share given at a place, as the copy rule takes it: its UR and that place. */
export interface PlacedShare {
  readonly place: number;
  readonly ur: string;
}

/**
 * The shares of `shares` that copy an earlier one exactly, the same UR however each was written,
 * each with the place of the first: a copy adds nothing to a restore and is used, or saved, once.
 * The one rule for copies, which the shares as typed (share-input.ts), the backup check and an
 * export (ShareExport) apply.
 */
export function copiesAmong(
  shares: readonly PlacedShare[],
): { readonly place: number; readonly of: number }[] {
  const copies: { readonly place: number; readonly of: number }[] = [];
  for (const [index, share] of shares.entries()) {
    const first = shares.slice(0, index).find((other) => other.ur === share.ur);
    if (first !== undefined) copies.push({ place: share.place, of: first.place });
  }
  return copies;
}

/** A group: the indexes of its shares in the input, counted from 0. */
type Group = readonly number[];

/** The groups that the secret is restored from, that secret, and whether a digest checks it. */
interface Reference {
  readonly groups: readonly Group[];
  readonly entropy: Uint8Array;
  readonly checked: boolean;
}

/**
 * A group of the set as given: its index in the set, counted from 0 as SSKR stores it, its member
 * threshold, and its shares, counted from 1 in the order given.
 */
export interface ShareGroup {
  readonly index: number;
  readonly threshold: number;
  readonly members: readonly number[];
}

/** Every choice of `count` of `items`, in their order: [a, b], [a, c], …, [b, c], … */
function* choicesOf<T>(items: readonly T[], count: number, from = 0): Generator<T[]> {
  if (count === 0) {
    yield [];
    return;
  }
  for (let at = from; at <= items.length - count; at += 1)
    for (const rest of choicesOf(items, count - 1, at + 1)) yield [items[at]!, ...rest];
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * The groups whose secret every other share is compared with: the first choice, in input order,
 * that a digest checks and that restores. A digest must check it: otherwise a wrong share that
 * comes first would be trusted, the right ones blamed, and leaving those out would restore a wrong
 * phrase. A choice that fails is passed over, so that a wrong group is blamed instead of the whole
 * set refused. With a group threshold of 2 or more, the digest of the groups checks any choice;
 * with 1, a group checks itself when its member threshold is 2 or more. When no group can be
 * checked, the first is taken, and a share that disagrees with it is not blamed.
 */
async function referenceOf(
  complete: readonly Group[],
  groupThreshold: number,
  memberThreshold: (group: Group) => number,
  restore: (groups: readonly Group[]) => Promise<Uint8Array | undefined>,
): Promise<Reference> {
  const checkable = complete.filter((group) => memberThreshold(group) >= MIN_DIGEST_THRESHOLD);
  if (groupThreshold < MIN_DIGEST_THRESHOLD && checkable.length === 0) {
    const entropy = await restore(complete.slice(0, 1));
    if (entropy === undefined) throw new Error(NO_SECRET);
    return { groups: complete.slice(0, 1), entropy, checked: false };
  }
  const choices =
    groupThreshold >= MIN_DIGEST_THRESHOLD
      ? choicesOf(complete, groupThreshold)
      : checkable.map((group) => [group]);
  let tries = 0;
  for (const groups of choices) {
    if (tries === MAX_REFERENCE_TRIES) throw new Error(TOO_MANY_FAILING);
    tries += 1;
    const entropy = await restore(groups);
    if (entropy !== undefined) return { groups, entropy, checked: true };
  }
  // A group of member threshold 1 may still restore, unchecked: no share is named, so that no
  // refusal leads there.
  throw new Error(NO_SECRET);
}

/** A refusal of the members of a group that give another secret than the reference. */
function otherGroupMismatch(members: readonly number[]): string {
  const numbers = members.map((member) => member + 1).join(", ");
  return members.length === 1
    ? `Share ${numbers} of another group does not fit with the others: leave it out, or check it.`
    : `Shares ${numbers} of another group do not fit with the others: leave them out, or check them.`;
}

/** A refusal of a surplus member that gives another secret than the reference. */
function memberMismatch(member: number): string {
  return `Share ${member + 1} does not fit with the others: with it they give another secret or none. Leave it out, or check it.`;
}

/** The indexes of the shares of each group, counted from 0, in the order the groups first come. */
function groupsOf(infos: readonly ShareInfo[]): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  infos.forEach((info, index) =>
    groups.set(info.groupIndex, [...(groups.get(info.groupIndex) ?? []), index]),
  );
  return groups;
}

/**
 * Restores the phrase from complete shares and checks that every share given agrees with it. The
 * SSKR library uses only the first `threshold` members of a group and the first groups that meet
 * the group threshold, so a surplus share would go unchecked, even a wrong one with a valid
 * checksum (AUD-008-FUN001). Each surplus member, and each surplus group, is therefore used once in
 * place of a member or a group of the reference (referenceOf), and must give the same secret. The
 * shares of a group with fewer members than its threshold take no part and cannot be checked: they
 * are returned, counted from 0.
 */
async function restoreCompleteShares(
  records: readonly string[],
  platform: SharePlatform,
): Promise<{ readonly mnemonic: string; readonly unchecked: readonly number[] }> {
  const normalized = validateShareSet(records);
  const infos = normalized.map((record) => shareInfo(urToTransport(record)));
  const groups = groupsOf(infos);
  const threshold = (group: Group) => infos[group[0]!]!.memberThreshold;
  const complete = [...groups.values()].filter((group) => group.length >= threshold(group));
  const unchecked = [...groups.values()]
    .filter((group) => group.length < threshold(group))
    .flat()
    .sort((a, b) => a - b);
  const firstMembers = (group: Group) => group.slice(0, threshold(group));
  /** The entropy that the SSKR library restores from `members`, or undefined when it refuses. */
  const recoverWith = async (members: readonly number[]): Promise<Uint8Array | undefined> => {
    try {
      return await platform.combineShares(members.map((member) => normalized[member]!));
    } catch {
      return undefined;
    }
  };
  const reference = await referenceOf(complete, infos[0]!.groupThreshold, threshold, (choice) =>
    recoverWith(choice.flatMap(firstMembers)),
  );
  const { groups: used, entropy } = reference;
  try {
    if (!BIP39_ENTROPY_BYTES.includes(entropy.length))
      throw new Error("Recovered SSKR secret is not BIP39 entropy.");
    /** The secret with `group` in place of one of the groups used: its own place, or the last. */
    const agrees = async (group: Group, members: readonly number[]): Promise<boolean> => {
      const at = used.includes(group) ? used.indexOf(group) : used.length - 1;
      const set = used.map((other, index) => (index === at ? members : firstMembers(other)));
      const again = await recoverWith(set.flat());
      try {
        return again !== undefined && sameBytes(again, entropy);
      } finally {
        again?.fill(0);
      }
    };
    // Without a digest, a disagreement shows only that some share is wrong, not which one.
    const refuse = (message: string): never => {
      throw new Error(reference.checked ? message : UNCHECKED_DISAGREEMENT);
    };
    for (const group of complete) {
      const first = firstMembers(group);
      if (!used.includes(group) && !(await agrees(group, first))) refuse(otherGroupMismatch(first));
      for (const member of group.slice(first.length))
        if (!(await agrees(group, [...first.slice(0, -1), member]))) refuse(memberMismatch(member));
    }
    return { mnemonic: entropyToMnemonic(entropy, wordlist), unchecked };
  } finally {
    entropy.fill(0);
  }
}

/**
 * The phrase that a set of SSKR shares restores, with every share as read or repaired, its groups
 * and thresholds, and what could not be checked. A class, so that a share set exists only once it
 * is restored and checked (its factories), and so that its phrase stays inside it: a caller takes
 * the phrase, or its fingerprint, on purpose; toString, toJSON and Node.js's inspect show none.
 */
export class ShareSet {
  readonly #set: RepairedSet;
  readonly #infos: readonly ShareInfo[];

  private constructor(set: RepairedSet) {
    if (set.shares.length === 0) throw new Error("A share set has at least one share.");
    // A copy that nothing can change: the set is handed out (toRepairedSet, shares) and must stay
    // what was restored and checked.
    this.#set = frozenSet(set);
    this.#infos = this.#set.shares.map((share) => shareInfo(urToTransport(share.ur)));
  }

  /**
   * Restores complete shares, each in any form MnemoCode writes, and checks every share given
   * against the phrase (restoreCompleteShares). A share that does not fit is refused by its place
   * among `records`, counted from 1.
   */
  static async restore(records: readonly string[], platform: SharePlatform): Promise<ShareSet> {
    assertShareCount(records.length);
    const shares = records.map((record) => ({
      ...readShare(record),
      repaired: false,
      filled: [],
    }));
    const { mnemonic, unchecked } = await restoreCompleteShares(
      shares.map((share) => share.ur),
      platform,
    );
    return new ShareSet({
      mnemonic,
      shares,
      unsettled: [],
      ...(unchecked.length === 0 ? {} : { unchecked: unchecked.map((index) => index + 1) }),
    });
  }

  /**
   * Restores the one phrase that `records` hold, in any form, with elements marked with ? where
   * unreadable, all with `platform`: complete shares by its SSKR library, marked ones assessed and
   * searched with it (JointRepair). A repair that needs a long search, or that more than one
   * phrase passes, is refused; a host that shows the assessment and asks first uses JointRepair
   * and ShareSet.of for each phrase found.
   */
  static async combine(records: readonly string[], platform: SharePlatform): Promise<ShareSet> {
    if (!records.some((record) => record.includes("?"))) return ShareSet.restore(records, platform);
    assertShareCount(records.length);
    const { assessment, search } = await new JointRepair(platform).plan(records);
    if (assessment.reason !== undefined) throw new Error(assessment.reason);
    if (assessment.combinations > MAX_LIBRARY_TRIES)
      throw new Error(
        "Too many combinations are open: read more of the marked elements, or add a share.",
      );
    const found = await search();
    if (found.length === 0)
      throw new Error("No phrase fits these shares: check the marks and the other elements.");
    if (found.length > 1)
      throw new Error(
        "More than one phrase fits these shares: read more of the marked elements, or add a share.",
      );
    return new ShareSet(found[0]!);
  }

  /** A phrase that a search of marked shares found (JointPlan.search), as a share set. */
  static of(set: RepairedSet): ShareSet {
    return new ShareSet(set);
  }

  /** Words of the phrase whose secret has `secretBytes`, as the shares and an assessment tell. */
  static wordCountOf(secretBytes: number): number {
    return secretBytes * WORDS_PER_ENTROPY_BYTE;
  }

  /**
   * Why the phrases restored, `sets` of them, are not the wallet given: their own phrases, or,
   * after a search of `dateCombinations` dates with ?, the phrases those dates unmask.
   */
  static walletMismatch(sets: number, dateCombinations?: number): string {
    if (dateCombinations === undefined)
      return sets === 1
        ? "The phrase that these shares restore does not match the wallet given."
        : `None of the ${sets} phrases that fit these shares matches the wallet given.`;
    const dates = RepairReport.counted(dateCombinations, "date combination");
    return sets === 1
      ? `None of the ${dates} gives the wallet given.`
      : `None of the ${dates} gives the wallet given, with any of the ${sets} phrases that fit these shares.`;
  }

  /** The phrase that the shares hold: for a Seedshift backup, the masked phrase. */
  get mnemonic(): string {
    return this.#set.mnemonic;
  }

  /** Every share, in the order given, as read or repaired. */
  get shares(): readonly ReadRepairableShare[] {
    return this.#set.shares;
  }

  /** Elements that the phrase does not depend on and nothing settles: their values are a guess. */
  get unsettled(): readonly MarkedElement[] {
    return this.#set.unsettled;
  }

  /** Shares, counted from 1, of a group with fewer than its threshold: they took no part. */
  get unchecked(): readonly number[] {
    return this.#set.unchecked ?? [];
  }

  /**
   * The warning for the shares that took no part, each named by its place in `places`, by its
   * index in the set; undefined when every share took part.
   */
  uncheckedNote(places?: readonly number[]): string | undefined {
    if (this.unchecked.length === 0) return undefined;
    const named = this.unchecked.map((share) => places?.[share - 1] ?? share);
    return `Share ${named.join(", ")}: too few shares of its group to take part; not checked.`;
  }

  /** Whether every share took part in the restore and every element of it is settled. */
  get checked(): boolean {
    return this.unchecked.length === 0 && this.unsettled.length === 0;
  }

  /** Groups of the set that restore the phrase. */
  get groupThreshold(): number {
    return this.#infos[0]!.groupThreshold;
  }

  /** Groups of the set, given or not. */
  get groupCount(): number {
    return this.#infos[0]!.groupCount;
  }

  /** The groups of the shares given, in the order they first come. */
  get groups(): readonly ShareGroup[] {
    return [...groupsOf(this.#infos).entries()].map(([index, members]) => ({
      index,
      threshold: this.#infos[members[0]!]!.memberThreshold,
      members: members.map((member) => member + 1),
    }));
  }

  /** Bytes of the secret that the shares hold. */
  get secretBytes(): number {
    return this.#infos[0]!.secretLength;
  }

  /** Words of the phrase that the shares hold. */
  get wordCount(): number {
    return ShareSet.wordCountOf(this.secretBytes);
  }

  /** The form in which the backup that was split is shown again: that of its first share. */
  get backupForm(): Exclude<OutputFormat, "json"> {
    return RESTORED_FORM[this.shares[0]!.format];
  }

  /**
   * The wallet fingerprint of the phrase that the shares hold, by `fingerprintOf` (the host's BIP32
   * master fingerprint, with its seed function and an empty BIP39 passphrase), or undefined when
   * that phrase is no valid BIP39 phrase. For a Seedshift backup it is the encoded fingerprint, to
   * be compared with the one noted at encoding before any date is typed.
   */
  fingerprint(fingerprintOf: (mnemonic: string) => string): string | undefined {
    return validateMnemonic(this.mnemonic, wordlist) ? fingerprintOf(this.mnemonic) : undefined;
  }

  /** The set as plain data, as combineSskrShareSet and the searches give it; it cannot be changed. */
  toRepairedSet(): RepairedSet {
    return this.#set;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/** A share as it is shown or written again: its UR, its form, and its place among those typed. */
export interface WrittenShare {
  readonly ur: string;
  readonly format: ShareFormat;
  readonly number: number;
}

/** The shares of `shown`, each once: the first of its copies (copiesAmong). */
function distinct(shown: readonly WrittenShare[]): WrittenShare[] {
  const placed = shown.map((share, index) => ({ place: index, ur: share.ur }));
  const copied = new Set(copiesAmong(placed).map((copy) => copy.place));
  return shown.filter((_, index) => !copied.has(index));
}

/** A set that no caller can change: every array and object of it copied and frozen. */
function frozenSet(set: RepairedSet): RepairedSet {
  return Object.freeze({
    mnemonic: set.mnemonic,
    shares: Object.freeze(
      set.shares.map((share) =>
        Object.freeze({
          ...share,
          filled: Object.freeze(share.filled.map((element) => Object.freeze({ ...element }))),
        }),
      ),
    ),
    unsettled: Object.freeze(set.unsettled.map((element) => Object.freeze({ ...element }))),
    ...(set.unchecked === undefined ? {} : { unchecked: Object.freeze([...set.unchecked]) }),
  });
}

/**
 * The shares of a set to write again, as an export writes them: each in its own form or in one
 * form given, by its place among those typed. A share with an element that nothing settles, such
 * as one that could not be read at all, is left out: written down, it would be a guess passed off
 * as the share. Copies of one share are shown as typed and saved once. A class, so that what is
 * shown, what is saved and the forms among them follow the same rules.
 */
export class ShareExport {
  readonly #shown: readonly WrittenShare[];
  readonly #leftOut: readonly number[];
  readonly #total: number;

  private constructor(shown: readonly WrittenShare[], leftOut: readonly number[], total: number) {
    // Copied and frozen: the getters hand them out, and what is shown, saved and named must stay
    // what the export settled.
    this.#shown = Object.freeze(shown.map((share) => Object.freeze({ ...share })));
    this.#leftOut = Object.freeze([...leftOut]);
    this.#total = total;
  }

  /**
   * The shares of `set`, repaired or not, named by `places`, by their index in the set; each in
   * `format`, or without it in the form it was written in.
   */
  static of(
    set: Pick<RepairedSet, "shares" | "unsettled">,
    places: readonly number[],
    format?: ShareFormat,
  ): ShareExport {
    // Array.from turns holes into undefined, which is refused: each share is named by its place,
    // and a missing one would be shown as "Share undefined".
    const named = Array.from(places);
    if (
      named.length < set.shares.length ||
      !named.every((place) => Number.isSafeInteger(place) && place >= 1)
    )
      throw new Error("Each share needs its place among those typed, a whole number from 1.");
    const leftOut = [
      ...new Set(set.unsettled.map((element) => named[element.share - 1] ?? element.share)),
    ];
    const shown = set.shares.flatMap((share, index) =>
      leftOut.includes(named[index]!)
        ? []
        : [{ ur: share.ur, format: format ?? share.format, number: named[index]! }],
    );
    return new ShareExport(shown, leftOut, Math.max(...named));
  }

  /** The places of the shares left out, with an element that nothing settles. */
  get leftOut(): readonly number[] {
    return this.#leftOut;
  }

  /** Why each share left out is left out, one line each. */
  leftOutMessages(): string[] {
    return this.#leftOut.map(
      (place) =>
        `Share ${place} cannot be settled and is left out: read more of it, or use another copy.`,
    );
  }

  /** The shares to show, in the order typed, copies included. */
  get shown(): readonly WrittenShare[] {
    return this.#shown;
  }

  /** The shares to save: each once. */
  get saved(): readonly WrittenShare[] {
    return distinct(this.#shown);
  }

  /** The forms of the shares saved, each once, in their order. */
  get forms(): readonly ShareFormat[] {
    return [...new Set(this.saved.map((share) => share.format))];
  }

  /** The shares shown, by place, as a check that they belong to one set takes them. */
  get members(): readonly { readonly place: number; readonly ur: string }[] {
    return this.#shown.map((share) => ({ place: share.number, ur: share.ur }));
  }

  /** The highest place of the shares typed: the shares are shown as "N of" it. */
  get total(): number {
    return this.#total;
  }

  /** The note for copies saved once, or undefined when no share was typed twice. */
  get copiesNote(): string | undefined {
    return this.saved.length < this.#shown.length
      ? "Copies of one share are saved once."
      : undefined;
  }

  /** The same shares, every one in `format`, as cards show them. */
  inForm(format: ShareFormat): ShareExport {
    return new ShareExport(
      this.#shown.map((share) => ({ ...share, format })),
      this.#leftOut,
      this.#total,
    );
  }
}
