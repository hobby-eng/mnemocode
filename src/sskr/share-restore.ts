// The restore of a seed phrase from Shamir shares and the repair of damaged shares, in the steps
// that every host takes, so that none writes them again:
//
// - read the shares (`read`): complete ones are checked as a set and restored, copies left out
//   with a note; marked ones are assessed together, and their report is told;
// - search marked shares (`search`), after the host's question when the search is long
//   (RepairReport.needsQuestion, dateSearchNeedsQuestion);
// - unmask the phrases with the dates of a Seedshift phrase, searched where a date holds ?
//   (`phrases`, with ShareUnmasking), and say why none is the wallet's;
// - write damaged shares again (ShareInput `rewritten` and `checkedExport`, `variants`).
//
// `restore` and `repair` run them in one go for a host that asks its questions before it starts,
// such as a page: a long search stops with the question, and runs once the person said yes
// (`confirmed`). The command line takes the steps one by one (src/cli/sskr-restore-command.ts),
// and asks again where an answer cannot be used. A search that a host does not make is released
// (`releaseRead`), so that what the assessment kept of the shares' secret is wiped.
//
// Needs from the host: its SSKR library and HMAC-SHA256 (ShareRepairPlatform), the dates, a wallet check
// and, for a set of shares that fits several ways, the master fingerprint of a phrase. Asks
// nothing and shows nothing.
//
// Host-neutral: it imports only sskr/ and core/ modules (test/portable-modules.test.ts).

import {
  walletReason,
  type DatesAnswer,
  type DateSearchProgress,
  type DateSearchRun,
} from "../core/date-search.js";
import { Masking } from "../core/masking.js";
import type { WalletCheck } from "../core/wallet-check.js";
import { JointRepair, searchOnce, type JointPlan } from "./joint-repair.js";
import { type RepairedSet, type RepairedShares } from "./joint-results.js";
import {
  NO_PHRASE_FITS,
  RepairReport,
  type DateWork,
  type ReportLine,
  type ShareRepairs,
} from "./repair-report.js";
import { ShareInput, type SharesTrouble } from "./share-input.js";
import type { ShareRepairPlatform } from "./share-platform.js";
import { ShareSet, type SetBackup } from "./share-set.js";
import { ShareUnmasking, type ShareMode, type UnmaskedPhrase } from "./share-unmasking.js";
import { writeShare, type ShareFormat } from "./transport.js";
import type { SearchRun, MonotonicClock } from "../core/search-turns.js";
import { defined } from "../core/defined.js";

/** Why a wallet check of shares needs a whole set: no phrase is restored from fewer. */
export const WALLET_CHECK_NEEDS_THRESHOLD =
  "The wallet can be checked only with as many shares as the threshold.";
/**
 * Why a repair of shares of a Seedshift phrase needs the wallet: the dates serve only its check.
 */
export const SEEDSHIFT_REPAIR_NEEDS_WALLET =
  "Seedshift mode here serves only the wallet check: give the wallet too.";
/** Why no share is written again: every one has an element that nothing settles. */
export const NO_SHARE_SETTLED = "No share could be settled.";

/** "2 sets of shares fit; the wallet tells yours.", after a restore without a wallet. */
export function severalSetsNote(sets: number): string {
  return `${sets} sets of shares fit; the wallet tells yours.`;
}

/** Why several sets of repaired shares are shown, none written: their fingerprints tell. */
export function variantsMessage(sets: number): string {
  return `${sets} sets of shares fit. The original fingerprint of each, the wallet's own, tells the right one; give it, or an address, to have that set written.`;
}

/**
 * How a host watches a long step, such as the assessment of marked shares: it runs `step` with a
 * signal that stops it and gives back its result.
 */
export type AssessmentWatch = <T>(
  step: (signal: AbortSignal | undefined) => Promise<T>,
) => Promise<T>;

/** The watch of a host that has a signal already, or none: the step runs with it. */
export function signalWatch(signal: AbortSignal | undefined): AssessmentWatch {
  return (step) => step(signal);
}

/** No watch: the step runs without a signal. */
const unwatched = signalWatch(undefined);

/**
 * How far a search of shares and of their dates has come, as the date search tells it: tries made,
 * of all, phrases found (the checksum-valid ones of a date search), and phrases that the wallet
 * matched, or every phrase without a wallet.
 */
export type RestoreProgress = DateSearchProgress;

/** How a host follows and stops a search. */
export interface RestoreRun extends SearchRun {
  /** Called now and then with the tries made, of all, and the phrases found and matched. */
  readonly onProgress?: ((progress: RestoreProgress) => void) | undefined;
}

/** What the shares as typed give, or their first problem. Nothing is searched yet. */
export type SharesRead =
  | (SharesTrouble & {
      /** The notes of copies left out, or the report of marked shares, said with the trouble. */
      readonly lines: readonly ReportLine[];
    })
  | {
      readonly kind: "complete";
      readonly set: RepairedSet;
      readonly secretBytes: number;
      /** The places of the set's shares among those typed, copies left out. */
      readonly places: readonly number[];
      /** The notes of copies left out. */
      readonly lines: readonly ReportLine[];
      /** The warning that a share took no part in the check of the set, if one did not. */
      readonly unchecked?: string | undefined;
    }
  | MarkedShares
  /** The host stopped the assessment of marked shares (CORE-22): nothing is planned. */
  | { readonly kind: "stopped"; readonly lines: readonly ReportLine[] };

/** Complete shares, restored. */
export type CompleteShares = Extract<SharesRead, { kind: "complete" }>;

/** Shares with ? marks, assessed together: the plan of their search and its report. */
export interface MarkedShares {
  /** Tells marked shares from the other outcomes of a read. */
  readonly kind: "marked";
  /** The plan of their search, owned here until ShareRestore.search or releaseRead wipes it. */
  readonly plan: JointPlan;
  /** The report of the assessment, with this machine's pace and the places of the shares. */
  readonly report: RepairReport;
  /** The place of each share among those typed, counted from 1, by its index in the plan. */
  readonly places: readonly number[];
  /** The lines of the report (RepairReport.lines), said before any search. */
  readonly lines: readonly ReportLine[];
}

/**
 * Wipes what `read` keeps of the shares' secret for a search that will not be made, such as one
 * that the person did not allow, or shares typed again: the plan of marked shares. A search wipes
 * it itself (searchOnce); complete shares keep nothing for one.
 */
export function releaseRead(read: SharesRead): void {
  if (read.kind === "marked") read.plan.wipe();
}

/** The words of the phrase that `read` holds, or undefined while an assessment does not tell. */
export function wordCountOf(
  read: Extract<SharesRead, { kind: "complete" | "marked" }>,
): number | undefined {
  const secretBytes =
    read.kind === "complete" ? read.secretBytes : read.plan.assessment.secretBytes;
  return secretBytes === undefined ? undefined : ShareSet.wordCountOf(secretBytes);
}

/**
 * How far a search goes without the person's yes: share combinations (--max-tries) and date
 * combinations (--max-candidates); without them, as long as QUESTION_SECONDS.
 */
export interface SearchLimits {
  /** Share combinations, digest checks, that a search of marked shares tries without a question. */
  readonly shares?: number | undefined;
  /**
   * Date combinations that a date search tries without a question: in all over the phrases
   * searched (dateSearchDecision), and those of one phrase before a search of marked shares, which
   * does not yet tell how many phrases it gives (RepairReport.needsQuestion).
   */
  readonly dates?: number | undefined;
}

/** A search decision: its question when it waits for the person's yes, or its notice. */
export interface SearchDecision {
  /** What to ask before the search, such as "Search 3,650 date combinations, about 9 hours?". */
  readonly question?: string;
  /** What the search tries and about how long it takes, when it starts without a question. */
  readonly notice?: string;
}

/**
 * Whether the date search of `work` for each of `phrases` phrases starts at once or after the
 * person's yes, with `limits.dates` combinations allowed without a question.
 */
export function dateSearchDecision(
  work: DateWork,
  phrases: number,
  limits: SearchLimits = {},
): SearchDecision {
  return RepairReport.dateSearchNeedsQuestion(work, phrases, limits.dates)
    ? { question: RepairReport.dateSearchQuestion(work, phrases) }
    : { notice: RepairReport.dateSearchNotice(work, phrases) };
}

/**
 * Complete shares restore one set (ShareSet.restore), so their date search unmasks one phrase. The
 * search of marked shares counts the phrases it may find itself (RepairReport.seconds).
 */
const COMPLETE_READ_PHRASES = 1;

/**
 * Whether the search that the shares of `read` need, with the date search of `work` for each
 * phrase they give, starts at once or after the person's yes: its question, or the notice that
 * says how long it takes. The one rule of every host. A date search of the phrases found later,
 * such as after another wallet, is asked anew with their count (dateSearchDecision).
 */
export function searchDecision(
  read: Extract<SharesRead, { kind: "complete" | "marked" }>,
  work: DateWork | undefined,
  limits: SearchLimits = {},
): SearchDecision {
  if (read.kind === "complete")
    return work === undefined ? {} : dateSearchDecision(work, COMPLETE_READ_PHRASES, limits);
  if (read.report.needsQuestion(limits.shares, work, limits.dates))
    return { question: read.report.searchQuestion(work) };
  return work === undefined ? {} : { notice: read.report.searchNotice(work) };
}

/** What a restore asks of `restore`. */
export interface ShareRestoreRequest extends RestoreRun {
  /** How far a search goes without the person's yes. */
  readonly limits?: SearchLimits | undefined;
  /**
   * The shares as typed; the restore refuses with core.secret-value.wiped when they end while a
   * host step is awaited.
   */
  readonly input: ShareInput;
  /** The mode that the phrase was split in: "direct", or "seedshift", which takes `dates`. */
  readonly mode: ShareMode;
  /** The dates of a Seedshift phrase, which may hold ?; none without Seedshift. */
  readonly dates?: DatesAnswer | undefined;
  /** Compares each phrase with the wallet; without it every phrase is kept. */
  readonly walletCheck?: WalletCheck | undefined;
  /** Matches of each date search kept for a candidate list; none by default. */
  readonly keep?: number | undefined;
  /** Whether the person said yes to the long search that a question announced. */
  readonly confirmed: boolean;
}

/** A phrase that shares restored, the phrase they hold, and what a repair filled in. */
export interface RestoredPhrase extends UnmaskedPhrase {
  /** The phrase the shares hold: the seed phrase, or its Seedshift mask. */
  readonly held: string;
  /** What a repair filled in where ? marked an element, share by share. */
  readonly repairs: readonly ShareRepairs[];
  /** The backup in the form its shares were written in, where it is not the phrase itself. */
  readonly backup?: SetBackup | undefined;
}

/** The seed phrases that the sets of a restore give, with their sets. */
export interface PhrasesFound {
  /** Tells phrases found from the other outcomes of a restore. */
  readonly kind: "phrases";
  /** The phrases kept: all of them, or the wallet's. */
  readonly phrases: readonly RestoredPhrase[];
  /** The sets of the phrases, each once, in their order. */
  readonly sets: readonly RepairedSet[];
  /** Every phrase for a candidate list, in its order, also the date matches beyond those shown. */
  readonly listed: readonly string[];
}

/** What the sets of a restore give as seed phrases (ShareRestore.phrases). */
export type RestoredPhrases =
  | PhrasesFound
  /** The dates are more than a set's phrase takes. */
  | { readonly kind: "dates"; readonly message: string }
  /** No phrase is the wallet's (ShareSet.walletMismatch). */
  | { readonly kind: "mismatch"; readonly message: string }
  /** The host stopped the date search: no phrase is told (CORE-22). */
  | { readonly kind: "stopped" };

/** A restore or a repair that ends without a result: a trouble to say, or a question first. */
export type ShareStop =
  | {
      readonly kind: "trouble";
      readonly message: string;
      readonly lines: readonly ReportLine[];
    }
  | {
      readonly kind: "question";
      readonly question: string;
      readonly lines: readonly ReportLine[];
    }
  /** The host stopped the assessment or a search (CORE-22): nothing is told. */
  | { readonly kind: "stopped"; readonly lines: readonly ReportLine[] };

/** Too few shares to restore a phrase: a repair then writes each share again on its own. */
export interface FewShares {
  /** Tells too few shares from the other outcomes of a restore. */
  readonly kind: "few";
  /** Why the shares restore no phrase, such as how many the set needs, for the person. */
  readonly message: string;
  /** The lines of the report, said before the message. */
  readonly lines: readonly ReportLine[];
}

/** The sets that the shares give, before their dates, with the places of their shares. */
interface FoundSets {
  readonly kind: "sets";
  readonly sets: readonly RepairedSet[];
  readonly places: readonly number[];
  readonly lines: readonly ReportLine[];
  readonly notes: readonly string[];
}

/** What a search of marked shares finds (ShareRestore.search): its sets, or why there are none. */
export type SearchedSets =
  | { readonly kind: "sets"; readonly sets: RepairedSet[]; readonly notes: readonly string[] }
  | { readonly kind: "none"; readonly message: string }
  /** The host stopped the search (RestoreRun.signal): no set is told (CORE-22). */
  | { readonly kind: "stopped" };

/**
 * What a restore of shares ends with: stopped, too few shares, or the phrases found, each with its
 * notes.
 */
export type ShareRestoreOutcome =
  | ShareStop
  | FewShares
  | (PhrasesFound & {
      readonly places: readonly number[];
      readonly lines: readonly ReportLine[];
      readonly notes: readonly string[];
    });

/**
 * The export path after restoration. The source result stays typed so that each host keeps its
 * own report context; only this library decides whether to repair each share, show variants or
 * export one set. A wallet cannot check fewer shares than the threshold.
 */
export type ShareExportDecision<Result extends PhrasesFound | { readonly kind: "few" }> =
  | { readonly kind: "each"; readonly few: Extract<Result, { readonly kind: "few" }> }
  | { readonly kind: "variants"; readonly found: Extract<Result, PhrasesFound> }
  | {
      readonly kind: "set";
      readonly found: Extract<Result, PhrasesFound>;
      readonly set: RepairedSet;
    }
  | { readonly kind: "trouble"; readonly message: string };

/** A share written again, by its place among those typed. */
export interface RepairedShare {
  /** The share's place among those typed, counted from 1. */
  readonly number: number;
  /** The share in the form asked for, or in its own. */
  readonly text: string;
  /** The form that `text` is written in. */
  readonly format: ShareFormat;
  /** The share as an SSKR UR record, which cards and share files take. */
  readonly record: string;
}

/** A set of shares that fits, with the original fingerprint of its phrase, after the dates. */
export interface ShareVariant {
  /** The host's fingerprintOf of the phrase; undefined for a share repaired alone, of no phrase. */
  readonly fingerprint: string | undefined;
  /** The set's shares written again, each named by its place. */
  readonly shares: readonly RepairedShare[];
  /** What the repair filled in, share by share, each guess marked. */
  readonly repairs: readonly ShareRepairs[];
}

/** What a repair asks of `repair`. */
export interface ShareRepairRequest extends Omit<ShareRestoreRequest, "keep"> {
  /** The form every share is written in; without it each keeps its own. */
  readonly form?: ShareFormat | undefined;
  /**
   * The master fingerprint of a phrase with an empty passphrase, for sets that fit several ways.
   */
  readonly fingerprintOf: (mnemonic: string) => string;
}

/** What a repair of marked shares ends with: stopped, or the shares found, or why none was. */
export type ShareRepairOutcome =
  | ShareStop
  | {
      readonly kind: "shares";
      readonly shares: readonly RepairedShare[];
      /** The one form every share is written in; undefined when they keep different forms. */
      readonly form: ShareFormat | undefined;
      readonly repairs: readonly ShareRepairs[];
      readonly lines: readonly ReportLine[];
      readonly notes: readonly string[];
    }
  | {
      readonly kind: "variants";
      readonly message: string;
      readonly variants: readonly ShareVariant[];
      readonly lines: readonly ReportLine[];
    };

/** The sets of `phrases`, each once, in their order. */
function setsOf(phrases: readonly { readonly set: RepairedSet }[]): RepairedSet[] {
  return [...new Set(phrases.map((phrase) => phrase.set))];
}

/** A share of `set` at `place`, written in `form` or its own. */
function repairedShare(
  share: { readonly ur: string; readonly format: ShareFormat },
  number: number,
  form: ShareFormat | undefined,
): RepairedShare {
  const format = form ?? share.format;
  return { number, text: writeShare(share.ur, format), format, record: share.ur };
}

/** A note as a line of the report. */
function noticeLine(text: string): ReportLine {
  return { kind: "notice", text };
}

/**
 * The restore and repair of shares with the host's SSKR library. A class because the platform is
 * bound once and every step uses it; it keeps nothing of a restore.
 */
export class ShareRestore {
  readonly #platform: ShareRepairPlatform;
  readonly #repair: JointRepair;

  /**
   * Binds the host's platform; throws sskr.joint-repair.share-repair-host-s-share-platform (a
   * TypeError) when it lacks hmacSha256 or combineShares.
   */
  constructor(platform: ShareRepairPlatform) {
    this.#platform = platform;
    this.#repair = new JointRepair(platform);
  }

  /**
   * What `input` gives: complete shares checked as a set and restored, copies left out with a
   * note; marked shares assessed together, with their report. A share refused at once, such as
   * one with too many marks, is refused before the assessment. `watch`, the host's, runs the
   * assessment, which may take seconds, and gives it a signal that stops it, such as a Ctrl+C read
   * as a key; without it the assessment runs unwatched. `turn`, the host's own, is how the
   * assessment lets the host's event loop run between its shares, as every search takes it.
   */
  async read(
    input: ShareInput,
    watch: AssessmentWatch = unwatched,
    turn?: SearchRun["turn"],
    now?: MonotonicClock,
  ): Promise<SharesRead> {
    if (!input.marked) {
      const { outcome, copies } = await input.restoreComplete(this.#platform);
      const lines = copies.map((copy) => noticeLine(copy.message));
      if (outcome.kind === "trouble") return { kind: "trouble", trouble: outcome.trouble, lines };
      // Copies were left out: the shares that remain keep their places, those of the set restored,
      // never of the input as a host may have changed it during the restore (AUD-014-API004).
      using set = ShareSet.of(outcome.set);
      const unchecked = set.uncheckedNote(outcome.places);
      return { ...outcome, lines, ...(unchecked === undefined ? {} : { unchecked }) };
    }
    const unreadable = input.firstUnreadable();
    if (unreadable !== undefined) return { kind: "trouble", trouble: unreadable, lines: [] };
    const places = input.places();
    const texts = input.texts();
    // A host failure after the plan was made still releases what the assessment owns.
    let made: JointPlan | undefined;
    let plan: JointPlan;
    let assessmentSignal: AbortSignal | undefined;
    try {
      plan = await watch(async (signal) => {
        assessmentSignal = signal;
        made = await this.#repair.plan(texts, { signal, places, turn, now });
        return made;
      });
    } catch (error) {
      made?.wipe();
      throw error;
    }
    // Until the plan is handed out for its search, nothing else owns it: a report that fails, such
    // as when the host's HMAC throws as it is timed, or a trouble that ends the read, wipes it
    // here (AUD-012-SEC004). A plan handed out is wiped by its search or by releaseRead.
    let handedOut = false;
    try {
      // The host can cancel after the assessment's last turn, while its watch returns the plan.
      if (assessmentSignal?.aborted === true || plan.assessment.verdict === "stopped")
        return { kind: "stopped", lines: [] };
      const report = new RepairReport(plan.assessment, this.#repair.triesPerSecond(now), places);
      const lines = report.lines();
      const trouble = input.assessmentTrouble(plan.assessment, places);
      if (trouble !== undefined) return { kind: "trouble", trouble, lines };
      handedOut = true;
      return { kind: "marked", plan, report, places, lines };
    } finally {
      if (!handedOut) plan.wipe();
    }
  }

  /**
   * The sets that marked shares restore, with a note for each share that took no part in their
   * check; none fits when they are empty.
   */
  async search(marked: MarkedShares, run: RestoreRun = {}): Promise<SearchedSets> {
    const { sets, stopped } = await searchOnce(marked.plan, {
      signal: run.signal,
      turn: run.turn,
      now: run.now,
      // Without a wallet yet, every phrase found is one that matched.
      onProgress: (progress) => run.onProgress?.({ ...progress, matched: progress.found }),
    });
    if (stopped) return { kind: "stopped" };
    if (sets.length === 0) return { kind: "none", message: NO_PHRASE_FITS };
    const notes = sets.flatMap((set) => {
      using restored = ShareSet.of(set);
      return restored.uncheckedNote(marked.places) ?? [];
    });
    return { kind: "sets", sets, notes };
  }

  /**
   * The phrases that the shares restore, as sskr-combine restores them: complete shares checked
   * as a set, marked ones repaired together, then unmasked with the dates, searched where a date
   * holds ?, and compared with the wallet if one is given. A long search waits for the person's
   * yes; several sets that fit are all given, with a note that the wallet tells them apart.
   * Refused with core.secret-value.wiped when the input ends while a host step is awaited, also
   * where the host stopped the run as well: once the input has ended, nothing is told, not even
   * that the run stopped.
   */
  async restore(request: ShareRestoreRequest): Promise<ShareRestoreOutcome> {
    const { dates, walletCheck } = request;
    const unmasking = new ShareUnmasking({
      mode: request.mode,
      dates,
      walletCheck,
      keep: request.keep ?? 0,
    });
    if (unmasking.needsWallet && walletCheck === undefined)
      return { kind: "trouble", message: walletReason(request.mode), lines: [] };
    const work = await unmasking.dateWork(request.now);
    // Each awaited host step may end the input: nothing that follows its end is published
    // (AUD-037-API001).
    request.input.assertLive();
    const found = await this.#sets(request, work);
    if (found.kind !== "sets") return found;
    // The date search tells its progress at its own turns, as every search does.
    const restored = await ShareRestore.phrases(unmasking, found.sets, found.places, {
      onProgress: request.onProgress,
      signal: request.signal,
      turn: request.turn,
      now: request.now,
    });
    request.input.assertLive();
    if (restored.kind === "stopped") return { kind: "stopped", lines: found.lines };
    if (restored.kind !== "phrases")
      return { kind: "trouble", message: restored.message, lines: found.lines };
    const { sets } = restored;
    const several =
      sets.length > 1 && walletCheck === undefined ? [severalSetsNote(sets.length)] : [];
    return {
      ...restored,
      places: found.places,
      lines: found.lines,
      notes: [...found.notes, ...several],
    };
  }

  /**
   * The seed phrases that `sets` give with `unmasking` (ShareUnmasking.unmask), each with the
   * phrase its shares hold, what a repair filled in, its shares named by `places`, and the backup
   * in the form of its shares; or why the dates do not fit, or why none is the wallet's. `run`
   * follows and stops a date search.
   */
  static async phrases(
    unmasking: ShareUnmasking,
    sets: readonly RepairedSet[],
    places: readonly number[],
    run?: DateSearchRun,
  ): Promise<RestoredPhrases> {
    const unmasked = await unmasking.unmask(sets, run);
    if (unmasked.kind === "dates" || unmasked.kind === "stopped") return unmasked;
    if (unmasked.phrases.length === 0)
      return {
        kind: "mismatch",
        message: ShareSet.walletMismatch(sets.length, unmasking.searchedCombinations),
      };
    const phrases = unmasked.phrases.map((phrase): RestoredPhrase => {
      using set = ShareSet.of(phrase.set);
      const backup = set.backup(phrase.mnemonic);
      return {
        ...phrase,
        held: phrase.set.mnemonic,
        repairs: RepairReport.repairs(phrase.set, places),
        ...(backup === undefined ? {} : { backup }),
      };
    });
    return { kind: "phrases", phrases, sets: setsOf(phrases), listed: unmasked.listed };
  }

  /**
   * Why a repair of shares in `mode` cannot start, before any share is read; none when it can. A
   * wallet tells sets of repaired shares apart, and for a Seedshift phrase it needs the dates,
   * which serve only its check.
   */
  static repairRefusal(mode: ShareMode, walletGiven: boolean): string | undefined {
    return Masking.of(mode).masked && !walletGiven ? SEEDSHIFT_REPAIR_NEEDS_WALLET : undefined;
  }

  /**
   * Whether a repair only writes the shares of `input` again: complete shares without a wallet
   * check restore no phrase, so they need no quorum (ShareInput.rewritten).
   */
  static rewritesOnly(input: ShareInput, walletGiven: boolean): boolean {
    return !input.marked && !walletGiven;
  }

  /** Selects the shared export path from a restore; a stopped or refused restore never enters it. */
  static exportDecision<Result extends PhrasesFound | { readonly kind: "few" }>(
    restored: Result,
    walletGiven: boolean,
  ): ShareExportDecision<Result>;
  static exportDecision(
    restored: PhrasesFound | { readonly kind: "few" },
    walletGiven: boolean,
  ): ShareExportDecision<PhrasesFound | { readonly kind: "few" }> {
    if (restored.kind === "few")
      return walletGiven
        ? { kind: "trouble", message: WALLET_CHECK_NEEDS_THRESHOLD }
        : { kind: "each", few: restored };
    const sets = [...restored.sets];
    if (sets.length === 0) return { kind: "trouble", message: NO_PHRASE_FITS };
    return sets.length > 1
      ? { kind: "variants", found: restored }
      : { kind: "set", found: restored, set: defined(sets[0]) };
  }

  /**
   * Damaged shares written again whole, as sskr-export writes them: each in its own form, or in
   * `form`; the phrase is never given. Complete shares need no quorum; marked ones are repaired
   * together, or each on its own when fewer than the threshold were typed. A wallet, with the
   * dates of a Seedshift phrase, tells apart several sets that fit; without one each set is given
   * with its fingerprint and none is chosen.
   */
  async repair(request: ShareRepairRequest): Promise<ShareRepairOutcome> {
    const { input, form, walletCheck } = request;
    const walletGiven = walletCheck !== undefined;
    const refusal = ShareRestore.repairRefusal(request.mode, walletGiven);
    if (refusal !== undefined) return { kind: "trouble", message: refusal, lines: [] };
    if (ShareRestore.rewritesOnly(input, walletGiven)) {
      const typed = input.rewritten();
      if (typed.kind === "trouble")
        return { kind: "trouble", message: typed.trouble.message, lines: [] };
      return ShareRestore.#exportOutcome(typed.set, input.places(), form, [], []);
    }
    // sskr-export writes no candidate list, so a repair keeps no phrase for one. The restore
    // refuses once the input ended during it (AUD-037-API001).
    const restored = await this.restore({ ...request, keep: 0 });
    if (restored.kind !== "few" && restored.kind !== "phrases") return restored;
    const decision = ShareRestore.exportDecision(restored, walletGiven);
    if (decision.kind === "trouble") return { ...decision, lines: restored.lines };
    if (decision.kind === "each")
      return ShareRestore.#repairEach(input, form, decision.few.message);
    const { found } = decision;
    if (decision.kind === "variants")
      return {
        kind: "variants",
        message: variantsMessage(found.sets.length),
        variants: ShareRestore.variants(found.phrases, found.places, form, request.fingerprintOf),
        lines: found.lines,
      };
    return ShareRestore.#exportOutcome(decision.set, found.places, form, found.lines, found.notes);
  }

  /**
   * Every set of `phrases` with the original fingerprint of its phrase, after the dates: the one
   * that a wallet check compares with, not that of the masked phrase the shares hold.
   */
  static variants(
    phrases: readonly UnmaskedPhrase[],
    places: readonly number[],
    form: ShareFormat | undefined,
    fingerprintOf: (mnemonic: string) => string,
  ): ShareVariant[] {
    return setsOf(phrases).map((set) => ({
      fingerprint: fingerprintOf(
        phrases.find((phrase) => phrase.set === set)?.mnemonic ?? set.mnemonic,
      ),
      shares: set.shares.map((share, index) => repairedShare(share, defined(places[index]), form)),
      repairs: RepairReport.repairs(set, places),
    }));
  }

  /** The sets that the shares give, or why there are none yet. */
  async #sets(
    request: ShareRestoreRequest,
    work: DateWork | undefined,
  ): Promise<ShareStop | FewShares | FoundSets> {
    const { dates, confirmed } = request;
    const read = await this.read(
      request.input,
      signalWatch(request.signal),
      request.turn,
      request.now,
    );
    try {
      // The read awaited the host's turns and clock: an input ended there is told before a stop
      // of the host, as restore promises (AUD-037-API001).
      request.input.assertLive();
      if (read.kind === "stopped") return read;
      if (read.kind === "trouble")
        return {
          kind: read.trouble.kind === "few" ? "few" : "trouble",
          message: read.trouble.message,
          lines: read.lines,
        };
      const tooMany = dates?.tooManyFor(wordCountOf(read));
      if (tooMany !== undefined) {
        return { kind: "trouble", message: tooMany, lines: read.lines };
      }
      // A search longer than MnemoCode starts without asking waits for the person's yes; the share
      // search and the date search of each phrase it finds are timed together. The host asks again
      // with the same shares, which are then read anew.
      const decision = searchDecision(read, work, request.limits);
      if (decision.question !== undefined && !confirmed) {
        return { kind: "question", question: decision.question, lines: read.lines };
      }
      const notice = decision.notice === undefined ? [] : [decision.notice];
      if (read.kind === "complete")
        return {
          kind: "sets",
          sets: [read.set],
          places: read.places,
          lines: read.lines,
          notes: [...(read.unchecked === undefined ? [] : [read.unchecked]), ...notice],
        };
      const found = await this.search(read, request);
      request.input.assertLive();
      if (found.kind === "stopped") return { kind: "stopped", lines: read.lines };
      if (found.kind === "none")
        return { kind: "trouble", message: found.message, lines: read.lines };
      return {
        kind: "sets",
        sets: found.sets,
        places: read.places,
        lines: read.lines,
        notes: [...found.notes, ...notice],
      };
    } finally {
      releaseRead(read);
    }
  }

  /** Fewer shares than the threshold restore no phrase: each is repaired from its own checks. */
  static #repairEach(
    input: ShareInput,
    form: ShareFormat | undefined,
    few: string,
  ): ShareRepairOutcome {
    const each = input.repairEach();
    if (each.kind === "unreadable") return { kind: "trouble", message: each.message, lines: [] };
    const lines = [{ kind: "warning", text: few } as const];
    if (each.kind === "variants")
      return {
        kind: "variants",
        message: each.message,
        variants: each.variants.map((variant) => ({
          fingerprint: undefined,
          shares: [repairedShare(variant, each.place, form)],
          repairs: [],
        })),
        lines,
      };
    return ShareRestore.#exportOutcome(
      { shares: each.shares, unsettled: [] },
      input.places(),
      form,
      lines,
      [],
    );
  }

  /** One set written again: a share that nothing settles is left out, copies are given once. */
  static #exportOutcome(
    set: RepairedShares,
    places: readonly number[],
    form: ShareFormat | undefined,
    lines: readonly ReportLine[],
    notes: readonly string[],
  ): ShareRepairOutcome {
    const checked = ShareInput.checkedExport(set, places, form);
    using written = checked.written;
    const leftOut = written.leftOutMessages();
    if (checked.kind === "none")
      return { kind: "trouble", message: [NO_SHARE_SETTLED, ...leftOut].join(" "), lines };
    if (checked.kind === "trouble")
      return { kind: "trouble", message: checked.trouble.message, lines };
    const forms = new Set(written.shown.map((share) => share.format));
    return {
      kind: "shares",
      shares: written.shown.map((share) => repairedShare(share, share.number, undefined)),
      form: forms.size === 1 ? [...forms][0] : undefined,
      repairs: RepairReport.repairs(set, places),
      lines,
      notes: [
        ...notes,
        ...leftOut,
        ...(written.copiesNote === undefined ? [] : [written.copiesNote]),
      ],
    };
  }
}
