// Decode's search for codes marked with ?, on the private screen: it asks how the right codes are
// told, with Decode's options answering the first way asked (the encoded fingerprint, the wallet
// or the list, and the limit of a long search), shows the search's progress on one line, and what
// it found. Every rule of the search is the core's MissingCodesSearch
// (core/missing-codes-search.ts); this module only asks, composes the wallet check and shows.

import {
  masterFingerprint,
  parseMasterFingerprint,
  walletCheckOf,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import type { DatesAnswer } from "../core/date-search.js";
import {
  foundAmongOthers,
  MISSING_CODES_TEXTS,
  MISSING_CODES_WAYS,
  MissingCodesSearch,
  type MissingCodesResult,
  type MissingCodesWay,
  type MissingCodesWaySearch,
  type MissingCodesFound,
  type MissingCodesRow,
} from "../core/missing-codes-search.js";
import { onPrivateScreen } from "./private-screen.js";
import { PrivateSteps } from "./private-steps.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { askAfterFailure, askValueUntil, WHAT_NOW } from "./ask.js";
import { askWalletEvidence } from "./wallet-question.js";
import { askDates } from "./date-search.js";
import { CODES_AGAIN_LABEL } from "./backup-questions.js";
import { choose } from "./terminal-choice.js";
import { askToSearch } from "./search-consent.js";
import { CtrlCWatch, nodeTurn } from "./terminal-input.js";
import {
  ProgressLine,
  terminalHint,
  terminalLastingWarning,
  terminalLayout,
  terminalNotice,
  terminalResultHeader,
  terminalStatus,
} from "./terminal.js";
import { candidateLabel, showCandidate } from "./candidate-view.js";
import { counting } from "../core/search-plan.js";
import { type WalletPlace } from "./bitcoin-options.js";
import { lowerFirst } from "../core/prose.js";
import { defined } from "../core/defined.js";
import { describeError } from "../core/refusal.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";

/** Seconds between two progress updates of a long search. */
const PROGRESS_SECONDS = 2;

/** What the search of marked codes gave the decode that asked for it. */
export type MissingOutcome =
  /** The one set of codes that fits, to be decoded as complete codes are, with these dates. */
  | MissingCodesFound
  /** The phrases were shown already, as a list. */
  | { readonly kind: "shown" }
  /** The codes are to be typed again. */
  | { readonly kind: "again" };

/** What Decode's options answer in the search of marked codes, and where a wallet is looked for. */
export interface MissingCodesAnswers {
  /** Where a wallet asked here is looked for (walletPlaceOf). */
  readonly place: WalletPlace | undefined;
  /** The wallet given with the options, which answers "The wallet". */
  readonly evidence?: WalletEvidence | undefined;
  /**
   * The wallet's BIP39 passphrase, "" for none, as its owner (GivenWallet.passphrase) gives it for
   * the search of marked codes that these answers are given to.
   */
  readonly passphrase: string;
  /** --encoded-fingerprint, which answers "Encoded fingerprint". */
  readonly encodedFingerprint?: string | undefined;
  /** --list-candidates, which answers "List every candidate". */
  readonly list: boolean;
  /** --max-candidates: the combinations of codes and dates tried without asking. */
  readonly maxCandidates?: number | undefined;
}

/** What a way that was searched gave: an outcome, LIST_OVERFLOWED, or undefined to ask again. */
type WayOutcome = MissingOutcome | typeof LIST_OVERFLOWED | undefined | Cancelled;

/** How the command line takes a way to tell the codes. */
interface WayOnCommandLine {
  /**
   * The option that names the way ahead in `answers`, as a refusal of it says; undefined where
   * none does, and the way is asked for.
   */
  readonly givenBy: (answers: MissingCodesAnswers) => string | undefined;
  /** Asks what the way needs, then searches it; `given` where the options named it. */
  readonly search: (
    search: MissingCodesSearch,
    answers: MissingCodesAnswers,
    given: boolean,
  ) => Promise<WayOutcome>;
}

/**
 * Each way of the core's search (MISSING_CODES_WAYS) as the command line takes it, one entry for
 * each (CORE-06): a way without one does not compile.
 */
const WAYS_ON_COMMAND_LINE = Object.freeze({
  encoded: {
    givenBy: (answers) =>
      answers.encodedFingerprint === undefined ? undefined : "--encoded-fingerprint",
    search: byEncodedFingerprint,
  },
  wallet: {
    givenBy: (answers) => (answers.evidence === undefined ? undefined : "The wallet option"),
    search: byWallet,
  },
  list: {
    givenBy: (answers) => (answers.list ? "--list-candidates" : undefined),
    search: listed,
  },
} satisfies Readonly<Record<MissingCodesWay, WayOnCommandLine>>);

/**
 * The first way, in the core's order, that the options answer and that fits the codes; one that
 * does not fit is said, and the next is taken. Undefined asks for it.
 */
function givenWay(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
): MissingCodesWay | undefined {
  for (const way of MISSING_CODES_WAYS) {
    const option = WAYS_ON_COMMAND_LINE[way].givenBy(answers);
    if (option === undefined) continue;
    const refusal = search.whyNot(way);
    if (refusal === undefined) return way;
    terminalNotice(`${option}: ${lowerFirst(refusal)}`, "warning");
  }
  return undefined;
}

/**
 * Says what the search filled in, the codes whole with those found, so that the written copy can
 * be corrected, and what the wallet check said of its match; the decode shows it again with its
 * result.
 */
export function reportFound(codes: MissingCodes, found: MissingCodesFound): void {
  terminalStatus(`${MissingCodesSearch.placesText(codes)} found:`, found.backup.text());
  if (found.foundDates !== undefined) terminalStatus("Dates found:", found.foundDates);
  // A fingerprint is only a filter (AUD-037-SEC004).
  if (found.warning !== undefined) terminalLastingWarning(found.warning);
  // Other codes with other dates give the same phrase: those found need not be those written.
  if (found.others !== undefined) terminalLastingWarning(foundAmongOthers(found.others));
  else terminalHint(MISSING_CODES_TEXTS.correct);
}

/** A search that is made, with the notice of its time to show over its progress, if any. */
interface Started {
  readonly notice: string | undefined;
}

/**
 * Whether `way` is searched: at once, its time to be said from a minute, or, when the plan asks
 * for it, only when the person chooses it (askToSearch), whose question said its time.
 */
async function started(
  way: MissingCodesWaySearch,
  limit: number | undefined,
): Promise<Started | "no" | Cancelled> {
  const plan = await way.plan(limit);
  if (!plan.ask) return { notice: plan.tell ? plan.notice() : undefined };
  const start = await askToSearch(plan.question(), {
    note: "choose another way",
    quit: "goes back",
  });
  return start === "yes" ? { notice: undefined } : start;
}

/** What a way that ran gave: its result, or CANCELLED when Ctrl+C stopped it. */
type RanResult = Exclude<MissingCodesResult, { readonly kind: "stopped" }> | Cancelled;

/**
 * Runs `way` while Ctrl+C is read as a key, on a step screen of its own, with `notice` first, if
 * any, and its progress on one line; a search that Ctrl+C stopped cancels the command.
 */
async function ran(way: MissingCodesWaySearch, notice?: string): Promise<RanResult> {
  // The search is a step of its own: its screen shows the title and the search, no longer the
  // question answered before it (CORE-39).
  PrivateSteps.begin();
  if (notice !== undefined) terminalNotice(notice);
  const progress = new ProgressLine(PROGRESS_SECONDS);
  let owned: MissingCodesResult | undefined;
  try {
    try {
      await CtrlCWatch.during(async (signal) => {
        owned = await way.run({
          signal,
          turn: nodeTurn,
          onProgress: ({ checked, total, found }) =>
            progress.showEvery(
              () => `Checked ${counting(checked)} of about ${counting(total)}; ${found} found.`,
            ),
        });
        // Adopt before the terminal watch's own asynchronous finalization can fail.
        return owned;
      });
    } finally {
      progress.end();
    }
    const result = defined(owned);
    // The person stopped the search with Ctrl+C.
    if (result.kind === "stopped") return CANCELLED;
    // Only after final progress output succeeds does this result belong to the next helper.
    owned = undefined;
    return result;
  } finally {
    if (owned?.kind === "found") owned.backup.wipe();
  }
}

/**
 * Asks how the right codes are told and searches them, until one set is found, the candidates are
 * listed, or the person types the codes again; CANCELLED when the command is cancelled. The
 * options in `answers` answer the first way and its value; once that way finds nothing, the
 * person chooses.
 */
export async function searchMissingCodes(
  codes: MissingCodes,
  answers: MissingCodesAnswers,
): Promise<MissingOutcome | Cancelled> {
  const search = new MissingCodesSearch(codes, masterFingerprint);
  terminalNotice(search.unreadable, "warning");
  if (search.many) terminalHint(MISSING_CODES_TEXTS.many);
  // A way that held more than it can, the list, is not offered again for these codes
  // (AUD-037-FUN002).
  const closed = new Set<MissingCodesWay>();
  for (let given = givenWay(search, answers); ; given = undefined) {
    const way = given ?? (await askWay(search, closed));
    if (way === undefined) return { kind: "again" };
    if (way === CANCELLED) return CANCELLED;
    const outcome = await WAYS_ON_COMMAND_LINE[way].search(search, answers, given === way);
    if (outcome === LIST_OVERFLOWED) closed.add(way);
    else if (outcome !== undefined) return outcome;
  }
}

/** Asks how the right codes are told, of the ways not `closed`; undefined types the codes again. */
async function askWay(
  search: MissingCodesSearch,
  closed: ReadonlySet<MissingCodesWay>,
): Promise<MissingCodesWay | undefined | Cancelled> {
  return choose(
    MISSING_CODES_TEXTS.question,
    search.ways
      .filter(({ way }) => !closed.has(way))
      .map(({ way, label, note }) => ({ label, note, value: way })),
    { label: "Codes", quit: "types the codes again" },
  );
}

/**
 * The codes whose own fingerprint is the encoded one that Encode showed, --encoded-fingerprint
 * when `given`; undefined asks again.
 */
async function byEncodedFingerprint(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined | Cancelled> {
  const fingerprint = given
    ? answers.encodedFingerprint
    : await askValueUntil(
        "Encoded fingerprint of these codes, such as 1a2b3c4d:",
        parseMasterFingerprint,
        { what: "the eight characters of the fingerprint" },
      );
  if (fingerprint === undefined || fingerprint === CANCELLED) return fingerprint;
  using way = search.byEncodedFingerprint(fingerprint);
  return await searched(search, way, answers.maxCandidates);
}

/**
 * The codes whose phrase, with the dates, matches the wallet, the one of the options when `given`;
 * undefined asks again. Dates with ? are searched with the codes.
 */
async function byWallet(
  search: MissingCodesSearch,
  answers: MissingCodesAnswers,
  given: boolean,
): Promise<MissingOutcome | undefined | Cancelled> {
  const dates = search.needsDates ? await askCodeDates(search, true) : undefined;
  if (dates === CANCELLED) return CANCELLED;
  using dateAnswer = dates;
  const evidence = given ? answers.evidence : await askWallet(answers.place);
  if (evidence === undefined || evidence === CANCELLED) return evidence;
  using walletCheck = defined(walletCheckOf(evidence, answers.passphrase));
  using way = search.byWallet(walletCheck, dateAnswer);
  return await searched(search, way, answers.maxCandidates);
}

/**
 * Searches `way` once the person allows it (started) and tells its outcome; undefined, after the
 * answer No, asks for another way.
 */
async function searched(
  search: MissingCodesSearch,
  way: MissingCodesWaySearch,
  limit: number | undefined,
): Promise<MissingOutcome | undefined | Cancelled> {
  const start = await started(way, limit);
  if (start === "no") return undefined;
  if (start === CANCELLED) return CANCELLED;
  const result = await ran(way, start.notice);
  return result === CANCELLED ? CANCELLED : outcomeOf(search, result);
}

/**
 * The dates of the masked codes, with ? for a forgotten digit where `patterns`; CANCELLED when
 * the command is cancelled.
 */
function askCodeDates(
  search: MissingCodesSearch,
  patterns: boolean,
): Promise<DatesAnswer | Cancelled> {
  return askDates({ wordCount: search.codes.wordCount, patterns });
}

/** The wallet asked on the screen; undefined when the person goes back. */
async function askWallet(
  place: WalletPlace | undefined,
): Promise<WalletEvidence | undefined | Cancelled> {
  const answer = await askWalletEvidence({
    optional: false,
    ...(place === undefined ? {} : { place }),
  });
  if (answer === CANCELLED) return CANCELLED;
  return answer.kind === "wallet" ? answer.evidence : undefined;
}

/** A listed candidate's facts on the private screen, each a label and its value, in order. */
function candidateFacts({ codes, phrase, fingerprint }: MissingCodesRow): [string, string][] {
  return [
    ["Codes", codes],
    ["Phrase", phrase],
    ["Fingerprint", fingerprint],
  ];
}

/**
 * The candidates of a listed search: on the private screen a result, "MnemoCode · Candidates" with
 * their number, then each candidate as a part of its own with its facts as grey labels
 * (showCandidate, CORE-36), which the page shows by pages when they do not fit (PrivatePage);
 * elsewhere one row each, for a script.
 */
function showCandidates(rows: readonly MissingCodesRow[]): void {
  if (onPrivateScreen() && terminalLayout("stdout")) {
    terminalResultHeader("Candidates", [["Found", String(rows.length)]]);
    for (const [index, row] of rows.entries())
      showCandidate(candidateLabel(index + 1), candidateFacts(row));
    return;
  }
  rows.forEach(({ codes, phrase, fingerprint }, index) =>
    console.log(`${index + 1}\t${codes}\t${phrase}\t${fingerprint}`),
  );
}

/** That a list held more candidates than it can: the way is asked again, without the list. */
const LIST_OVERFLOWED = "list-overflowed";

/**
 * Every candidate with its phrase and fingerprint, for the person to compare. More of them than a
 * list holds, which the estimate allowed, are said, and the way is asked again (AUD-037-UI003).
 */
async function listed(
  search: MissingCodesSearch,
): Promise<MissingOutcome | typeof LIST_OVERFLOWED | Cancelled> {
  const dates = search.needsDates ? await askCodeDates(search, false) : undefined;
  if (dates === CANCELLED) return CANCELLED;
  using dateAnswer = dates;
  using way = search.listed(dateAnswer?.known ?? []);
  let result: RanResult;
  try {
    result = await ran(way);
  } catch (error) {
    if (!MissingCodesSearch.isListOverflow(error)) throw error;
    terminalNotice(describeError(error), "warning");
    return LIST_OVERFLOWED;
  }
  if (result === CANCELLED) return CANCELLED;
  if (result.kind === "list") showCandidates(result.rows);
  terminalHint(MISSING_CODES_TEXTS.list);
  return { kind: "shown" };
}

/**
 * The one set of codes found, reported; none says why and asks again; several, which a
 * fingerprint leaves only by chance, are told by the wallet or the codes are typed again.
 */
async function outcomeOf(
  search: MissingCodesSearch,
  result: Exclude<RanResult, Cancelled>,
): Promise<MissingOutcome | undefined | Cancelled> {
  if (result.kind === "found") {
    try {
      reportFound(search.codes, result);
      return result;
    } catch (error) {
      result.backup.wipe();
      throw error;
    }
  }
  if (result.kind === "none") {
    terminalNotice(result.message, "warning");
    return undefined;
  }
  if (result.kind !== "several") return { kind: "shown" };
  terminalNotice(result.message, "warning");
  const next = await askAfterFailure(
    WHAT_NOW,
    [
      { label: "Tell them by the wallet", value: "wallet" },
      { label: CODES_AGAIN_LABEL, value: "again" },
    ] as const,
    { escape: "types the codes again" },
  );
  if (next === CANCELLED) return CANCELLED;
  return next === "again" ? { kind: "again" } : undefined;
}
