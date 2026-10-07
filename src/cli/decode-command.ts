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

import { parseInput, type DateShiftDate, type DecodedResult, type SeedshiftMode } from "../core.js";
import {
  MAX_SHOWN_MATCHES,
  walletNeeded,
  type DatesAnswer,
  type DateSearchResult,
} from "../core/date-search.js";
import type { EncodedBackup, EncodedMode } from "../core/encoded-backup.js";
import { Masking, PHRASE_WORDS } from "../core/masking.js";
import {
  assertWalletEvidence,
  masterFingerprint,
  parseMasterFingerprint,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { assertFlag, integerOption, type ParsedArguments, value, values } from "./arguments.js";
import { commandOptions } from "./command-options.js";
import {
  reportFound,
  searchMissingCodes,
  type MissingCodesAnswers,
} from "./missing-codes-search.js";
import { restoreFromShare } from "./sskr-command.js";
import {
  askAfterFailure,
  askWalletEvidence,
  assertWalletPlaceUsed,
  walletPlaceOf,
  type WalletPlace,
} from "./ask.js";
import { searchLimit } from "./share-repair.js";
import { bip39Passphrase, walletEvidence } from "./bitcoin-options.js";
import {
  askDates,
  askEncodedBackup,
  dateMatchNotes,
  encodedFingerprintOf,
  fromFile,
  inputKindOf,
  matchesFitScreen,
  maxCandidatesOf,
  PROGRESS_EVERY,
  reportDateMatches,
  searchDates,
  showEncodedFingerprint,
  typedAfterFile,
} from "./date-search.js";
import {
  assertOneEncodedSource,
  dates,
  encodedInput,
  inputFormat,
  recordedInputFormat,
  transformMode,
  type EncodedFormat,
  type TransformMode,
} from "./input.js";
import { clearPrivateScreen } from "./private-screen.js";
import {
  capitalized,
  FINGERPRINT_NOTE,
  readmeLink,
  terminalColor,
  terminalFingerprint,
  terminalHint,
  terminalPart,
  terminalPhrase,
  terminalResultHeader,
  terminalNotice,
  terminalStatus,
} from "./terminal.js";
import type { Choice, Explanation } from "./terminal-choice.js";

export async function runDecode(arguments_: ParsedArguments): Promise<void> {
  if (arguments_["ask-secrets"] === true) return decodeWithQuestions(arguments_);
  return decodeFromOptions(arguments_);
}

/**
 * The options that answer questions of the private screen only, where dates or codes may hold ?;
 * from the command line, with complete codes and dates, nothing would use them.
 */
const SCREEN_ANSWERS = [
  "scan-gap",
  "bitcoin-address",
  "coin-address",
  "coin",
  "master-xpub",
  "account-xpub",
  "compressed-public-key",
  "master-fingerprint",
  "wif-file",
  "network",
  "bitcoin-profile",
  "account",
  "branch",
  "index",
  "bip39-passphrase-file",
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
  const rawEncoded = await encodedInput(arguments_);
  const record = parseRecord(rawEncoded);
  const mode = transformMode(arguments_, record?.mode);
  const enteredDates = dates(arguments_);
  if (mode === "direct" && enteredDates.length > 0)
    throw new Error("Dates cannot be used in direct mode.");
  if (mode !== "direct" && enteredDates.length === 0)
    throw new Error(`${mode} requires at least one date.`);
  const encoded = record?.payload ?? rawEncoded;
  const format = await recordedInputFormat(arguments_, encoded, record);
  const masking = Masking.of(mode);
  const results = masking.undo(parseInput(encoded, format), enteredDates);
  if (masking.givesSeveral) showLegacyValidCandidates(results);
  else showRecovered(results[0]!, mode, format);
}

/** Every phrase that a record with a replaced last word may hold, each with its fingerprint. */
function showLegacyValidCandidates(candidates: readonly DecodedResult[]): void {
  for (const [index, candidate] of candidates.entries()) {
    console.log(
      `${index + 1}\t${candidate.recoveredMnemonic}\t${masterFingerprint(candidate.recoveredMnemonic)}`,
    );
  }
  console.error(
    `Recovered ${candidates.length} checksum-valid candidates for the original seed phrase, the wallet's. The final column is the original BIP32 master fingerprint for an empty BIP39 passphrase.`,
  );
}

/** The recovered seed phrase, its checksum and, when the checksum is valid, its fingerprint. */
function showRecovered(result: DecodedResult, mode: TransformMode, format: EncodedFormat): void {
  const parts = terminalResultHeader("Recovered result", [
    ["Mode", mode],
    ["Input format", format],
    ["Words", String(result.recoveredIndexes.length)],
  ]);
  if (parts) showRecoveredParts(result);
  else showRecoveredPlain(result);
}

/**
 * On a terminal: the phrase under its label, numbered for writing down, then its checksum and,
 * when the checksum is valid, its fingerprint, each apart, as a restore from shares shows them.
 */
function showRecoveredParts(result: DecodedResult): void {
  const phrase = result.recoveredMnemonic;
  terminalPart(capitalized(PHRASE_WORDS.original), true);
  terminalPhrase(phrase);
  console.log("");
  if (!result.checksumValid) {
    terminalStatus("BIP39 checksum", "invalid - dates or input may be wrong", false);
    return;
  }
  terminalFingerprint(
    PHRASE_WORDS.originalFingerprint,
    masterFingerprint(phrase),
    FINGERPRINT_NOTE,
  );
}

/** The phrase on one line, then its checksum and fingerprint, for a file or a pipe. */
function showRecoveredPlain(result: DecodedResult): void {
  console.log(result.recoveredMnemonic);
  if (terminalColor("stderr")) {
    console.error("");
    if (result.checksumValid) terminalStatus("BIP39 checksum", "valid");
    else terminalStatus("BIP39 checksum", "invalid - dates or input may be wrong", false);
    if (result.checksumValid) {
      terminalStatus(PHRASE_WORDS.originalFingerprint, masterFingerprint(result.recoveredMnemonic));
      terminalHint("Fingerprint uses an empty BIP39 passphrase.");
    }
  } else {
    console.error(
      result.checksumValid
        ? "BIP39 checksum: valid."
        : "BIP39 checksum: invalid — dates or input may be wrong.",
    );
    if (result.checksumValid)
      console.error(
        `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.recoveredMnemonic)}`,
      );
  }
}

// On the private screen.

/**
 * Why the wallet is asked for before a search, shown with the question. Where the checksum leaves
 * only some dates, the wallet is optional, as the menu asks it for recover-date.
 */
function walletExplanation(mode: TransformMode, passphrase: string): Explanation {
  return {
    lines: [
      walletNeeded(mode)
        ? "Each guessed date gives a valid phrase; the wallet tells which is yours."
        : "Several guessed dates may give a valid phrase; the wallet tells which is yours.",
      passphrase === ""
        ? "Decode compares it without a BIP39 passphrase."
        : "Decode compares it with the BIP39 passphrase of --bip39-passphrase-file.",
    ],
    more: [readmeLink("date-recovery-helper")],
  };
}

/** What is asked or done next on the private screen. */
type Step = "backup" | "dates" | "wallet" | "search" | "decode" | "done";

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
  const evidence = walletEvidence(args);
  if (evidence !== undefined) assertWalletEvidence(evidence);
  assertWalletPlaceUsed(args, evidence);
  // Read only by a restore from shares, after a share typed here: checked now all the same.
  searchLimit(args);
  assertFlag(args, "list-candidates");
  const list = args["list-candidates"] === true;
  if (list && evidence !== undefined)
    throw new Error("--list-candidates lists the candidates instead of a wallet check.");
  const fingerprint = value(args, "encoded-fingerprint");
  return {
    evidence,
    place: walletPlaceOf(evidence, args),
    passphrase: bip39Passphrase(args),
    encodedFingerprint: fingerprint === undefined ? undefined : parseMasterFingerprint(fingerprint),
    list,
    maxCandidates: maxCandidatesOf(args),
    maxResults: integerOption(args, "max-results", {
      defaultValue: MAX_SHOWN_MATCHES,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    }),
  };
}

/** Decode's options that the restore from shares takes too, for a share typed for the codes. */
function handedToRestore(args: ParsedArguments): ParsedArguments {
  const taken = new Set<string>(commandOptions["sskr-combine"]);
  return Object.fromEntries(Object.entries(args).filter(([key]) => taken.has(key)));
}

/** The choice that asks for the encoded seed phrase once more; after a file, it is typed. */
function backupChoice(args: ParsedArguments): Choice<"backup"> {
  return fromFile(args)
    ? { label: "Type the encoded seed phrase", note: "instead of the file", value: "backup" }
    : { label: "Type the encoded seed phrase again", value: "backup" };
}

/** The step after the dates: the search when a date holds ?, otherwise the decoding. */
function afterDates(dates: DatesAnswer): Step {
  return dates.hasForgottenDigits ? "wallet" : "decode";
}

/**
 * The answers of decode on the private screen, in this order, each checked at once: the encoded
 * seed phrase and everything that can be checked before the dates (askEncodedBackup), the dates,
 * which may hold ?, then either the decoding or, for dates with ?, the wallet (optional where the
 * mode's checksum leaves only some dates) and the search. A result that cannot be right offers
 * what to type again; every other answer is kept.
 */
async function decodeWithQuestions(args: ParsedArguments): Promise<void> {
  if (value(args, "input") !== undefined || values(args, "date").length > 0)
    throw new Error(
      "--ask-secrets cannot be combined with direct encoded text or command-line dates.",
    );
  // The values of the options are checked before the first question, so that none is lost to them.
  assertOneEncodedSource(args);
  transformMode(args);
  const format = value(args, "format");
  if (format !== undefined) inputFormat(format);
  const given = givenAnswers(args);
  const inputKind = inputKindOf(args);
  let backupArgs = args;
  let backup: EncodedBackup | undefined;
  // The mode that a record header named, for codes typed after it without one.
  let recordMode: EncodedMode | undefined;
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
        marks: true,
        shares: true,
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
      if (backup.mode === "direct") step = "decode";
      else {
        showEncodedFingerprint(encodedFingerprintOf(backup));
        // Dates kept from before still count if the new phrase takes them.
        step =
          typedDates?.fitsPhrase(backup.indexes.length) === true ? afterDates(typedDates) : "dates";
      }
    } else if (step === "dates") {
      typedDates = await askDates({ wordCount: backup!.indexes.length, patterns: true });
      step = afterDates(typedDates);
    } else if (step === "wallet") {
      const needed = walletNeeded(backup!.mode);
      if (needed && given.list && evidence === undefined)
        terminalNotice(
          "--list-candidates does not apply here: every date gives a valid phrase, so the wallet tells the right one.",
          "warning",
        );
      if (evidence !== undefined || (withoutWallet && !needed)) step = "search";
      else {
        const answer = await askWalletEvidence({
          optional: !needed,
          explanation: walletExplanation(backup!.mode, given.passphrase),
          place: given.place,
        });
        if (answer.kind === "wallet") evidence = answer.evidence;
        withoutWallet = answer.kind === "none";
        step = answer.kind === "back" ? "dates" : "search";
      }
    } else if (step === "search") {
      const searched = await searchAndShow(backup!, typedDates!, evidence, backupArgs, given);
      step = searched.step;
      evidence = searched.evidence;
      withoutWallet = evidence === undefined;
    } else {
      step = await decodeAndShow(
        backup!,
        foundDates ?? typedDates?.known ?? [],
        backupArgs,
        foundCodes,
      );
    }
    // The same file would give the same phrase: it is typed this time, and its mode asked again
    // unless --mode or a record named it.
    if (step === "backup") backupArgs = typedAfterFile(args);
  }
}

/**
 * Decodes with complete dates and shows the result. A phrase without a valid checksum, which the
 * Original Seedshift gives for a wrong date or code, offers to type the dates or the codes again;
 * `backupArgs` are the options the codes were read with.
 */
async function decodeAndShow(
  backup: EncodedBackup,
  known: readonly DateShiftDate[],
  backupArgs: ParsedArguments,
  foundCodes?: () => void,
): Promise<Step> {
  const { mode, format } = backup;
  if (backup.givesSeveral) {
    showLegacyValidCandidates(backup.candidates(known));
    return "done";
  }
  const result = backup.decode(known);
  // The result is a step of its own: the questions are cleared away.
  clearPrivateScreen();
  foundCodes?.();
  showRecovered(result, mode, format);
  if (result.checksumValid) return "done";
  return askAfterFailure<Step>("What now?", [
    ...(mode === "direct" ? [] : [{ label: "Type the dates again", value: "dates" } as const]),
    backupChoice(backupArgs),
    { label: "Done", note: "keep this result", value: "done" },
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
  const mode = backup.mode as SeedshiftMode;
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
  for (;;) {
    const next = await afterSearch(result, evidence, backupArgs, maxResults);
    if (next !== "wallet" && next !== "change-wallet") return { step: next, evidence };
    // "It cannot" only in place of a wallet that matched none, where the mode can list the
    // candidates without one.
    const answer = await askWalletEvidence({
      optional: next === "change-wallet" && !walletNeeded(mode),
      explanation: walletExplanation(mode, given.passphrase),
      place: given.place,
    });
    if (answer.kind === "back") continue;
    return { step: "search", evidence: answer.kind === "wallet" ? answer.evidence : undefined };
  }
}

/** A step after a search, or "change-wallet" for another wallet in place of one that matched none. */
type AfterSearch = Exclude<Step, "search"> | "change-wallet";

/** What the person changes after a search whose result is not complete; "done" when it is. */
async function afterSearch(
  result: DateSearchResult,
  evidence: WalletEvidence | undefined,
  backupArgs: ParsedArguments,
  maxResults: number,
): Promise<AfterSearch> {
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
    return askAfterFailure("What now?", [
      { label: "Change the dates", value: "dates" },
      ...wallet,
      backupChoice(backupArgs),
      { label: "Stop", value: "done" },
    ]);
  }
  // With a wallet, every match is one the wallet confirmed.
  if (evidence !== undefined) return "done";
  let question: string;
  if (result.matchCount > maxResults) question = "Not every candidate is shown. What now?";
  // The private screen keeps no scrollback: matches above its top could not be read.
  else if (!matchesFitScreen(result))
    question = "Not every candidate fits on the screen. What now?";
  else return "done";
  return askAfterFailure(question, [
    { label: "Check them against the wallet", note: "only those that match", value: "wallet" },
    { label: "Change the dates", note: "fewer ? give fewer candidates", value: "dates" },
    { label: "Done", value: "done" },
  ]);
}
