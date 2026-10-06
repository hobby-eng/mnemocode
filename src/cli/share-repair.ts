// The command-line side of repairing shares with unreadable elements (src/sskr/joint-repair.ts):
// what the shares settle together, shown before any search; a question before a long search;
// progress while it runs; and the wallet check that tells phrases apart when several pass.

import {
  masterFingerprint,
  matchBitcoinEvidence,
  type BitcoinEvidence,
} from "../bitcoin-evidence.js";
import {
  MAX_SEARCH_BITS,
  measureTriesPerSecond,
  type JointAssessment,
  type JointPlan,
  type RepairedSet,
} from "../sskr/joint-repair.js";
import { integerOption, type ParsedArguments } from "./arguments.js";
import { onPrivateScreen } from "./private-screen.js";
import { choose } from "./terminal-choice.js";
import { terminalHint, terminalMore, terminalNotice, terminalStatus } from "./terminal.js";

/** A search expected to take longer than this, on this computer, is asked for first. */
const AUTO_SECONDS = 60;
/** Seconds between two progress lines of a long search. */
const PROGRESS_SECONDS = 10;
/** Elements named as help after the assessment. */
const NAMED_HELPS = 3;
/** Wrong phrases expected by chance from which the assessment mentions them. */
const NOTABLE_FALSE = 0.01;
/** The README section on damaged shares. */
const REPAIR_ANCHOR = "damaged-shares";

/** A plan, and how fast this machine checks the digest. */
export interface ShareRepair {
  readonly plan: JointPlan;
  readonly triesPerSecond: number;
}

/** A length of time in words: "about 3 minutes". */
export function duration(seconds: number): string {
  if (seconds < 1) return "under a second";
  const units = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ] as const;
  const [name, size] = units.find(([, size]) => seconds >= size)!;
  const count = Math.round(seconds / size);
  return `about ${count.toLocaleString("en-US")} ${name}${count === 1 ? "" : "s"}`;
}

const count = (value: number) => value.toLocaleString("en-US");

/** Prints what the shares settle together, what is open and what would help. */
function reportAssessment(assessment: JointAssessment, triesPerSecond: number): void {
  if (assessment.verdict === "determined") {
    terminalStatus("Marked elements:", "settled by the shares together");
    return;
  }
  if (assessment.verdict === "no-fit" || assessment.verdict === "not-enough") return;
  const time = duration(assessment.combinations / triesPerSecond);
  terminalStatus(
    "Open combinations:",
    `${count(assessment.combinations)} (2^${Math.ceil(Math.log2(assessment.combinations))}), ${time}`,
    false,
  );
  for (const help of assessment.helps.slice(0, NAMED_HELPS))
    terminalHint(
      `Reading element ${help.position} of share ${help.share} would leave 2^${help.openBits}.`,
    );
  if (assessment.moreShares > 0)
    terminalHint(
      `${assessment.moreShares} more ${assessment.moreShares === 1 ? "share" : "shares"} without marks would settle everything.`,
    );
  if (assessment.expectedFalse >= NOTABLE_FALSE)
    terminalNotice(
      `About ${assessment.expectedFalse.toPrecision(2)} wrong phrases may pass by chance; every phrase found is listed.`,
      "warning",
    );
  terminalMore(REPAIR_ANCHOR);
}

/**
 * Prints the assessment of shares typed with ? marks (planShareRepair); throws the reason when they
 * cannot be repaired. No combination is tried yet.
 */
export function assessShareRepair(plan: JointPlan): ShareRepair {
  const triesPerSecond = measureTriesPerSecond();
  reportAssessment(plan.assessment, triesPerSecond);
  if (plan.assessment.reason !== undefined) throw new Error(plan.assessment.reason);
  return { plan, triesPerSecond };
}

/**
 * The combinations that --max-tries allows without a question, read before any secret is asked;
 * undefined without it, when a search of up to AUTO_SECONDS goes ahead.
 */
export function searchLimit(args: ParsedArguments): number | undefined {
  if (args["max-tries"] === undefined) return undefined;
  return integerOption(args, "max-tries", { min: 1, max: 2 ** MAX_SEARCH_BITS });
}

/**
 * Runs the search, after asking on the private screen when it is longer than allowed; elsewhere a
 * longer search needs --max-tries. Resolves with every phrase found, at least one.
 */
export async function searchShareRepair(
  repair: ShareRepair,
  limit: number | undefined,
): Promise<RepairedSet[]> {
  const { assessment } = repair.plan;
  const time = duration(assessment.combinations / repair.triesPerSecond);
  const allowed = limit ?? Math.floor(AUTO_SECONDS * repair.triesPerSecond);
  if (assessment.combinations > allowed) {
    if (!onPrivateScreen())
      throw new Error(
        `The search takes ${count(assessment.combinations)} checks, ${time}. Allow it with --max-tries ${assessment.combinations}.`,
      );
    const start = await choose(
      `Search ${count(assessment.combinations)} combinations, ${time}?`,
      [
        { label: "Yes", note: "Ctrl+C stops it", value: true },
        { label: "No", value: false },
      ],
      { label: "Search" },
    );
    if (start !== true) throw new Error("The search was not started.");
  }
  let shown = Date.now();
  const found = await repair.plan.search({
    onProgress: (done, total, phrases) => {
      if (Date.now() - shown < PROGRESS_SECONDS * 1000 || done === total) return;
      shown = Date.now();
      terminalHint(
        `Checked ${Math.floor((100 * done) / total)}%: ${count(done)} of ${count(total)}; ${phrases} found.`,
      );
    },
  });
  if (found.length === 0)
    throw new Error(
      "No phrase fits these shares: a ? may stand at a wrong place, or an element without ? be misread.",
    );
  return found;
}

/**
 * The sets whose wallet, `walletOf` their phrase, matches `evidence`; all of them without evidence.
 * Throws when evidence matches none.
 */
export function matchingSets(
  sets: readonly RepairedSet[],
  evidence: BitcoinEvidence | undefined,
  walletOf: (set: RepairedSet) => string,
  passphrase: string,
): RepairedSet[] {
  if (evidence === undefined) return [...sets];
  const matching = sets.filter(
    (set) => matchBitcoinEvidence(walletOf(set), evidence, passphrase).matched,
  );
  if (matching.length === 0)
    throw new Error(
      sets.length === 1
        ? "The phrase that these shares restore does not match the wallet given."
        : `None of the ${sets.length} phrases that fit these shares matches the wallet given.`,
    );
  return matching;
}

/**
 * Says, share by share, what a repair filled in where ? marked an element, so that the written
 * copy can be corrected. An element that nothing settles is a guess, and is said to be one.
 */
export function reportRepairs(set: Pick<RepairedSet, "shares" | "unsettled">): void {
  set.shares.forEach((share, index) => {
    if (!share.repaired) return;
    const guesses = new Set(
      set.unsettled.filter((element) => element.share === index + 1).map((e) => e.position),
    );
    const elements = share.filled.map(
      (element) =>
        `element ${element.position} is ${element.value}${guesses.has(element.position) ? " (a guess)" : ""}`,
    );
    terminalNotice(`Share ${index + 1}: ${elements.join(", ")}.`, "warning");
  });
  if (set.unsettled.length > 0)
    terminalNotice(
      "The phrase does not depend on the guesses, and nothing settles them: do not copy them.",
      "warning",
    );
  if (set.shares.some((share) => share.repaired))
    terminalNotice("Correct the written copy; then check the wallet that comes back.");
}

/** The fingerprint of the phrase that the shares hold, with an empty BIP39 passphrase. */
export function backupFingerprint(set: RepairedSet): string {
  return masterFingerprint(set.mnemonic);
}
