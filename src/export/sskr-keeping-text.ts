// What saved share cards are kept with: how many of the shares restore what, and where each share
// is in what was saved. The command line and a page say it alike, each adding its own words about
// the file it saved.
//
// Host-neutral and without PDF: the shares carry the set's threshold, set-topology.ts owns the rule
// that counts an exact copy of a share once, and the conflicts that refuse shares of no one set.

import { PHRASE_WORDS } from "../core/masking.js";
import { Share } from "../sskr/transport.js";
import {
  SET_CONFLICT_CODES,
  SET_CONFLICT_TEXTS,
  SetTopology,
  withoutCopies,
} from "../sskr/set-topology.js";
import { counted } from "../core/search-plan.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.sskr-keeping-text", {
  "there-no-shares-keep": () => "There are no shares to keep.",
  "shares-of-different-sets": () =>
    `${SET_CONFLICT_TEXTS.set.refusal} Only the shares of one set are kept.`,
  "member-given-twice": () =>
    `${SET_CONFLICT_TEXTS.member.refusal} Only the shares of one set are kept.`,
  "group-thresholds-conflict": () =>
    `${SET_CONFLICT_TEXTS.threshold.refusal} Only the shares of one set are kept.`,
  "packaging-unknown": (packagings: string) =>
    `Name how the shares were saved, as one of: ${packagings}.`,
});

/** How the cards or records of the shares were saved. */
export type ShareCardPackaging =
  /** One file that holds every share, such as a collection PDF or a file of records. */
  | "file"
  /** One folder that holds every share, such as the page images of a collection. */
  | "folder"
  /** One file for each share. */
  | "files"
  /** One folder of separate cards for each share. */
  | "folders"
  /** Numbered page images for each share. */
  | "pages";

/** Where each share is in what was saved, by how it was saved. */
const LAYOUTS: Readonly<Record<ShareCardPackaging, string>> = Object.freeze({
  file: "the file holds every share",
  folder: "the folder holds every share",
  files: "each file is one share",
  folders: "each folder is one share and needs all its cards",
  pages: "the numbered pages of each share belong together",
});

/**
 * What the shares of a Seedshift split restore, in MnemoCode's words (PHRASE_WORDS): only the
 * decoy, so such shares are never called enough for recovery without the dates.
 */
const MASKED_GOAL = `to restore ${PHRASE_WORDS.masked}, which the owner's dates turn back into ${PHRASE_WORDS.original}`;

function singleGroupQuorum(count: number, threshold: number, goal: string, noun: string): string {
  if (count < threshold) return `These shares are fewer than the ${threshold} needed ${goal}`;
  if (threshold === 1) return `Any single share is enough ${goal}`;
  if (threshold === count) return `All ${counted(count, noun)} are needed ${goal}`;
  return `Any ${threshold} of the ${counted(count, noun)} are enough ${goal}`;
}

/**
 * How many of `records`, UR records of one set, restore the phrase: read from the shares, whose
 * threshold and groups they carry. Cards may print fewer shares than restore, such as one share
 * printed again, and a set may have several groups. An exact copy counts once; shares of another
 * set, two different shares of one member, or a group with two thresholds are refused, as a
 * restore refuses them: no quorum holds for them (AUD-037-API007).
 */
function quorum(records: readonly string[], masked: boolean): string {
  const goal = masked ? MASKED_GOAL : "for recovery";
  const shares: Share[] = [];
  try {
    for (const record of records) shares.push(Share.read(record));
    const kept = withoutCopies(shares.map((share, place) => ({ place, ur: share.ur })));
    const infos = kept.map(({ place }) => defined(shares[place]).info);
    const conflict = SetTopology.firstConflict(infos);
    if (conflict !== undefined) throw ERRORS.create(SET_CONFLICT_CODES[conflict.kind], []);
    const info = defined(infos[0]);
    if (info.groupCount > 1)
      return `These shares belong to ${info.groupCount} groups, each needing enough of its own ${goal}`;
    const repeated = infos.length < records.length;
    const text = singleGroupQuorum(
      infos.length,
      info.memberThreshold,
      goal,
      repeated ? "distinct share" : "share",
    );
    return repeated ? `${text}; repeated copies count as one share` : text;
  } finally {
    for (const share of shares) share.wipe();
  }
}

/**
 * How the shares saved as `packaging` are kept: how many restore what (Seedshift `masked` the
 * phrase before the split, or not), and where each share is; one sentence or two. `records` are
 * the shares of one set, any of them repeated. Refuses no share at all
 * (export.sskr-keeping-text.there-no-shares-keep), a packaging not named
 * (export.sskr-keeping-text.packaging-unknown), a record that is no share, as Share.read refuses
 * it, and shares of no one set: of different sets
 * (export.sskr-keeping-text.shares-of-different-sets), two different shares of one member
 * (export.sskr-keeping-text.member-given-twice), or a group with two thresholds
 * (export.sskr-keeping-text.group-thresholds-conflict).
 */
export function shareKeepingNote(
  records: readonly string[],
  packaging: ShareCardPackaging,
  masked: boolean,
): string {
  if (records.length === 0) throw ERRORS.create("there-no-shares-keep", []);
  if (!Object.hasOwn(LAYOUTS, packaging))
    throw ERRORS.create("packaging-unknown", [Object.keys(LAYOUTS).join(", ")]);
  return `${quorum(records, masked)}; ${LAYOUTS[packaging]}. Store the shares apart.`;
}
