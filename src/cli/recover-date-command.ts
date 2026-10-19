// recover-date: finds the forgotten digits of the dates of a Seedshift backup, with the core's date
// search (core/date-search.ts) and the questions and reports of cli/date-search.ts.
// From the command line every input is given, and one that cannot be used ends the command. With
// --ask-secrets, on the private screen, each answer is checked as soon as it is given and asked
// again, and a search without a usable result offers what to change; the other answers are kept.

import { Masking } from "../core/masking.js";
import { type WalletEvidence } from "../bitcoin-evidence.js";
import { type SeedshiftMode } from "../core.js";
import { candidateListHolds, TooManyForListError } from "../core/candidate-list.js";
import {
  DatesAnswer,
  NARROW_DATE_SEARCH,
  walletNeeded,
  type DateSearchResult,
} from "../core/date-search.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import { integerOption, type ParsedArguments, value } from "./arguments.js";
import { askWalletEvidence } from "./ask.js";
import { type WalletPlace, givenWallet } from "./bitcoin-options.js";
import { CandidatesFile } from "./candidates-file.js";
import {
  askDates,
  dateMatchNotes,
  maxCandidatesOf,
  PROGRESS_EVERY,
  recoveryDatesPrompt,
  reportDateMatches,
  searchDates,
  walletExplanation,
  maxResultsOf,
  askAfterDateSearch,
  backupChoice,
} from "./date-search.js";
import {
  askEncodedCodes,
  encodedFingerprintOf,
  showEncodedFingerprint,
  typedAfterFile,
} from "./backup-questions.js";
import {
  assertAskedEncodedInput,
  givenInputFormat,
  backupFromOptions,
  transformMode,
  dateInputText,
} from "./input.js";
import { terminalNotice } from "./terminal.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { counting } from "../core/search-plan.js";
import type { MaskingMode } from "../core/types.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.recover-date-command", {
  "recovery-mode-can-produce-checksum-valid-candidates-every": () =>
    "This recovery mode can produce checksum-valid candidates for every date. Provide a master fingerprint, address, public key, extended public key, or WIF to identify the intended wallet.",
  "seedshift-mode-only": () => SEEDSHIFT_MODE_ONLY,
  "provide-dates-including-at-least-one-pattern-containing": () =>
    "Provide dates, including at least one pattern containing ? digits.",
  "date-patterns-produce-combinations-increase-candidate-search-limit": (
    value0: string,
    value1: string,
  ) =>
    `The date patterns produce ${value0} combinations. Increase the candidate search limit to at least ${value1} to continue.`,
});

/**
 * Checksum-valid Seedshift gives a valid phrase for every date, so only the wallet can tell the
 * right dates: without a fingerprint, an address, a public key or a WIF there is nothing to search.
 */
function assertEvidenceGiven(mode: MaskingMode, evidence: unknown): void {
  if (walletNeeded(mode) && evidence === undefined)
    throw ERRORS.create("recovery-mode-can-produce-checksum-valid-candidates-every", []);
}

/** The options of recover-date, read and checked before any question. */
interface Settings {
  readonly maxResults: number;
  readonly progressEvery: number;
  /** The combinations searched without asking (--max-candidates); without it, twelve hours. */
  readonly maxCandidates: number | undefined;
  readonly target: CandidatesFile | undefined;
  readonly evidence: WalletEvidence | undefined;
  /** Where a wallet asked on the private screen is looked for: as the one given, if any. */
  readonly place: WalletPlace;
  readonly passphrase: string;
}

/**
 * Reads and checks every option before the first question, so that no answer is lost to an option
 * that cannot be used: the limits, the list, the mode and the format given, the wallet's evidence
 * and where it is looked for, and the BIP39 passphrase file.
 */
async function settingsOf(args: ParsedArguments): Promise<Settings> {
  const maxResults = maxResultsOf(args);
  const progressEvery = integerOption(args, "progress-every", {
    defaultValue: PROGRESS_EVERY,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const maxCandidates = maxCandidatesOf(args);
  const target = await CandidatesFile.of(args);
  try {
    // A record may name another mode or format; askEncodedCodes and backupFromOptions settle that.
    if (value(args, "mode") !== undefined && !Masking.isMaskedMode(transformMode(args)))
      throw ERRORS.create("seedshift-mode-only", []);
    givenInputFormat(args);
    const { evidence, place, passphrase } = givenWallet(args);
    if (args["ask-secrets"] !== true && value(args, "mode") !== undefined) {
      // From the command line nothing can be asked later; a record names its own mode.
      assertEvidenceGiven(transformMode(args), evidence);
    }
    target?.assertListable(passphrase);
    return {
      maxResults,
      progressEvery,
      maxCandidates,
      target,
      evidence,
      place,
      passphrase,
    };
  } catch (error) {
    target?.wipe();
    throw error;
  }
}

/** Why recover-date refuses a mode given or chosen: only a masked phrase has dates to search. */
const SEEDSHIFT_MODE_ONLY = "Date recovery is available only when a Seedshift mode is selected.";

/** Searches the forgotten digits of the dates; CANCELLED when the person cancelled. */
export async function runRecoverDate(arguments_: ParsedArguments): Promise<Cancelled | undefined> {
  const settings = await settingsOf(arguments_);
  try {
    if (arguments_["ask-secrets"] === true) return await recoverWithQuestions(arguments_, settings);
    return await recoverFromOptions(arguments_, settings);
  } finally {
    settings.target?.wipe();
  }
}

/** The standalone search's refusal belongs to the date answer, shared with browser hosts. */
function requireIncompleteDate(dates: DatesAnswer): void {
  dates.assertIncomplete();
}

/**
 * Every input from the options, as before --ask-secrets existed; a problem ends the command.
 * CANCELLED when the person left a question of the private screen: the form of the codes, the
 * passphrase of the list, or a search longer than allowed, which ends it too.
 */
async function recoverFromOptions(
  args: ParsedArguments,
  settings: Settings,
): Promise<Cancelled | undefined> {
  const read = await backupFromOptions(args, true);
  if (read === CANCELLED) return CANCELLED;
  using backup = read.backup;
  const { mode } = read;
  if (!Masking.isMaskedMode(mode)) throw ERRORS.create("seedshift-mode-only", []);
  assertEvidenceGiven(mode, settings.evidence);
  const indexes = backup.indexes;
  const dateValues = dateInputText(args);
  if (dateValues.length === 0)
    throw ERRORS.create("provide-dates-including-at-least-one-pattern-containing", []);
  using dates = DatesAnswer.parse(dateValues, {
    wordCount: indexes.length,
    patterns: true,
  });
  requireIncompleteDate(dates);
  const { combinations } = dates;
  if (settings.maxCandidates !== undefined && combinations > settings.maxCandidates) {
    const formatted = counting(combinations);
    throw ERRORS.create("date-patterns-produce-combinations-increase-candidate-search-limit", [
      `${formatted}`,
      `${formatted}`,
    ]);
  }
  if ((await settings.target?.prepare(settings.passphrase)) === CANCELLED) return CANCELLED;
  const result = await search(indexes, dates, mode, settings.evidence, settings);
  if (result === CANCELLED) return CANCELLED;
  // Asked on the private screen whether to make a search longer than allowed, the person said no.
  if (result === undefined) {
    if (settings.target !== undefined) settings.target.discard();
    return CANCELLED;
  }
  reportDateMatches(result, { mode, evidence: settings.evidence, maxResults: settings.maxResults });
  if (result.matchCount === 0) return settings.target?.saveEntropies([]);
  if (settings.target !== undefined) {
    if (!candidateListHolds(result.matchCount)) throw new TooManyForListError(NARROW_DATE_SEARCH);
    if ((await saveList(settings, result)) === CANCELLED) return CANCELLED;
  }
  dateMatchNotes(settings.evidence);
  return undefined;
}

/**
 * The search of recover-date with its settings; undefined when the person chose not to make a
 * search longer than allowed, CANCELLED when they stopped it (searchDates).
 */
function search(
  indexes: readonly number[],
  dates: DatesAnswer,
  mode: SeedshiftMode,
  evidence: WalletEvidence | undefined,
  settings: Settings,
): Promise<DateSearchResult | undefined | Cancelled> {
  return searchDates({
    indexes,
    dates,
    mode,
    evidence,
    passphrase: settings.passphrase,
    limits: { maxResults: settings.maxResults, maxCandidates: settings.maxCandidates },
    target: settings.target,
    report: { progressEvery: settings.progressEvery },
  });
}

/** Saves every match as a candidate list; CANCELLED when the person cancelled the save. */
function saveList(settings: Settings, result: DateSearchResult): Promise<Cancelled | undefined> {
  return defined(settings.target).savePhrases(result.kept, settings.passphrase);
}

/** What is asked next on the private screen. */
type Step = "backup" | "dates" | "wallet" | "search" | "done";

/**
 * The answers of a recovery on the private screen, asked in this order, each checked at once: the
 * encoded seed phrase and what can be checked before the dates (askEncodedCodes), after which its
 * encoded fingerprint is shown, as decode shows it, so that a mistyped code shows before a long
 * search; the dates, the wallet when the mode needs it and no option gave it, then the search.
 * After a search without a usable result the person chooses what to change; every other answer is
 * kept. CANCELLED when the person cancelled, at a question or by stopping the search.
 */
async function recoverWithQuestions(
  args: ParsedArguments,
  settings: Settings,
): Promise<Cancelled | undefined> {
  assertAskedEncodedInput(args);
  let backupArgs = args;
  let backup: EncodedBackup | undefined;
  // The mode that a record header named, for codes typed after it without one.
  let recordMode: MaskingMode | undefined;
  let dates: DatesAnswer | undefined;
  let evidence = settings.evidence;
  // Whether the list was saved, and how many matched the last search, for a list that was not.
  let listed = false;
  let lastMatches = 0;
  try {
    for (let step: Step = "backup"; step !== "done";) {
      if (step === "backup") {
        const read = await askEncodedCodes({ args: backupArgs, seedshiftOnly: true, recordMode });
        if (read === CANCELLED) return CANCELLED;
        backup?.wipe();
        backup = read.backup;
        recordMode = read.recordMode ?? recordMode;
        showEncodedFingerprint(encodedFingerprintOf(backup));
        // Dates kept from before still count if the new phrase takes as many.
        step = dates?.fitsPhrase(backup.indexes.length) === true ? "wallet" : "dates";
      } else if (step === "dates") {
        const asked = await askRecoveryDates(defined(backup));
        if (asked === CANCELLED) return CANCELLED;
        dates?.wipe();
        dates = asked;
        step = "wallet";
      } else if (step === "wallet") {
        if (evidence !== undefined || !walletNeeded(defined(backup).mode)) step = "search";
        else {
          const answer = await askWalletEvidence({
            optional: false,
            explanation: walletExplanation(defined(backup).mode),
            place: settings.place,
          });
          if (answer === CANCELLED) return CANCELLED;
          if (answer.kind === "wallet") evidence = answer.evidence;
          step = answer.kind === "back" ? "dates" : "search";
        }
      } else {
        const { mode } = defined(backup);
        Masking.assertMaskedMode(mode);
        if ((await settings.target?.prepare(settings.passphrase)) === CANCELLED) return CANCELLED;
        const result = await search(
          defined(backup).indexes,
          defined(dates),
          mode,
          evidence,
          settings,
        );
        if (result === CANCELLED) return CANCELLED;
        // A search longer than allowed that the person did not want: the dates are typed again.
        if (result === undefined) {
          step = "dates";
          continue;
        }
        reportDateMatches(result, { mode, evidence, maxResults: settings.maxResults });
        const listable = settings.target === undefined || candidateListHolds(result.matchCount);
        lastMatches = result.matchCount;
        if (result.matchCount > 0 && listable) {
          if (settings.target !== undefined && (await saveList(settings, result)) === CANCELLED)
            return CANCELLED;
          listed = true;
          dateMatchNotes(evidence);
        } else if (!listable)
          terminalNotice(new TooManyForListError(NARROW_DATE_SEARCH).message, "warning");
        const next = await askAfterDateSearch(result, {
          evidence,
          mode,
          maxResults: settings.maxResults,
          again: backupChoice(backupArgs),
          wallet: { explanation: walletExplanation(mode), place: settings.place },
          listing: settings.target !== undefined,
        });
        if (next === CANCELLED) return CANCELLED;
        if (typeof next === "string") step = next;
        else {
          evidence = next.evidence;
          step = "search";
        }
        // The same file would give the same phrase: it is typed this time, and its mode asked again
        // unless --mode or a record named it.
        if (step === "backup") backupArgs = typedAfterFile(args);
      }
    }
    if (settings.target === undefined || listed) return undefined;
    if (lastMatches === 0) return await settings.target.saveEntropies([]);
    settings.target.discard();
    return undefined;
  } finally {
    backup?.wipe();
    dates?.wipe();
  }
}

/** Asks for the dates with ? until they can be used; CANCELLED when the person cancelled. */
async function askRecoveryDates(backup: EncodedBackup): Promise<DatesAnswer | Cancelled> {
  const wordCount = backup.indexes.length;
  return askDates({
    wordCount,
    patterns: true,
    prompt: recoveryDatesPrompt(wordCount),
    check: requireIncompleteDate,
  });
}
