// Restores the seed phrase of a set of SSKR shares, and checks every share given against it.
//
// Needs from the host: a SharePlatform (share-platform.ts) whose combineShares is the host's SSKR
// library; shares with elements marked with ? are assessed and searched with the same platform
// (JointRepair, joint-repair.ts).
// Also: the names of the share forms, the form in which a restored backup is shown, the rule that
// tells a copy of a share, the texts for shares that took no part and for a wallet that no phrase
// restored matches, and the rules by which an export writes the shares of a set again
// (ShareExport).
// Does not: run the SSKR self-test (the share functions for Node.js in shares.ts do, and another
// host checks its own library first), ask for shares, name them by where they were typed
// (share-input.ts), or say what a repair filled in (repair-report.ts).

import { formatEncoded } from "../core/representations.js";
import { representMnemonic } from "../core/seedshift.js";
import { wordCountOfEntropy } from "../core/bip39-sizes.js";
import { englishTokens, fingerprintOfValidPhrase } from "../core/english-words.js";
import type { EncodedFormat } from "../core/types.js";
import { JointRepair, searchOnce } from "./joint-repair.js";
import {
  type JointAssessment,
  type MarkedElement,
  type RepairedSet,
  type RepairedShares,
} from "./joint-results.js";
import type { ReadRepairableShare } from "./repair.js";
import { NO_PHRASE_FITS } from "./repair-report.js";
import {
  ShareCombineRefusalError,
  type ShareCombiner,
  type ShareRepairPlatform,
} from "./share-platform.js";
import { errorCode } from "../core/refusal.js";
import {
  assertShareCount,
  assertShareFormat,
  Share,
  type ShareFormat,
  MIRRORED_FORM,
  SHARE_FORMAT_NAMES,
} from "./transport.js";
import type { ShareInfo } from "./share-layout.js";
import { copiesAmong, SetTopology, type PlacedShare, withoutCopies } from "./set-topology.js";
import {
  digestChecks,
  digestField,
  restoreCompleteShares,
  uncheckedField,
} from "./complete-shares.js";
import { Redacted } from "../core/redacted.js";
import { counted } from "../core/search-plan.js";
import { placeOf } from "../core/places.js";
import { unrepairedShare } from "./repair.js";
import { isMarked } from "./repair-units.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";
import { SecretValue } from "../core/secret-value.js";
import { ShareValues } from "./share-values.js";
import { inWholeRange, wholeNumbersFrom } from "../core/typed-number.js";

/** What combine says of more combinations than it tries (MAX_LIBRARY_TRIES). */
const TOO_MANY_OPEN =
  "Too many combinations are open: read more of the marked elements, or add a share.";

// A plan that combine does not search is refused with one code for each condition
// (combineRefusal), worded by JointRepair's reason where it gives one (AUD-037-API009).
const ERRORS = new ErrorCatalog("sskr.share-set", {
  "share-set-at-least-one-share": () => "A share set has at least one share.",
  "more-shares-needed": suppliedMessage,
  "share-unreadable": suppliedMessage,
  "several-groups": suppliedMessage,
  "shares-do-not-fit": suppliedMessage,
  "too-many-combinations-open": (reason = TOO_MANY_OPEN) => reason,
  "no-phrase-fits": () => NO_PHRASE_FITS,
  "more-than-one-phrase-fits-shares-read-more": () =>
    "More than one phrase fits these shares: read more of the marked elements, or add a share.",
  "share-s-secret-no-bip39-length": () => "A share's secret has no BIP39 length.",
  "each-share-place-among-typed-whole-number-from": () =>
    "Each share needs its place among those typed, a whole number from 1.",
  "repair-position": {
    kind: "type",
    text: () => "A repair needs whole positive share and element positions.",
  },
});

// The copy rule belongs to set-topology.ts; here too for the modules that take it with a set.
export { copiesAmong, type PlacedShare };

// The names of the share forms belong to the forms (transport.ts); here too for the modules and
// hosts that take them with a set.
export { SHARE_FORMAT_NAMES };

/** The form in which a restored backup is shown: the one its shares look like (transport.ts). */
export const RESTORED_FORM: Readonly<Record<ShareFormat, EncodedFormat>> = MIRRORED_FORM;

/** What is said of shares that keep no digest of the secret (ShareSet.digestChecked). */
const NO_DIGEST_NOTE =
  "No SSKR digest checked this phrase: the groups that restored it take one share each. A changed share would give another phrase.";

/**
 * The parts whose coded errors, thrown while shares are restored, refuse the shares given; their
 * TypeErrors and the codes of SHARE_FAULTS are faults, not refusals (ShareSet.isRefusal).
 */
const SHARE_REFUSAL_PARTS = [
  "sskr.share-set.",
  "sskr.complete-shares.",
  "sskr.transport.",
  "sskr.joint-repair.",
  "sskr.repair.",
  "sskr.share-values.",
];
/** Coded errors of those parts that end an owner's lifetime rather than refuse the shares. */
const SHARE_FAULTS = new Set(["sskr.joint-repair.plan-wiped"]);

/** Digest checks that a combine makes on its own: well under a second. */
const MAX_LIBRARY_TRIES = 2 ** 16;

/** The backup that was split, in the form its shares were written in (ShareSet.backup). */
export interface SetBackup {
  /** The form of the first share, as the backup takes it (RESTORED_FORM). */
  readonly form: EncodedFormat;
  /** The backup written in that form: secret, and never the same words as the phrase. */
  readonly text: string;
}

/**
 * A group of the set as given: its index in the set, counted from 0 as SSKR stores it, its member
 * threshold, and its shares, counted from 1 in the order given.
 */
export interface ShareGroup {
  /** The group's index in the set, counted from 0, 0 to 15. */
  readonly index: number;
  /** The members that restore the group, 1 to 16. */
  readonly threshold: number;
  /** The group's shares among those given, counted from 1, in the order given. */
  readonly members: readonly number[];
}

/**
 * The phrase that a set of SSKR shares restores, with every share as read or repaired, its groups
 * and thresholds, and what could not be checked. A class, so that a share set exists only once it
 * is restored and checked (its factories), and so that its phrase stays inside it: a caller takes
 * the phrase, or its fingerprint, on purpose; toString, toJSON and Node.js's inspect show none.
 */
export class ShareSet extends Redacted implements Disposable {
  readonly #mnemonic: SecretValue<string>;
  readonly #shares: ShareValues;
  readonly #unsettled: readonly MarkedElement[];
  readonly #unchecked: readonly number[] | undefined;
  readonly #digestUnchecked: boolean;
  readonly #infos: readonly ShareInfo[];

  private constructor(set: RepairedSet) {
    super("ShareSet");
    if (set.shares.length === 0) throw ERRORS.create("share-set-at-least-one-share", []);
    // Snapshot the admitted fields only; borrowed objects may contain extra private material.
    const copy = frozenSet(set);
    this.#infos = copy.shares.map((share) => {
      using read = Share.read(share.ur);
      return read.info;
    });
    const mnemonic = SecretValue.text(copy.mnemonic);
    try {
      this.#shares = new ShareValues(copy.shares);
      this.#mnemonic = mnemonic;
      this.#unsettled = copy.unsettled;
      this.#unchecked = copy.unchecked;
      // A set that says nothing of its digest is called checked only where the shares can be.
      this.#digestUnchecked = copy.digestUnchecked === true || !digestChecksShares(this.#infos);
    } catch (error) {
      mnemonic.wipe();
      throw error;
    }
  }

  /**
   * Restores complete shares, each in any form MnemoCode writes, and checks every share given
   * against the phrase (restoreCompleteShares). A share that does not fit is refused by its place
   * in `places`, by its index among `records`; by that index, counted from 1, without them.
   */
  static async restore(
    records: readonly string[],
    platform: ShareCombiner,
    places?: readonly number[],
  ): Promise<ShareSet> {
    assertShareCount(records.length);
    const shares = records.map(unrepairedShare);
    const { mnemonic, unchecked, digestChecked } = await restoreCompleteShares(
      shares.map((share) => share.ur),
      platform,
      places,
    );
    return new ShareSet({
      mnemonic,
      shares,
      unsettled: [],
      ...uncheckedField(unchecked),
      ...digestField(digestChecked),
    });
  }

  /**
   * Whether `error`, thrown by restore or combine, refuses the shares given: a coded refusal of
   * the share modules, or the engine's refusal of a combination (ShareCombineRefusalError). A
   * failure of the host, of its engine or of MnemoCode is no refusal: a caller lets it pass
   * through rather than ask for other shares (AUD-037-API002).
   */
  static isRefusal(error: unknown): boolean {
    if (ShareCombineRefusalError.is(error)) return true;
    const code = errorCode(error);
    if (code === undefined || error instanceof TypeError || SHARE_FAULTS.has(code)) return false;
    return SHARE_REFUSAL_PARTS.some((part) => code.startsWith(part));
  }

  /**
   * Restores the one phrase that `records` hold, in any form, with elements marked with ? where
   * unreadable, all with `platform`: complete shares by its SSKR library, marked ones assessed and
   * searched with it (JointRepair). A repair that needs a long search, or that more than one
   * phrase passes, is refused; a host that shows the assessment and asks first uses JointRepair
   * and ShareSet.of for each phrase found. A refusal names each share by its place in `places`,
   * as restore does. Refuses complete shares as restore does, and marked ones as assertShareCount
   * and JointRepair.plan do; then too few shares (sskr.share-set.more-shares-needed), shares that
   * do not fit, by JointRepair's NoFitKind (sskr.share-set.share-unreadable, several-groups,
   * shares-do-not-fit), too much left open (sskr.share-set.too-many-combinations-open), no phrase
   * that fits (sskr.share-set.no-phrase-fits) and more than one
   * (sskr.share-set.more-than-one-phrase-fits-shares-read-more).
   */
  static async combine(
    records: readonly string[],
    platform: ShareRepairPlatform,
    places?: readonly number[],
  ): Promise<ShareSet> {
    if (!records.some(isMarked)) return ShareSet.restore(records, platform, places);
    assertShareCount(records.length);
    const plan = await new JointRepair(platform).plan(records, { places });
    const refusal = combineRefusal(plan.assessment);
    if (refusal !== undefined) {
      // A plan that is not searched is wiped here; searchOnce wipes the one that is.
      plan.wipe();
      throw refusal;
    }
    // Searched without a signal: nothing stops it.
    const { sets: found } = await searchOnce(plan);
    if (found.length === 0) throw ERRORS.create("no-phrase-fits", []);
    if (found.length > 1) throw ERRORS.create("more-than-one-phrase-fits-shares-read-more", []);
    return new ShareSet(defined(found[0]));
  }

  /**
   * A restored set as a share set: one that a search of marked shares found (JointPlan.search), or
   * one that combineSskrShareSet or toRepairedSet gave. Every share is read again. Refuses a set
   * without shares (sskr.share-set.share-set-at-least-one-share), a share whose UR does not read
   * (Share.read's refusals, sskr.transport), a share of no RepairedSet shape
   * (sskr.share-values.shape, a TypeError), a phrase that is no text (core.secret-value.text, a
   * TypeError), and an unsettled or unchecked position that is not a whole number from 1
   * (sskr.share-set.repair-position, a TypeError).
   */
  static of(set: RepairedSet): ShareSet {
    return new ShareSet(set);
  }

  /**
   * Words of the phrase whose secret has `secretBytes` bytes, as the shares and an assessment tell.
   * Refuses a length that no BIP39 phrase has (sskr.share-set.share-s-secret-no-bip39-length).
   */
  static wordCountOf(secretBytes: number): number {
    const words = wordCountOfEntropy(secretBytes);
    if (words === undefined) throw ERRORS.create("share-s-secret-no-bip39-length", []);
    return words;
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
    const dates = counted(dateCombinations, "date combination");
    return sets === 1
      ? `None of the ${dates} gives the wallet given.`
      : `None of the ${dates} gives the wallet given, with any of the ${sets} phrases that fit these shares.`;
  }

  /** The phrase that the shares hold: for a Seedshift backup, the masked phrase. */
  get mnemonic(): string {
    return this.#mnemonic.value;
  }

  /** Every share, in the order given, as read or repaired. */
  get shares(): readonly ReadRepairableShare[] {
    return this.#shares.shares;
  }

  /** Elements that the phrase does not depend on and nothing settles: their values are a guess. */
  get unsettled(): readonly MarkedElement[] {
    return this.#unsettled;
  }

  /** Shares, counted from 1, of a group with fewer than its threshold: they took no part. */
  get unchecked(): readonly number[] {
    return this.#unchecked ?? [];
  }

  /**
   * The warning for the shares that took no part, each named by its place in `places`, by its
   * index in the set, and for a phrase that no digest checked (digestChecked); undefined when every
   * share took part and a digest checked the phrase.
   */
  uncheckedNote(places?: readonly number[]): string | undefined {
    const named = this.unchecked.map((share) => placeOf(places, share));
    const notes = [
      ...(named.length === 0
        ? []
        : [`Share ${named.join(", ")}: too few shares of its group to take part; not checked.`]),
      ...(this.digestChecked ? [] : [NO_DIGEST_NOTE]),
    ];
    return notes.length === 0 ? undefined : notes.join(" ");
  }

  /**
   * Whether an SSKR digest checked the secret, as the restore found (RepairedSet.digestUnchecked):
   * none does where the groups that restored it each take one share, under a group threshold of
   * 1, so that a changed share restores another phrase that nothing tells (AUD-037-API004).
   * MnemoCode never writes such shares.
   */
  get digestChecked(): boolean {
    return !this.#digestUnchecked;
  }

  /**
   * Whether every share took part in the restore, every element of it is settled, and a digest
   * checked the phrase.
   */
  get checked(): boolean {
    return this.unchecked.length === 0 && this.unsettled.length === 0 && this.digestChecked;
  }

  /** Groups of the set that restore the phrase. */
  get groupThreshold(): number {
    return defined(this.#infos[0]).groupThreshold;
  }

  /** Groups of the set, given or not. */
  get groupCount(): number {
    return defined(this.#infos[0]).groupCount;
  }

  /** The groups of the shares given, in the order they first come. */
  get groups(): readonly ShareGroup[] {
    const topology = new SetTopology(this.#infos);
    return topology.groups.map((members) => ({
      index: defined(this.#infos[defined(members[0])]).groupIndex,
      threshold: topology.thresholdOf(members),
      members: members.map((member) => member + 1),
    }));
  }

  /** Bytes of the secret that the shares hold. */
  get secretBytes(): number {
    return defined(this.#infos[0]).secretLength;
  }

  /** Words of the phrase that the shares hold. */
  get wordCount(): number {
    return ShareSet.wordCountOf(this.secretBytes);
  }

  /**
   * The backup that was split, in the form its shares were written in (that of its first share,
   * RESTORED_FORM), which the dates turn into the seed phrase `mnemonic`; undefined when the
   * shares already hold that original phrase, in every share form.
   */
  backup(mnemonic: string): SetBackup | undefined {
    const held = this.mnemonic;
    if (held === englishTokens(mnemonic).join(" ")) return undefined;
    const form = RESTORED_FORM[defined(this.shares[0]).format];
    return { form, text: formatEncoded(representMnemonic(held), form) };
  }

  /**
   * The wallet fingerprint of the phrase that the shares hold, by `fingerprintOf` (the host's BIP32
   * master fingerprint, with its seed function and an empty BIP39 passphrase), or undefined when
   * that phrase is no valid BIP39 phrase. For a Seedshift backup it is the encoded fingerprint, to
   * be compared with the one noted at encoding before any date is typed.
   */
  fingerprint<T>(fingerprintOf: (mnemonic: string) => T): T | undefined {
    return fingerprintOfValidPhrase(this.mnemonic, fingerprintOf);
  }

  /**
   * The set as plain data, as combineSskrShareSet and the searches give it; it cannot be changed.
   */
  toRepairedSet(): RepairedSet {
    return Object.freeze({
      mnemonic: this.mnemonic,
      shares: this.shares,
      unsettled: this.#unsettled,
      ...(this.#unchecked === undefined ? {} : { unchecked: this.#unchecked }),
      ...digestField(this.digestChecked),
    });
  }

  /** Ends the retained phrase/share lifetime; earlier caller-owned views remain independent. */
  wipe(): void {
    this.#mnemonic.wipe();
    this.#shares.wipe();
  }

  /** Ends this set after all asynchronous uses and any explicit child snapshots are complete. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** A share as it is shown or written again: its UR, its form, and its place among those typed. */
export interface WrittenShare {
  /** The share as a UR, ur:sskr/ and its bytewords; it holds a part of the secret. */
  readonly ur: string;
  /** The form that the share is written in. */
  readonly format: ShareFormat;
  /** The share's place among those typed, or in a split's order, counted from 1. */
  readonly number: number;
}

/** The shares of `shown`, each once: the first of its copies (copiesAmong). */
function distinct(shown: readonly WrittenShare[]): WrittenShare[] {
  const placed = shown.map((share, place) => ({ place, share, ur: share.ur }));
  return withoutCopies(placed).map((placedShare) => placedShare.share);
}

/** A set that no caller can change: every array and object of it copied and frozen. */
function frozenSet(set: RepairedSet): RepairedSet {
  return Object.freeze({
    mnemonic: set.mnemonic,
    shares: Object.freeze(
      set.shares.map((share) =>
        Object.freeze({
          ur: share.ur,
          format: share.format,
          repaired: share.repaired,
          filled: Object.freeze(
            share.filled.map(({ position, value }) => Object.freeze({ position, value })),
          ),
        }),
      ),
    ),
    unsettled: Object.freeze(
      Array.from(set.unsettled, ({ share, position }) => {
        if (
          !inWholeRange(share, wholeNumbersFrom(1)) ||
          !inWholeRange(position, wholeNumbersFrom(1))
        )
          throw ERRORS.create("repair-position", []);
        return Object.freeze({ share, position });
      }),
    ),
    ...(set.unchecked === undefined
      ? {}
      : {
          unchecked: Object.freeze(
            Array.from(set.unchecked, (share) => {
              if (!inWholeRange(share, wholeNumbersFrom(1)))
                throw ERRORS.create("repair-position", []);
              return share;
            }),
          ),
        }),
    ...(set.digestUnchecked === true ? { digestUnchecked: true as const } : {}),
  });
}

/**
 * The refusal of a plan of marked shares that combine does not search, one code for each condition
 * (AUD-037-API009): too few shares; shares that do not fit, by the code of JointRepair's condition
 * (NoFitKind): a share that no reading fits, shares of a set of several groups, or shares that are
 * not of one set; or too much left open, whether more combinations than a combine tries
 * (MAX_LIBRARY_TRIES) or more than JointRepair searches at all. Undefined for a plan that combine
 * searches.
 */
function combineRefusal(assessment: JointAssessment): Error | undefined {
  const { verdict, reason, noFit, combinations } = assessment;
  // First: past a combine's own limit, a reason of JointRepair would name its larger limit.
  if (combinations > MAX_LIBRARY_TRIES) return ERRORS.create("too-many-combinations-open", []);
  if (reason === undefined) return undefined;
  if (verdict === "not-enough") return ERRORS.create("more-shares-needed", [reason]);
  // JointRepair gives every "no-fit" its condition: no English reason is read for it.
  if (verdict === "no-fit") return ERRORS.create(defined(noFit), [reason]);
  // "too-uncertain" before any combination is counted: too many forms, ways or member numbers. No
  // assessment of combine is "stopped": it gives JointRepair no signal.
  return ERRORS.create("too-many-combinations-open", [reason]);
}

/**
 * Whether an SSKR digest can check what the shares of `infos` restore: by their group threshold
 * and the member thresholds of the groups they complete (SetTopology.complete, digestChecks). Each
 * member counts once, by its first share: copies of one share are one member, which the topology
 * of `infos` as given would count twice and call checked (AUD-037-API004).
 */
function digestChecksShares(infos: readonly ShareInfo[]): boolean {
  const members = new Map<string, ShareInfo>();
  for (const info of infos)
    if (!members.has(SetTopology.memberOf(info))) members.set(SetTopology.memberOf(info), info);
  const topology = new SetTopology([...members.values()]);
  return digestChecks(
    defined(infos[0]).groupThreshold,
    topology.complete.map((group) => topology.thresholdOf(group)),
  );
}

/**
 * The shares of a set to write again, as an export writes them: each in its own form or in one
 * form given, by its place among those typed. A share with an element that nothing settles, such
 * as one that could not be read at all, is left out: written down, it would be a guess passed off
 * as the share. Copies of one share are shown as typed and saved once. A class, so that what is
 * shown, what is saved and the forms among them follow the same rules.
 */
export class ShareExport extends Redacted implements Disposable {
  readonly #uris: SecretValue<readonly string[]>;
  readonly #shown: readonly Omit<WrittenShare, "ur">[];
  readonly #leftOut: readonly number[];
  readonly #total: number;

  private constructor(shown: readonly WrittenShare[], leftOut: readonly number[], total: number) {
    super("ShareExport");
    // Copied and frozen: the getters hand them out, and what is shown, saved and named must stay
    // what the export settled.
    this.#shown = Object.freeze(
      shown.map(({ format, number }) => Object.freeze({ format, number })),
    );
    this.#leftOut = Object.freeze([...leftOut]);
    this.#total = total;
    this.#uris = SecretValue.texts(shown.map(({ ur }) => ur));
  }

  /**
   * The shares of `set`, repaired or not, named by `places`, by their index in the set; each in
   * `format`, or without it in the form it was written in. Refuses a `format` that names no form
   * (sskr.transport.share-format-one), and fewer places than shares or a place that is not a whole
   * number from 1 (sskr.share-set.each-share-place-among-typed-whole-number-from).
   */
  static of(set: RepairedShares, places: readonly number[], format?: ShareFormat): ShareExport {
    // Refused here, where it is bound to the shares, not once a share is written (AUD-001-API001).
    if (format !== undefined) assertShareFormat(format);
    // Array.from turns holes into undefined, which is refused: each share is named by its place,
    // and a missing one would be shown as "Share undefined".
    const named = Array.from(places);
    if (
      named.length < set.shares.length ||
      !named.every((place) => Number.isSafeInteger(place) && place >= 1)
    )
      throw ERRORS.create("each-share-place-among-typed-whole-number-from", []);
    const leftOut = [...new Set(set.unsettled.map((element) => placeOf(named, element.share)))];
    const shown = set.shares.flatMap((share, index) =>
      leftOut.includes(defined(named[index]))
        ? []
        : [{ ur: share.ur, format: format ?? share.format, number: defined(named[index]) }],
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
    const uris = this.#uris.value;
    return Object.freeze(
      this.#shown.map((share, index) => Object.freeze({ ...share, ur: defined(uris[index]) })),
    );
  }

  /** The shares to save: each once. */
  get saved(): readonly WrittenShare[] {
    return distinct(this.shown);
  }

  /** The forms of the shares saved, each once, in their order. */
  get forms(): readonly ShareFormat[] {
    return [...new Set(this.saved.map((share) => share.format))];
  }

  /** The shares shown, by place, as a check that they belong to one set takes them. */
  get members(): readonly PlacedShare[] {
    return this.shown.map((share) => ({ place: share.number, ur: share.ur }));
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
    assertShareFormat(format);
    return new ShareExport(
      this.shown.map((share) => ({ ...share, format })),
      this.#leftOut,
      this.#total,
    );
  }

  /** Ends retained export URs, leaving independent inForm copies and borrowed sets untouched. */
  wipe(): void {
    this.#uris.wipe();
  }

  /** Ends this export after its display and asynchronous saves have settled. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
