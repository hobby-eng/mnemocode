// The steps that the commands undoing Seedshift share, with the dates that the person types:
// recover-date uses all of them, and decode and sskr-combine (Restore from Shamir shares) use them
// where a date may hold ? for a forgotten digit. Every question is asked again until its answer
// can be used (ask.ts); what was answered before is kept. How a backup is read, the dates, their
// limits and the search are the library's (core/backup-reading.ts, core/encoded-backup.ts,
// core/date-search.ts); this module asks, shows and watches Ctrl+C around them.
//
// The API for the commands (askEncodedBackup and askEncodedCodes, typedAfterFile and
// showEncodedFingerprint in backup-questions.ts, the rest here):
// - askEncodedBackup({ args, seedshiftOnly, recordMode }): on the private screen, the encoded seed
//   phrase, typed or read from --input-file or --qr-file, and everything that can be checked before
// the dates, in the order of BackupReading: the record header, the record's mode against --mode
// (offering the record's), a Shamir share typed by mistake, the format (asked when several fit;
// Esc asks for the codes again), the codes and their count, the mode when neither a record header
// nor --mode names it (the mode of the record read before, `recordMode`, or asked), and the
// container checksum of the checksum-valid modes (offering the Original Seedshift instead). A file
// that cannot be used offers another file, typing the phrase, or Stop. It returns the core's
// EncodedBackup (core/encoded-backup.ts), which holds the codes' own rules, and the mode that a
// record header named. typedAfterFile(args) gives the options for typing the phrase after a file.
// - showEncodedFingerprint(fingerprint): the encoded fingerprint, before the dates are asked.
// - askDates(question) asks for the dates until they fit (the core's DatesAnswer.parse).
// - searchDates(search): recover-date's search over the core's DateSearch, asked for first when it
//   takes longer than twelve hours (DateSearch.plan, SearchPlan.ask), with its progress lines and
//   Ctrl+C watch (dateSearchRun); it returns the matches, and every match for a candidate list.
//   reportDateMatches and dateMatchNotes show them as recover-date does; matchesFitScreen tells
//   whether they can all be read on the private screen, which keeps no scrollback.

import { LIST_KEEP, candidateListHolds } from "../core/candidate-list.js";
import {
  DatesAnswer,
  DateSearch,
  HARD_MAX_COMBINATIONS,
  type DateMatch,
  type DateSearchResult,
  type DateSearchRun,
  type DatesRules,
  walletReason,
  MAX_INCOMPLETE_DATES,
  MAX_SHOWN_MATCHES,
  walletNeeded,
} from "../core/date-search.js";
import type { SeedshiftMode } from "../core/date-recovery.js";
import { PHRASE_WORDS, type MaskingMode } from "../core/masking.js";
import { walletCheckOf, type WalletEvidence } from "../bitcoin-evidence.js";
import { integerOption, type ParsedArguments } from "./arguments.js";
import {
  askAfterFailure,
  askSecretUntil,
  askWalletEvidence,
  changeWalletAnswer,
  checkWalletAnswer,
  WHAT_NOW,
} from "./ask.js";
import type { CandidatesFile } from "./candidates-file.js";
import { datesPrompt, mostDates } from "./input.js";
import { evidenceLabel } from "./option-copy.js";
import { onPrivateScreen, closingRows } from "./private-screen.js";
import { linesFitPrivateScreen } from "./screen-fit.js";
import {
  ProgressLine,
  terminalNotice,
  terminalResultHeader,
  readmeLink,
  resultHeaderLines,
  noticeLines,
  moreLine,
} from "./terminal.js";
import { type Choice, type Explanation, rowsOf } from "./terminal-choice.js";
import { askToSearch, type SearchRefusal, allowedBy } from "./search-consent.js";
import { withCtrlCWatch, nodeTurn } from "./terminal-input.js";
import { counted } from "../core/search-plan.js";
import { DATE_FORMAT_TEXT } from "../core/dates.js";
import { numberWord } from "../core/prose.js";
import { type WalletPlace } from "./bitcoin-options.js";
import { fromFile } from "./backup-questions.js";

// The core's limits, rule and types, under the names that the commands and their tests use.
export {
  HARD_MAX_COMBINATIONS,
  MAX_INCOMPLETE_DATES,
  walletNeeded,
  walletReason,
} from "../core/date-search.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.date-search", {
  "search-dates-refused": suppliedMessage,
});

/**
 * Why the wallet is asked for before a date search in `mode`, shown with the question: the
 * library's reason (walletReason), the command's own `extraLines`, and where to read more.
 */
export function walletExplanation(
  mode: MaskingMode | undefined,
  extraLines: readonly string[] = [],
): Explanation {
  return { lines: [walletReason(mode), ...extraLines], more: [readmeLink("date-recovery-helper")] };
}

export type { DateMatch, DateSearchResult, DatesRules } from "../core/date-search.js";

/**
 * --max-candidates: how many combinations a search may try without asking, the dates times the
 * codes or phrases they are tried with; undefined, without it, asks after 12 hours of work.
 */
export function maxCandidatesOf(args: ParsedArguments): number | undefined {
  if (args["max-candidates"] === undefined) return undefined;
  return integerOption(args, "max-candidates", { min: 1, max: HARD_MAX_COMBINATIONS });
}

/** --max-results: the most matches of a date search shown; MAX_SHOWN_MATCHES without it. */
export function maxResultsOf(args: ParsedArguments): number {
  return integerOption(args, "max-results", {
    defaultValue: MAX_SHOWN_MATCHES,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
}

// The dates.

/** The question for dates that may hold ?, as recover-date asks it. */
export function recoveryDatesPrompt(wordCount: number | undefined): string {
  return `Dates with ? for what is forgotten (${mostDates(wordCount)}one to ${numberWord(MAX_INCOMPLETE_DATES)} of them incomplete):`;
}

/** The question for dates: with ? where `patterns` allows it, otherwise as Encode asks. */
export function datesQuestion(rules: DatesRules): string {
  return rules.patterns
    ? `Dates (${mostDates(rules.wordCount)}${DATE_FORMAT_TEXT}, ? for what is forgotten, separated by spaces):`
    : datesPrompt(rules.wordCount);
}

/** What askDates asks. */
export interface DatesQuestion extends DatesRules {
  /** The question; datesQuestion(rules) by default. */
  readonly prompt?: string;
  /** A rule of the command on top, such as recover-date's: at least one date with ?. */
  readonly check?: (answer: DatesAnswer) => void;
}

/**
 * Asks for the dates on the private screen until they can be used (DatesAnswer.parse); CANCELLED
 * when the command is cancelled.
 */
export async function askDates(question: DatesQuestion): Promise<DatesAnswer | Cancelled> {
  return askSecretUntil(
    question.prompt ?? datesQuestion(question),
    (line) => {
      const answer = DatesAnswer.parse(line, question);
      try {
        question.check?.(answer);
        return answer;
      } catch (error) {
        answer.wipe();
        throw error;
      }
    },
    { what: "the dates" },
  );
}

// The search.

/** Date combinations between two progress lines, as recover-date writes them by default. */
export const PROGRESS_EVERY = 1000;

/** A search for the forgotten digits of the dates, with what the command line adds to it. */
export interface DateSearchRequest {
  /** The encoded seed phrase's BIP39 indexes, 0 to 2047. */
  readonly indexes: readonly number[];
  readonly dates: DatesAnswer;
  readonly mode: SeedshiftMode;
  /** The wallet, which each checksum-valid candidate is compared with; none lists them all. */
  readonly evidence?: WalletEvidence | undefined;
  /** The BIP39 passphrase of the wallet, "" for none. */
  readonly passphrase: string;
  /**
   * How many matches are kept to be shown (recover-date's --max-results), and the combinations
   * searched without asking (--max-candidates); without them, what takes up to twelve hours.
   */
  readonly limits: { readonly maxResults: number; readonly maxCandidates?: number | undefined };
  /** A candidate list to be saved: every match is kept for it, up to one more than a list holds. */
  readonly target?: CandidatesFile | undefined;
  /** A progress line after every `progressEvery` combinations, as recover-date shows them. */
  readonly report: { readonly progressEvery: number };
}

/**
 * How the command line runs a date search: progress on `progress` after every `progressEvery`
 * combinations, as recover-date writes it, `signal` from the Ctrl+C watch, and the turns of
 * Node's event loop.
 */
export function dateSearchRun(
  signal: AbortSignal,
  progressEvery: number,
  progress: ProgressLine,
): DateSearchRun {
  return {
    progressEvery,
    onProgress: ({ checked, total, matched }) =>
      progress.show(
        `Checked ${checked}/${total} date combinations; found ${matched} ${matched === 1 ? "match" : "matches"}.`,
      ),
    signal,
    turn: nodeTurn,
  };
}

/** Runs `search` with the progress of a date search on one line, closed when the search ends. */
export async function withDateProgress<T>(
  search: (progress: ProgressLine) => Promise<T>,
): Promise<T> {
  const progress = new ProgressLine();
  try {
    return await search(progress);
  } finally {
    progress.end();
  }
}

/**
 * Runs the core's search for the forgotten digits with the wallet's Bitcoin evidence, if any,
 * after saying how large it is, and shows progress. A search of more combinations than
 * `limits.maxCandidates`, or without that limit one longer than twelve hours on this computer
 * (DateSearch.plan, SearchPlan.ask), is asked for first on the private screen and needs
 * --max-candidates elsewhere. Ctrl+C is read as a key during the search's turns and stops it at
 * the next one, which cancels the command (CANCELLED). Undefined when the person chose not to
 * search.
 */
export async function searchDates(
  request: DateSearchRequest,
): Promise<DateSearchResult | undefined | Cancelled> {
  using walletCheck = walletCheckOf(request.evidence, request.passphrase);
  using search = new DateSearch({
    indexes: request.indexes,
    dates: request.dates,
    mode: request.mode,
    walletCheck,
    maxShown: request.limits.maxResults,
    keep: request.target === undefined ? 0 : LIST_KEEP,
  });
  const plan = search.plan(await search.pace(), request.limits.maxCandidates);
  if (plan.ask) {
    if (!onPrivateScreen())
      throw ERRORS.create("search-dates-refused", [
        allowedBy(plan.extent(), [["max-candidates", plan.count]]),
      ]);
    // Keys typed while the wallet check was timed do not answer this (askToSearch).
    const start = await askToSearch(plan.question(), DATES_AGAIN);
    if (start !== "yes") return start === "no" ? undefined : start;
  }
  // The size is said once, and then the time where it is told (SearchPlan.tell).
  terminalNotice(`Recovery search contains ${plan.size}.`);
  if (plan.tell) terminalNotice(plan.timeNotice());
  const result = await withDateProgress((progress) =>
    withCtrlCWatch((signal) =>
      search.run(dateSearchRun(signal, request.report.progressEvery, progress)),
    ),
  );
  // The person stopped the search with Ctrl+C.
  if (result.stopped) return CANCELLED;
  return result;
}

/**
 * The answer that changes the wallet (changeWalletAnswer), with `value`, after a search that
 * matched no phrase with the wallet given; nothing where none was given. Decode and recover-date
 * offer it so (AUD-012-ARC001).
 */
function changeWalletChoice<T>(evidence: WalletEvidence | undefined, value: T): Choice<T>[] {
  return evidence === undefined ? [] : [changeWalletAnswer(value)];
}

/** The answer No to a long date search, which asks for the dates again. */
export const DATES_AGAIN: SearchRefusal = {
  note: "type the dates again",
  quit: "types the dates again",
};

/** How reportDateMatches shows a result. */
export interface MatchesReport {
  readonly mode: SeedshiftMode;
  readonly evidence?: WalletEvidence | undefined;
  readonly maxResults: number;
}

/**
 * Shows the result as recover-date does: the heading with the mode and the number of matches,
 * then one line per shown match (its dates, its phrase and where the wallet matched). With a
 * wallet that none of the checksum-valid candidates matched, it says so.
 */
export function reportDateMatches(result: DateSearchResult, report: MatchesReport): void {
  terminalResultHeader(MATCHES_TITLE, matchFacts(result, report));
  if (result.matchCount === 0) {
    const { checksumValid: valid } = result;
    console.log(
      report.evidence !== undefined && valid > 0
        ? `None of the ${counted(valid, "checksum-valid candidate")} matched the requested ${evidenceLabel(report.evidence)}.`
        : "No candidate with a valid BIP39 checksum was found.",
    );
    return;
  }
  for (const match of result.shown) console.log(matchLine(match));
  if (result.matchCount > report.maxResults)
    terminalNotice(
      `Displayed ${report.maxResults} of ${result.matchCount} checksum-valid candidates.`,
    );
}

/** The title of the heading of reportDateMatches. */
const MATCHES_TITLE = "Date recovery";

/** The facts under the heading of reportDateMatches. */
function matchFacts(result: DateSearchResult, report: MatchesReport): [string, string][] {
  return [
    ["Phrases", `${PHRASE_WORDS.original}, for each set of dates`],
    ["Mode", report.mode],
    ["Matches", String(result.matchCount)],
  ];
}

/** A match as reportDateMatches prints it: its dates, its phrase and where the wallet matched. */
function matchLine(match: DateMatch): string {
  const where = match.evidence === undefined ? "" : `\tmatched at ${match.evidence}`;
  return `${match.dates}\t${match.mnemonic}${where}`;
}

/**
 * Whether the matches shown fit on the private screen with the lines around them, each measured
 * as it is printed: the heading and its facts (reportDateMatches), the notes (dateMatchNotes),
 * and what closes the private screen.
 */
export function matchesFitScreen(result: DateSearchResult, report: MatchesReport): boolean {
  const beside =
    rowsOf(resultHeaderLines(MATCHES_TITLE, matchFacts(result, report))) +
    rowsOf(dateMatchNoteLines(report.evidence)) +
    closingRows();
  return linesFitPrivateScreen(result.shown.map(matchLine), beside);
}

/** The note after shown matches: what a valid checksum proves, or what the wallet check did. */
export function dateMatchNotes(evidence: WalletEvidence | undefined): void {
  for (const line of dateMatchNoteLines(evidence)) console.error(line);
}

/** The lines of dateMatchNotes. */
function dateMatchNoteLines(evidence: WalletEvidence | undefined): string[] {
  return evidence === undefined
    ? [
        ...noticeLines("A valid checksum does not prove the date: compare an address."),
        moreLine("exact-local-recovery-checks"),
      ]
    : noticeLines(
        `Each displayed candidate matched the requested ${evidenceLabel(evidence)} locally.`,
      );
}

/** The answer that types the dates again, after a phrase or a part that does not fit. */
export const DATES_AGAIN_LABEL = "Type the dates again";

/** The choice that asks for the dates again, after a phrase that cannot be the right one. */
export function datesAgainChoice(): Choice<"dates"> {
  return { label: DATES_AGAIN_LABEL, value: "dates" };
}

/** The choice that asks for the encoded seed phrase once more; after a file, it is typed. */
export function backupChoice(args: ParsedArguments): Choice<"backup"> {
  return fromFile(args)
    ? { label: "Type the encoded seed phrase", note: "instead of the file", value: "backup" }
    : { label: "Type the encoded seed phrase again", value: "backup" };
}

/** What comes after a date search: a step of the command, or a search with another wallet. */
export type AfterDateSearch =
  | "dates"
  | "backup"
  | "done"
  | { readonly kind: "search"; readonly evidence: WalletEvidence | undefined };

/** What the question after a date search needs from its command. */
export interface AfterDateSearchQuestion {
  readonly evidence: WalletEvidence | undefined;
  readonly mode: SeedshiftMode;
  readonly maxResults: number;
  /** The answer that asks for the encoded seed phrase again (backupChoice). */
  readonly again: Choice<"backup">;
  /** How the wallet is asked for: why, and where it is looked for. */
  readonly wallet: { readonly explanation: Explanation; readonly place: WalletPlace };
  /** Whether a candidate list is written, which holds every match up to its limit. */
  readonly listing?: boolean;
}

/** What the person may choose after a search: a step, or a wallet to ask for first. */
type AfterSearchChoice = "dates" | "backup" | "done" | "wallet" | "change-wallet";

/**
 * Asks what to change after a date search whose result cannot be used: none matched, more than a
 * list holds, or, without a wallet, more than are shown or than fit on the screen; "done" when the
 * result is complete. A wallet asked for here is asked at once, and Escape there asks this again.
 * CANCELLED when the command is cancelled. Decode and recover-date ask it so.
 */
export async function askAfterDateSearch(
  result: DateSearchResult,
  question: AfterDateSearchQuestion,
): Promise<AfterDateSearch | Cancelled> {
  for (;;) {
    const next = await afterSearchChoice(result, question);
    if (next === CANCELLED || (next !== "wallet" && next !== "change-wallet")) return next;
    // "It cannot" only where it changes the search: in place of a wallet that matched none, where
    // the mode can list the candidates without one. Asked for a wallet that was missing, it would
    // run the same search again.
    const answer = await askWalletEvidence({
      optional: next === "change-wallet" && !walletNeeded(question.mode),
      ...question.wallet,
    });
    if (answer === CANCELLED) return CANCELLED;
    if (answer.kind === "back") continue;
    return { kind: "search", evidence: answer.kind === "wallet" ? answer.evidence : undefined };
  }
}

/** The question itself, with the answers that fit the result. */
async function afterSearchChoice(
  result: DateSearchResult,
  question: AfterDateSearchQuestion,
): Promise<AfterSearchChoice | Cancelled> {
  const done: Choice<AfterSearchChoice> = { label: "Stop", value: "done" };
  const dates: Choice<AfterSearchChoice> = { label: "Change the dates", value: "dates" };
  const checkWallet = checkWalletAnswer<AfterSearchChoice>("wallet");
  if (result.matchCount === 0)
    return askAfterFailure(WHAT_NOW, [
      dates,
      ...changeWalletChoice(question.evidence, "change-wallet" as const),
      question.again,
      done,
    ]);
  if (question.listing === true && !candidateListHolds(result.matchCount))
    return askAfterFailure(WHAT_NOW, [
      { label: "Give the wallet", note: "its fingerprint or an address", value: "wallet" },
      dates,
      { ...done, note: "no list is saved" },
    ]);
  // A list holds every match already; with a wallet, every match is one the wallet confirmed.
  if (question.listing === true || question.evidence !== undefined) return "done";
  const narrower = { ...dates, note: "fewer ? give fewer candidates" };
  if (result.matchCount > question.maxResults)
    return askAfterFailure(`Not every candidate is shown. ${WHAT_NOW}`, [
      checkWallet,
      narrower,
      { ...done, label: "Done" },
    ]);
  // The private screen keeps no scrollback: matches above its top could not be read.
  if (!matchesFitScreen(result, question))
    return askAfterFailure(`Not every candidate fits on the screen. ${WHAT_NOW}`, [
      checkWallet,
      narrower,
      { ...done, label: "Done" },
    ]);
  return "done";
}
