// recover-date: finds the forgotten digits of the dates of a Seedshift backup, with the core's date
// search (core/date-search.ts) and the questions and reports of cli/date-search.ts.
// From the command line every input is given, and one that cannot be used ends the command. With
// --ask-secrets, on the private screen, each answer is checked as soon as it is given and asked
// again, and a search without a usable result offers what to change; the other answers are kept.

import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { assertWalletEvidence, type WalletEvidence } from "../bitcoin-evidence.js";
import { parseInput, type SeedshiftMode } from "../core.js";
import { MAX_CANDIDATE_RECORDS, TooManyForList } from "../core/candidate-list.js";
import {
  DatesAnswer,
  HARD_MAX_COMBINATIONS,
  MAX_SHOWN_MATCHES,
  NARROW_DATE_SEARCH,
  walletNeeded,
  type DateSearchResult,
} from "../core/date-search.js";
import type { EncodedBackup, EncodedMode } from "../core/encoded-backup.js";
import { WORD_COUNT_SET } from "../core/words.js";
import { parseRecord } from "../record.js";
import { integerOption, type ParsedArguments, value, values } from "./arguments.js";
import {
  askAfterFailure,
  askWalletEvidence,
  assertWalletPlaceUsed,
  walletPlaceOf,
  type WalletPlace,
} from "./ask.js";
import { bip39Passphrase, walletEvidence } from "./bitcoin-options.js";
import {
  assertListable,
  candidatesTarget,
  discardCandidates,
  prepareCandidates,
  saveCandidates,
  type CandidatesTarget,
} from "./candidates-file.js";
import {
  askDates,
  askEncodedCodes,
  dateMatchNotes,
  encodedFingerprintOf,
  matchesFitScreen,
  maxCandidatesOf,
  PROGRESS_EVERY,
  recoveryDatesPrompt,
  reportDateMatches,
  searchDates,
  showEncodedFingerprint,
  typedAfterFile,
} from "./date-search.js";
import { encodedInput, inputFormat, recordedInputFormat, transformMode } from "./input.js";
import { readmeLink, terminalNotice } from "./terminal.js";
import type { Choice, Explanation } from "./terminal-choice.js";
import { InputCancelled } from "./terminal-input.js";

/**
 * Checksum-valid Seedshift gives a valid phrase for every date, so only the wallet can tell the
 * right dates: without a fingerprint, an address, a public key or a WIF there is nothing to search.
 */
function assertEvidenceGiven(mode: string, evidence: unknown): void {
  if (walletNeeded(mode as EncodedMode) && evidence === undefined)
    throw new Error(
      "This recovery mode can produce checksum-valid candidates for every date. Provide a master fingerprint, address, public key, extended public key, or WIF to identify the intended wallet.",
    );
}

/** The options of recover-date, read and checked before any question. */
interface Settings {
  readonly maxResults: number;
  readonly progressEvery: number;
  /** The combinations searched without asking (--max-candidates); without it, twelve hours. */
  readonly maxCandidates: number | undefined;
  readonly target: CandidatesTarget | undefined;
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
  const maxResults = integerOption(args, "max-results", {
    defaultValue: MAX_SHOWN_MATCHES,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const progressEvery = integerOption(args, "progress-every", {
    defaultValue: PROGRESS_EVERY,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const maxCandidates = maxCandidatesOf(args);
  const target = await candidatesTarget(args);
  // A record may name another mode or format; askEncodedBackup and recordedInputFormat settle that.
  if (value(args, "mode") !== undefined && transformMode(args) === "direct")
    throw new Error("Date recovery is available only when a Seedshift mode is selected.");
  const format = value(args, "format");
  if (format !== undefined) inputFormat(format);
  const evidence = walletEvidence(args);
  if (evidence !== undefined) assertWalletEvidence(evidence);
  // A wallet asked on the screen is looked for where the evidence given says, or at the default.
  assertWalletPlaceUsed(args, evidence);
  if (args["ask-secrets"] !== true && value(args, "mode") !== undefined) {
    // From the command line nothing can be asked later; a record names its own mode.
    assertEvidenceGiven(transformMode(args), evidence);
  }
  const passphrase = bip39Passphrase(args);
  assertListable(target, passphrase);
  return {
    maxResults,
    progressEvery,
    maxCandidates,
    target,
    evidence,
    place: walletPlaceOf(evidence, args),
    passphrase,
  };
}

export async function runRecoverDate(arguments_: ParsedArguments): Promise<void> {
  const settings = await settingsOf(arguments_);
  if (arguments_["ask-secrets"] === true) return recoverWithQuestions(arguments_, settings);
  return recoverFromOptions(arguments_, settings);
}

/** recover-date's own rule: a date without a forgotten digit is no search. */
function requireIncompleteDate(dates: DatesAnswer): void {
  if (!dates.hasForgottenDigits)
    throw new Error("At least one date must contain a forgotten digit represented by ?.");
}

/** Every input from the options, as before --ask-secrets existed; a problem ends the command. */
async function recoverFromOptions(args: ParsedArguments, settings: Settings): Promise<void> {
  const rawEncoded = await encodedInput(args);
  const record = parseRecord(rawEncoded);
  if (record?.mode === "direct")
    throw new Error("Date recovery is available only for records created with Seedshift.");
  const mode = transformMode(args, record?.mode);
  if (mode === "direct")
    throw new Error("Date recovery is available only when a Seedshift mode is selected.");
  assertEvidenceGiven(mode, settings.evidence);
  const encoded = record?.payload ?? rawEncoded;
  const format = await recordedInputFormat(args, encoded, record);
  const indexes = parseInput(encoded, format);
  if (!WORD_COUNT_SET.has(indexes.length))
    throw new Error("Expected 12, 15, 18, 21, or 24 word indexes.");
  const dateValues = values(args, "date");
  if (dateValues.length === 0)
    throw new Error("Provide dates, including at least one pattern containing ? digits.");
  const dates = DatesAnswer.parse(dateValues.join(" "), {
    wordCount: indexes.length,
    patterns: true,
  });
  requireIncompleteDate(dates);
  const { combinations } = dates;
  if (settings.maxCandidates !== undefined && combinations > settings.maxCandidates) {
    const formatted = combinations.toLocaleString("en-US");
    throw new Error(
      `The date patterns produce ${formatted} combinations. Increase the candidate search limit to at least ${formatted} to continue.`,
    );
  }
  await prepareCandidates(settings.target, settings.passphrase);
  const result = await search(indexes, dates, mode, settings.evidence, settings);
  // Asked on the private screen whether to make a search longer than allowed, the person said no.
  if (result === undefined) {
    if (settings.target !== undefined) discardCandidates(settings.target);
    throw new InputCancelled();
  }
  reportDateMatches(result, { mode, evidence: settings.evidence, maxResults: settings.maxResults });
  if (result.matchCount === 0) {
    if (settings.target !== undefined) await saveCandidates(settings.target, []);
    return;
  }
  if (settings.target !== undefined) {
    if (result.matchCount > MAX_CANDIDATE_RECORDS) throw new TooManyForList(NARROW_DATE_SEARCH);
    await saveList(settings, result);
  }
  dateMatchNotes(settings.evidence);
}

/**
 * The search of recover-date with its settings; undefined when the person chose not to make a
 * search longer than allowed (searchDates).
 */
function search(
  indexes: readonly number[],
  dates: DatesAnswer,
  mode: SeedshiftMode,
  evidence: WalletEvidence | undefined,
  settings: Settings,
): Promise<DateSearchResult | undefined> {
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

/** Saves every match as a candidate list. */
async function saveList(settings: Settings, result: DateSearchResult): Promise<void> {
  await saveCandidates(
    settings.target!,
    result.kept.map((phrase) => mnemonicToEntropy(phrase, wordlist)),
    settings.passphrase,
  );
}

/** Why the wallet is asked for on the private screen, shown with the question. */
const WALLET_EXPLANATION: Explanation = {
  lines: ["Each guessed date gives a valid phrase; the wallet tells which is yours."],
  more: [readmeLink("date-recovery-helper")],
};

/** What is asked next on the private screen. */
type Step = "backup" | "dates" | "wallet" | "search" | "done";

/**
 * The answers of a recovery on the private screen, asked in this order, each checked at once: the
 * encoded seed phrase and what can be checked before the dates (askEncodedCodes), after which its
 * encoded fingerprint is shown, as decode shows it, so that a mistyped code shows before a long
 * search; the dates, the wallet when the mode needs it and no option gave it, then the search.
 * After a search without a usable result the person chooses what to change; every other answer is
 * kept.
 */
async function recoverWithQuestions(args: ParsedArguments, settings: Settings): Promise<void> {
  if (value(args, "input") !== undefined || values(args, "date").length > 0)
    throw new Error(
      "--ask-secrets cannot be combined with direct encoded text or command-line dates.",
    );
  let backupArgs = args;
  let backup: EncodedBackup | undefined;
  // The mode that a record header named, for codes typed after it without one.
  let recordMode: EncodedMode | undefined;
  let dates: DatesAnswer | undefined;
  let evidence = settings.evidence;
  // Whether the list was saved, and how many matched the last search, for a list that was not.
  let listed = false;
  let lastMatches = 0;
  for (let step: Step = "backup"; step !== "done";) {
    if (step === "backup") {
      const read = await askEncodedCodes({ args: backupArgs, seedshiftOnly: true, recordMode });
      backup = read.backup;
      recordMode = read.recordMode ?? recordMode;
      showEncodedFingerprint(encodedFingerprintOf(backup));
      // Dates kept from before still count if the new phrase takes as many.
      step = dates?.fitsPhrase(backup.indexes.length) === true ? "wallet" : "dates";
    } else if (step === "dates") {
      dates = await askRecoveryDates(backup!);
      step = "wallet";
    } else if (step === "wallet") {
      if (evidence !== undefined || !walletNeeded(backup!.mode)) step = "search";
      else {
        const answer = await askWalletEvidence({
          optional: false,
          explanation: WALLET_EXPLANATION,
          place: settings.place,
        });
        if (answer.kind === "wallet") evidence = answer.evidence;
        step = answer.kind === "back" ? "dates" : "search";
      }
    } else {
      const mode = backup!.mode as SeedshiftMode;
      await prepareCandidates(settings.target, settings.passphrase);
      const result = await search(backup!.indexes, dates!, mode, evidence, settings);
      // A search longer than allowed that the person did not want: the dates are typed again.
      if (result === undefined) {
        step = "dates";
        continue;
      }
      reportDateMatches(result, { mode, evidence, maxResults: settings.maxResults });
      const listable = settings.target === undefined || result.matchCount <= MAX_CANDIDATE_RECORDS;
      lastMatches = result.matchCount;
      if (result.matchCount > 0 && listable) {
        if (settings.target !== undefined) await saveList(settings, result);
        listed = true;
        dateMatchNotes(evidence);
      } else if (!listable)
        terminalNotice(new TooManyForList(NARROW_DATE_SEARCH).message, "warning");
      for (;;) {
        const next = await nextStep(result, evidence, settings);
        if (next !== "wallet" && next !== "change-wallet") {
          step = next;
          break;
        }
        // "It cannot" only where it changes the search: in place of a wallet that matched none,
        // where the mode can list the candidates without one. Asked for a wallet that was
        // missing, it would run the same search again.
        const answer = await askWalletEvidence({
          optional: next === "change-wallet" && !walletNeeded(mode),
          explanation: WALLET_EXPLANATION,
          place: settings.place,
        });
        if (answer.kind === "back") continue;
        evidence = answer.kind === "wallet" ? answer.evidence : undefined;
        step = "search";
        break;
      }
      // The same file would give the same phrase: it is typed this time, and its mode asked again
      // unless --mode or a record named it.
      if (step === "backup") backupArgs = typedAfterFile(args);
    }
  }
  if (settings.target === undefined || listed) return;
  if (lastMatches === 0) await saveCandidates(settings.target, []);
  else discardCandidates(settings.target);
}

/** Asks for the dates with ? until they can be used. */
async function askRecoveryDates(backup: EncodedBackup): Promise<DatesAnswer> {
  const wordCount = backup.indexes.length;
  return askDates({
    wordCount,
    patterns: true,
    prompt: recoveryDatesPrompt(wordCount),
    check: requireIncompleteDate,
  });
}

/**
 * What comes after a search: a step, or "change-wallet", which asks for another wallet in place
 * of one that matched none, as "wallet" asks for one that was not given.
 */
type AfterSearch = Exclude<Step, "search"> | "change-wallet";

/**
 * What the person changes after a result that cannot be used: none matched, more than a list
 * holds, or, without a wallet, more than are shown or than fit on the screen. "done" when the
 * result is complete.
 */
async function nextStep(
  result: DateSearchResult,
  evidence: WalletEvidence | undefined,
  settings: Settings,
): Promise<AfterSearch> {
  const done: Choice<AfterSearch> = { label: "Stop", value: "done" };
  const dates: Choice<AfterSearch> = { label: "Change the dates", value: "dates" };
  if (result.matchCount === 0) {
    const wallet: Choice<AfterSearch>[] =
      evidence === undefined
        ? []
        : [
            {
              label: "Change the wallet",
              note: "the fingerprint or the address",
              value: "change-wallet",
            },
          ];
    const again: Choice<AfterSearch> = {
      label: "Type the encoded seed phrase again",
      value: "backup",
    };
    return askAfterFailure("What now?", [dates, ...wallet, again, done]);
  }
  if (settings.target !== undefined && result.matchCount > MAX_CANDIDATE_RECORDS)
    return askAfterFailure("What now?", [
      { label: "Give the wallet", note: "its fingerprint or an address", value: "wallet" },
      dates,
      { ...done, note: "no list is saved" },
    ]);
  // A list holds every match already; without one, the wallet picks those to show.
  if (
    settings.target === undefined &&
    evidence === undefined &&
    result.matchCount > settings.maxResults
  )
    return askAfterFailure("Not every candidate is shown. What now?", [
      { label: "Check them against the wallet", note: "only those that match", value: "wallet" },
      { ...done, label: "Done" },
    ]);
  // The private screen keeps no scrollback: matches above its top could not be read.
  if (settings.target === undefined && evidence === undefined && !matchesFitScreen(result))
    return askAfterFailure("Not every candidate fits on the screen. What now?", [
      { label: "Check them against the wallet", note: "only those that match", value: "wallet" },
      { ...dates, note: "fewer ? give fewer candidates" },
      { ...done, label: "Done" },
    ]);
  return "done";
}
