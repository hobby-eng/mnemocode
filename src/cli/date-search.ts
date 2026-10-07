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
//   the dates, in the order of BackupReading: the record header, the record's mode against --mode
//   (offering the record's), a Shamir share typed by mistake, the format (asked when several fit;
//   Esc asks for the codes again), the codes and their count, the mode when neither a record header
//   nor --mode names it (the mode of the record read before, `recordMode`, or asked), and the
//   container checksum of the checksum-valid modes (offering the Original Seedshift instead). A file
//   that cannot be used offers another file, typing the phrase, or Stop. It returns the core's
//   EncodedBackup (core/encoded-backup.ts), which holds the codes' own rules, and the mode that a
//   record header named. typedAfterFile(args) gives the options for typing the phrase after a file.
// - showEncodedFingerprint(fingerprint): the encoded fingerprint, before the dates are asked.
// - askDates(question) asks for the dates until they fit (the core's DatesAnswer.parse).
// - searchDates(search): recover-date's search over the core's DateSearch, asked for first when it
//   takes longer than twelve hours (DateSearch.needsQuestion), with its progress lines and Ctrl+C
//   watch (dateSearchRun); it returns the matches, and every match for a candidate list.
//   reportDateMatches and dateMatchNotes show them as recover-date does; matchesFitScreen tells
//   whether they can all be read on the private screen, which keeps no scrollback.

import { isatty } from "node:tty";
import { BackupReading } from "../core/backup-reading.js";
import { MAX_CANDIDATE_RECORDS } from "../core/candidate-list.js";
import {
  DatesAnswer,
  DateSearch,
  HARD_MAX_COMBINATIONS,
  type DateMatch,
  type DateSearchResult,
  type DateSearchRun,
  type DatesRules,
} from "../core/date-search.js";
import type { SeedshiftMode } from "../core/date-recovery.js";
import { maximumDates } from "../core/dates.js";
import { RepairReport } from "../sskr/repair-report.js";
import { EncodedBackup, MissingChecksum, type EncodedMode } from "../core/encoded-backup.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";
import type { Bip39WordCount } from "../core/types.js";
import { WORD_COUNT_SET } from "../core/words.js";
import { masterFingerprint, walletCheckOf, type WalletEvidence } from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { integerOption, value, type ParsedArguments } from "./arguments.js";
import { askAfterFailure, askSecretUntil, askValueUntil, droppedPath } from "./ask.js";
import type { CandidatesTarget } from "./candidates-file.js";
import {
  datesPrompt,
  encodedInput,
  inputFormat,
  readBoundedTextFile,
  type EncodedFormat,
  type TransformMode,
} from "./input.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { evidenceLabel, optionLabel } from "./option-copy.js";
import { onPrivateScreen } from "./private-screen.js";
import { decodeQrPngFile } from "./qr-input.js";
import {
  ProgressLine,
  terminalColor,
  terminalHint,
  terminalMore,
  terminalNotice,
  terminalResultHeader,
  terminalStatus,
} from "./terminal.js";
import { choose, type Choice } from "./terminal-choice.js";
import {
  dropTypedAhead,
  InputCancelled,
  rowsOfOutputLine,
  terminalColumns,
  terminalRows,
  withCtrlCWatch,
} from "./terminal-input.js";

// The core's limits, rule and types, under the names that the commands and their tests use.
export { HARD_MAX_COMBINATIONS, MAX_INCOMPLETE_DATES, walletNeeded } from "../core/date-search.js";
export type { DateMatch, DateSearchResult, DatesRules } from "../core/date-search.js";

/**
 * --max-candidates: how many combinations a search may try without asking, the dates times the
 * codes or phrases they are tried with; undefined, without it, asks after 12 hours of work.
 */
export function maxCandidatesOf(args: ParsedArguments): number | undefined {
  if (args["max-candidates"] === undefined) return undefined;
  return integerOption(args, "max-candidates", { min: 1, max: HARD_MAX_COMBINATIONS });
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
  readonly recordMode?: EncodedMode | undefined;
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
export type InputKind = "codes" | "share";

/** --input-kind, checked before the first question. */
export function inputKindOf(args: ParsedArguments): InputKind | undefined {
  const given = value(args, "input-kind");
  if (given === undefined || given === "codes" || given === "share") return given;
  throw new Error("--input-kind must be codes or share.");
}

/** An encoded seed phrase as askEncodedBackup read it, with the mode its record named, if any. */
export interface ReadCodes {
  readonly kind: "codes";
  readonly backup: EncodedBackup;
  readonly recordMode: EncodedMode | undefined;
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
      readonly recordMode: EncodedMode | undefined;
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
  if (terminalColor("stderr")) {
    terminalStatus(PHRASE_WORDS.encodedFingerprint, fingerprint);
    terminalHint("Fingerprint uses an empty BIP39 passphrase.");
  } else
    console.error(
      `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${fingerprint}`,
    );
}

/** The encoded fingerprint of `backup` with Node's PBKDF2 (masterFingerprint). */
export function encodedFingerprintOf(backup: EncodedBackup): string | undefined {
  return backup.fingerprint(masterFingerprint);
}

/** Where the encoded seed phrase comes from: typed, or a file read again after a problem. */
class BackupSource {
  private typed: boolean;
  private readonly qr: boolean;
  private reads = 0;

  constructor(private readonly args: ParsedArguments) {
    this.qr = value(args, "qr-file") !== undefined;
    this.typed = !this.qr && value(args, "input-file") === undefined;
  }

  /** Whether the text read last came from a QR code image. */
  get readsQr(): boolean {
    return !this.typed && this.qr;
  }

  /** The choice that asks for the phrase again, for the questions after a problem. */
  againChoice(): Choice<"again"> {
    return this.typed
      ? { label: "Type the encoded seed phrase again", value: "again" }
      : { label: "Read another file", note: "or type the encoded seed phrase", value: "again" };
  }

  /** The text of the next attempt; `problem`, shown first, is why the last one could not be used. */
  async next(problem: string | undefined): Promise<string> {
    if (this.typed) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      return askSecretUntil("Encoded seed phrase or record:", recordText, {
        what: "the encoded seed phrase or its record",
      });
    }
    if (this.reads === 0) {
      this.reads += 1;
      try {
        return await encodedInput(this.args);
      } catch (error) {
        problem = refusal(error);
      }
    }
    return this.otherSource(problem);
  }

  /** After a file could not be used: another file, the phrase typed instead, or Stop. */
  private async otherSource(problem: string | undefined): Promise<string> {
    for (;;) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      problem = undefined;
      const next = await askAfterFailure("What now?", [
        { label: "Read another file", value: "file" },
        { label: "Type the encoded seed phrase", note: "or paste it", value: "typed" },
        { label: "Stop", value: "stop" },
      ] as const);
      if (next === "stop") throw new InputCancelled();
      if (next === "typed") {
        this.typed = true;
        return this.next(undefined);
      }
      const text = await askValueUntil(
        this.qr ? "QR code file name:" : "Record file name:",
        (answer) => {
          const path = droppedPath(answer);
          return this.qr ? decodeQrPngFile(path) : readBoundedTextFile(path, "The file");
        },
        { what: "the name of the file" },
      );
      if (text !== undefined) return text;
    }
  }
}

/** The warning for a refused answer or file; InputCancelled and other throws pass through. */
function refusal(error: unknown): string {
  if (error instanceof InputCancelled || !(error instanceof Error)) throw error;
  return error.message;
}

/** A typed answer whose record header, if it has one, can be read. */
function recordText(text: string): string {
  try {
    parseRecord(text);
  } catch (error) {
    const message = refusal(error);
    // Typing it again cannot help here; the message says so.
    if (message.startsWith("Unsupported MnemoCode record version"))
      throw new Error(`${message} A newer MnemoCode reads it.`, { cause: error });
    throw error;
  }
  return text;
}

/** A further attempt, with why the last one could not be used, if anything is to be said. */
interface Again {
  readonly again: string | undefined;
}

/** Where the person reads Shamir shares, for a share typed in place of the codes. */
const SHARE_READER = MENU_ENTRY_NAMES.restore.label;

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
    });
  } catch (error) {
    return { again: refusal(error) };
  }
  const settled = await settledMode(reading, question, source);
  if (settled === undefined) return { again: undefined };
  if (reading.marked) return markedBackup(reading, settled, question, source);
  const format = await settledFormat(reading, question.args, source);
  if (typeof format !== "string") return format;
  let codes: EncodedBackup;
  try {
    // Read first as not masked, which has no rule beyond the codes and their count: codes that
    // name no mode are asked about only once they are known to be a phrase's.
    codes = reading.codes(format);
  } catch (error) {
    return { again: refusal(error) };
  }
  const mode = settled === "ask" ? await askedMode(question.seedshiftOnly) : settled;
  if (mode === undefined) return { again: undefined };
  const recordMode = reading.mode();
  try {
    return { kind: "codes", backup: codes.withMode(mode), recordMode };
  } catch (error) {
    if (!(error instanceof MissingChecksum)) throw error;
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
  settled: TransformMode | "ask",
  question: BackupQuestion,
  source: BackupSource,
): Promise<ReadBackup | Again> {
  if (question.marks !== true)
    return { again: "Every code is needed here: Decode searches codes marked with ?." };
  const format = await settledFormat(reading, question.args, source, true);
  if (typeof format !== "string") return format;
  let codes: MissingCodes;
  try {
    codes = reading.missingCodes(format);
  } catch (error) {
    return { again: refusal(error) };
  }
  const mode = settled === "ask" ? await askedMode(question.seedshiftOnly) : settled;
  if (mode === undefined) return { again: undefined };
  return { kind: "missing", codes: codes.withMode(mode), recordMode: reading.mode() };
}

/** The variants of Seedshift that the menu offers, for codes that name none. */
const SEEDSHIFT_CHOICES: readonly Choice<TransformMode>[] = [
  {
    label: "MnemoCode Seedshift",
    note: "a valid BIP39 seed phrase again; recommended",
    value: "seedshift",
  },
  {
    label: "Original Seedshift",
    note: "as the original program; checksum usually fails",
    value: "seedshift-legacy",
  },
];

/**
 * The mode of the codes: the record's, which wins over another --mode when the person agrees, or
 * --mode, or the mode of the record read before; "ask" when none names it. Undefined asks for the
 * codes again.
 */
async function settledMode(
  reading: BackupReading,
  question: BackupQuestion,
  source: BackupSource,
): Promise<TransformMode | "ask" | undefined> {
  const given = value(question.args, "mode") as TransformMode | undefined;
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

/** The answer for codes that were not masked, where they may not have been. */
const NO_SEEDSHIFT: Choice<TransformMode> = {
  label: "No",
  note: "the codes stand for the words themselves",
  value: "direct",
};

/**
 * How codes that name no mode were masked: which Seedshift, or, unless `seedshiftOnly`, whether
 * one was used at all, after saying that no record header names it. Undefined (Escape) asks for
 * the codes again.
 */
async function askedMode(seedshiftOnly: boolean): Promise<TransformMode | undefined> {
  if (!seedshiftOnly)
    terminalNotice(
      "These codes have no MNC1 record header, so they do not say how they were made.",
    );
  await dropTypedAhead();
  return choose(
    seedshiftOnly ? "Which Seedshift was used?" : "Was Seedshift used when it was encoded?",
    seedshiftOnly ? SEEDSHIFT_CHOICES : [NO_SEEDSHIFT, ...SEEDSHIFT_CHOICES],
    { label: "Seedshift", quit: "asks for the codes again" },
  );
}

/** The format numbers of the menu and of --format. */
const FORMAT_DIGITS: Readonly<Record<EncodedFormat, number>> = {
  english: 1,
  indexes: 2,
  unicode: 3,
  "colors-unicode": 4,
  colors: 5,
};

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
  const option = value(args, "format");
  const given = option === undefined ? undefined : inputFormat(option);
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
  if (fitting.length > 1) await dropTypedAhead();
  const format =
    fitting.length === 1
      ? fitting[0]
      : await choose(
          "The input fits more than one format. Which format was recorded?",
          fitting.map((format) => ({ label: format, digit: FORMAT_DIGITS[format], value: format })),
          { label: "Format", quit: "asks for the codes again" },
        );
  if (format === undefined) return { again: undefined };
  terminalNotice(`Detected input format: ${format}.`);
  return format;
}

// The dates.

/** "up to N, " for a phrase of `wordCount` words; nothing when the count is not known yet. */
function mostDates(wordCount: number | undefined): string {
  return wordCount === undefined || !WORD_COUNT_SET.has(wordCount)
    ? ""
    : `up to ${maximumDates(wordCount as Bip39WordCount)}, `;
}

/** The question for dates that may hold ?, as recover-date asks it. */
export function recoveryDatesPrompt(wordCount: number | undefined): string {
  return `Dates with ? for what is forgotten (${mostDates(wordCount)}one to three of them incomplete):`;
}

/** The question for dates: with ? where `patterns` allows it, otherwise as Encode asks. */
export function datesQuestion(rules: DatesRules): string {
  return rules.patterns
    ? `Dates (${mostDates(rules.wordCount)}DD-MM-YYYY, ? for what is forgotten, separated by spaces):`
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

/** One more match than a list holds is kept, so that a search can tell that they are too many. */
export const KEPT_FOR_LIST = MAX_CANDIDATE_RECORDS + 1;

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
  readonly target?: CandidatesTarget | undefined;
  /** A progress line after every `progressEvery` combinations, as recover-date shows them. */
  readonly report: { readonly progressEvery: number };
}

/** The next turn of Node's event loop, after the input that waits, such as Ctrl+C read as a key. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
    onProgress: ({ checked, combinations, matchCount }) =>
      progress.show(
        `Checked ${checked}/${combinations} date combinations; found ${matchCount} ${matchCount === 1 ? "match" : "matches"}.`,
      ),
    signal,
    turn: nextTurn,
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

/** A search expected to take at least this long has its time said before it starts. */
const TIMED_SEARCH_SECONDS = 60;

/**
 * Runs the core's search for the forgotten digits with the wallet's Bitcoin evidence, if any,
 * after saying how large it is, and shows progress. A search of more combinations than
 * `limits.maxCandidates`, or without that limit one longer than twelve hours on this computer
 * (DateSearch.needsQuestion), is asked for first on the private screen and needs
 * --max-candidates elsewhere. Ctrl+C is read as a key during the search's turns and stops it at
 * the next one (InputCancelled). Undefined when the person chose not to search.
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
    keep: request.target === undefined ? 0 : KEPT_FOR_LIST,
  });
  const { combinations } = search;
  const pace = await search.pace();
  const seconds = search.estimatedSeconds(pace);
  const time = seconds >= 1 ? `, ${RepairReport.duration(seconds)}` : "";
  const size = RepairReport.counted(combinations, "date combination");
  if (search.needsQuestion(pace, request.limits.maxCandidates)) {
    if (!onPrivateScreen())
      throw new Error(
        `The search tries ${size}${time}. Allow it with --max-candidates ${combinations}.`,
      );
    // Keys typed while the wallet check was timed must not answer this.
    await dropTypedAhead();
    const start = await choose(
      `Search ${size}${time}?`,
      [
        { label: "Yes", note: "Ctrl+C stops it", value: true },
        { label: "No", note: "type the dates again", value: false },
      ],
      { label: "Search", quit: "types the dates again" },
    );
    if (start !== true) return undefined;
  }
  terminalNotice(
    `Recovery search contains ${combinations.toLocaleString("en-US")} date combinations.`,
  );
  if (seconds >= TIMED_SEARCH_SECONDS)
    terminalNotice(`It takes ${RepairReport.duration(seconds)}; progress is shown.`);
  return withDateProgress((progress) =>
    withCtrlCWatch((signal) =>
      search.run(dateSearchRun(signal, request.report.progressEvery, progress)),
    ),
  );
}

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
  terminalResultHeader("Date recovery", [
    ["Phrases", `${PHRASE_WORDS.original}, for each set of dates`],
    ["Mode", report.mode],
    ["Matches", String(result.matchCount)],
  ]);
  if (result.matchCount === 0) {
    const { checksumValid: valid } = result;
    console.log(
      report.evidence !== undefined && valid > 0
        ? `None of the ${valid.toLocaleString("en-US")} checksum-valid ${valid === 1 ? "candidate" : "candidates"} matched the requested ${evidenceLabel(report.evidence)}.`
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

/** A match as reportDateMatches prints it: its dates, its phrase and where the wallet matched. */
function matchLine(match: DateMatch): string {
  const where = match.evidence === undefined ? "" : `\tmatched at ${match.evidence}`;
  return `${match.dates}\t${match.mnemonic}${where}`;
}

/**
 * The rows that the screen shows with the matches of a search without a wallet: the blank line,
 * the heading and its two facts (reportDateMatches), the two lines of dateMatchNotes, and the
 * blank line and "Press Enter to clear this screen." that end the private screen.
 */
const ROWS_BESIDE_MATCHES = 8;

/**
 * Whether the matches shown fit on the private screen with the lines around them: that screen
 * keeps no scrollback, so a match that scrolled off its top could not be read. Standard output in
 * a file or a pipe takes every match, as the main screen does with its scrollback.
 */
export function matchesFitScreen(result: DateSearchResult): boolean {
  if (!onPrivateScreen() || !isatty(1)) return true;
  const columns = terminalColumns();
  const rows = result.shown.reduce(
    (total, match) => total + rowsOfOutputLine(matchLine(match), columns),
    ROWS_BESIDE_MATCHES,
  );
  return rows <= terminalRows();
}

/** The note after shown matches: what a valid checksum proves, or what the wallet check did. */
export function dateMatchNotes(evidence: WalletEvidence | undefined): void {
  if (evidence === undefined) {
    terminalNotice("A valid checksum does not prove the date: compare an address.");
    terminalMore("exact-local-recovery-checks");
  } else
    terminalNotice(
      `Each displayed candidate matched the requested ${evidenceLabel(evidence)} locally.`,
    );
}
