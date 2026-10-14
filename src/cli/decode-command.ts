// decode: an encoded seed phrase turned back into the words. From the command line every input is
// given, and one that cannot be used ends the command. With --ask-secrets, on the private screen,
// each answer is checked as soon as it is given and asked again (cli/date-search.ts), and the
// other answers are kept. Once the codes are checked, the fingerprint of the encoded phrase is
// shown before the dates are asked, so that a mistyped code shows before any date is typed. A
// date may hold ? for each forgotten digit: the dates are then searched with the core's date
// search, as recover-date searches them, with the wallet, which is optional where the checksum
// alone leaves only some of the dates. Options answer the questions of the private screen that are
// no secret: the wallet, the encoded fingerprint, whether to list the candidates, the limits, and
// what a text that may be a Shamir share is read as.

import { type DateShiftDate, type DecodedResult } from "../core.js";
import { walletNeeded, type DatesAnswer } from "../core/date-search.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";
import {
  masterFingerprint,
  parseMasterFingerprint,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { type ParsedArguments, value } from "./arguments.js";
import { commandOptions } from "./command-options.js";
import {
  reportFound,
  searchMissingCodes,
  type MissingCodesAnswers,
} from "./missing-codes-search.js";
import { restoreFromShare } from "./sskr-command.js";
import { askAfterFailure, askWalletEvidence, WHAT_NOW } from "./ask.js";
import { searchLimit } from "./share-repair.js";
import { WALLET_EVIDENCE_OPTIONS, type WalletPlace, givenWallet } from "./bitcoin-options.js";
import {
  askDates,
  dateMatchNotes,
  maxCandidatesOf,
  PROGRESS_EVERY,
  reportDateMatches,
  searchDates,
  walletExplanation,
  walletReason,
  maxResultsOf,
  askAfterDateSearch,
  backupChoice,
  datesAgainChoice,
} from "./date-search.js";
import {
  askEncodedBackup,
  encodedFingerprintOf,
  inputKindOf,
  showEncodedFingerprint,
  typedAfterFile,
} from "./backup-questions.js";
import {
  assertAskedEncodedInput,
  assertOneEncodedSource,
  dates,
  givenInputFormat,
  backupFromOptions,
  transformMode,
} from "./input.js";
import { clearPrivateScreen } from "./private-screen.js";
import {
  type Channel,
  terminalColor,
  terminalLine,
  terminalResultHeader,
  terminalNotice,
  terminalStatus,
} from "./terminal.js";
import type { Choice, Explanation } from "./terminal-choice.js";
import {
  CHECKSUM_INVALID,
  reportOriginalFingerprint,
  showOriginalPhrase,
} from "./fingerprint-report.js";
import type { MaskingMode, EncodedFormat } from "../core/types.js";
import { defined } from "../core/defined.js";

export async function runDecode(arguments_: ParsedArguments): Promise<void> {
  if (arguments_["ask-secrets"] === true) return decodeWithQuestions(arguments_);
  return decodeFromOptions(arguments_);
}

/**
 * The options that answer questions of the private screen only, where dates or codes may hold ?;
 * from the command line, with complete codes and dates, nothing would use them.
 */
const SCREEN_ANSWERS = [
  ...WALLET_EVIDENCE_OPTIONS,
  "encoded-fingerprint",
  "list-candidates",
  "max-candidates",
  "max-results",
  "max-tries",
  "input-kind",
] as const;

/** Every input from the options; a problem ends the command. */
async function decodeFromOptions(arguments_: ParsedArguments): Promise<void> {
  const unused = SCREEN_ANSWERS.find((key) => arguments_[key] !== undefined);
  if (unused !== undefined)
    throw new Error(
      `--${unused} answers a question of decode --ask-secrets, where the dates or the codes may hold ?.`,
    );
  const { backup, dates: enteredDates } = await backupAndDatesFromOptions(arguments_);
  if (backup.givesSeveral) showLegacyValidCandidates(backup.candidates(enteredDates));
  else {
    const result = backup.decode(enteredDates);
    showRecovered(result, backup.mode, backup.format);
    if (!result.checksumValid) reportShorterPhrases(backup, enteredDates);
  }
}

/**
 * The encoded seed phrase and its complete dates from the options, as Decode reads them; Re-encode
 * reads an old backup so. The dates are counted as soon as the mode is known, so that a wrong count
 * is refused before the form of the codes is asked about.
 */
export async function backupAndDatesFromOptions(
  args: ParsedArguments,
): Promise<{ readonly backup: EncodedBackup; readonly dates: readonly DateShiftDate[] }> {
  let enteredDates: readonly DateShiftDate[] = [];
  const { backup } = await backupFromOptions(args, false, (known) => {
    enteredDates = dates(args);
    Masking.of(known).assertDateCount(enteredDates.length);
  });
  return { backup, dates: enteredDates };
}

/**
 * Where the checksum failed, the phrases of fewer words that the first codes give with a valid
 * checksum, each by its fingerprint, never by its words: codes typed from printed cards end with
 * decoys, which --words leaves out.
 */
function reportShorterPhrases(backup: EncodedBackup, dates: readonly DateShiftDate[]): void {
  const shorter = backup.shorterPhrases(dates);
  if (shorter.length === 0) return;
  const listed = shorter
    .map(
      ({ words, result }) =>
        `${words} words, fingerprint ${masterFingerprint(result.recoveredMnemonic)}`,
    )
    .join("; ");
  terminalNotice(
    `The first codes give a phrase with a valid checksum: ${listed}. Printed cards end with codes that belong to nothing; give the number of words of the phrase (--words ${defined(shorter[0]).words}).`,
    "warning",
  );
}

/** Every phrase that a record with a replaced last word may hold, each with its fingerprint. */
function showLegacyValidCandidates(candidates: readonly DecodedResult[]): void {
  for (const [index, candidate] of candidates.entries()) {
    console.log(
      `${index + 1}\t${candidate.recoveredMnemonic}\t${masterFingerprint(candidate.recoveredMnemonic)}`,
    );
  }
  console.error(
    `Recovered ${candidates.length} checksum-valid candidates for ${PHRASE_WORDS.original}. The final column is the original BIP32 master fingerprint for an empty BIP39 passphrase.`,
  );
}

/** The recovered seed phrase, its checksum and, when the checksum is valid, its fingerprint. */
export function showRecovered(
  result: DecodedResult,
  mode: MaskingMode,
  format: EncodedFormat,
  channel: Channel = "stdout",
): void {
  const parts = terminalResultHeader(
    "Recovered result",
    [
      ["Mode", mode],
      ["Input format", format],
      ["Words", String(result.recoveredIndexes.length)],
    ],
    channel,
  );
  if (parts) showRecoveredParts(result, channel);
  else showRecoveredPlain(result, channel);
}

/**
 * On a terminal: the phrase under its label, numbered for writing down, then its checksum and,
 * when the checksum is valid, its fingerprint, each apart, as a restore from shares shows them.
 */
function showRecoveredParts(result: DecodedResult, channel: Channel): void {
  showOriginalPhrase(result.recoveredMnemonic, result.checksumValid, channel);
}

/** The phrase on one line, then its checksum and fingerprint, for a file or a pipe. */
function showRecoveredPlain(result: DecodedResult, channel: Channel): void {
  terminalLine(channel, result.recoveredMnemonic);
  if (terminalColor("stderr")) {
    console.error("");
    terminalStatus(
      "BIP39 checksum",
      result.checksumValid ? "valid" : CHECKSUM_INVALID,
      result.checksumValid,
    );
  } else console.error(`BIP39 checksum: ${result.checksumValid ? "valid" : CHECKSUM_INVALID}.`);
  if (result.checksumValid) reportOriginalFingerprint(result.recoveredMnemonic);
}

// On the private screen.

/**
 * Why the wallet is asked for before a search, shown with the question. Where the checksum leaves
 * only some dates, the wallet is optional, as the menu asks it for recover-date.
 */
function decodeWalletExplanation(mode: MaskingMode, passphrase: string): Explanation {
  return walletExplanation(mode, [comparedPassphrase("Decode", passphrase)]);
}

/**
 * The line of a wallet question that says which BIP39 passphrase `tool` compares the wallet with:
 * none, or that of --bip39-passphrase-file, as `passphrase` is empty or not. A wallet made with
 * another one does not match, whatever the dates.
 */
export function comparedPassphrase(tool: string, passphrase: string): string {
  return passphrase === ""
    ? `${tool} compares it without a BIP39 passphrase.`
    : `${tool} compares it with the BIP39 passphrase of --bip39-passphrase-file.`;
}

/** What is asked or done next on the private screen. */
type Step = "backup" | "dates" | "wallet" | "search" | "decode" | "done";

/** What follows a phrase that the questions decoded: the end, or the dates or the codes again. */
export type AfterDecoded = Extract<Step, "done" | "dates" | "backup">;

/**
 * What the questions of Decode are for: Decode shows the phrase they decode; Re-encode confirms it
 * and encodes it again (re-encode-command.ts), from the whole backup.
 */
export interface DecodeUse {
  /** Codes and dates with ?, and a Shamir share given for the codes, are taken and searched. */
  readonly searches: boolean;
  /** The choice that ends after a phrase whose checksum fails, beside typing again. */
  readonly stop: Choice<"done">;
  /** What follows a record that gives several phrases (EncodedBackup.givesSeveral). */
  several(backup: EncodedBackup, dates: readonly DateShiftDate[]): Promise<AfterDecoded>;
  /** What follows a phrase with a valid checksum, shown already. */
  decoded(backup: EncodedBackup, dates: readonly DateShiftDate[]): Promise<AfterDecoded>;
  /** Shows the decoded phrase: Decode's result on standard output, re-encode's on the terminal. */
  show(result: DecodedResult, mode: MaskingMode, format: EncodedFormat): void;
}

/** Decode itself: the phrase shown, a record's several phrases listed, and done. */
const DECODE: DecodeUse = {
  searches: true,
  stop: { label: "Done", note: "keep this result", value: "done" },
  async several(backup, dates) {
    showLegacyValidCandidates(backup.candidates(dates));
    return "done";
  },
  decoded: async () => "done",
  show: (result, mode, format) => showRecovered(result, mode, format),
};

/** The answers that decode's options give its questions on the private screen. */
interface GivenAnswers extends MissingCodesAnswers {
  readonly place: WalletPlace;
  /** The most matches of a date search shown. */
  readonly maxResults: number;
}

/**
 * The answers of the options, each checked before the first question, so that none is lost to a
 * wrong value: the wallet and where another is looked for, its BIP39 passphrase, the encoded
 * fingerprint, whether to list the candidates, and the limits.
 */
function givenAnswers(args: ParsedArguments): GivenAnswers {
  const { evidence, place, passphrase } = givenWallet(args);
  // Read only by a restore from shares, after a share typed here: checked now all the same.
  searchLimit(args);
  const list = args["list-candidates"] === true;
  if (list && evidence !== undefined)
    throw new Error("--list-candidates lists the candidates instead of a wallet check.");
  const fingerprint = value(args, "encoded-fingerprint");
  return {
    evidence,
    place,
    passphrase,
    encodedFingerprint: fingerprint === undefined ? undefined : parseMasterFingerprint(fingerprint),
    list,
    maxCandidates: maxCandidatesOf(args),
    maxResults: maxResultsOf(args),
  };
}

/** Decode's options that the restore from shares takes too, for a share typed for the codes. */
function handedToRestore(args: ParsedArguments): ParsedArguments {
  const taken = new Set<string>(commandOptions["sskr-combine"]);
  return Object.fromEntries(Object.entries(args).filter(([key]) => taken.has(key)));
}

/** The step after the dates: the search when a date holds ?, otherwise the decoding. */
function afterDates(dates: DatesAnswer): Step {
  return dates.hasForgottenDigits ? "wallet" : "decode";
}

/**
 * The step after the codes of `backup`: the decoding of an unmasked phrase; for a masked one, once
 * its encoded fingerprint is shown, the dates, or the step after `typedDates`, which still count
 * when the new phrase takes them.
 */
function stepAfterCodes(backup: EncodedBackup, typedDates: DatesAnswer | undefined): Step {
  if (!Masking.of(backup.mode).masked) return "decode";
  showEncodedFingerprint(encodedFingerprintOf(backup));
  return typedDates?.fitsPhrase(backup.indexes.length) === true ? afterDates(typedDates) : "dates";
}

/**
 * The answers of decode on the private screen, in this order, each checked at once: the encoded
 * seed phrase and everything that can be checked before the dates (askEncodedBackup), the dates,
 * which may hold ?, then either the decoding or, for dates with ?, the wallet (optional where the
 * mode's checksum leaves only some dates) and the search. A result that cannot be right offers
 * what to type again; every other answer is kept. `use` says what the decoded phrase is for, and
 * whether codes and dates may hold ? (DecodeUse); Decode's own by default.
 */
export async function decodeWithQuestions(
  args: ParsedArguments,
  use: DecodeUse = DECODE,
): Promise<void> {
  assertAskedEncodedInput(args);
  // The values of the options are checked before the first question, so that none is lost to them.
  assertOneEncodedSource(args);
  transformMode(args);
  givenInputFormat(args);
  const given = givenAnswers(args);
  const inputKind = inputKindOf(args);
  let backupArgs = args;
  let backup: EncodedBackup | undefined;
  // The mode that a record header named, for codes typed after it without one.
  let recordMode: MaskingMode | undefined;
  let typedDates: DatesAnswer | undefined;
  let evidence: WalletEvidence | undefined = given.evidence;
  // "It cannot" at the wallet question, or --list-candidates, kept for dates typed again; a mode
  // that needs the wallet asks for it all the same.
  let withoutWallet = given.list;
  // The dates with which the search of marked codes found them, which decode them as they are,
  // and the line that names the codes found, shown again with the result.
  let foundDates: readonly DateShiftDate[] | undefined;
  let foundCodes: (() => void) | undefined;
  for (let step: Step = "backup"; step !== "done";) {
    if (step === "backup") {
      foundDates = undefined;
      foundCodes = undefined;
      const read = await askEncodedBackup({
        args: backupArgs,
        seedshiftOnly: false,
        recordMode,
        marks: use.searches,
        shares: use.searches,
        inputKind,
      });
      // A Shamir share typed here is restored from, with its mode if Decode was given one.
      if (read.kind === "share") {
        const restore = { text: read.text, fromQr: read.fromQr };
        if ((await restoreFromShare(handedToRestore(args), restore)) === "done") return;
        // Escape at the question whether Seedshift was used: the codes are given again.
        backupArgs = typedAfterFile(args);
        continue;
      }
      recordMode = read.recordMode ?? recordMode;
      if (read.kind === "missing") {
        const outcome = await searchMissingCodes(read.codes, given);
        if (outcome.kind !== "found") {
          step = outcome.kind === "shown" ? "done" : "backup";
          if (step === "backup") backupArgs = typedAfterFile(args);
          continue;
        }
        backup = outcome.backup;
        const { codes } = read;
        const { backup: found, foundDates: dates } = outcome;
        foundCodes = () => reportFound(codes, found, dates);
        if (outcome.dates !== undefined) {
          foundDates = outcome.dates;
          step = "decode";
          continue;
        }
      } else backup = read.backup;
      step = stepAfterCodes(backup, typedDates);
    } else if (step === "dates") {
      typedDates = await askDates({
        wordCount: defined(backup).indexes.length,
        patterns: use.searches,
      });
      step = afterDates(typedDates);
    } else if (step === "wallet") {
      ({ step, evidence, withoutWallet } = await askedWallet(defined(backup), given, {
        evidence,
        withoutWallet,
      }));
    } else if (step === "search") {
      ({ step, evidence } = await searchAndShow(
        defined(backup),
        defined(typedDates),
        evidence,
        backupArgs,
        given,
      ));
      withoutWallet = evidence === undefined;
    } else {
      step = await decodeAndShow(
        defined(backup),
        foundDates ?? typedDates?.known ?? [],
        backupArgs,
        use,
        foundCodes,
      );
    }
    // The same file would give the same phrase: it is typed this time, and its mode asked again
    // unless --mode or a record named it.
    if (step === "backup") backupArgs = typedAfterFile(args);
  }
}

/**
 * The wallet before a search of dates with ?: asked unless it was given, or unless it was left out
 * before ("It cannot", or --list-candidates) and the mode needs none. The step after it, with the
 * wallet and whether it is left out.
 */
async function askedWallet(
  backup: EncodedBackup,
  given: GivenAnswers,
  known: { readonly evidence: WalletEvidence | undefined; readonly withoutWallet: boolean },
): Promise<{ step: Step; evidence: WalletEvidence | undefined; withoutWallet: boolean }> {
  const needed = walletNeeded(backup.mode);
  if (needed && given.list && known.evidence === undefined)
    terminalNotice(
      `--list-candidates does not apply here. ${walletReason(backup.mode)}`,
      "warning",
    );
  if (known.evidence !== undefined || (known.withoutWallet && !needed))
    return { ...known, step: "search" };
  const answer = await askWalletEvidence({
    optional: !needed,
    explanation: decodeWalletExplanation(backup.mode, given.passphrase),
    place: given.place,
  });
  return {
    step: answer.kind === "back" ? "dates" : "search",
    evidence: answer.kind === "wallet" ? answer.evidence : known.evidence,
    withoutWallet: answer.kind === "none",
  };
}

/**
 * Decodes with complete dates and shows the result, then does what `use` says with it. A phrase
 * without a valid checksum, which the Original Seedshift gives for a wrong date or code, offers to
 * type the dates or the codes again; `backupArgs` are the options the codes were read with.
 */
async function decodeAndShow(
  backup: EncodedBackup,
  known: readonly DateShiftDate[],
  backupArgs: ParsedArguments,
  use: DecodeUse,
  foundCodes?: () => void,
): Promise<Step> {
  const { mode, format } = backup;
  if (backup.givesSeveral) return use.several(backup, known);
  const result = backup.decode(known);
  // The result is a step of its own: the questions are cleared away.
  clearPrivateScreen();
  foundCodes?.();
  use.show(result, mode, format);
  if (result.checksumValid) return use.decoded(backup, known);
  reportShorterPhrases(backup, known);
  return askAfterFailure<Step>(WHAT_NOW, [
    ...(Masking.of(mode).masked ? [datesAgainChoice()] : []),
    backupChoice(backupArgs),
    use.stop,
  ]);
}

/** What comes after a search, and the wallet it used or the one to use next. */
interface Searched {
  readonly step: Step;
  readonly evidence: WalletEvidence | undefined;
}

/**
 * Searches the dates with ?, shows the matches as recover-date shows them, and asks what to change
 * when no match was found, or, without a wallet, when not every match is shown or the matches are
 * taller than the window. `backupArgs` are the options the codes were read with.
 */
async function searchAndShow(
  backup: EncodedBackup,
  typedDates: DatesAnswer,
  evidence: WalletEvidence | undefined,
  backupArgs: ParsedArguments,
  given: GivenAnswers,
): Promise<Searched> {
  const { mode } = backup;
  Masking.assertMaskedMode(mode);
  const { maxResults } = given;
  const result = await searchDates({
    indexes: backup.indexes,
    dates: typedDates,
    mode,
    evidence,
    passphrase: given.passphrase,
    limits: {
      maxResults,
      ...(given.maxCandidates === undefined ? {} : { maxCandidates: given.maxCandidates }),
    },
    report: { progressEvery: PROGRESS_EVERY },
  });
  // A search longer than twelve hours that the person did not want: the dates are typed again.
  if (result === undefined) return { step: "dates", evidence };
  reportDateMatches(result, { mode, evidence, maxResults });
  if (result.matchCount > 0) dateMatchNotes(evidence);
  const next = await askAfterDateSearch(result, {
    evidence,
    mode,
    maxResults,
    again: backupChoice(backupArgs),
    wallet: { explanation: decodeWalletExplanation(mode, given.passphrase), place: given.place },
  });
  return typeof next === "string"
    ? { step: next, evidence }
    : { step: "search", evidence: next.evidence };
}
