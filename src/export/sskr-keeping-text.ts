// What saved share cards are kept with: how many of the shares restore what, and where each share
// is in what was saved. The command line and a page say it alike, each adding its own words about
// the file it saved.
//
// Host-neutral and without PDF: the shares carry the set's threshold, and SetTopology owns the
// member identity used to count repeated copies once.

import { PHRASE_WORDS } from "../core/masking.js";
import { Share } from "../sskr/transport.js";
import { SetTopology } from "../sskr/set-topology.js";
import { counted } from "../core/search-plan.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.sskr-keeping-text", {
  "there-no-shares-keep": () => "There are no shares to keep.",
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
 * printed again, and a set may have several groups.
 */
function quorum(records: readonly string[], masked: boolean): string {
  const goal = masked ? MASKED_GOAL : "for recovery";
  using first = Share.read(defined(records[0]));
  const { info } = first;
  if (info.groupCount > 1)
    return `These shares belong to ${info.groupCount} groups, each needing enough of its own ${goal}`;
  const members = new Set<string>();
  for (const record of records) {
    using share = Share.read(record);
    members.add(SetTopology.memberOf(share.info));
  }
  const repeated = members.size < records.length;
  const text = singleGroupQuorum(
    members.size,
    info.memberThreshold,
    goal,
    repeated ? "distinct share" : "share",
  );
  return repeated ? `${text}; repeated copies count as one share` : text;
}

/**
 * How the shares saved as `packaging` are kept: how many restore what (Seedshift `masked` the
 * phrase before the split, or not), and where each share is; one sentence or two.
 */
export function shareKeepingNote(
  records: readonly string[],
  packaging: ShareCardPackaging,
  masked: boolean,
): string {
  if (records.length === 0) throw ERRORS.create("there-no-shares-keep", []);
  return `${quorum(records, masked)}; ${LAYOUTS[packaging]}. Store the shares apart.`;
}
