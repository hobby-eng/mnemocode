// Repairs the shares of one SSKR set together, each with elements marked with ? where they are
// unreadable. Every share alone gives an affine space of solutions over the bits of its marks
// (repair.ts, readingSpace). Across shares more is known, and all of it is linear over GF(2): the
// shares carry the same identifier and thresholds, each its member number, and every share beyond
// the first `threshold` lies on their polynomial (gf256.ts; multiplying by a known constant is
// GF(2)-linear). Solving all of it together settles what no share settles alone. What is still
// open is decided by the 32-bit digest that bc-shamir keeps beside the secret: each candidate is
// checked with HMAC-SHA256 here, and each one that passes is restored by the SSKR library itself.
// Every phrase that passes is reported; none is chosen.
//
// Only sets of one group are repaired, which is all that MnemoCode writes. JointRepair, at the
// end, is the entry: built with the host's SharePlatform (share-platform.ts), whose HMAC-SHA256
// checks each candidate and whose SSKR library restores it, it assesses the shares and searches
// them. Long work gives the host a turn now and then, so that it can show progress or stop it.
// The functions before it stay for the hosts that already call them; without a platform of their
// own they use the one configured with configureSharePlatform, as the Node.js entry configures it.
//
// Needs from the host: its SharePlatform, and an AbortSignal and a progress callback for a search.
// Does not: ask whether to search, say what a repair filled in (repair-report.ts), or name shares
// by where they were typed (share-input.ts).

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { TURN_MILLISECONDS } from "../core/search-turns.js";
import { bytesToBits, solve, topBit } from "./gf2.js";
import { DIGEST_X, gfMultiply, lagrangeCoefficients, SECRET_X } from "./gf256.js";
import {
  candidateCounts,
  choicesAt,
  reachesMetadata,
  markCount,
  markedReadings,
  markProblem,
  MAX_REPAIR_TEXT_LENGTH,
  placesWithin,
  METADATA_BYTES,
  readingSpace,
  type FilledElement,
  type ReadingSpace,
  type ReadRepairableShare,
} from "./repair.js";
import { sharePlatform, type SharePlatform } from "./share-platform.js";
import { readShare, validateShareSet, type ShareFormat } from "./transport.js";

/** Marked elements on one share. The other shares settle most of them; see the assessment. */
export const MAX_JOINT_MARKED_ELEMENTS = 64;
/** The most ? on one share: a ? for each of the six digits of every color it may mark. */
const MAX_JOINT_MARK_SYMBOLS = MAX_JOINT_MARKED_ELEMENTS * 6;
/**
 * Combinations that a search may try, 2^40 in all: they take weeks, and leave about 2^8 phrases
 * that pass by chance.
 */
export const MAX_SEARCH_BITS = 40;
/** The digest bits that bc-shamir compares (bc-shamir 0.13.0, shamir.rs, recover_secret). */
export const DIGEST_BITS = 32;
const DIGEST_BYTES = DIGEST_BITS / 8;
/** Ways to read the shares (forms and member numbers) that are solved before refusing. */
const MAX_BRANCHES = 4096;
/** Unsettled bits of the thresholds and member numbers; 2^12 = MAX_BRANCHES. */
const MAX_LABEL_BITS = 12;
/** Values of undetermined elements tried until the shares read; they do not change the phrase. */
const MAX_HIDDEN_TRIES_BITS = 8;
/**
 * Digest checks between two turns of the event loop, so that progress shows and a stop is heard.
 * A turn costs about a millisecond (the least delay of setTimeout), so they are some 50 ms apart.
 */
const TRIES_PER_TURN = 16_384;
const BYTE_BITS = 8;
const NIBBLE_BITS = 4;
const NIBBLE = 0x0f;
/** SSKR metadata (sskr encoding.rs): identifier, group thresholds, group and member threshold. */
const GROUP_BYTE = 2;
const MEMBER_THRESHOLD_BYTE = 3;
const MEMBER_BYTE = 4;
/** Secret lengths of BIP39 entropy, 12 to 24 words. */
const BIP39_ENTROPY_BYTES = new Set([16, 20, 24, 28, 32]);

/** Lets the host run: progress, a stop, Ctrl+C. setTimeout exists in every host. */
function nextTurn(signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A marked element: its share and place, both counted from 1. */
export interface MarkedElement {
  readonly share: number;
  readonly position: number;
}

/** What one share is on its own. */
export interface ShareAssessment {
  readonly marks: number;
  readonly forms: readonly ShareFormat[];
  /** Bits still open when the share is solved alone, the fewest over its readings. */
  readonly openAlone: number;
}

/** What reading one more element would leave open. */
export interface ElementHelp extends MarkedElement {
  readonly openBits: number;
}

/** What the shares are together, before any search. */
export interface JointAssessment {
  readonly shares: readonly ShareAssessment[];
  readonly secretBytes?: number;
  readonly threshold?: number;
  /** Ways to read the shares that fit every equation. */
  readonly branches: number;
  /** Bits that only the digest can decide, the most over the branches. */
  readonly openBits: number;
  /** Digest checks of the search. */
  readonly combinations: number;
  /** Phrases expected to pass the digest by chance: every wrong try passes with 2^-32. */
  readonly expectedFalse: number;
  /** More shares without marks that would settle every open bit. */
  readonly moreShares: number;
  /** Elements whose reading would leave fewer bits open, best first. */
  readonly helps: readonly ElementHelp[];
  /**
   * "determined": no bit is open, and the search checks one candidate per way to read the shares;
   * "search": the digest decides among `combinations`; the others refuse, with `reason`.
   */
  readonly verdict: "determined" | "search" | "too-uncertain" | "no-fit" | "not-enough";
  readonly reason?: string;
}

/** A phrase that the shares restore, with every share as repaired. */
export interface RepairedSet {
  readonly mnemonic: string;
  readonly shares: readonly ReadRepairableShare[];
  /** Elements that the phrase does not depend on and nothing settles: their values are a guess. */
  readonly unsettled: readonly MarkedElement[];
  /**
   * Shares, counted from 1, that took no part and were not checked: members of a group with fewer
   * than its threshold, in a set of several groups.
   */
  readonly unchecked?: readonly number[];
}

export interface SearchOptions {
  /** Called now and then with the checks made, of all, and the phrases found so far. */
  readonly onProgress?: (done: number, total: number, found: number) => void;
  /** Stops the search between two turns; it then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
}

export interface JointPlan {
  readonly assessment: JointAssessment;
  /** Tries every open combination; resolves with every phrase that passes, possibly none. */
  readonly search: (options?: SearchOptions) => Promise<RepairedSet[]>;
}

/** One reading per share, and joint coordinates: bit offsets[s] + j is basis vector j of share s. */
interface Joint {
  readonly spaces: readonly ReadingSpace[];
  readonly offsets: readonly number[];
  readonly dimensions: number;
  readonly secretBytes: number;
}

/** A solved way to read the shares. */
interface Branch {
  readonly joint: Joint;
  readonly threshold: number;
  readonly members: readonly number[];
  /** The first `threshold` shares with distinct members, which the polynomial is taken from. */
  readonly base: readonly number[];
  readonly particular: bigint;
  /** Directions that change the secret or the digest, each with the change it makes to them. */
  readonly visible: readonly bigint[];
  readonly visibleDeltas: readonly Uint8Array[];
  /** Directions that change neither. */
  readonly hidden: readonly bigint[];
  readonly secretAndDigest: Uint8Array;
}

/** Bit fields packed into one vector, the first at bit 0. */
class Fields {
  vector = 0n;
  width = 0;

  add(value: number, bits: number): void {
    this.vector |= BigInt(value & ((1 << bits) - 1)) << BigInt(this.width);
    this.width += bits;
  }
}

/** The XOR of `vectors[i]` for every bit i set in `choice`. */
function combine(vectors: readonly bigint[], choice: bigint): bigint {
  let sum = 0n;
  vectors.forEach((vector, index) => {
    if ((choice >> BigInt(index)) & 1n) sum ^= vector;
  });
  return sum;
}

/** The change that joint direction `z` makes to the marked bits of share `share`. */
function holeChange(joint: Joint, share: number, z: bigint): bigint {
  return combine(joint.spaces[share]!.basis, z >> BigInt(joint.offsets[share]!));
}

function payloadsAt(joint: Joint, z: bigint): Uint8Array[] {
  return joint.spaces.map((space, share) => {
    const payload = Uint8Array.from(space.payload);
    const own = z >> BigInt(joint.offsets[share]!);
    space.payloadDeltas.forEach((delta, j) => {
      if ((own >> BigInt(j)) & 1n)
        for (let index = 0; index < payload.length; index += 1) payload[index]! ^= delta[index]!;
    });
    return payload;
  });
}

/** An affine map at `origin`, and its change along each of `directions`. */
function linearize(
  map: (z: bigint) => bigint,
  origin: bigint,
  directions: readonly bigint[],
): { readonly value: bigint; readonly columns: bigint[] } {
  const value = map(origin);
  return { value, columns: directions.map((direction) => map(origin ^ direction) ^ value) };
}

/** Rows that hold for every reading of a set of one group: one group, and the same metadata. */
function sharedResidual(payloads: readonly Uint8Array[]): bigint {
  const fields = new Fields();
  const first = payloads[0]!;
  // One group of one: group threshold and count 1, group index 0.
  fields.add(first[GROUP_BYTE]!, BYTE_BITS);
  fields.add(first[MEMBER_THRESHOLD_BYTE]! >>> NIBBLE_BITS, NIBBLE_BITS);
  for (const payload of payloads.slice(1))
    for (let byte = 0; byte < MEMBER_BYTE; byte += 1)
      fields.add(payload[byte]! ^ first[byte]!, BYTE_BITS);
  return fields.vector;
}

/** The member threshold, less one, then the member number of every share, 4 bits each. */
function labelsOf(payloads: readonly Uint8Array[]): bigint {
  const fields = new Fields();
  fields.add(payloads[0]![MEMBER_THRESHOLD_BYTE]! & NIBBLE, NIBBLE_BITS);
  for (const payload of payloads) fields.add(payload[MEMBER_BYTE]! & NIBBLE, NIBBLE_BITS);
  return fields.vector;
}

/** Every share beyond the base is a copy of a base share or lies on the base's polynomial. */
function polynomialResidual(
  payloads: readonly Uint8Array[],
  members: readonly number[],
  base: readonly number[],
  secretBytes: number,
): bigint {
  const fields = new Fields();
  const xs = base.map((share) => members[share]!);
  payloads.forEach((payload, share) => {
    if (base.includes(share)) return;
    const copyOf = base.find((other) => members[other] === members[share]);
    const lambdas = copyOf === undefined ? lagrangeCoefficients(xs, members[share]!) : [];
    for (let k = METADATA_BYTES; k < METADATA_BYTES + secretBytes; k += 1) {
      let value = payload[k]!;
      if (copyOf !== undefined) value ^= payloads[copyOf]![k]!;
      else
        base.forEach((other, i) => {
          value ^= gfMultiply(lambdas[i]!, payloads[other]![k]!);
        });
      fields.add(value, BYTE_BITS);
    }
  });
  return fields.vector;
}

/** The secret S and the digest share D of the base's polynomial, S then D. */
function secretAndDigest(
  payloads: readonly Uint8Array[],
  members: readonly number[],
  base: readonly number[],
  secretBytes: number,
): Uint8Array {
  const xs = base.map((share) => members[share]!);
  const toSecret = lagrangeCoefficients(xs, SECRET_X);
  const toDigest = lagrangeCoefficients(xs, DIGEST_X);
  const out = new Uint8Array(2 * secretBytes);
  for (let k = 0; k < secretBytes; k += 1)
    base.forEach((share, i) => {
      const y = payloads[share]![METADATA_BYTES + k]!;
      out[k]! ^= gfMultiply(toSecret[i]!, y);
      out[secretBytes + k]! ^= gfMultiply(toDigest[i]!, y);
    });
  return out;
}

type Hmac = (key: Uint8Array, message: Uint8Array) => Uint8Array;

/** bc-shamir's check: HMAC-SHA256(key: D[4..], message: S) begins with D[0..4]. */
function digestFits(secretAndDigestBytes: Uint8Array, secretBytes: number, hmac: Hmac): boolean {
  const secret = secretAndDigestBytes.subarray(0, secretBytes);
  const digest = secretAndDigestBytes.subarray(secretBytes);
  const mac = hmac(digest.subarray(DIGEST_BYTES), secret);
  for (let index = 0; index < DIGEST_BYTES; index += 1)
    if (mac[index] !== digest[index]) return false;
  return true;
}

/**
 * Digest checks per second in this host, from a short run on zero bytes, with `platform`'s
 * HMAC-SHA256; without it, with the configured platform (JointRepair.triesPerSecond).
 */
export function measureTriesPerSecond(platform: SharePlatform = sharePlatform()): number {
  const { hmacSha256 } = platform;
  const secretBytes = 32;
  const sample = new Uint8Array(2 * secretBytes);
  const tries = 10_000;
  const start = performance.now();
  for (let index = 0; index < tries; index += 1) digestFits(sample, secretBytes, hmacSha256);
  const seconds = (performance.now() - start) / 1000;
  return tries / Math.max(seconds, 1e-6);
}

/** Splits directions by whether they change (S, D); a hidden one is reduced so it changes none. */
function splitByDigest(
  directions: readonly bigint[],
  sdAt: (z: bigint) => Uint8Array,
  origin: bigint,
): { visible: bigint[]; visibleDeltas: Uint8Array[]; hidden: bigint[] } {
  const sd0 = sdAt(origin);
  const deltaOf = (direction: bigint) =>
    sdAt(origin ^ direction).map((byte, index) => byte ^ sd0[index]!);
  const pivots = new Map<number, { image: bigint; direction: bigint }>();
  const visible: bigint[] = [];
  const visibleDeltas: Uint8Array[] = [];
  const hidden: bigint[] = [];
  for (const original of directions) {
    let direction = original;
    let image = bytesToBits(deltaOf(direction));
    while (image !== 0n && pivots.has(topBit(image))) {
      const pivot = pivots.get(topBit(image))!;
      image ^= pivot.image;
      direction ^= pivot.direction;
    }
    if (image === 0n) hidden.push(direction);
    else {
      pivots.set(topBit(image), { image, direction });
      visible.push(direction);
      visibleDeltas.push(deltaOf(direction));
    }
  }
  return { visible, visibleDeltas, hidden };
}

/** A basis of the span of `vectors`. */
function basisOf(vectors: readonly bigint[]): bigint[] {
  const pivots = new Map<number, bigint>();
  for (let vector of vectors) {
    while (vector !== 0n && pivots.has(topBit(vector))) vector ^= pivots.get(topBit(vector))!;
    if (vector !== 0n) pivots.set(topBit(vector), vector);
  }
  return [...pivots.values()];
}

/** The first `threshold` shares with distinct members, or undefined when there are fewer. */
function baseOf(members: readonly number[], threshold: number): number[] | undefined {
  const base: number[] = [];
  for (let share = 0; share < members.length && base.length < threshold; share += 1)
    if (!base.some((other) => members[other] === members[share])) base.push(share);
  return base.length === threshold ? base : undefined;
}

interface JointSolution {
  readonly branches: Branch[];
  /** The rows that every reading shares have no solution: another set, or a misread element. */
  readonly conflict: boolean;
  /** The thresholds and member numbers leave too many possibilities to solve each. */
  readonly tooMany: boolean;
  /** Some possibility had as many distinct members as its threshold. */
  readonly enoughMembers: boolean;
  /** Some possibility gave two shares the same member number. */
  readonly duplicates: boolean;
}

/**
 * The work that solveJoint may still do for the choices of thresholds and member numbers, each
 * choice an elimination of its own: payloads of one share evaluated, about a microsecond each. A
 * bound on the work of trying words (refined) that does not depend on the computer.
 */
interface WorkBudget {
  left: number;
}

/**
 * Solves one reading of every share: first the rows that every reading shares, then, for each
 * threshold and each set of member numbers that those leave possible, the polynomial.
 */
async function solveJoint(
  joint: Joint,
  signal: AbortSignal | undefined,
  budget?: WorkBudget,
): Promise<JointSolution> {
  const solution: JointSolution = {
    branches: [],
    conflict: false,
    tooMany: false,
    enoughMembers: false,
    duplicates: false,
  };
  const units = Array.from({ length: joint.dimensions }, (_, bit) => 1n << BigInt(bit));
  const shared = linearize((z) => sharedResidual(payloadsAt(joint, z)), 0n, units);
  const common = solve(shared.columns, shared.value);
  if (common === undefined) return { ...solution, conflict: true };
  const labels = linearize((z) => labelsOf(payloadsAt(joint, z)), common.particular, common.free);
  const labelBasis = basisOf(labels.columns);
  if (labelBasis.length > MAX_LABEL_BITS) return { ...solution, tooMany: true };
  if (budget !== undefined) {
    // Each choice evaluates the payloads of every share once for each free bit and once more.
    const work = 2 ** labelBasis.length * (common.free.length + 1) * joint.spaces.length;
    if (work > budget.left) return { ...solution, tooMany: true };
    budget.left -= work;
  }
  const shares = joint.spaces.length;
  const labelWidth = BigInt(NIBBLE_BITS * (shares + 1));
  let { enoughMembers, duplicates } = solution;
  let turned = Date.now();
  for (let choice = 0; choice < 2 ** labelBasis.length; choice += 1) {
    // A turn now and then, not for each choice: a turn costs about a millisecond.
    signal?.throwIfAborted();
    if (Date.now() - turned >= TURN_MILLISECONDS) {
      await nextTurn(signal);
      turned = Date.now();
    }
    const label = labels.value ^ combine(labelBasis, BigInt(choice));
    const threshold = Number(label & BigInt(NIBBLE)) + 1;
    const members = Array.from({ length: shares }, (_, share) =>
      Number((label >> BigInt(NIBBLE_BITS * (share + 1))) & BigInt(NIBBLE)),
    );
    duplicates ||= new Set(members).size < shares;
    // A threshold of 1 keeps no digest, so nothing would be checked.
    const base = threshold < 2 ? undefined : baseOf(members, threshold);
    if (base === undefined) continue;
    enoughMembers = true;
    const residual = (z: bigint) => {
      const payloads = payloadsAt(joint, z);
      const polynomial = polynomialResidual(payloads, members, base, joint.secretBytes);
      return (labelsOf(payloads) ^ label) | (polynomial << labelWidth);
    };
    const local = linearize(residual, common.particular, common.free);
    const solved = solve(local.columns, local.value);
    if (solved === undefined) continue;
    const particular = common.particular ^ combine(common.free, solved.particular);
    const free = solved.free.map((direction) => combine(common.free, direction));
    const sdAt = (z: bigint) =>
      secretAndDigest(payloadsAt(joint, z), members, base, joint.secretBytes);
    solution.branches.push({
      joint,
      threshold,
      members,
      base,
      particular,
      ...splitByDigest(free, sdAt, particular),
      secretAndDigest: sdAt(particular),
    });
  }
  return { ...solution, enoughMembers, duplicates };
}

/** Whether a share plainly belongs to a set of several groups. */
function severalGroups(spaces: readonly ReadingSpace[]): boolean {
  return spaces.every(
    (space) =>
      space.payload[GROUP_BYTE] !== 0 &&
      space.payloadDeltas.every((delta) => delta[GROUP_BYTE] === 0),
  );
}

/** Every way to pick one item of each list, or undefined past `limit`. */
function picks<T>(lists: readonly (readonly T[])[], limit: number): T[][] | undefined {
  let all: T[][] = [[]];
  for (const list of lists) {
    all = all.flatMap((prefix) => list.map((item) => [...prefix, item]));
    if (all.length > limit) return undefined;
  }
  return all;
}

/** The places of the marked elements of a reading, in the order of their bits. */
function holesOf(space: ReadingSpace): number[] {
  return space.reading.values.flatMap((value, index) => (value === undefined ? [index] : []));
}

/** Open bits of `branch` if marked element `hole` of share `share` were read. */
function openBitsIfRead(branch: Branch, share: number, hole: number): number {
  const width = BigInt(branch.joint.spaces[share]!.reading.unitBits);
  const mask = ((1n << width) - 1n) << (BigInt(hole) * width);
  // Each direction with the change it makes in (S, D): a pair, typed as one so that a host that
  // compiles with noUncheckedIndexedAccess reads both of its parts as present.
  const directions: (readonly [bigint, bigint])[] = [
    ...branch.visible.map((direction, i): readonly [bigint, bigint] => [
      direction,
      bytesToBits(branch.visibleDeltas[i]!),
    ]),
    ...branch.hidden.map((direction): readonly [bigint, bigint] => [direction, 0n]),
  ];
  // The combinations of directions that leave this element as it is, with their images in (S, D).
  const pivots = new Map<number, { part: bigint; image: bigint }>();
  const kept: bigint[] = [];
  for (const [direction, original] of directions) {
    let part = holeChange(branch.joint, share, direction) & mask;
    let image = original;
    while (part !== 0n && pivots.has(topBit(part))) {
      const pivot = pivots.get(topBit(part))!;
      part ^= pivot.part;
      image ^= pivot.image;
    }
    if (part === 0n) kept.push(image);
    else pivots.set(topBit(part), { part, image });
  }
  return basisOf(kept).length;
}

/**
 * Elements whose reading would leave fewer open bits, best first. They are found in the branch
 * with the most open bits, which decides the time of the search: in every branch would cost as
 * many eliminations again for each of up to MAX_BRANCHES branches.
 */
async function helpfulElements(
  branches: readonly Branch[],
  signal: AbortSignal | undefined,
): Promise<ElementHelp[]> {
  const widest = branches.reduce((most, branch) =>
    branch.visible.length > most.visible.length ? branch : most,
  );
  const openBits = widest.visible.length;
  if (openBits === 0) return [];
  const helps: ElementHelp[] = [];
  for (const [share, space] of widest.joint.spaces.entries()) {
    await nextTurn(signal);
    for (const [hole, place] of holesOf(space).entries())
      helps.push({
        share: share + 1,
        position: place + 1,
        openBits: openBitsIfRead(widest, share, hole),
      });
  }
  return helps.filter((help) => help.openBits < openBits).sort((a, b) => a.openBits - b.openBits);
}

function refusal(
  shares: readonly ShareAssessment[],
  verdict: JointAssessment["verdict"],
  reason: string,
): JointPlan {
  return {
    assessment: {
      shares,
      branches: 0,
      openBits: 0,
      combinations: 0,
      expectedFalse: 0,
      moreShares: 0,
      helps: [],
      verdict,
      reason,
    },
    search: async () => [],
  };
}

/**
 * About how many more shares would settle what `branch` leaves open. Each share beyond the
 * threshold adds as many equations as the secret has bits, and `threshold` shares without marks
 * settle everything; the marks of the new shares, or equations that depend on others, can make
 * one more needed.
 */
function sharesToSettle(branch: Branch, shares: readonly ShareAssessment[]): number {
  const openBits = branch.visible.length;
  if (openBits === 0) return 0;
  const clean = new Set(branch.members.filter((_, share) => shares[share]!.marks === 0)).size;
  const byEquations = Math.ceil(openBits / (BYTE_BITS * branch.joint.secretBytes));
  return Math.max(1, Math.min(branch.threshold - clean, byEquations));
}

/** The value of a field when every branch agrees on it. */
function agreed<T>(branches: readonly Branch[], field: (branch: Branch) => T): T | undefined {
  const values = new Set(branches.map(field));
  return values.size === 1 ? [...values][0] : undefined;
}

/**
 * The refusal of a share, counted from 0, that no reading fits. Its marks are named only when it
 * has any: a share without them is typed wrong, or is no share. A code marked with the wrong
 * number of symbols is named (markProblem).
 */
function unreadableShare(share: number, marks: number, text: string): string {
  const problem = markProblem(text);
  if (problem !== undefined) return `Share ${share + 1}: ${problem}`;
  return marks === 0
    ? `Share ${share + 1} cannot be read as a share: check each of its elements.`
    : `Share ${share + 1} cannot be read as a share: check the elements marked with ?, and the others.`;
}

/** What solving every combination of the shares' readings gives (solveReadings). */
interface Solved {
  readonly branches: Branch[];
  /** The rows that every reading shares had no solution in some combination. */
  readonly conflict: boolean;
  /** Some possibility had as many distinct members as its threshold. */
  readonly enoughMembers: boolean;
  /** Some possibility gave two shares the same member number. */
  readonly duplicates: boolean;
  /** Some length of the secret is one that every share can be read in. */
  readonly sameLength: boolean;
  /** Why the shares cannot be assessed at all, when they cannot. */
  readonly refused?: { readonly verdict: JointAssessment["verdict"]; readonly reason: string };
}

/**
 * Solves every combination of one reading of each share (solveJoint), for each length of the
 * secret that every share can be read in, and gathers the branches.
 */
async function solveReadings(
  spacesOf: readonly (readonly ReadingSpace[])[],
  signal: AbortSignal | undefined,
  budget?: WorkBudget,
): Promise<Solved> {
  const branches: Branch[] = [];
  let conflict = false;
  let enoughMembers = false;
  let duplicates = false;
  let sameLength = false;
  const solved = (refused?: Solved["refused"]): Solved => ({
    branches,
    conflict,
    enoughMembers,
    duplicates,
    sameLength,
    ...(refused === undefined ? {} : { refused }),
  });
  const lengths = new Set(spacesOf[0]!.map((space) => space.reading.structure.payloadLength));
  for (const payloadLength of lengths) {
    const secretBytes = payloadLength - METADATA_BYTES;
    if (!BIP39_ENTROPY_BYTES.has(secretBytes)) continue;
    const choices = spacesOf.map((spaces) =>
      spaces.filter((space) => space.reading.structure.payloadLength === payloadLength),
    );
    if (choices.some((options) => options.length === 0)) continue;
    sameLength = true;
    const readings = picks(choices, MAX_BRANCHES);
    if (readings === undefined)
      return solved({
        verdict: "too-uncertain",
        reason: "Too many forms fit these shares; mark fewer.",
      });
    // Readings with the fewest forms first: a share all marked is then taken in the form of the
    // others, which is how its repair is shown.
    const formsIn = (spaces: readonly ReadingSpace[]) =>
      new Set(spaces.map((space) => space.reading.format)).size;
    readings.sort((a, b) => formsIn(a) - formsIn(b));
    for (const spaces of readings) {
      const offsets = spaces.map((_, share) =>
        spaces.slice(0, share).reduce((sum, space) => sum + space.basis.length, 0),
      );
      const dimensions = offsets.at(-1)! + spaces.at(-1)!.basis.length;
      const joint = await solveJoint({ spaces, offsets, dimensions, secretBytes }, signal, budget);
      if (joint.tooMany)
        return solved({
          verdict: "too-uncertain",
          reason:
            "The member numbers of these shares cannot be told; read more of their first elements.",
        });
      conflict ||= joint.conflict;
      enoughMembers ||= joint.enoughMembers;
      duplicates ||= joint.duplicates;
      branches.push(...joint.branches);
      if (branches.length > MAX_BRANCHES)
        return solved({
          verdict: "too-uncertain",
          reason: "Too many ways fit these shares; mark fewer.",
        });
    }
  }
  return solved();
}

/** The combinations that a search of `branches` tries. */
function combinationsOf(branches: readonly Branch[]): number {
  return branches.reduce((sum, branch) => sum + 2 ** branch.visible.length, 0);
}

/**
 * Combinations of words that the partly read Unicode codes of all the shares are tried in, word
 * by word (refined), and the work that all of them may do together for the choices of thresholds
 * and member numbers (WorkBudget): a few seconds at most, so that the assessment never runs for
 * minutes. Beyond them
 * the codes stay unknown as a whole, and the assessment says what would help.
 */
const CODE_TRIALS = 64;
const TRIAL_WORK = 2 ** 19;

/**
 * The branches of the shares with their partly read Unicode codes tried word by word: the codes
 * with the fewest fitting words, across the shares, as many as keep the combinations within
 * CODE_TRIALS (repair.ts, placesWithin and choicesAt), each combination solved as the shares
 * are. Every word that fits a code is tried, so nothing that the digits allow is lost. Undefined
 * when no code is read in part, or when that does not shorten the search of `branches`: the codes
 * then stay unknown as a whole, their digits still checked (MarkedReading.fits).
 */
async function refined(
  spacesOf: readonly (readonly ReadingSpace[])[],
  before: number,
  signal: AbortSignal | undefined,
): Promise<Branch[] | undefined> {
  if (before <= 1) return undefined;
  const units = spacesOf.flatMap((spaces, share) => {
    const reading = spaces.find((space) => space.reading.candidates !== undefined)?.reading;
    return reading === undefined
      ? []
      : candidateCounts(reading).map((unit) => ({
          ...unit,
          share,
          metadata: reachesMetadata(reading, unit.place),
        }));
  });
  // The codes that reach the metadata first, which tell the member numbers; then those with the
  // fewest words, which gain the most bits for their choices.
  units.sort((a, b) => Number(b.metadata) - Number(a.metadata) || a.count - b.count);
  const chosen = placesWithin(units, CODE_TRIALS);
  if (chosen.length === 0) return undefined;
  const expanded: ReadingSpace[][] = [];
  for (const [share, spaces] of spacesOf.entries()) {
    await nextTurn(signal);
    const places = chosen.filter((unit) => unit.share === share).map((unit) => unit.place);
    expanded.push(
      spaces.flatMap((space) =>
        choicesAt(space.reading, places)
          .map(readingSpace)
          .filter((tried): tried is ReadingSpace => tried !== undefined),
      ),
    );
  }
  if (expanded.some((spaces) => spaces.length === 0)) return undefined;
  const solved = await solveReadings(expanded, signal, { left: TRIAL_WORK });
  if (solved.refused !== undefined || solved.branches.length === 0) return undefined;
  return combinationsOf(solved.branches) < before ? solved.branches : undefined;
}

/** How planJointRepair assesses the shares. */
export interface PlanOptions {
  /** Stops the assessment, which can take a while for many marks. */
  readonly signal?: AbortSignal | undefined;
  /**
   * The host's services, with which the search checks and restores each candidate; the platform
   * configured with configureSharePlatform when none is given (JointRepair passes its own).
   */
  readonly platform?: SharePlatform | undefined;
}

/**
 * Assesses the shares as typed, with ? for each unreadable element, and returns a plan whose search
 * finds every phrase they can restore. Nothing is tried before `search` is called. `signal` stops
 * the assessment, which can take a while for many marks.
 */
export async function planJointRepair(
  records: readonly string[],
  options: PlanOptions = {},
): Promise<JointPlan> {
  const { signal } = options;
  signal?.throwIfAborted();
  const { platform } = options;
  const texts = records.map((record) => record.trim());
  for (const [index, text] of texts.entries())
    if (
      text.length > MAX_REPAIR_TEXT_LENGTH ||
      (text.match(/\?/gu) ?? []).length > MAX_JOINT_MARK_SYMBOLS ||
      markCount(text) > MAX_JOINT_MARKED_ELEMENTS
    )
      throw new Error(
        `Share ${index + 1}: mark at most ${MAX_JOINT_MARKED_ELEMENTS} unreadable elements with ?.`,
      );
  const spacesOf: ReadingSpace[][] = [];
  for (const text of texts) {
    // A turn between the shares: reading one is quick, but many add up.
    await nextTurn(signal);
    spacesOf.push(
      markedReadings(text)
        .map(readingSpace)
        .filter((space): space is ReadingSpace => space !== undefined),
    );
  }
  const shares: ShareAssessment[] = spacesOf.map((spaces, index) => ({
    marks: markCount(texts[index]!),
    forms: [...new Set(spaces.map((space) => space.reading.format))],
    openAlone: spaces.length === 0 ? 0 : Math.min(...spaces.map((space) => space.basis.length)),
  }));
  const unfit = spacesOf.findIndex((spaces) => spaces.length === 0);
  if (unfit >= 0)
    return refusal(shares, "no-fit", unreadableShare(unfit, shares[unfit]!.marks, texts[unfit]!));
  if (spacesOf.some(severalGroups))
    return refusal(
      shares,
      "no-fit",
      "These shares belong to a set of several groups; only sets of one group are repaired.",
    );
  const solved = await solveReadings(spacesOf, signal);
  if (solved.refused !== undefined) {
    // The digits read of partly read codes may tell what the codes unknown as a whole cannot.
    const tried =
      solved.refused.verdict === "too-uncertain"
        ? await refined(spacesOf, Number.POSITIVE_INFINITY, signal)
        : undefined;
    if (tried === undefined) return refusal(shares, solved.refused.verdict, solved.refused.reason);
    return planOf(shares, tried, platform, signal);
  }
  if (!solved.sameLength)
    return refusal(shares, "no-fit", "These shares are of different lengths: not of one set.");
  if (solved.branches.length === 0) {
    // The common rows fail for shares of another set, or for a misread identifier or threshold:
    // more shares would not help.
    if (solved.enoughMembers || solved.conflict)
      return refusal(
        shares,
        "no-fit",
        "These shares do not fit together: check the marks, and that all belong to one set.",
      );
    return refusal(
      shares,
      "not-enough",
      solved.duplicates
        ? "The same share is given more than once: the threshold of this set needs more shares."
        : "Too few shares: the threshold of this set needs more of them.",
    );
  }
  // Partly read Unicode codes are tried word by word where that shortens the search; the verdicts
  // above come from the codes unknown as a whole, which a wrong word cannot mislead.
  const branches =
    (await refined(spacesOf, combinationsOf(solved.branches), signal)) ?? solved.branches;
  return planOf(shares, branches, platform, signal);
}

/** The assessment of `branches` and the search of them, with the host's platform. */
async function planOf(
  shares: readonly ShareAssessment[],
  branches: readonly Branch[],
  platform: SharePlatform | undefined,
  signal: AbortSignal | undefined,
): Promise<JointPlan> {
  const openBits = Math.max(...branches.map((branch) => branch.visible.length));
  const combinations = combinationsOf(branches);
  const threshold = agreed(branches, (branch) => branch.threshold);
  const secretBytes = agreed(branches, (branch) => branch.joint.secretBytes);
  const tooOpen = combinations > 2 ** MAX_SEARCH_BITS;
  const assessment: JointAssessment = {
    shares,
    ...(secretBytes === undefined ? {} : { secretBytes }),
    ...(threshold === undefined ? {} : { threshold }),
    branches: branches.length,
    openBits,
    combinations,
    expectedFalse: (combinations - 1) / 2 ** DIGEST_BITS,
    moreShares: Math.max(...branches.map((branch) => sharesToSettle(branch, shares))),
    helps: await helpfulElements(branches, signal),
    verdict: tooOpen ? "too-uncertain" : openBits === 0 ? "determined" : "search",
    ...(tooOpen
      ? {
          reason: `About 2^${Math.ceil(Math.log2(combinations))} combinations stay open; at most 2^${MAX_SEARCH_BITS} can be searched.`,
        }
      : {}),
  };
  if (tooOpen) return { assessment, search: async () => [] };
  // The configured platform is read only by a search, which the assessment alone does not need.
  return {
    assessment,
    search: (options) => searchBranches(branches, platform ?? sharePlatform(), options),
  };
}

/** The place of the lowest set bit of a positive integer below 2^53. */
function lowestBit(value: number): number {
  const low = value % 2 ** 32;
  if (low === 0) return 32 + lowestBit(Math.floor(value / 2 ** 32));
  return 31 - Math.clz32(low & -low);
}

/**
 * Tries every open combination of every branch against the digest, in Gray code order so that
 * each step adds one known change to (S, D); a candidate that passes is read and restored by the
 * SSKR library. Resolves with every distinct phrase.
 */
async function searchBranches(
  branches: readonly Branch[],
  platform: SharePlatform,
  options: SearchOptions = {},
): Promise<RepairedSet[]> {
  options.signal?.throwIfAborted();
  const total = branches.reduce((sum, branch) => sum + 2 ** branch.visible.length, 0);
  const found = new Map<string, RepairedSet>();
  let done = 0;
  for (const branch of branches) {
    const secretBytes = branch.joint.secretBytes;
    const current = Uint8Array.from(branch.secretAndDigest);
    const count = 2 ** branch.visible.length;
    try {
      for (let step = 0; step < count; step += 1) {
        if (step > 0) {
          const delta = branch.visibleDeltas[lowestBit(step)]!;
          for (let index = 0; index < current.length; index += 1) current[index]! ^= delta[index]!;
        }
        if (digestFits(current, secretBytes, platform.hmacSha256)) {
          const gray = BigInt(step) ^ (BigInt(step) >> 1n);
          const z = branch.particular ^ combine(branch.visible, gray);
          const repaired = await confirm(branch, z, platform);
          if (repaired !== undefined) {
            const known = found.get(repaired.mnemonic);
            found.set(repaired.mnemonic, known === undefined ? repaired : merged(known, repaired));
          }
        }
        done += 1;
        if (done % TRIES_PER_TURN === 0) {
          options.onProgress?.(done, total, found.size);
          await nextTurn(options.signal);
        }
      }
    } finally {
      current.fill(0);
    }
  }
  options.onProgress?.(total, total, found.size);
  return [...found.values()];
}

/**
 * One phrase from two candidates, such as a share all marked read with two member numbers: the
 * shares of the first are kept, and the elements in which the two differ are unsettled.
 */
function merged(first: RepairedSet, other: RepairedSet): RepairedSet {
  const differing = first.shares.flatMap((share, index) => {
    const second = other.shares[index]!;
    if (share.ur === second.ur) return [];
    const values = new Map(second.filled.map((element) => [element.position, element.value]));
    return share.filled
      .filter(
        (element) =>
          share.format !== second.format || values.get(element.position) !== element.value,
      )
      .map((element) => ({ share: index + 1, position: element.position }));
  });
  const unsettled = new Map(
    [...first.unsettled, ...other.unsettled, ...differing].map((element) => [
      `${element.share}:${element.position}`,
      element,
    ]),
  );
  return {
    ...first,
    unsettled: [...unsettled.values()].sort((a, b) => a.share - b.share || a.position - b.position),
  };
}

/** Elements that a hidden direction changes. */
function unsettledElements(branch: Branch): MarkedElement[] {
  return branch.joint.spaces.flatMap((space, share) => {
    const width = BigInt(space.reading.unitBits);
    const mask = (1n << width) - 1n;
    const changed = branch.hidden.reduce(
      (bits, direction) => bits | holeChange(branch.joint, share, direction),
      0n,
    );
    return holesOf(space).flatMap((place, hole) =>
      (changed >> (BigInt(hole) * width)) & mask ? [{ share: share + 1, position: place + 1 }] : [],
    );
  });
}

/** Every share at joint point `z`, read as an ordinary share; undefined if one does not read. */
function readCandidate(branch: Branch, z: bigint): ReadRepairableShare[] | undefined {
  const shares: ReadRepairableShare[] = [];
  for (const [share, space] of branch.joint.spaces.entries()) {
    const values = space.valuesAt(space.particular ^ holeChange(branch.joint, share, z));
    const reading = space.reading;
    if (reading.fits !== undefined && !reading.fits(values)) return undefined;
    let read;
    try {
      read = readShare(reading.text(values));
    } catch {
      return undefined;
    }
    if (read.format !== reading.format) return undefined;
    const filled: FilledElement[] = holesOf(space).map((place) => ({
      position: place + 1,
      value: reading.unitText(values[place]!),
    }));
    shares.push({ ur: read.ur, format: read.format, repaired: filled.length > 0, filled });
  }
  return shares;
}

/**
 * Restores the phrase with the SSKR library, once from the base and once more for every other
 * member together with the first `threshold - 1` of the base, so that every share is checked to
 * lie on the polynomial; copies of one member must be the same share. Undefined when any fails.
 */
async function restore(
  branch: Branch,
  shares: readonly ReadRepairableShare[],
  platform: SharePlatform,
): Promise<string | undefined> {
  const { base, members, threshold } = branch;
  const firstOf = new Map<number, number>();
  members.forEach((member, share) => {
    if (!firstOf.has(member)) firstOf.set(member, share);
  });
  if (members.some((member, share) => shares[share]!.ur !== shares[firstOf.get(member)!]!.ur))
    return undefined;
  const others = [...firstOf.values()].filter((share) => !base.includes(share));
  const windows = [base, ...others.map((share) => [...base.slice(0, threshold - 1), share])];
  let restored: string | undefined;
  for (const window of windows) {
    let entropy: Uint8Array | undefined;
    try {
      const records = validateShareSet(window.map((share) => shares[share]!.ur));
      entropy = await platform.combineShares(records);
      const mnemonic = entropyToMnemonic(entropy, wordlist);
      if (restored !== undefined && restored !== mnemonic) return undefined;
      restored = mnemonic;
    } catch {
      return undefined;
    } finally {
      entropy?.fill(0);
    }
  }
  return restored;
}

/**
 * Reads the shares of a candidate that passed the digest and restores the phrase. Undetermined
 * elements do not change the phrase; the first of their values with which every share reads are
 * taken, and they are reported as unsettled.
 */
async function confirm(
  branch: Branch,
  z: bigint,
  platform: SharePlatform,
): Promise<RepairedSet | undefined> {
  const hiddenBits = Math.min(branch.hidden.length, MAX_HIDDEN_TRIES_BITS);
  for (let choice = 0; choice < 2 ** hiddenBits; choice += 1) {
    const shares = readCandidate(branch, z ^ combine(branch.hidden, BigInt(choice)));
    if (shares === undefined) continue;
    const mnemonic = await restore(branch, shares, platform);
    return mnemonic === undefined
      ? undefined
      : { mnemonic, shares, unsettled: unsettledElements(branch) };
  }
  return undefined;
}

/**
 * The repair of marked shares with the host's services. A class, so that a page binds its
 * SharePlatform once and every assessment, search and measure of its pace uses it, and never a
 * platform configured elsewhere.
 */
export class JointRepair {
  readonly #platform: SharePlatform;

  constructor(platform: SharePlatform) {
    if (typeof platform?.hmacSha256 !== "function" || typeof platform.combineShares !== "function")
      throw new TypeError("A share repair needs the host's SharePlatform.");
    this.#platform = platform;
  }

  /** Marked elements on one share that a repair takes (MAX_JOINT_MARKED_ELEMENTS). */
  static readonly MAX_MARKED_ELEMENTS = MAX_JOINT_MARKED_ELEMENTS;

  /**
   * Assesses `records`, the shares as typed with ? for each unreadable element, and returns the
   * plan whose search finds every phrase they can restore (planJointRepair).
   */
  plan(
    records: readonly string[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<JointPlan> {
    return planJointRepair(records, { ...options, platform: this.#platform });
  }

  /** Digest checks per second in this host, for the time of a search (RepairReport). */
  triesPerSecond(): number {
    return measureTriesPerSecond(this.#platform);
  }
}
