// The steps that the commands undoing Seedshift share, with the dates that the person types:
// recover-date uses all of them, and decode and sskr-combine (Restore from Shamir shares) use them
// where a date may hold ? for a forgotten digit. Every question is asked again until its answer
// can be used (ask.ts); what was answered before is kept. How a backup is read, the dates, their
// limits and the search are the library's (core/backup-reading.ts, core/encoded-backup.ts,
// core/date-search.ts); this module asks, shows and watches Ctrl+C around them.
//
// The API for the commands:
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

import { BackupReading } from "../core/backup-reading.js";
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
import { EncodedBackup, MissingChecksumError } from "../core/encoded-backup.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { Masking, PHRASE_WORDS, type MaskingMode } from "../core/masking.js";
import { masterFingerprint, walletCheckOf, type WalletEvidence } from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { integerOption, value, type ParsedArguments, choiceOption } from "./arguments.js";
import {
  askAfterFailure,
  askSecretUntil,
  askValueUntil,
  droppedPath,
  askWalletEvidence,
  changeWalletAnswer,
  checkWalletAnswer,
  WHAT_NOW,
  askOrCancel,
} from "./ask.js";
import type { CandidatesFile } from "./candidates-file.js";
import {
  datesPrompt,
  mostDates,
  encodedInput,
  givenInputFormat,
  detectedFormat,
  phraseWords,
  SHARE_READER,
} from "./input.js";
import { readBoundedTextFile } from "./text-file.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import {
  SEEDSHIFT_CHOICES,
  ENCODED_SEEDSHIFT_QUESTION,
  WHICH_SEEDSHIFT_QUESTION,
  ENCODED_SEEDSHIFT_CHOICES,
} from "./seedshift-choices.js";
import { evidenceLabel } from "./option-copy.js";
import { onPrivateScreen, closingRows } from "./private-screen.js";
import { linesFitPrivateScreen } from "./screen-fit.js";
import { decodeQrPngFile } from "./qr-input.js";
import {
  ProgressLine,
  terminalNotice,
  terminalResultHeader,
  readmeLink,
  resultHeaderLines,
  noticeLines,
  moreLine,
} from "./terminal.js";
import { choose, type Choice, type Explanation, rowsOf } from "./terminal-choice.js";
import { askToSearch, type SearchRefusal, allowedBy } from "./search-consent.js";
import { withCtrlCWatch, refusal, nodeTurn } from "./terminal-input.js";
import { counted } from "../core/search-plan.js";
import { DATE_FORMAT_TEXT } from "../core/dates.js";
import { numberWord } from "../core/prose.js";
import { type WalletPlace } from "./bitcoin-options.js";
import { reportFingerprint, plainFingerprintLine } from "./fingerprint-report.js";

// The core's limits, rule and types, under the names that the commands and their tests use.
export {
  HARD_MAX_COMBINATIONS,
  MAX_INCOMPLETE_DATES,
  walletNeeded,
  walletReason,
} from "../core/date-search.js";
import type { EncodedFormat } from "../core/types.js";
import { EncodedForm } from "../core/encoded-form.js";

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

// The encoded seed phrase, before its dates.

/** What askEncodedBackup asks for. */
export interface BackupQuestion {
  /**
   * The command's options: --input-file or --qr-file name the file to read first, --mode and
   * --format what was given; the caller has checked their values before the first question.
   */
  readonly args: ParsedArguments;
  /**
   * Only a Seedshift mode will do. The mode is asked when neither a record header nor --mode names
   * it: which Seedshift was used, or, without seedshiftOnly, whether one was used at all.
   */
  readonly seedshiftOnly: boolean;
  /**
   * The mode that the record read before named, for codes typed after it without a header: they
   * are undone as the record says rather than asked about. Never an answer given on the screen,
   * which the person may want to change by typing the codes again.
   */
  readonly recordMode?: MaskingMode | undefined;
  /** Codes marked with ? are read as codes to search (MissingCodes), as Decode searches them. */
  readonly marks?: boolean;
  /** A Shamir share given here is offered to the restore from shares, the share kept. */
  readonly shares?: boolean;
  /**
   * What a text that may be a Shamir share is read as, as --input-kind says: "share" restores from
   * it without asking, "codes" reads it as the codes; undefined asks where it is a share.
   */
  readonly inputKind?: InputKind | undefined;
}

/** What --input-kind reads a text as that may be a Shamir share. */
const INPUT_KINDS = Object.freeze(["codes", "share"] as const);
export type InputKind = (typeof INPUT_KINDS)[number];

/** --input-kind, checked before the first question. */
export function inputKindOf(args: ParsedArguments): InputKind | undefined {
  return choiceOption(args, "input-kind", INPUT_KINDS);
}

/** An encoded seed phrase as askEncodedBackup read it, with the mode its record named, if any. */
export interface ReadCodes {
  readonly kind: "codes";
  readonly backup: EncodedBackup;
  readonly recordMode: MaskingMode | undefined;
}

/**
 * What askEncodedBackup read: the codes; codes marked with ?, where the question takes them; or a
 * Shamir share that the person chose to restore from, where the question offers it.
 */
export type ReadBackup =
  | ReadCodes
  | {
      readonly kind: "missing";
      readonly codes: MissingCodes;
      readonly recordMode: MaskingMode | undefined;
    }
  /** A Shamir share, with whether it was read from a QR code image, for the restore it goes to. */
  | { readonly kind: "share"; readonly text: string; readonly fromQr: boolean };

/** Options that name the file of the encoded seed phrase, left out when it is typed again. */
const FILE_SOURCES = ["input-file", "qr-file"] as const;

/**
 * The options for typing the encoded seed phrase after it was read: without its file, which would
 * give the same phrase. --mode and --format stay; the answers given on the screen do not, so that
 * they are asked again for the codes typed.
 */
export function typedAfterFile(args: ParsedArguments): ParsedArguments {
  const typed = { ...args };
  for (const key of FILE_SOURCES) delete typed[key];
  return typed;
}

/** Whether the options name a file of the encoded seed phrase. */
export function fromFile(args: ParsedArguments): boolean {
  return FILE_SOURCES.some((key) => value(args, key) !== undefined);
}

/**
 * The encoded fingerprint of the codes, before their dates, when they form a valid BIP39 phrase
 * (EncodedBackup.fingerprint, ShareSet.fingerprint), as encode shows it: compared with the one
 * noted then, it shows a mistyped code before any date is typed. Nothing for undefined.
 */
export function showEncodedFingerprint(fingerprint: string | undefined): void {
  if (fingerprint === undefined) return;
  reportFingerprint(
    PHRASE_WORDS.encodedFingerprint,
    fingerprint,
    plainFingerprintLine("encoded", fingerprint, true),
  );
}

/** The encoded fingerprint of `backup` with Node's PBKDF2 (masterFingerprint). */
export function encodedFingerprintOf(backup: EncodedBackup): string | undefined {
  return backup.fingerprint(masterFingerprint);
}

/** Where the encoded seed phrase comes from: typed, or a file read again after a problem. */
class BackupSource {
  #typed: boolean;
  readonly #qr: boolean;
  #reads = 0;
  readonly #args: ParsedArguments;

  constructor(args: ParsedArguments) {
    this.#args = args;
    this.#qr = value(args, "qr-file") !== undefined;
    this.#typed = !this.#qr && value(args, "input-file") === undefined;
  }

  /** Whether the text read last came from a QR code image. */
  get readsQr(): boolean {
    return !this.#typed && this.#qr;
  }

  /** The choice that asks for the phrase again, for the questions after a problem. */
  againChoice(): Choice<"again"> {
    return this.#typed
      ? { label: "Type the encoded seed phrase again", value: "again" }
      : { label: "Read another file", note: "or type the encoded seed phrase", value: "again" };
  }

  /**
   * The text of the next attempt; `problem`, shown first, is why the last one could not be used.
   */
  async next(problem: string | undefined): Promise<string> {
    if (this.#typed) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      return askSecretUntil("Encoded seed phrase or record:", recordText, {
        what: "the encoded seed phrase or its record",
        hints: EncodedForm.typedWords,
      });
    }
    if (this.#reads === 0) {
      this.#reads += 1;
      try {
        return await encodedInput(this.#args);
      } catch (error) {
        problem = refusal(error);
      }
    }
    return this.#otherSource(problem);
  }

  /** After a file could not be used: another file, the phrase typed instead, or Stop. */
  async #otherSource(problem: string | undefined): Promise<string> {
    for (;;) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      problem = undefined;
      const next = await askOrCancel(WHAT_NOW, [
        { label: "Read another file", value: "file" },
        { label: "Type the encoded seed phrase", note: "or paste it", value: "typed" },
      ] as const);
      if (next === "typed") {
        this.#typed = true;
        return this.next(undefined);
      }
      const text = await askValueUntil(
        this.#qr ? "QR code file name:" : "Record file name:",
        (answer) => {
          const path = droppedPath(answer);
          return this.#qr ? decodeQrPngFile(path) : readBoundedTextFile(path, "The file");
        },
        { what: "the name of the file" },
      );
      if (text !== undefined) return text;
    }
  }
}

/**
 * A typed answer whose record header, if it has one, can be read; the record's refusal says what
 * helps, such as a newer MnemoCode for a newer version.
 */
function recordText(text: string): string {
  parseRecord(text);
  return text;
}

/** A further attempt, with why the last one could not be used, if anything is to be said. */
interface Again {
  readonly again: string | undefined;
}

/**
 * Asks for the encoded seed phrase on the private screen, or reads the file given, and checks it as
 * described at the top, until it passes; the caller asks for the dates then.
 */
export async function askEncodedBackup(question: BackupQuestion): Promise<ReadBackup> {
  const source = new BackupSource(question.args);
  for (let problem: string | undefined; ;) {
    const checked = await checkedBackup(await source.next(problem), question, source);
    if (!("again" in checked)) return checked;
    problem = checked.again;
  }
}

/** The codes alone, for a command that takes neither marks nor shares (askEncodedBackup). */
export async function askEncodedCodes(
  question: Omit<BackupQuestion, "marks" | "shares">,
): Promise<ReadCodes> {
  const read = await askEncodedBackup(question);
  if (read.kind !== "codes") throw new Error("Only complete codes are read here.");
  return read;
}

/**
 * Whether a Shamir share given in place of the codes is restored from (BackupReading.shareKind):
 * "share" restores from it, "codes" reads it as the codes after all, "again" asks for them again;
 * undefined when it is no share. A text that is surely a share goes to the restore at once, kept
 * as its first share, so that nothing makes the person read it again; only a text that may also
 * be the codes is asked about, unless --input-kind answers it.
 */
async function offeredRestore(
  text: string,
  source: BackupSource,
  inputKind: InputKind | undefined,
): Promise<"share" | "codes" | "again" | undefined> {
  const kind = BackupReading.shareKind(text);
  if (kind === undefined) return undefined;
  if (inputKind === "share") return "share";
  if (kind === "share") {
    terminalNotice(
      `These are the codes of a Shamir share: they go to "${MENU_ENTRY_NAMES.restore.label}" as its first share.`,
    );
    return "share";
  }
  return askAfterFailure(
    "These may be the codes of a Shamir share, or of the encoded seed phrase.",
    [
      {
        label: MENU_ENTRY_NAMES.restore.label,
        note: "kept as the first share",
        value: "share",
      },
      { label: "The encoded seed phrase", note: "its codes with ? are searched", value: "codes" },
      source.againChoice(),
    ] as const,
    { escape: "asks again" },
  );
}

async function checkedBackup(
  text: string,
  question: BackupQuestion,
  source: BackupSource,
): Promise<ReadBackup | Again> {
  // --input-kind codes reads every text as codes, a share among them.
  if (question.shares === true && question.inputKind !== "codes") {
    const offered = await offeredRestore(text, source, question.inputKind);
    if (offered === "share") return { kind: "share", text, fromQr: source.readsQr };
    if (offered === "again") return { again: undefined };
  }
  let reading: BackupReading;
  try {
    reading = BackupReading.of(text, {
      seedshiftOnly: question.seedshiftOnly,
      shareReader: SHARE_READER,
      words: phraseWords(question.args),
    });
  } catch (error) {
    return { again: refusal(error) };
  }
  const settled = await settledMode(reading, question, source);
  if (settled === undefined) return { again: undefined };
  if (reading.marked) return markedBackup(reading, settled, question, source);
  // Read first as not masked, which has no rule beyond the codes and their count: codes that name
  // no mode are asked about only once they are known to be a phrase's.
  const read = await codesAndMode(reading, settled, question, source, false, (format) =>
    reading.codes(format),
  );
  if ("again" in read) return read;
  const { codes, mode } = read;
  const recordMode = reading.mode();
  try {
    return { kind: "codes", backup: codes.withMode(mode), recordMode };
  } catch (error) {
    if (!(error instanceof MissingChecksumError)) throw error;
    const choice = await askAfterFailure(
      error.message,
      [{ label: "It was the Original Seedshift", value: "legacy" }, source.againChoice()] as const,
      { escape: "asks again" },
    );
    return choice === "again"
      ? { again: undefined }
      : { kind: "codes", backup: codes.withMode("seedshift-legacy"), recordMode };
  }
}

/**
 * Codes marked with ? where the question takes them, in their form and mode, as checkedBackup
 * reads complete ones; elsewhere they are asked for again, every code needed.
 */
async function markedBackup(
  reading: BackupReading,
  settled: MaskingMode | "ask",
  question: BackupQuestion,
  source: BackupSource,
): Promise<ReadBackup | Again> {
  if (question.marks !== true)
    return { again: "Every code is needed here: Decode searches codes marked with ?." };
  const read = await codesAndMode(reading, settled, question, source, true, (format) =>
    reading.missingCodes(format),
  );
  if ("again" in read) return read;
  return { kind: "missing", codes: read.codes.withMode(read.mode), recordMode: reading.mode() };
}

/**
 * The codes of `reading`, `marked` or complete, read by `read` in their settled form, with their
 * mode, `settled` or asked once they read; Again where the form, the codes or the mode are refused
 * or left with Escape.
 */
async function codesAndMode<Codes>(
  reading: BackupReading,
  settled: MaskingMode | "ask",
  question: BackupQuestion,
  source: BackupSource,
  marked: boolean,
  read: (format: EncodedFormat) => Codes,
): Promise<{ readonly codes: Codes; readonly mode: MaskingMode } | Again> {
  const format = await settledFormat(reading, question.args, source, marked);
  if (typeof format !== "string") return format;
  let codes: Codes;
  try {
    codes = read(format);
  } catch (error) {
    return { again: refusal(error) };
  }
  const mode = settled === "ask" ? await askedMode(question.seedshiftOnly) : settled;
  if (mode === undefined) return { again: undefined };
  return { codes, mode };
}

/**
 * The mode of the codes: the record's, which wins over another --mode when the person agrees, or
 * --mode, or the mode of the record read before; "ask" when none names it. Undefined asks for the
 * codes again.
 */
async function settledMode(
  reading: BackupReading,
  question: BackupQuestion,
  source: BackupSource,
): Promise<MaskingMode | "ask" | undefined> {
  const given = value(question.args, "mode") as MaskingMode | undefined;
  const conflict = reading.modeConflict(given);
  if (conflict !== undefined) {
    const named = reading.mode()!;
    const choice = await askAfterFailure(
      conflict,
      [
        { label: "As the record says", note: Masking.of(named).name, value: "record" },
        source.againChoice(),
      ] as const,
      { escape: "asks again" },
    );
    return choice === "record" ? named : undefined;
  }
  // Nothing names how these codes were made, whether typed, in a QR code or in a file without
  // the record header: taken as not masked, masked codes would be shown as the recovered seed
  // phrase. So it is asked, once the codes are known to be a phrase's; the menu, which asks
  // about Seedshift itself, passes --mode, also --mode direct for No.
  return reading.mode(given) ?? question.recordMode ?? "ask";
}

/**
 * How codes that name no mode were masked: which Seedshift, or, unless `seedshiftOnly`, whether
 * one was used at all, after saying that no record header names it. Undefined (Escape) asks for
 * the codes again.
 */
async function askedMode(seedshiftOnly: boolean): Promise<MaskingMode | undefined> {
  if (!seedshiftOnly)
    terminalNotice(
      "These codes have no MNC1 record header, so they do not say how they were made.",
    );
  return choose(
    seedshiftOnly ? WHICH_SEEDSHIFT_QUESTION : ENCODED_SEEDSHIFT_QUESTION,
    seedshiftOnly ? SEEDSHIFT_CHOICES : ENCODED_SEEDSHIFT_CHOICES,
    { label: "Seedshift", quit: "asks for the codes again" },
  );
}

/**
 * The format of the codes: the record's, --format, or the one that fits; asked when several fit.
 * Undefined, or a problem, asks for the codes again.
 */
async function settledFormat(
  reading: BackupReading,
  args: ParsedArguments,
  source: BackupSource,
  marked = false,
): Promise<EncodedFormat | Again> {
  const given = givenInputFormat(args);
  const conflict = reading.formatConflict(given);
  if (conflict !== undefined) {
    const [recorded] = reading.formats();
    const choice = await askAfterFailure(
      conflict,
      [{ label: `Read them as ${recorded!}`, value: "record" }, source.againChoice()] as const,
      { escape: "asks again" },
    );
    return choice === "record" ? recorded! : { again: undefined };
  }
  let fitting: EncodedFormat[];
  try {
    fitting = marked ? reading.markedFormats(given) : reading.formats(given);
  } catch (error) {
    return { again: refusal(error) };
  }
  // A record or --format names the format; only a detected one is announced.
  if (reading.hasRecord || given !== undefined) return fitting[0]!;
  const format = await detectedFormat(fitting, "asks for the codes again");
  return format ?? { again: undefined };
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

/** Asks for the dates on the private screen until they can be used (DatesAnswer.parse). */
export async function askDates(question: DatesQuestion): Promise<DatesAnswer> {
  return askSecretUntil(
    question.prompt ?? datesQuestion(question),
    (line) => {
      const answer = DatesAnswer.parse(line, question);
      question.check?.(answer);
      return answer;
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
 * the next one (InputCancelledError). Undefined when the person chose not to search.
 */
export async function searchDates(
  request: DateSearchRequest,
): Promise<DateSearchResult | undefined> {
  const walletCheck = walletCheckOf(request.evidence, request.passphrase);
  const search = new DateSearch({
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
      throw new Error(allowedBy(plan.extent(), [["max-candidates", plan.count]]));
    // Keys typed while the wallet check was timed do not answer this (askToSearch).
    if (!(await askToSearch(plan.question(), DATES_AGAIN))) return undefined;
  }
  // The size is said once, and then the time where it is told (SearchPlan.tell).
  terminalNotice(`Recovery search contains ${plan.size}.`);
  if (plan.tell) terminalNotice(plan.timeNotice());
  return withDateProgress((progress) =>
    withCtrlCWatch((signal) =>
      search.run(dateSearchRun(signal, request.report.progressEvery, progress)),
    ),
  );
}

/**
 * The answer that changes the wallet (changeWalletAnswer), with `value`, after a search that matched
 * no phrase with the wallet given; nothing where none was given. Decode and recover-date offer it
 * so (AUD-012-ARC001).
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
 * Decode and recover-date ask it so.
 */
export async function askAfterDateSearch(
  result: DateSearchResult,
  question: AfterDateSearchQuestion,
): Promise<AfterDateSearch> {
  for (;;) {
    const next = await afterSearchChoice(result, question);
    if (next !== "wallet" && next !== "change-wallet") return next;
    // "It cannot" only where it changes the search: in place of a wallet that matched none, where
    // the mode can list the candidates without one. Asked for a wallet that was missing, it would
    // run the same search again.
    const answer = await askWalletEvidence({
      optional: next === "change-wallet" && !walletNeeded(question.mode),
      ...question.wallet,
    });
    if (answer.kind === "back") continue;
    return { kind: "search", evidence: answer.kind === "wallet" ? answer.evidence : undefined };
  }
}

/** The question itself, with the answers that fit the result. */
async function afterSearchChoice(
  result: DateSearchResult,
  question: AfterDateSearchQuestion,
): Promise<AfterSearchChoice> {
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
