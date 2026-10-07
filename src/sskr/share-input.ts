// The shares that a person types or pastes to restore or export a seed phrase, each kept with the
// place it was typed at, by which every message names it: one answer split into shares (a share
// that a paste wrapped over lines joined again), a seed phrase typed where a share was asked for
// told apart, each share read, the set they make checked, copies of a share used once, and the
// share without which the others restore named; for an export of fewer shares than the threshold,
// each share repaired alone.
//
// Needs from the host: a SharePlatform (share-platform.ts) to restore complete shares, and the name
// of its own reader of an encoded seed phrase, which a seed phrase typed in place of a share is
// sent to: the command line names its menu entry, a page its tab.
// Does not: ask anything, show anything, or search shares with unreadable elements (joint-repair.ts
// assesses and searches them; this module only names the trouble that an assessment finds).

import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { placesInWords } from "../core/places.js";
import { detectInputFormats, parseInput } from "../core/representations.js";
import {
  MAX_JOINT_MARKED_ELEMENTS,
  type JointAssessment,
  type RepairedSet,
} from "./joint-repair.js";
import {
  markCount,
  markProblem,
  MAX_REPAIR_TEXT_LENGTH,
  readRepairableShare,
  ShareVariantsError,
  type ReadRepairableShare,
} from "./repair.js";
import type { SharePlatform } from "./share-platform.js";
import { copiesAmong, ShareSet } from "./share-set.js";
import {
  assertShareCount,
  readShare,
  Share,
  shareInfo,
  urToTransport,
  type ShareInfo,
} from "./transport.js";

/** Lines that one share may take in a paste, as a narrow column of a PDF wraps it. */
const MAX_WRAPPED_LINES = 8;
/** What separates the shares of one answer: a semicolon, or a line break. */
const SHARE_SEPARATORS = /;|\r?\n/u;

/** A share as typed, and its place among the shares typed, by which every message names it. */
export interface TypedShare {
  readonly place: number;
  readonly text: string;
}

/**
 * A problem of the shares as typed, and how a host mends it: "unreadable", the share is typed
 * again, or left out while others remain; "odd", a share that does not fit with the others is left
 * out or typed again; "few", more shares are needed; "refused", the person chooses which share to
 * change or leave out, also where the message names several shares of which nothing tells the
 * wrong one.
 */
export type ShareTrouble =
  | { readonly kind: "unreadable"; readonly place: number; readonly message: string }
  | { readonly kind: "odd"; readonly place: number; readonly message: string }
  | { readonly kind: "few"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

/** A share typed again as it was typed before: it is left out, and used once. */
export interface ShareCopy {
  readonly place: number;
  /** The place of the share it copies. */
  readonly of: number;
  readonly message: string;
}

/** What complete shares give: the phrase, with the secret's length, or their first problem. */
export type CompleteOutcome =
  | { readonly kind: "complete"; readonly set: RepairedSet; readonly secretBytes: number }
  | { readonly kind: "trouble"; readonly trouble: ShareTrouble };

/**
 * Each share repaired alone (ShareInput.repairEach): every one of them, or the first that cannot
 * be repaired, or the first that fits several ways, whose variants a host shows and never chooses.
 */
export type EachRepair =
  | { readonly kind: "repaired"; readonly shares: readonly ReadRepairableShare[] }
  | {
      readonly kind: "unreadable";
      readonly place: number;
      readonly message: string;
      readonly cause: Error;
    }
  | {
      readonly kind: "variants";
      readonly place: number;
      readonly variants: readonly ReadRepairableShare[];
      readonly message: string;
    };

/** A complete share as read, with its place and its metadata. */
interface ReadShare {
  readonly place: number;
  readonly ur: string;
  readonly info: ShareInfo;
}

/**
 * What `text` is when it is a seed phrase rather than a share, or undefined: English words of a
 * phrase's length, or codes of another form whose BIP39 checksum holds, as those of an encoded
 * phrase do in direct mode and in MnemoCode Seedshift. A share in word numbers may have as many
 * numbers as a phrase has words; the checksum keeps a damaged one from passing for a phrase but
 * rarely (1 in 128 for 21 numbers).
 */
function phraseKind(text: string): "words" | "encoded" | undefined {
  for (const format of detectInputFormats(text)) {
    if (format === "english") return "words";
    const words = parseInput(text, format).map((index) => wordlist[index]!);
    if (validateMnemonic(words.join(" "), wordlist)) return "encoded";
  }
  return undefined;
}

/**
 * The share that parts of an answer from `start` on make together, and where it ends, or
 * undefined: parts that cannot be read alone, one after another, that read as a share once joined,
 * with spaces between them or, where a line break cut a UR, without. A host that takes a pasted
 * line break as ; gets a share wrapped over lines as such parts. Its own checksum makes parts of
 * different shares, or other text, read as one only by a chance of about one in four billion
 * (transport.ts).
 */
function wrappedShare(
  parts: readonly string[],
  start: number,
): { readonly text: string; readonly end: number } | undefined {
  const lines: string[] = [];
  for (let end = start; end < parts.length && lines.length < MAX_WRAPPED_LINES; end += 1) {
    const part = parts[end]!;
    if (part.includes("?") || Share.reads(part)) return undefined;
    lines.push(part);
    if (lines.length < 2) continue;
    for (const separator of [" ", ""]) {
      const text = lines.join(separator);
      if (Share.reads(text)) return { text, end: end + 1 };
    }
  }
  return undefined;
}

/** The parts of an answer with each share that a paste wrapped over lines joined again. */
function joinWrapped(parts: readonly string[]): string[] {
  const shares: string[] = [];
  for (let start = 0; start < parts.length;) {
    const wrapped = wrappedShare(parts, start);
    shares.push(wrapped?.text ?? parts[start]!);
    start = wrapped?.end ?? start + 1;
  }
  return shares;
}

/** Shares of one set agree on all of these. */
const setOf = (info: ShareInfo): string =>
  [info.identifier, info.groupThreshold, info.groupCount, info.secretLength].join(":");

/** One member of a set, which no two different shares may be. */
const memberOf = (info: ShareInfo): string => `${info.groupIndex}:${info.memberIndex}`;

/**
 * Shares of which nothing tells the wrong one, named together: the person chooses which to change
 * or leave out. Naming only the later one would let only it be changed, also when the earlier one
 * is wrong, and the same message would come back for every share typed after.
 */
function undecided(places: readonly number[], what: string): ShareTrouble {
  return {
    kind: "refused",
    message: `Shares ${placesInWords(places)} ${what}, and nothing tells which is right.`,
  };
}

/**
 * The first problem of shares that do not all belong together, or undefined. A share of another
 * set than most of them is named alone ("odd"). Where nothing tells which share is wrong, the
 * shares are named together (undecided): sets with as many shares each, of which the first share of
 * each is named; two shares that are the same member of the set but differ; two that give their
 * group different thresholds. Copies are left out before.
 */
function setTrouble(shares: readonly ReadShare[]): ShareTrouble | undefined {
  // The places of the shares of each set, in the order typed.
  const sets = new Map<string, number[]>();
  for (const share of shares) {
    const set = setOf(share.info);
    sets.set(set, [...(sets.get(set) ?? []), share.place]);
  }
  const largest = Math.max(...[...sets.values()].map((places) => places.length));
  const main = [...sets].filter(([, places]) => places.length === largest);
  if (main.length > 1)
    return undecided(
      main.map(([, places]) => places[0]!),
      "are of different sets",
    );
  const [mainSet, mainPlaces] = main[0]!;
  const members = new Map<string, number>();
  const thresholds = new Map<number, ReadShare>();
  for (const share of shares) {
    if (setOf(share.info) !== mainSet)
      return {
        kind: "odd",
        place: share.place,
        message: `Share ${share.place} is of another set than share ${mainPlaces[0]!}.`,
      };
    const same = members.get(memberOf(share.info));
    if (same !== undefined)
      return undecided([same, share.place], "are the same member of the set but differ");
    members.set(memberOf(share.info), share.place);
    const group = thresholds.get(share.info.groupIndex);
    if (group !== undefined && group.info.memberThreshold !== share.info.memberThreshold)
      return undecided([group.place, share.place], "give their group different thresholds");
    thresholds.set(share.info.groupIndex, share);
  }
  return undefined;
}

/** Why complete shares of one set are too few to restore it, or undefined when they are enough. */
function fewTrouble(shares: readonly ReadShare[]): ShareTrouble | undefined {
  const { groupThreshold, groupCount } = shares[0]!.info;
  const groups = new Map<number, { readonly threshold: number; members: number }>();
  for (const { info } of shares) {
    const group = groups.get(info.groupIndex) ?? { threshold: info.memberThreshold, members: 0 };
    group.members += 1;
    groups.set(info.groupIndex, group);
  }
  const complete = [...groups.values()].filter((group) => group.members >= group.threshold);
  if (complete.length >= groupThreshold) return undefined;
  if (groupCount === 1) {
    const needed = shares[0]!.info.memberThreshold;
    const typed = shares.length === 1 ? "One share is" : `These ${shares.length} shares are`;
    return { kind: "few", message: `${typed} not enough: this set needs ${needed}.` };
  }
  return {
    kind: "few",
    message: `These shares are not enough: this set needs ${groupThreshold} of its ${groupCount} groups, each with as many shares as its threshold.`,
  };
}

/** Whether the places are 1, 2, 3, …: the share set then names each share by its place. */
function namedAsTyped(places: readonly number[]): boolean {
  return places.every((place, index) => place === index + 1);
}

/** The message of a refusal; a throw that is no Error passes through. */
function refusal(error: unknown): string {
  if (!(error instanceof Error)) throw error;
  return error.message;
}

/**
 * The shares typed, each with the place it was typed at, while one of them is typed again, left
 * out or joined by more. A class, so that the places stay consistent with the shares through every
 * change, and so that a page binds one object to its share fields; its checks name every share by
 * its place.
 */
export class ShareInput {
  #shares: TypedShare[] = [];
  #nextPlace = 1;
  readonly #decodeEntry: string;

  /**
   * `decodeEntry` names where the host reads an encoded seed phrase, which a seed phrase typed in
   * place of a share is sent to: "Decode numbers, codes or colors back into a seed phrase" in the
   * command line's menu, "The Decode tab" on a page.
   */
  constructor(options: { readonly decodeEntry: string }) {
    if (typeof options?.decodeEntry !== "string" || options.decodeEntry.trim() === "")
      throw new TypeError("ShareInput needs the name of the host's reader of a seed phrase.");
    this.#decodeEntry = options.decodeEntry;
  }

  /**
   * `message` of a share after "Share N" and `joint`, such as "Share 2 cannot be read: unknown …".
   * Its first letter is made small, unless it begins an abbreviation such as SSKR.
   */
  static aboutShare(place: number, joint: string, message: string): string {
    const text = /^[A-Z]{2}/u.test(message)
      ? message
      : `${message.charAt(0).toLowerCase()}${message.slice(1)}`;
    return `Share ${place}${joint}${text}`;
  }

  /**
   * The first share of `shares` that does not belong with the others, for shares that need no
   * quorum, such as those written again by an export. A copy of a share is no problem.
   */
  static looseSetTrouble(
    shares: readonly { readonly place: number; readonly ur: string }[],
  ): ShareTrouble | undefined {
    const copied = new Set(copiesAmong(shares).map((copy) => copy.place));
    const distinct = shares.filter((share) => !copied.has(share.place));
    return setTrouble(
      distinct.map((share) => ({ ...share, info: shareInfo(urToTransport(share.ur)) })),
    );
  }

  /**
   * The shares of `shares` that copy an earlier one exactly (the same UR), each with the place of
   * the first and a note: a copy adds nothing to a restore, so it is left out and used once. The
   * restore here and the backup check (core/backup-check.ts) both apply this rule.
   */
  static copiesOf(shares: readonly { readonly place: number; readonly ur: string }[]): ShareCopy[] {
    return copiesAmong(shares).map((copy) => ({
      ...copy,
      message: `Share ${copy.place} is a copy of share ${copy.of}: it is used once.`,
    }));
  }

  /** The shares typed, each with its place; a copy, so that only this object's changes count. */
  get list(): readonly TypedShare[] {
    return Object.freeze([...this.#shares]);
  }

  /** The texts, in the order typed, as the share functions take them. */
  texts(): string[] {
    return this.#shares.map((share) => share.text);
  }

  /** The place of each share, by its index in texts(). */
  places(): number[] {
    return this.#shares.map((share) => share.place);
  }

  /** Whether an element of a share is marked with ? as unreadable. */
  get marked(): boolean {
    return this.#shares.some((share) => share.text.includes("?"));
  }

  /** Whether a share was typed at `place`, and is not left out. */
  has(place: number): boolean {
    return this.#shares.some((share) => share.place === place);
  }

  /**
   * The shares of one answer, split at ; and at line breaks, as a page's field holds one share per
   * line, with each share that a paste wrapped over lines joined again (wrappedShare), checked to
   * fit in a set: alone, or `adding` them to those typed. An empty part, from a ; at the end or two
   * in a row, is no share and is passed over. A seed phrase typed or pasted here, also one word per
   * line, is refused as one.
   */
  sharesOfAnswer(answer: string, adding = false): string[] {
    const parts = answer
      .split(SHARE_SEPARATORS)
      .map((text) => text.trim())
      .filter(Boolean);
    if (parts.length === 0) throw new Error("Type at least one share.");
    // Bounds the work below: wrapped or not, the parts make no more shares than a set may have.
    assertShareCount(Math.ceil(parts.length / MAX_WRAPPED_LINES));
    const shares = joinWrapped(parts);
    // Looked for only when nothing reads as a share: a share in word numbers, wrapped or not, may
    // have as many numbers as a phrase has words.
    if (!shares.some((share) => share.includes("?") || Share.reads(share))) {
      const kind = phraseKind(parts.join(" "));
      if (kind !== undefined) throw new Error(this.#notShareMessage(kind, "This is"));
    }
    assertShareCount((adding ? this.#shares.length : 0) + shares.length);
    return shares;
  }

  /** Adds shares after those typed, each at the next place. */
  add(texts: readonly string[]): void {
    assertShareCount(this.#shares.length + texts.length);
    for (const text of texts)
      this.#shares = [...this.#shares, Object.freeze({ place: this.#nextPlace++, text })];
  }

  /** Takes `texts` in place of every share typed before, at places from 1. */
  replaceAll(texts: readonly string[]): void {
    assertShareCount(texts.length);
    this.#shares = [];
    this.#nextPlace = 1;
    this.add(texts);
  }

  /** Takes `text` for the share at `place`, which keeps its place. */
  replace(place: number, text: string): void {
    if (!this.has(place)) throw new Error(`No share was typed at place ${place}.`);
    this.#shares = this.#shares.map((share) =>
      share.place === place ? Object.freeze({ place, text }) : share,
    );
  }

  /** Leaves out the share at `place`; the others keep their places. */
  leaveOut(place: number): void {
    this.#shares = this.#shares.filter((share) => share.place !== place);
  }

  /**
   * Why a share cannot be used even before the others are looked at, or undefined: a share without
   * ? must read as a share in one of its forms; one with ? may hold only as many marks as a joint
   * repair takes (planJointRepair), which tells later whether the rest of it fits.
   */
  readProblem(place: number, text: string): string | undefined {
    if (text.includes("?")) {
      if (text.length > MAX_REPAIR_TEXT_LENGTH || markCount(text) > MAX_JOINT_MARKED_ELEMENTS)
        return `Share ${place}: mark at most ${MAX_JOINT_MARKED_ELEMENTS} unreadable elements with ?.`;
      const problem = markProblem(text);
      return problem === undefined ? undefined : `Share ${place}: ${problem}`;
    }
    try {
      readShare(text);
      return undefined;
    } catch (error) {
      const message = refusal(error);
      const kind = phraseKind(text);
      return kind === undefined
        ? ShareInput.aboutShare(place, " cannot be read: ", message)
        : this.#notShareMessage(kind, `Share ${place} is`);
    }
  }

  /** The first share typed that cannot be read (readProblem), or undefined. */
  firstUnreadable(): ShareTrouble | undefined {
    for (const { place, text } of this.#shares) {
      const message = this.readProblem(place, text);
      if (message !== undefined) return { kind: "unreadable", place, message };
    }
    return undefined;
  }

  /**
   * The first problem of complete shares written again by an export, which needs no quorum: each
   * must be read, and all must be of one set; copies of a share are kept, to be shown as typed and
   * saved once.
   */
  looseTrouble(): ShareTrouble | undefined {
    const read = this.#readAll();
    return Array.isArray(read) ? ShareInput.looseSetTrouble(read) : read;
  }

  /**
   * Restores complete shares: each is read, copies are left out (and returned, with a note), the
   * set is checked (setTrouble, fewTrouble), and its phrase restored, every share checked against
   * it (ShareSet.restore). When they do not agree, the share without which the others restore a
   * phrase is named: each is left out once.
   */
  async restoreComplete(
    platform: SharePlatform,
  ): Promise<{ readonly outcome: CompleteOutcome; readonly copies: readonly ShareCopy[] }> {
    const read = this.#readAll();
    if (!Array.isArray(read)) return { outcome: { kind: "trouble", trouble: read }, copies: [] };
    const copies = this.#dropCopies(read);
    const distinct = read.filter((share) => this.has(share.place));
    const trouble = setTrouble(distinct) ?? fewTrouble(distinct);
    if (trouble !== undefined) return { outcome: { kind: "trouble", trouble }, copies };
    return { outcome: await this.#restoreChecked(distinct, platform), copies };
  }

  /**
   * Each share repaired from its own checks alone (readRepairableShare), as an export does with
   * fewer shares than the threshold, which restore no phrase: the shares, or the first problem.
   */
  repairEach(): EachRepair {
    const shares: ReadRepairableShare[] = [];
    for (const { place, text } of this.#shares) {
      try {
        shares.push(readRepairableShare(text));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        if (!(error instanceof ShareVariantsError))
          return {
            kind: "unreadable",
            place,
            message: ShareInput.aboutShare(place, ": ", error.message),
            cause: error,
          };
        return {
          kind: "variants",
          place,
          variants: error.variants,
          message: `Share ${place} fits ${error.variants.length} ways, so nothing is saved: use another copy of it, or more shares.`,
        };
      }
    }
    return { kind: "repaired", shares };
  }

  /** The problem that an assessment of marked shares names, or undefined when they can be searched. */
  assessmentTrouble(assessment: JointAssessment): ShareTrouble | undefined {
    if (assessment.reason === undefined) return undefined;
    // A share that no reading fits is named, by its place, rather than by the reason's index.
    const unfit = assessment.shares.findIndex((share) => share.forms.length === 0);
    if (unfit >= 0) {
      const place = this.#shares[unfit]!.place;
      const check =
        assessment.shares[unfit]!.marks === 0
          ? "each of its elements"
          : "the elements marked with ?, and the others";
      return {
        kind: "unreadable",
        place,
        message: `Share ${place} cannot be read as a share: check ${check}.`,
      };
    }
    return {
      kind: assessment.verdict === "not-enough" ? "few" : "refused",
      message: assessment.reason,
    };
  }

  /**
   * The one line for a seed phrase typed where a share was asked for: what it is and which entry
   * reads it, without repeating it. `subject` is "This is" or "Share N is".
   */
  #notShareMessage(kind: "words" | "encoded", subject: string): string {
    return kind === "words"
      ? `${subject} a seed phrase in words, not a Shamir share: ${this.#decodeEntry} reads a masked one.`
      : `${subject} an encoded seed phrase, not a Shamir share: ${this.#decodeEntry} reads it.`;
  }

  /** Reads every complete share; the first that cannot be read is the trouble. */
  #readAll(): ReadShare[] | ShareTrouble {
    const read: ReadShare[] = [];
    for (const { place, text } of this.#shares) {
      const message = this.readProblem(place, text);
      if (message !== undefined) return { kind: "unreadable", place, message };
      const { ur } = readShare(text);
      read.push({ place, ur, info: shareInfo(urToTransport(ur)) });
    }
    return read;
  }

  /** Leaves out each share typed again as an earlier one (copiesOf). */
  #dropCopies(read: readonly ReadShare[]): ShareCopy[] {
    const copies = ShareInput.copiesOf(read);
    for (const copy of copies) this.leaveOut(copy.place);
    return copies;
  }

  /** The phrase of `read`, checked as a set before; or the share named as the one that is wrong. */
  async #restoreChecked(
    read: readonly ReadShare[],
    platform: SharePlatform,
  ): Promise<CompleteOutcome> {
    const texts = this.texts();
    try {
      const set = (await ShareSet.restore(texts, platform)).toRepairedSet();
      return { kind: "complete", set, secretBytes: read[0]!.info.secretLength };
    } catch (error) {
      const message = refusal(error);
      const fits: number[] = [];
      for (const [index, share] of read.entries()) {
        try {
          await ShareSet.restore(
            texts.filter((_, other) => other !== index),
            platform,
          );
          fits.push(share.place);
        } catch (other) {
          refusal(other);
        }
      }
      if (fits.length === 1)
        return {
          kind: "trouble",
          trouble: {
            kind: "odd",
            place: fits[0]!,
            message: `Share ${fits[0]} does not fit with the others: with it they give another phrase or none.`,
          },
        };
      // The share set names shares by their index, which is their place only while none was left
      // out.
      return {
        kind: "trouble",
        trouble: {
          kind: "refused",
          message: namedAsTyped(this.places())
            ? message
            : "These shares do not restore one phrase: one of them is wrong, or of another set.",
        },
      };
    }
  }
}
