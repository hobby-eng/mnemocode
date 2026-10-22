// sskr-combine: Shamir shares typed or read back, repaired where marked, and the seed phrase
// restored with the dates and checked with the wallet. With --ask-secrets each answer is checked
// as soon as it is given (share-repair.ts, ask.ts, date-search.ts); what the shares are, and the
// phrases they give, the library decides (sskr/share-input.ts, share-set.ts, share-unmasking.ts).

import {
  dateSearchDecision,
  releaseRead,
  severalSetsNote,
  ShareRestore,
  wordCountOf as wordsOfRead,
  type MarkedShares,
  type PhrasesFound,
  type RestoredPhrase,
  type RestoredPhrases,
  type SearchLimits,
  matchWarnings,
} from "../sskr/share-restore.js";
import { clearPrivateScreen } from "./private-screen.js";
import { PrivateSteps } from "./private-steps.js";
import {
  FINGERPRINT_NOTE,
  printCodes,
  terminalLayout,
  terminalFingerprint,
  terminalLastingWarning,
  terminalNotice,
  terminalPart,
  terminalResultHeader,
} from "./terminal.js";
import type { EncodedFormat } from "../core/types.js";
import {
  assertSingleValues,
  value,
  type ParsedArguments,
  assertAskedNotGiven,
} from "./arguments.js";
import { encodedOutputLabel, dates, transformMode, DATES_OPTION } from "./input.js";
import { DatesAnswer, MAX_SHOWN_MATCHES } from "../core/date-search.js";
import { DATE_COUNT_WORDS, Masking, PHRASE_WORDS, type SplitMode } from "../core/masking.js";
import {
  masterFingerprint,
  walletCheckOf,
  type OwnedWalletCheck,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { assertSskrSelfTest } from "../sskr/self-test.js";
import type { RepairedSet } from "../sskr/joint-results.js";
import { NO_PHRASE_FITS, type DateWork } from "../sskr/repair-report.js";
import { ShareSet } from "../sskr/share-set.js";
import type { ShareTrouble } from "../sskr/share-input.js";
import { ShareUnmasking } from "../sskr/share-unmasking.js";
import { type GivenWallet, givenWallet } from "./bitcoin-options.js";
import {
  assessShares,
  askShareFix,
  mendShares,
  reportRepairs,
  searchLimit,
  searchShareRepair,
  TypedShares,
  type FirstShare,
} from "./share-repair.js";
import { evidenceLabel } from "./option-copy.js";
import { CandidatesFile } from "./candidates-file.js";
import { LIST_KEEP } from "../core/candidate-list.js";
import { askOrCancel, WHAT_NOW } from "./ask.js";
import { askWalletEvidence, changeWalletAnswer } from "./wallet-question.js";
import {
  askDates,
  dateSearchRun,
  withDateProgress,
  maxCandidatesOf,
  PROGRESS_EVERY,
  DATES_AGAIN,
  CHANGE_DATES_LABEL,
  walletExplanation,
} from "./date-search.js";
import { showEncodedFingerprint } from "./backup-questions.js";
import { choose, waitForEnter } from "./terminal-choice.js";
import { askToSearch } from "./search-consent.js";
import { SHARE_SEEDSHIFT_CHOICES, SHARE_SEEDSHIFT_QUESTION } from "./seedshift-choices.js";
import { CtrlCWatch } from "./terminal-input.js";
import { SHARE_SOURCE_OPTIONS } from "./share-options.js";
import { reportOriginalFingerprint, showOriginalPhrase } from "./fingerprint-report.js";
import { isMasterKeyPath } from "../core/wallet-check.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.sskr-restore-command", {
  "ask-share-dates-refused": suppliedMessage,
  "after-refused-refused": suppliedMessage,
  "restore-phrases-refused": suppliedMessage,
  "after-mismatch-refused": suppliedMessage,
  "too-few-shares-restore-phrase": () => "Too few shares to restore the phrase.",
});

export const SSKR_INPUT_OPTIONS = [...SHARE_SOURCE_OPTIONS, "ask-secrets"] as const;

/** The question of askShareFix when the shares that no phrase fits are to be changed. */
const CHANGE_SHARES = "Which shares to change?";

/**
 * The shares: asked on the private screen with --ask-secrets, or read from the options; CANCELLED
 * when the person cancelled.
 */
export async function typedShares(args: ParsedArguments): Promise<TypedShares | Cancelled> {
  return TypedShares.read(args);
}

// Restoring the phrase from the shares, with the dates and the wallet.

/** Direct mode or checksum-valid Seedshift, the two modes in which shares are made. */
function shareMode(args: ParsedArguments): SplitMode {
  const mode = transformMode(args);
  Masking.assertSplitMode(mode);
  return mode;
}

/**
 * The answers of a restore of shares: read and checked before the first question, then answered
 * on the private screen. A record: what the answers give, and the steps of the restore, the
 * library decides (ShareRestore, ShareUnmasking); restorePhrases only asks and keeps the answers.
 */
export interface Recovery {
  /** Whether the shares are asked on the private screen, so that a problem is asked about. */
  readonly interactive: boolean;
  /** Changed on the private screen when the person says that Seedshift was, or was not, used. */
  mode: SplitMode;
  /**
   * How far a search goes without a question: the share combinations of --max-tries and the date
   * combinations of --max-candidates, for every phrase.
   */
  readonly limits: SearchLimits;
  /**
   * The wallet given with the options, if any, where a wallet asked on the private screen is
   * looked for (walletPlaceOf), and the owner of the BIP39 passphrase, which the command disposes.
   */
  readonly wallet: GivenWallet;
  /** The candidate list to save (sskr-combine), for which every date match is kept. */
  readonly target?: CandidatesFile | undefined;
  readonly shares: TypedShares;
  /** The wallet: given with the options, or asked on the private screen. */
  evidence: WalletEvidence | undefined;
  /** The dates of a Seedshift phrase: given with the options, or asked once the shares are read. */
  dates: DatesAnswer | undefined;
}

/**
 * Reads and checks the options that a restore uses, before any question: the mode, the dates, the
 * wallet and where it is looked for, the BIP39 passphrase and --max-tries; then runs the SSKR
 * self-test, so that it cannot fail after the shares were typed.
 */
export async function recoverySettings(
  args: ParsedArguments,
): Promise<Omit<Recovery, "shares" | "target">> {
  const mode = shareMode(args);
  // Dates are secret: with --ask-secrets they are asked on the private screen, as every command
  // that takes them does, and never also taken from the command line.
  assertAskedNotGiven(args, [DATES_OPTION, "dates-file"]);
  const given = dates(args);
  Masking.of(mode).assertDateCount(
    given.length,
    args["ask-secrets"] === true,
    DATE_COUNT_WORDS.recovery,
  );
  const wallet = givenWallet(args);
  let datesAnswer: DatesAnswer | undefined;
  try {
    const limits = { shares: searchLimit(args), dates: maxCandidatesOf(args) };
    datesAnswer = given.length === 0 ? undefined : DatesAnswer.of(given);
    await assertSskrSelfTest();
    const interactive = args["ask-secrets"] === true;
    return { interactive, mode, limits, wallet, evidence: wallet.evidence, dates: datesAnswer };
  } catch (error) {
    datesAnswer?.wipe();
    wallet.wipe();
    throw error;
  }
}

/** The phrases of ShareRestore.phrases, with the places of their shares. */
type PhrasesAt = PhrasesFound & {
  /** The places of the sets' shares among those typed, by their index in a set. */
  readonly places: readonly number[];
};

/** What restorePhrases gives: the phrases, or too few shares, which the caller deals with. */
export type Restoring = PhrasesAt | { readonly kind: "few" };

/**
 * Uses the original phrases after restoration and Seedshift removal, without printing them on
 * standard output. "dates" keeps the shares and asks their dates again; "back" changes the input.
 * The borrowed result is valid only during the call. Every phrase still needs confirmation by
 * the caller: a valid checksum does not identify the wallet.
 */
export type RestoredUse = (
  restored: PhrasesAt,
  mode: SplitMode,
) => Promise<"done" | "dates" | "back" | Cancelled>;

/** Too few shares to restore a phrase, by the code of the condition (ShareTrouble). */
type FewTrouble = Extract<ShareTrouble, { readonly kind: "few" }>;

/** How restorePhrases deals with what differs between restoring and exporting shares. */
interface RestoreRules {
  /**
   * After too few shares, as `trouble` says: "again" when more shares were added, "few" to stop
   * restoring and give the shares back to the caller, CANCELLED when the person cancelled.
   */
  readonly few: (trouble: FewTrouble) => Promise<"again" | "few" | Cancelled>;
  /** Whether several phrases, without a wallet, ask for one to tell the right set (sskr-export). */
  readonly one: boolean;
}

/**
 * Asks for the dates of a Seedshift phrase of `words` words, ? standing for a forgotten digit,
 * until they can be used. Without a private screen the dates must have been given.
 */
async function askShareDates(
  r: Recovery,
  words: number | undefined,
): Promise<DatesAnswer | Cancelled> {
  // Off the private screen recoverySettings has refused a masked mode without dates, so the dates
  // given can only be too many for the phrase.
  if (!r.interactive)
    throw ERRORS.create("ask-share-dates-refused", [defined(defined(r.dates).tooManyFor(words))]);
  return askDates({ wordCount: words, patterns: true });
}

/** A date search that is made, with the notice of its time to show over its progress, if any. */
interface DateSearchStart {
  readonly notice: string | undefined;
}

/**
 * Whether the date search of `phrases` phrases is made (dateSearchDecision): at once, its notice
 * to be shown when it runs, or when the person chooses it (askToSearch), whose question said its
 * time; "no" types the dates again. Dates with ? are typed on the private screen only.
 */
async function askDateSearch(
  work: DateWork,
  phrases: number,
  limits: SearchLimits,
): Promise<DateSearchStart | "no" | Cancelled> {
  const decision = dateSearchDecision(work, phrases, limits);
  if (decision.question === undefined) return { notice: decision.notice };
  const start = await askToSearch(decision.question, DATES_AGAIN);
  return start === "yes" ? { notice: undefined } : start;
}

/**
 * How the sets of this restore become seed phrases (ShareUnmasking): with its mode, its dates and
 * the wallet, keeping every date match for a candidate list.
 */
function unmaskingOf(r: Recovery, walletCheck?: OwnedWalletCheck): ShareUnmasking {
  return new ShareUnmasking({
    mode: r.mode,
    dates: r.dates,
    walletCheck,
    maxShown: MAX_SHOWN_MATCHES,
    keep: r.target === undefined ? 0 : LIST_KEEP,
  });
}

/**
 * The date search that each phrase of the shares needs, for its time (ShareUnmasking.dateWork):
 * undefined without dates with ? or without a wallet.
 */
async function dateWork(r: Recovery): Promise<DateWork | undefined> {
  using walletCheck = walletCheckOf(r.evidence, r.wallet.passphrase);
  return await unmaskingOf(r, walletCheck).dateWork();
}

/**
 * The phrases of `sets` whose wallet matches the one given, if any (ShareRestore.phrases): the
 * set's own phrase, or the phrase that the dates unmask, searched where a date holds ? while
 * Ctrl+C is read as a key, on a step screen of its own with `notice` first, if any; or why the
 * dates do not fit, or why none is the wallet's.
 */
async function unmasked(
  r: Recovery,
  sets: readonly RepairedSet[],
  places: readonly number[],
  notice?: string,
): Promise<RestoredPhrases> {
  using walletCheck = walletCheckOf(r.evidence, r.wallet.passphrase);
  const unmasking = unmaskingOf(r, walletCheck);
  if (!unmasking.searches) return await ShareRestore.phrases(unmasking, sets, places);
  // The search is a step of its own: its screen shows the title and the search, no longer the
  // question answered before it (CORE-39).
  PrivateSteps.begin();
  if (notice !== undefined) terminalNotice(notice);
  return await withDateProgress((progress) =>
    CtrlCWatch.during((signal) =>
      ShareRestore.phrases(
        unmasking,
        sets,
        places,
        dateSearchRun(signal, PROGRESS_EVERY, progress),
      ),
    ),
  );
}

/** What is asked next while restoring. */
type Step = "shares" | "dates" | "wallet" | "search";

/**
 * Shows the fingerprint of the masked phrase that complete shares restore, before any date is
 * typed: the split showed it as the encoded fingerprint, so a share typed wrong shows here as
 * another fingerprint, before the dates, as decode shows it for typed codes. It is shown when the
 * phrase is a valid BIP39 phrase (ShareSet.fingerprint).
 */
function showSetFingerprint(set: RepairedSet): void {
  using restored = ShareSet.of(set);
  showEncodedFingerprint(restored.fingerprint(masterFingerprint));
}

/**
 * The step after the shares of a phrase of `words` words: its dates where none were given or more
 * than the phrase takes, which the person is told; otherwise the wallet.
 */
function stepAfterShares(r: Recovery, words: number | undefined): Step {
  // Dates typed or given before the word count was known may be more than the phrase takes.
  const tooMany = r.dates?.tooManyFor(words);
  if (tooMany !== undefined && r.interactive) terminalNotice(tooMany, "warning");
  return Masking.of(r.mode).masked && (r.dates === undefined || tooMany !== undefined)
    ? "dates"
    : "wallet";
}

/**
 * The wallet, asked when the date search needs it and none was given: the step after it, the
 * search, or the dates at Escape.
 */
async function walletForSearch(r: Recovery): Promise<Step | Cancelled> {
  if (!unmaskingOf(r).needsWallet || r.evidence !== undefined) return "search";
  const answer = await askWalletEvidence({
    optional: false,
    explanation: walletExplanation(r.mode),
    place: r.wallet.place,
  });
  if (answer === CANCELLED) return CANCELLED;
  if (answer.kind === "back") return "dates";
  if (answer.kind === "wallet") r.evidence = answer.evidence;
  return "search";
}

/**
 * The step after the phrases of the shares were refused: the dates again when they do not fit,
 * or what afterMismatch asks when no phrase is the wallet's. Without a private screen the refusal
 * ends the command.
 */
async function afterRefused(
  r: Recovery,
  result: Extract<RestoredPhrases, { readonly kind: "dates" | "mismatch" }>,
): Promise<Step | Cancelled> {
  if (result.kind === "mismatch") return afterMismatch(r, result.message);
  if (!r.interactive) throw ERRORS.create("after-refused-refused", [result.message]);
  terminalNotice(result.message, "warning");
  return "dates";
}

/**
 * Several sets fit, and nothing tells the right one: the wallet does, without a new search.
 * "given" when a wallet was given, "none" when not.
 */
async function walletForSeveral(r: Recovery, sets: number): Promise<"given" | "none" | Cancelled> {
  const answer = await askWalletEvidence({
    optional: true,
    explanation: { lines: [severalSetsNote(sets)] },
    place: r.wallet.place,
  });
  if (answer === CANCELLED) return CANCELLED;
  if (answer.kind !== "wallet") return "none";
  r.evidence = answer.evidence;
  return "given";
}

/** The sets of repaired shares that fit the shares typed, as a search of them found them. */
interface FoundSets {
  /** Each set that fits, with the phrase it holds. */
  readonly sets: readonly RepairedSet[];
  /** The places of the sets' shares among those typed, by their index in a set. */
  readonly places: readonly number[];
  /** What the date search that follows says of its time before it runs, if anything. */
  readonly notice?: string | undefined;
}

/**
 * The step of restorePhrases that takes the sets that fit the shares: their phrases with the dates
 * and the wallet of `r` (unmasked), or the step that comes next. After phrases that the dates or
 * the wallet refused it is the step that afterRefused gives. Where several sets fit, nothing tells
 * the right one and `one` asks for one, the wallet is asked on the private screen
 * (walletForSeveral): a wallet given searches the sets again with it ("search"), and "It cannot"
 * keeps every set. The sets are data here, so that its tests can give it sets that typed shares
 * give only by chance. CANCELLED when the person cancelled, at a question or by stopping the date
 * search. Without a private screen a refusal ends the command, as afterRefused throws it.
 */
export async function phrasesOfSets(
  r: Recovery,
  found: FoundSets,
  one: boolean,
): Promise<PhrasesAt | Step | Cancelled> {
  const { sets, places } = found;
  const result = await unmasked(r, sets, places, found.notice);
  // The person stopped the date search with Ctrl+C.
  if (result.kind === "stopped") return CANCELLED;
  if (result.kind === "dates" || result.kind === "mismatch") return afterRefused(r, result);
  const restored = { ...result, places };
  if (!(one && result.sets.length > 1 && r.evidence === undefined && r.interactive))
    return restored;
  const wallet = await walletForSeveral(r, result.sets.length);
  if (wallet === "given") return "search";
  return wallet === "none" ? restored : wallet;
}

/**
 * Restores the phrases that the shares hold, asked in this order on the private screen, each
 * answer checked at once: the shares (each read, then the set; see share-repair.ts), the dates of
 * a Seedshift phrase, with ? for forgotten digits, the wallet when a date search needs it, then the
 * search of marked shares and of the dates, and the wallet check. A result that cannot be used
 * offers what to change; the other answers, and the phrases already found, are kept. Without a
 * private screen the first problem ends the command. CANCELLED when the person cancelled, at a
 * question or by stopping a search.
 */
export async function restorePhrases(
  r: Recovery,
  rules: RestoreRules,
): Promise<Restoring | Cancelled> {
  let repair: MarkedShares | undefined;
  let sets: readonly RepairedSet[] | undefined;
  let places: number[] = [];
  let words: number | undefined;
  // Whether the encoded fingerprint of the set restored was shown (showSetFingerprint).
  let encodedShown = false;
  /**
   * Shows it once for complete shares of a Seedshift phrase, before its dates, on the private
   * screen only, as decode does: from the command line the dates are given, and nothing is asked.
   */
  const showEncoded = (): void => {
    if (!r.interactive || !Masking.of(r.mode).masked || encodedShown) return;
    // Marked shares restore their phrases only in the search, after the dates.
    if (repair !== undefined || sets === undefined) return;
    showSetFingerprint(defined(sets[0]));
    encodedShown = true;
  };
  /**
   * The read of marked shares that the search takes, or none for complete shares. The one before
   * is released (releaseRead): a read whose search was not made keeps nothing of the shares'
   * secret once shares are typed again, nor once the restore ends; a search wiped it already.
   */
  const assessed = (marked: MarkedShares | undefined): void => {
    if (repair !== undefined) releaseRead(repair);
    repair = marked;
  };
  try {
    for (let step: Step | Cancelled = "shares"; ;) {
      if (step === CANCELLED) return CANCELLED;
      if (step === "shares") {
        const outcome = await assessShares(r.shares);
        if (outcome === CANCELLED) return CANCELLED;
        if (outcome.kind === "trouble") {
          const mended =
            outcome.trouble.kind === "few"
              ? await rules.few(outcome.trouble)
              : await mendShares(r.shares, outcome.trouble, r.interactive);
          if (mended === CANCELLED) return CANCELLED;
          if (mended === "few") return { kind: "few" };
          continue;
        }
        places = r.shares.places();
        encodedShown = false;
        if (outcome.kind === "complete") {
          assessed(undefined);
          sets = [outcome.set];
          if (outcome.unchecked !== undefined) terminalLastingWarning(outcome.unchecked);
          showEncoded();
        } else {
          assessed(outcome);
          sets = undefined;
        }
        words = wordsOfRead(outcome);
        step = stepAfterShares(r, words);
      } else if (step === "dates") {
        // Also after "It was masked with Seedshift" (otherMode), which comes here.
        showEncoded();
        const dates = await askShareDates(r, words);
        if (dates === CANCELLED) return CANCELLED;
        r.dates?.wipe();
        r.dates = dates;
        step = "wallet";
      } else if (step === "wallet") {
        step = await walletForSearch(r);
      } else {
        // The time of a date search that the repair search below counted is said by that search.
        let notice: string | undefined;
        if (sets === undefined) {
          const found = await searchShareRepair(defined(repair), r.limits, await dateWork(r));
          if (found === CANCELLED) return CANCELLED;
          if (found === undefined || found.length === 0) {
            // A search not made leaves the plan, which the shares typed next do not use: it is
            // wiped now, before they are asked. A search wiped it already, which is no harm.
            assessed(undefined);
            // Shares given with the options cannot be typed again here.
            const problem = found === undefined ? "The search was not started." : NO_PHRASE_FITS;
            if (!r.interactive) throw ERRORS.create("restore-phrases-refused", [problem]);
            if (found !== undefined) terminalNotice(problem, "warning");
            // Escape here is Stop (askAfterFailure): a search that found nothing has no question
            // to go back to, and the search question, whose own Escape leads here, would be asked
            // without end once the input has ended.
            const change = await askShareFix(r.shares, { question: CHANGE_SHARES });
            step = change === CANCELLED ? CANCELLED : "shares";
            continue;
          }
          sets = found;
        } else {
          const work = await dateWork(r);
          const start =
            work === undefined
              ? { notice: undefined }
              : await askDateSearch(work, sets.length, r.limits);
          if (start === "no" || start === CANCELLED) {
            step = start === "no" ? "dates" : start;
            continue;
          }
          notice = start.notice;
        }
        const next = await phrasesOfSets(r, { sets, places, notice }, rules.one);
        if (typeof next === "object") return next;
        step = next;
      }
    }
  } finally {
    assessed(undefined);
  }
}

/**
 * Takes the other of the two modes in which shares are made, after the person said that the phrase
 * was, or was not, masked with Seedshift before splitting: the menu asks that before the shares,
 * and a wrong answer there shows only as a wallet that nothing matches. The phrases found are
 * kept; a masked one needs its dates.
 */
function otherMode(r: Recovery): Step {
  if (!Masking.of(r.mode).masked) {
    r.mode = "seedshift";
    return "dates";
  }
  r.mode = "direct";
  r.dates?.wipe();
  r.dates = undefined;
  return "search";
}

/**
 * After phrases of which none matches the wallet given: says so, in the library's `message`
 * (ShareRestore.phrases), and asks what to change, the dates, the wallet, the shares or whether
 * Seedshift was used; Stop cancels (CANCELLED). Escape at the wallet or share question that
 * follows comes back here. Without a private screen the mismatch ends the command.
 */
async function afterMismatch(r: Recovery, message: string): Promise<Step | Cancelled> {
  if (!r.interactive) throw ERRORS.create("after-mismatch-refused", [message]);
  terminalNotice(message, "warning");
  for (;;) {
    const next = await askOrCancel(WHAT_NOW, [
      ...(Masking.of(r.mode).masked
        ? [{ label: CHANGE_DATES_LABEL, value: "dates" as const }]
        : []),
      changeWalletAnswer("wallet" as const),
      { label: "Change a share", note: "or add more", value: "shares" as const },
      !Masking.of(r.mode).masked
        ? { label: "It was masked with Seedshift", note: "type its dates", value: "mode" as const }
        : { label: "It was not masked with Seedshift", note: "no dates", value: "mode" as const },
    ]);
    if (next === CANCELLED) return CANCELLED;
    if (next === "dates") return "dates";
    if (next === "mode") return otherMode(r);
    if (next === "shares") {
      const change = await askShareFix(r.shares, { question: CHANGE_SHARES, back: true });
      if (change !== "back") return change === "changed" ? "shares" : change;
      continue;
    }
    const answer = await askWalletEvidence({ optional: false, place: r.wallet.place });
    if (answer === CANCELLED) return CANCELLED;
    if (answer.kind === "wallet") {
      r.evidence = answer.evidence;
      return "search";
    }
  }
}

/**
 * The restore from Shamir shares on the private screen, after shares were typed where Decode or
 * Re-encode asked for the codes: every share is kept, and any more needed are asked for. Shares are made
 * with Seedshift or without; Decode's mode tells which where it is one of the two, or it is asked
 * as the menu's entry asks it. `handed` are Decode's options that a restore takes too, such as
 * the mode, the wallet and the search limits. `use` receives the original phrases after Seedshift
 * removal instead of printing them; Re-encode confirms them privately. CANCELLED when cancelled.
 */
export async function restoreFromShare(
  handed: ParsedArguments,
  share: FirstShare,
  use?: RestoredUse,
): Promise<"done" | "back" | Cancelled> {
  const given = value(handed, "mode");
  const mode = Masking.isSplitMode(given) ? given : await askShareSeedshift();
  if (mode === undefined) return "back";
  if (mode === CANCELLED) return CANCELLED;
  const options: ParsedArguments = { ...handed, "ask-secrets": true };
  delete options.mode;
  if (Masking.of(mode).masked) options.mode = mode;
  return useRestoredShares(options, share, use);
}

/** Whether Seedshift was used before the shares were made; undefined goes back (Escape). */
async function askShareSeedshift(): Promise<SplitMode | undefined | Cancelled> {
  return choose(SHARE_SEEDSHIFT_QUESTION, SHARE_SEEDSHIFT_CHOICES, {
    label: "Seedshift",
    quit: "goes back",
  });
}

/**
 * Restores the phrase from the shares given, or typed on the private screen, after `firstShare`
 * when another command's question took it (restoreFromShare). CANCELLED when the person
 * cancelled.
 */
export async function runSskrCombine(
  args: ParsedArguments,
  firstShare?: FirstShare,
): Promise<Cancelled | undefined> {
  const result = await useRestoredShares(args, firstShare);
  return result === "done" ? undefined : CANCELLED;
}

/** Owns the same share/date recovery for Decode, Restore and Re-encode. */
async function useRestoredShares(
  args: ParsedArguments,
  firstShare: FirstShare | undefined,
  use?: RestoredUse,
): Promise<"done" | "back" | Cancelled> {
  // Again for the menu, which runs the command without the command line's checks.
  assertSingleValues(args);
  const settings = await recoverySettings(args);
  using initialDates = settings.dates;
  using ownedWallet = settings.wallet;
  using target = await CandidatesFile.of(args);
  target?.assertListable(ownedWallet.passphrase);
  const shares =
    firstShare === undefined ? await typedShares(args) : await TypedShares.startingWith(firstShare);
  if (shares === CANCELLED) return CANCELLED;
  using ownedShares = shares;
  const r: Recovery = { ...settings, dates: initialDates, target, shares: ownedShares };
  try {
    if ((await target?.prepare(r.wallet.passphrase)) === CANCELLED) return CANCELLED;
    for (;;) {
      const restored = await restorePhrases(r, {
        few: async (trouble) => (await mendShares(r.shares, trouble, r.interactive)) ?? "again",
        one: use !== undefined,
      });
      if (restored === CANCELLED) return CANCELLED;
      if (restored.kind === "few") throw ERRORS.create("too-few-shares-restore-phrase", []);
      if (use !== undefined) {
        const next = await use(restored, r.mode);
        if (next !== "dates") return next;
        r.dates?.wipe();
        r.dates = undefined;
        continue;
      }
      if ((await showRestoredPhrases(restored, r)) === CANCELLED) return CANCELLED;
      const saved = await target?.savePhrases(restored.listed, r.wallet.passphrase);
      return saved === CANCELLED ? CANCELLED : "done";
    }
  } finally {
    r.dates?.wipe();
  }
}

/** Restore's output adapter; Re-encode uses its own terminal-only confirmation instead. */
async function showRestoredPhrases(
  restored: PhrasesAt,
  r: Recovery,
): Promise<Cancelled | undefined> {
  const { phrases } = restored;
  // The result is a step of its own: the questions and the search are cleared away.
  const cleared = clearPrivateScreen();
  if (phrases.length > 1)
    terminalNotice(
      `${phrases.length} phrases fit these shares. Each is listed with its fingerprint: the wallet tells which is yours.`,
      "warning",
    );
  const reported = new Set<RepairedSet>();
  let shown = 0;
  for (const [index, phrase] of phrases.entries()) {
    // The private screen keeps no scrollback: there each phrase has a screen of its own, the next
    // shown on Enter, so that none scrolls out of reach.
    if (index > 0 && cleared) {
      const next = await waitForEnter(
        `Press Enter for phrase ${index + 1} of ${phrases.length}; Esc ends.`,
      );
      if (next === CANCELLED) return CANCELLED;
      if (next === "escape") break;
      clearPrivateScreen();
    }
    showRestored(phrase, r.mode, {
      index,
      of: phrases.length,
      places: restored.places,
      // What is said of a set comes once, with its first phrase, and again on a screen of its own.
      set: cleared ? "cleared" : reported.has(phrase.set) ? "said" : "new",
      ...(r.evidence === undefined ? {} : { evidence: evidenceLabel(r.evidence) }),
    });
    reported.add(phrase.set);
    shown += 1;
  }
  reportWalletWarnings(phrases.slice(0, shown));
  return undefined;
}

/** Where a restored phrase stands among those shown, and what was already said of its set. */
interface RestoredPlace {
  readonly index: number;
  readonly of: number;
  /** The places of the set's shares among those typed, by their index in the set. */
  readonly places: readonly number[];
  /** The wallet given, in the words of its option, which the phrase matched. */
  readonly evidence?: string;
  /**
   * "said" when an earlier phrase of the same set told its repairs; "cleared" when the screen was
   * cleared after the notes of the shares, which are then said again; "new" otherwise.
   */
  readonly set: "said" | "cleared" | "new";
}

/**
 * Prints one restored phrase: what the repair of its set filled in, the backup in the form of its
 * shares, and the phrase with its dates and fingerprint. On a terminal each part stands apart
 * under its own label, the phrase numbered for writing down; elsewhere the plain lines.
 */
function showRestored(phrase: RestoredPhrase, mode: SplitMode, place: RestoredPlace): void {
  if (terminalLayout("stdout")) showRestoredParts(phrase, mode, place);
  else showRestoredPlain(phrase, mode, place);
}

/**
 * What is said of a set before its first phrase: a share that took no part, and the repairs; with
 * `spaced`, after a blank line when there is something to say.
 */
function reportSet(phrase: RestoredPhrase, place: RestoredPlace, spaced: boolean): void {
  if (place.set === "said") return;
  // Said before the dates too (restorePhrases), on the screen cleared since.
  using restored = place.set === "cleared" ? ShareSet.of(phrase.set) : undefined;
  const unchecked = restored?.uncheckedNote(place.places);
  const repaired = phrase.repairs.length > 0;
  if (spaced && (unchecked !== undefined || repaired)) console.error("");
  if (unchecked !== undefined) terminalLastingWarning(unchecked);
  reportRepairs(phrase.set, place.places);
}

/**
 * The backup that was split, in the form its shares were written in, which the dates turn into
 * the seed phrase (RestoredPhrase.backup), under the label of its form; undefined where it would
 * repeat the original phrase in another form.
 */
function restoredBackup(
  phrase: RestoredPhrase,
  mode: SplitMode,
): { readonly label: string; readonly text: string; readonly form: EncodedFormat } | undefined {
  const { backup } = phrase;
  return backup === undefined
    ? undefined
    : { label: encodedOutputLabel(backup.form, mode), text: backup.text, form: backup.form };
}

/**
 * ", phrase 2 of 3" after a heading when several phrases are shown: the place of the phrase among
 * those found, not of a share.
 */
function numberedOf(place: RestoredPlace): string {
  return place.of > 1 ? `, phrase ${place.index + 1} of ${place.of}` : "";
}

/**
 * What the wallet check said of the matches of `phrases`, such as that a fingerprint is only a
 * filter (AUD-037-SEC004): each warning once, however many phrases it matched, said after them:
 * after the phrases shown (sskr-combine), or after the shares that the wallet chose or every set
 * that it matched alike (sskr-export). Nothing without a wallet, whose check says nothing.
 */
export function reportWalletWarnings(phrases: readonly RestoredPhrase[]): void {
  for (const warning of matchWarnings(phrases)) terminalLastingWarning(warning);
}

/** "matches the address at m/84'/0'/0'/0/3", for the wallet fact. */
function walletFact(phrase: RestoredPhrase, place: RestoredPlace): string | undefined {
  if (place.evidence === undefined) return undefined;
  const { matchedAt } = phrase;
  // The master key's path says nothing that the fact does not.
  const at = matchedAt === undefined || isMasterKeyPath(matchedAt) ? "" : ` at ${matchedAt}`;
  return `matches the ${place.evidence}${at}`;
}

/**
 * A restored phrase on a terminal: the heading with the mode, the dates and the wallet; the
 * repairs; the masked phrase (decoy) with its encoded fingerprint, grey; then, in bold, the
 * original seed phrase numbered for writing down, and its fingerprint.
 */
function showRestoredParts(phrase: RestoredPhrase, mode: SplitMode, place: RestoredPlace): void {
  const wallet = walletFact(phrase, place);
  const facts: [string, string][] = [["Mode", mode]];
  if (phrase.dates !== undefined) facts.push(["Dates", phrase.dates]);
  if (wallet !== undefined) facts.push(["Wallet", wallet]);
  terminalResultHeader(`Restored from shares${numberedOf(place)}`, facts);
  reportSet(phrase, place, true);
  const backup = restoredBackup(phrase, mode);
  if (backup !== undefined) {
    terminalPart(backup.label);
    // Codes written joined apart, beside the joined text; other forms wrapped at their spaces.
    printCodes(backup.text, backup.form);
    // Only a masked phrase has a fingerprint of its own; another form is the phrase below.
    using set = Masking.of(mode).masked ? ShareSet.of(phrase.set) : undefined;
    const encoded = set?.fingerprint(masterFingerprint);
    if (encoded !== undefined)
      terminalFingerprint(Masking.of(mode).encodedFingerprintLabel, encoded, FINGERPRINT_NOTE);
  }
  showOriginalPhrase(phrase.mnemonic);
}

/** A restored phrase as plain lines, for a file, a pipe or TERM=dumb. */
function showRestoredPlain(phrase: RestoredPhrase, mode: SplitMode, place: RestoredPlace): void {
  reportSet(phrase, place, false);
  const { mnemonic } = phrase;
  const ordinal = place.of > 1 ? `phrase ${place.index + 1} of ${place.of}` : undefined;
  const backup = restoredBackup(phrase, mode);
  if (backup !== undefined) {
    console.log(`${backup.label}${ordinal === undefined ? "" : ` (${ordinal})`}:`);
    console.log(backup.text);
  }
  const notes = [ordinal, phrase.dates === undefined ? undefined : `dates ${phrase.dates}`].filter(
    (note) => note !== undefined,
  );
  console.log(
    `${PHRASE_WORDS.originalLabel}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}:`,
  );
  console.log(mnemonic);
  reportOriginalFingerprint(mnemonic);
}

// Exporting the shares again.
