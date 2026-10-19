// Repairs a share with up to six unreadable elements, each marked with ? at its place: a word
// number, a Unicode code, a color, a Byteword or a pair of letters of a UR. Every form keeps a
// CRC32 checksum, and the mixed forms a version and a length byte (transport.ts), and all of these
// are affine over GF(2) in the bits of the share: the mixing XORs each byte with a CRC32 of the
// checksum, and CRC32 itself is affine. So the missing bits are the solutions of a system of linear
// equations, found by elimination instead of by trying every value, which for three colors would
// be 2^72 tries. Each solution is then read as an ordinary share, which checks everything again.
// More solutions than one are listed as variants, never chosen silently; unmarked errors are never
// repaired.
//
// An element may also be read in part, a ? standing for each digit that cannot be read: a color
// such as #B5?0??, whose digits are bits, adds the bits read as equations of their own. A Unicode
// code such as 4E?0, whose digits are not bits of its word number, is unknown as a whole, and the
// words whose code fits are its candidates: a solution must be one of them (fits), and where that
// shortens the search they are tried one by one, each as the code's bits (withValues).
//
// MarkedReading and ReadingSpace are the classes of the repair: a way to read a marked text, and
// the solutions of that reading on its own, which owns the share's secret arrays and wipes them.
// The units of each form are read and written through share-units.ts and the mixed layout through
// mixed-layout.ts, as the reader of shares reads them (transport.ts). The structures of a share's
// bytes are repair-units.ts, and the ways to read a marked share as units of a form, which a
// MarkedReading solves, repair-models.ts.

import { apartHexUnits, codeTokens, withJoinedMarksHint, wholeMark } from "../core/code-text.js";
import { combination } from "./gf2.js";
import { readShare } from "./transport.js";
import { capitalized } from "../core/prose.js";
import { defined } from "../core/defined.js";
import { isMarked, MAX_REPAIR_TEXT_LENGTH, type ShareRepairErrorCode } from "./repair-units.js";
import { CODE_FORMS, type CodeForm, DIGIT_MARKED_WIDTHS } from "./repair-models.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";
import { MarkedReading } from "./repair-owners.js";
import type { ReadRepairableShare } from "./repair-types.js";

/** Owned reading APIs, kept available through the original repair entry point. */
export { MarkedReading, ReadingSpace, everyPick } from "./repair-owners.js";
/** Repair result shapes shared through a leaf module without an owner import cycle. */
export type { FilledElement, ReadRepairableShare } from "./repair-types.js";

const ERRORS = new ErrorCatalog("sskr.repair", {
  "each-at-place": (value0: string) => `${value0}, each at its place.`,
  "repair-candidates-refused": suppliedMessage,
  "shares-readings-refused": suppliedMessage,
  "free-bits-budget": () => `freeBits must be a whole number from 0 to ${MAX_LISTED_FREE_BITS}.`,
});

/** More marked elements than this leave too few checksum bits to find them. */
export const MAX_MARKED_ELEMENTS = 6;

/**
 * Readings that one share alone is tried in, one for each choice of words for its partly read
 * Unicode codes (MarkedReading.choicesAt), when the checksum alone leaves too many solutions.
 */
export const MAX_CODE_CHOICES = 256;

/**
 * Up to 2^4 solutions of one share are listed as variants. Restoring with other shares may try up
 * to 2^8 of them, since the SSKR library then keeps only the one whose secret digest fits.
 */
export const LISTED_FREE_BITS = 4;

/** Largest single-share listing budget: at most 256 solutions per solved reading. */
export const MAX_LISTED_FREE_BITS = 8;

/** A complete share, read in its form, as a repair gives it back with nothing filled in. */
export function unrepairedShare(text: string): ReadRepairableShare {
  return { ...readShare(text), repaired: false, filled: [] };
}

/**
 * Thrown when several shares fit the marked elements. The message names only their places: an
 * error may be shown where the screen is not private. It retains count/place metadata only;
 * callers obtain secret variants through repairCandidates(), never through this Error.
 */
export class ShareVariantsError extends Error {
  /** Stable code for several complete share variants, without retaining the secret variants. */
  readonly code: ShareRepairErrorCode = "share-variants";

  /** Immutable one-based positions of the marked elements that leave several variants. */
  readonly places: readonly number[];

  constructor(
    /** Number of complete variants; this error retains only count and place metadata. */
    readonly count: number,
    places: readonly number[],
  ) {
    super(
      `${count} shares fit the marked elements ${places.join(", ")}. Use another copy of this share, or another share.`,
    );
    this.places = Object.freeze([...places]);
  }
}

/**
 * The candidate units to try value by value, in the order given, as many as keep the product of
 * their counts within `limit`; the others stay unknown as a whole.
 */
export function placesWithin<Unit extends { readonly count: number }>(
  units: readonly Unit[],
  limit: number,
): Unit[] {
  const chosen: Unit[] = [];
  let product = 1;
  for (const unit of units) {
    // Compared before multiplying, so that the product stays a whole number within the limit.
    if (unit.count > Math.floor(limit / product)) continue;
    product *= unit.count;
    chosen.push(unit);
  }
  return chosen;
}

/**
 * The marked elements of `text`, as the repair reads them (docs/SSKR.md, Damaged shares). Among
 * colors or Unicode codes of words written apart, each code with a ? is one element: a lone ?, a
 * code read in part such as #B5?0?? or 4E?0, and a code all of whose digits are ?, such as ??????
 * or ????, which the repair reads as a lone ? (markedCodes). Elsewhere each ? counts, as each may
 * stand for a whole element of codes run together, except that a code of four or six symbols with
 * ? among its digits is still one element.
 */
export function markCount(text: string): number {
  const apart = digitCodesApart(text);
  if (apart !== undefined) return apart.filter(isMarked).length;
  return codeTokens(text).reduce((marks, token) => {
    const symbols = (token.match(/\?/gu) ?? []).length;
    const code = DIGIT_MARKED_WIDTHS.includes(token.length);
    const partly = code && symbols > 0 && symbols < token.length && /^[0-9A-F?]+$/iu.test(token);
    return marks + (partly ? 1 : symbols);
  }, 0);
}

/**
 * Whether `text` is longer than a repair reads or marks more than `maxElements` elements: the
 * bound of one share's repair and of a joint repair, each with its own number. The ? are bounded
 * with the elements: a partly read code holds fewer ? than its digits and counts as one.
 */
export function exceedsMarks(text: string, maxElements: number): boolean {
  const trimmed = text.trim();
  return trimmed.length > MAX_REPAIR_TEXT_LENGTH || markCount(trimmed) > maxElements;
}

/** The bound of exceedsMarks as a refusal says it: "mark at most N unreadable elements with ?". */
export function markLimit(maxElements: number): string {
  return `mark at most ${maxElements} unreadable elements with ?`;
}

/** The form of codes written apart (CODE_FORMS) that every code of `tokens` read fits, if any. */
function codeFormOf(tokens: readonly string[]): CodeForm | undefined {
  const read = tokens.filter((token) => !token.includes("?"));
  if (read.length === 0) return undefined;
  return CODE_FORMS.find((candidate) => read.every(candidate.reads));
}

/**
 * The codes of `text` when it is codes written apart of a form whose codes take a ? for a digit,
 * colors or Unicode codes of words, as the repair reads them (apartHexUnits); undefined otherwise.
 */
function digitCodesApart(text: string): string[] | undefined {
  const digits = codeFormOf(codeTokens(text))?.digits;
  return digits === undefined ? undefined : apartHexUnits(text, digits);
}

/**
 * Why a code with a ? among its symbols cannot be read, in words that follow "Share 2: ", when the
 * text is codes written apart of one form (CODE_FORMS): in a color or a Unicode code it must keep
 * all its symbols, a ? for each digit that cannot be read; the other forms take only a lone ? for
 * a whole code. A ? joined to a whole code, as in ?4E00, is read as before and not named. It names
 * the code by its place only: the text may be shown where the screen is not private.
 */
export function markProblem(text: string): string | undefined {
  const tokens = codeTokens(text);
  const form = codeFormOf(tokens);
  if (form === undefined) return undefined;
  for (const [index, token] of tokens.entries()) {
    if (!token.includes("?") || wholeMark(token)) continue;
    const name = `${form.name} ${index + 1}`;
    if (form.digits === undefined)
      return `${name} has a ? among its digits: ${form.plural} take only a lone ? for a whole ${form.name}.`;
    // Longer than a code: a whole mark joined to a code, which the joined reading takes.
    if (token.length < form.digits)
      return `${name} has ${token.length} of ${form.digits} symbols: write a ? for each digit that cannot be read, or a lone ? for the whole ${form.name}.`;
  }
  return undefined;
}

/**
 * The unit values of every solution of `reading` on its own; `tooMany` when there are more than
 * 2^freeBits of them, which are then not listed.
 */
function solutions(
  reading: MarkedReading,
  freeBits: number,
): { readonly found: number[][]; readonly tooMany: boolean } {
  return reading.withSpace((space) => {
    if (space === undefined) return { found: [], tooMany: false };
    const basis = space.basis;
    if (basis.length > freeBits) return { found: [], tooMany: true };
    const particular = space.particular;
    const found: number[][] = [];
    try {
      for (let choice = 0; choice < 2 ** basis.length; choice += 1)
        found.push(space.valuesAt(particular ^ combination(basis, BigInt(choice))));
      return { found, tooMany: false };
    } catch (error) {
      for (const values of found) values.fill(0);
      throw error;
    }
  });
}

/**
 * `reading` as one share alone is solved: as it is, or, when the checksum leaves more than
 * 2^freeBits solutions and it has candidate units, once for each choice of their values within
 * MAX_CODE_CHOICES (placesWithin, choicesAt).
 */
function triedReadings(reading: MarkedReading, freeBits: number): MarkedReading[] {
  const counts = reading.candidateCounts();
  if (counts.length === 0) return [reading];
  const freeBitsOfReading = reading.withSpace((space) => space?.basis.length);
  if (freeBitsOfReading === undefined || freeBitsOfReading <= freeBits) return [reading];
  // The units with the fewest values first: each gains the most bits for its choices.
  const fewestFirst = [...counts].sort((a, b) => a.count - b.count);
  return reading.choicesAt(placesWithin(fewestFirst, MAX_CODE_CHOICES).map((unit) => unit.place));
}

/**
 * Every share that `value` can be, in any form, with up to MAX_MARKED_ELEMENTS elements marked with
 * ? where they are unreadable; at most 2^freeBits of them. Every candidate passes the ordinary
 * reader, so its checksum and its SSKR metadata are checked as for any share. `freeBits` must be
 * a whole number from 0 to MAX_LISTED_FREE_BITS; an unsupported budget is refused before reading.
 */
export function repairCandidates(
  value: string,
  freeBits: number = LISTED_FREE_BITS,
): ReadRepairableShare[] {
  if (!Number.isInteger(freeBits) || freeBits < 0 || freeBits > MAX_LISTED_FREE_BITS)
    throw ERRORS.create("free-bits-budget", []);
  if (!isMarked(value)) return [unrepairedShare(value)];
  const text = value.trim();
  if (exceedsMarks(text, MAX_MARKED_ELEMENTS))
    throw ERRORS.create("each-at-place", [`${capitalized(markLimit(MAX_MARKED_ELEMENTS))}`]);
  const problem = markProblem(text);
  if (problem !== undefined)
    throw ERRORS.create("repair-candidates-refused", [capitalized(problem)]);
  const roots = MarkedReading.of(text);
  const owned = new Set(roots);
  try {
    const outcomes: ReadingOutcome[] = [];
    for (const reading of roots) {
      const tried = triedReadings(reading, freeBits);
      for (const model of tried) owned.add(model);
      for (const model of tried) {
        const solved = solutions(model, freeBits);
        try {
          outcomes.push({
            withDecoys: model.withDecoys,
            tooMany: solved.tooMany,
            shares: solved.found.flatMap((values) => model.solvedShare(values) ?? []),
          });
        } finally {
          for (const values of solved.found) values.fill(0);
        }
      }
    }
    return sharesOfReadings(outcomes, text);
  } finally {
    for (const reading of owned) reading.wipe();
  }
}

/** What one reading of a marked share gave (repairCandidates). */
export interface ReadingOutcome {
  /** Whether the reading takes decoy cards after a prefix of the text. */
  readonly withDecoys: boolean;
  /** Whether its search stopped at the cap, with filters left that it could not apply. */
  readonly tooMany: boolean;
  /** The shares it solved. */
  readonly shares: readonly ReadRepairableShare[];
}

/**
 * The shares that the readings of the marked share `text` gave, each once, by their outcomes. A
 * capped reading of the whole text keeps uniqueness from being established, since the cap stops
 * its remaining filters: it refuses with "Too many elements" whatever the others solved. One that
 * takes decoy cards after a prefix is only one hypothesis more and leaves a solved reading
 * standing (AUD-022-FUN001). Without a share, the refusal says why.
 */
export function sharesOfReadings(
  outcomes: readonly ReadingOutcome[],
  text: string,
): ReadRepairableShare[] {
  const found = new Map<string, ReadRepairableShare>();
  let tooMany = false;
  let cappedDecoys = false;
  for (const outcome of outcomes) {
    if (outcome.withDecoys) cappedDecoys ||= outcome.tooMany;
    else tooMany ||= outcome.tooMany;
    for (const share of outcome.shares) found.set(share.ur, share);
  }
  if (tooMany || found.size === 0)
    throw ERRORS.create("shares-readings-refused", [
      tooMany || cappedDecoys
        ? "Too many elements are marked for this form: the checksum cannot tell them. Mark fewer, or use another share."
        : withJoinedMarksHint(
            "No valid share fits the marked elements. Check their places and the other elements.",
            text,
          ),
    ]);
  return [...found.values()];
}

/** One caller-owned share, or a metadata-only ShareVariantsError; use repairCandidates for variants. */
export function readRepairableShare(value: string): ReadRepairableShare {
  const candidates = repairCandidates(value);
  if (candidates.length > 1)
    throw new ShareVariantsError(
      candidates.length,
      defined(candidates[0]).filled.map((element) => element.position),
    );
  return defined(candidates[0]);
}
