// The search of codes that cannot be read, marked with ?: how the right codes are told (the
// encoded fingerprint that Encode showed for them, the wallet, with the dates where the phrase was
// masked, or every candidate listed where they are few), the size and time of each way before it
// starts, and what it found. A host asks the person and shows the results; this module decides
// every rule, so that the command line and a page search alike.
//
// Needs from the host: the master fingerprint of a phrase, which may answer later, as a page's
// WebCrypto does; the wallet check of the wallet the person names (core/wallet-check.ts); and,
// for a run, its progress callback and an AbortSignal.
// Does not: ask, print or read anything. Its messages never repeat a code or a phrase.
//
// Host-neutral: it reaches only core modules and the BIP39 word list.

import type { SeedshiftMode } from "./date-recovery.js";
import { DateSearch, DatesAnswer, type DateMatch } from "./date-search.js";
import { EncodedBackup } from "./encoded-backup.js";
import { EncodedForm } from "./encoded-form.js";
import { Masking } from "./masking.js";
import type { MissingCodes } from "./missing-codes.js";
import {
  stillRunning,
  startTimer,
  type SearchProgress,
  type SearchRun,
  type MonotonicClock,
} from "./search-turns.js";
import type { DateShiftDate } from "./types.js";
import {
  askWallet,
  fingerprintWalletCheck,
  parseMasterFingerprint,
  type PhraseFingerprint,
  type WalletCheck,
} from "./wallet-check.js";
import { placesNamed } from "./places.js";
import { lowerFirst } from "./prose.js";
import { phraseOfIndexes } from "./words.js";
import { ownedDates } from "./dates.js";
import { CORRECT_WRITTEN_COPY, SearchPlan, counted } from "./search-plan.js";
import { defined } from "./defined.js";
import { ErrorCatalog, suppliedMessage } from "./error-catalog.js";

const ERRORS = new ErrorCatalog("core.missing-codes-search", {
  "search-host-s-fingerprint-function": {
    kind: "type",
    text: () => "The search needs the host's fingerprint function.",
  },
  "codes-were-not-masked-no-dates-search": () =>
    "Codes that were not masked have no dates to search.",
  "dates-found-do-not-decode-codes-wallet-matched": () =>
    "The dates found do not decode the codes to the wallet that matched.",
  "list-overflow": (rows: string) =>
    `More than ${MAX_LISTED} ${rows} fit these codes and dates. Narrow the codes or use a wallet check instead of listing them.`,
  "way-wiped": () => "This prepared code search has been wiped.",
  "operation-refused": suppliedMessage,
});

/** How the right codes are told. */
export type MissingCodesWay = "encoded" | "wallet" | "list";

/** A way offered for codes, with the words a host shows for it. */
export interface MissingCodesWayChoice {
  /** The way, which one method prepares: byEncodedFingerprint, byWallet or listed. */
  readonly way: MissingCodesWay;
  /** The way's name in a list of choices, such as "The wallet". */
  readonly label: string;
  /** What the way needs or does, shown beside its label, in lower case: "compare them yourself". */
  readonly note: string;
}

/** The texts that every host shows as they are. */
export const MISSING_CODES_TEXTS = Object.freeze({
  question: "How can MnemoCode tell the right codes?",
  many: "A fingerprint or an address tells the right codes among them.",
  noneByFingerprint: "No codes fit this fingerprint: check it, and the codes.",
  noneByWallet: "No codes give this wallet: check the dates, the wallet and the codes.",
  correct: CORRECT_WRITTEN_COPY,
  list: "Each line: the codes, the seed phrase they give, and its fingerprint with an empty BIP39 passphrase. Compare the fingerprint with your wallet.",
});

/**
 * What a host says of a find whose phrase `others` other sets of codes and dates give too
 * (MissingCodesFound.others), instead of MISSING_CODES_TEXTS.correct: the codes and dates found
 * need not be those written.
 */
export function foundAmongOthers(others: number): string {
  return `${counted(others + 1, "set")} of codes and dates give this phrase; those found are one of them, so keep the dates you used.`;
}

/** One candidate of a listed search: the codes, the phrase they give, and its fingerprint. */
export interface MissingCodesRow {
  /** The codes written in their form, as encode writes them (EncodedBackup.text). */
  readonly codes: string;
  /** The seed phrase that they give with the dates, English words; its checksum is valid. */
  readonly phrase: string;
  /** The host's master fingerprint of the phrase with an empty BIP39 passphrase, as it gave it. */
  readonly fingerprint: string;
}

/**
 * The one set of codes that fits, with the dates it was decoded with, found or known; none where
 * the way needed no dates, which the host then asks as for complete codes.
 */
export interface MissingCodesFound {
  /** What the result is: one set of codes found. */
  readonly kind: "found";
  /** The codes found, complete; the caller owns the backup and wipes it. */
  readonly backup: EncodedBackup;
  /**
   * The complete dates that the codes decode with, known or found; undefined where the way needed
   * no dates (the encoded fingerprint), and empty where the codes were not masked.
   */
  readonly dates?: readonly DateShiftDate[] | undefined;
  /** The dates as found by a search of their forgotten digits, as DD-MM-YYYY joined by spaces. */
  readonly foundDates?: string | undefined;
  /**
   * How many other sets of codes and dates give the same phrase, which no wallet tells apart: the
   * codes and dates found are one of them, not always those written (AUD-037-FUN001).
   */
  readonly others?: number | undefined;
  /**
   * What the wallet check said of the match, such as that a master fingerprint is only a filter
   * (WalletMatch.warning); absent where it said nothing (AUD-037-SEC004).
   */
  readonly warning?: string | undefined;
}

/** What one way found. */
export type MissingCodesResult =
  | MissingCodesFound
  | {
      /** Every candidate, for the person to compare. */
      readonly kind: "list";
      /** A row for each phrase the codes and dates give, MissingCodesSearch.MAX_LISTED at most. */
      readonly rows: readonly MissingCodesRow[];
    }
  | {
      /** No codes fit. */
      readonly kind: "none";
      /** What to check, as the way says it, such as MISSING_CODES_TEXTS.noneByWallet. */
      readonly message: string;
    }
  | {
      /**
       * Several sets fit, which a fingerprint leaves only by chance: the wallet tells them apart.
       */
      readonly kind: "several";
      /** How many sets of codes, or of codes and dates, fit: 2 or more. */
      readonly count: number;
      /** That they fit and that the wallet tells which is the person's, with their count. */
      readonly message: string;
    }
  | {
      /** The host stopped the search (SearchRun.signal): nothing found is told (CORE-22). */
      readonly kind: "stopped";
    };

/** The result of a way that the host stopped. */
const STOPPED: MissingCodesResult = { kind: "stopped" };

/**
 * A search of one way before it starts: what is searched, such as "128 candidates" or "128
 * candidates with 10 date combinations each", what the person is told, and whether they are asked.
 */
export type MissingCodesPlan = SearchPlan;

/**
 * How far the search of marked codes has come: candidates checked, of about how many, and found.
 */
export interface MissingCodesProgress extends SearchProgress {
  /** About how many candidates the search checks in all (MissingCodes.expected). */
  readonly total: number;
}

/** The host's services for a run. */
export interface MissingCodesRun extends SearchRun {
  /** Called as the candidates are checked: how many so far, of about how many, and found. */
  readonly onProgress?: ((progress: MissingCodesProgress) => void) | undefined;
}

/**
 * One owned way prepared with its answers: its plan first, then its run. Dispose it after both
 * settle. Codes and incomplete date answers are borrowed; complete dates are owned snapshots.
 * A found backup is transferred to the caller and survives disposal of this way.
 */
export interface MissingCodesWaySearch extends Disposable {
  /**
   * The size of the search and about how long it takes here, timed on `now`, the host's clock
   * (performance.now by default), except the list way, which takes no time to plan; asked for
   * first when it tries more than `limit`, the person's own limit, or without one takes longer
   * than QUESTION_SECONDS (SearchPlan). Refused after wipe (core.missing-codes-search.way-wiped);
   * the host's failures pass through.
   */
  plan(limit?: number, now?: MonotonicClock): Promise<MissingCodesPlan>;
  /**
   * The search, with the host's services in `run`: "stopped" where its signal aborts it. Refused
   * after wipe (core.missing-codes-search.way-wiped), and where more rows fit than a list holds
   * (list-overflow, MissingCodesSearch.isListOverflow); the host's failures pass through.
   */
  run(run?: MissingCodesRun): Promise<MissingCodesResult>;
  /** Ends this prepared way, releases its inputs and refuses further planning/publication. */
  wipe(): void;
}

/** The lifetime shared by prepared ways; borrowed inputs are released, never disposed here. */
class CodeSearchInput implements Disposable {
  #codes: MissingCodes | undefined;
  #dates: DatesAnswer | undefined;
  #patterns: DatesAnswer | undefined;

  constructor(codes: MissingCodes, dates: readonly DateShiftDate[] = [], patterns?: DatesAnswer) {
    const known = ownedDates(dates);
    this.#codes = codes;
    this.#dates = known.length === 0 ? undefined : DatesAnswer.of(known);
    this.#patterns = patterns;
  }

  assertLive(): void {
    if (this.#codes === undefined) throw ERRORS.create("way-wiped", []);
  }

  get codes(): MissingCodes {
    this.assertLive();
    return defined(this.#codes);
  }

  get dates(): readonly DateShiftDate[] {
    this.assertLive();
    return this.#dates?.known ?? [];
  }

  get patterns(): DatesAnswer {
    this.assertLive();
    return defined(this.#patterns);
  }

  /** A host callback may end this owner synchronously or while its answer is awaited. */
  async checked<Value>(read: () => Value | PromiseLike<Value>): Promise<Value> {
    this.assertLive();
    const value = await read();
    this.assertLive();
    return value;
  }

  /** A probe owns no live iterator after the first candidate has been copied. */
  first(): number[] | undefined {
    const candidates = this.codes.candidates();
    try {
      const first = candidates.next();
      return first.done === true ? undefined : first.value;
    } finally {
      candidates.return(undefined);
    }
  }

  wipe(): void {
    this.#dates?.wipe();
    this.#dates = undefined;
    this.#patterns = undefined;
    this.#codes = undefined;
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

// The host's fingerprint of a phrase (wallet-check.ts), here too for the hosts that take it with
// this search.
export type { PhraseFingerprint };

/** Candidates few enough to be listed for the person to compare. */
const MAX_LISTED = 16;

/**
 * About how many rows a list of the candidates of `codes` has: one phrase for each set of codes,
 * or as many as one set gives where its mode gives several (Masking.givesSeveral), so that a list
 * is offered only where it can hold them (AUD-037-FUN002).
 */
function listedRows(codes: MissingCodes): number {
  const masking = Masking.of(codes.mode);
  if (!masking.givesSeveral) return codes.expected;
  return codes.expected * masking.checksPerDecoding(codes.wordCount);
}

/**
 * What a row of a list of `codes` is: a candidate, a set of codes with its phrase, or a phrase
 * where one set gives several. A candidate stays a set of codes in every text.
 */
function listedRow(codes: MissingCodes): "candidate" | "phrase" {
  return Masking.of(codes.mode).givesSeveral ? "phrase" : "candidate";
}

/** The rows of a list of `codes` in words, such as "about 24 phrases" (listedRow). */
function listedText(codes: MissingCodes): string {
  return counted(listedRows(codes), listedRow(codes));
}

/** Why a list cannot tell `codes`: it holds at most MAX_LISTED rows (listedText). */
function tooManyToList(codes: MissingCodes): string {
  return `A list holds at most ${MAX_LISTED} ${listedRow(codes)}s; these codes give about ${listedText(codes)}.`;
}

/**
 * The refusal of a list of `codes` that more rows fit than it holds, which the estimate allowed;
 * the rows named as the list names them (listedRow): phrases where one set of codes gives several.
 */
function listOverflow(codes: MissingCodes): Error {
  return ERRORS.create("list-overflow", [`${listedRow(codes)}s`]);
}

/** The phrases that `backup` gives with `dates` and that pass their own checksum. */
function phrasesOf(backup: EncodedBackup, dates: readonly DateShiftDate[]): string[] {
  return backup
    .candidates(dates)
    .filter((result) => result.checksumValid)
    .map((result) => result.recoveredMnemonic);
}

/** Seconds that decoding `backup` with `dates` takes in this host, phrases and checksums too. */
function secondsToDecode(
  backup: EncodedBackup,
  dates: readonly DateShiftDate[],
  now?: MonotonicClock,
): number {
  const elapsed = startTimer(now);
  phrasesOf(backup, dates);
  return elapsed();
}

/**
 * The one set found, with the `warning` of the wallet check that passed it, none, or several, as a
 * result; or that the host stopped the search.
 */
function foundOne(
  searchedCodes: SearchedCodes,
  nothing: string,
  dates: readonly DateShiftDate[] | undefined,
  run: MissingCodesRun,
  warning?: string,
): MissingCodesResult {
  const { passed, stopped } = searchedCodes;
  if (stopped || !stillRunning(run)) return STOPPED;
  if (passed === 0) return { kind: "none", message: nothing };
  if (passed === 1)
    return {
      kind: "found",
      backup: searchedCodes.takeOnly(),
      dates,
      ...(warning === undefined ? {} : { warning }),
    };
  // Counted by every set that passed, as the progress counts them, not by those kept.
  return severalSets(passed, "codes");
}

/** That `count` sets of `what` fit, which the wallet tells apart. */
function severalSets(count: number, what: string): MissingCodesResult {
  return {
    kind: "several",
    count,
    message: `${counted(count, "set")} of ${what} fit; the wallet tells which is yours.`,
  };
}

/**
 * The search of codes marked with ?, for one set of codes. A class, so that a host binds its
 * fingerprint once and every way it offers follows the same rules; each way is prepared with its
 * answers and planned before it runs.
 */
export class MissingCodesSearch {
  /** Candidates few enough to be listed (the way "list"). */
  static readonly MAX_LISTED = MAX_LISTED;

  readonly #codes: MissingCodes;
  readonly #fingerprint: PhraseFingerprint;

  /**
   * Borrows `codes`, whose owner keeps it live while ways of it are prepared and run, and binds the
   * host's `fingerprint`; refuses one that is no function
   * (core.missing-codes-search.search-host-s-fingerprint-function, a TypeError).
   */
  constructor(codes: MissingCodes, fingerprint: PhraseFingerprint) {
    if (typeof fingerprint !== "function")
      throw ERRORS.create("search-host-s-fingerprint-function", []);
    this.#codes = codes;
    this.#fingerprint = fingerprint;
  }

  /**
   * The places of `codes` that cannot be read: "Code 6", "Codes 6 and 9"; "Words 10 and 11" for
   * colours, whose marks leave words open (EncodedForm.placeName), and "Words 1 and 2 or words 11
   * and 12" where their tags leave two placements open, of which one is right.
   */
  static placesText(codes: MissingCodes): string {
    const name = EncodedForm.of(codes.format).placeName;
    return codes.placements
      .map((places, placement) => {
        const named = placesNamed(name, places);
        return placement === 0 ? named : lowerFirst(named);
      })
      .join(" or ");
  }

  /** The borrowed marked-code owner; its creating caller remains responsible for its lifetime. */
  get codes(): MissingCodes {
    return this.#codes;
  }

  /** What cannot be read, and how many candidates that leaves. */
  get unreadable(): string {
    const codes = this.#codes;
    // Where one set of codes gives several phrases, those too (AUD-037-FUN002).
    const gives = codes.expected === 1 ? "gives" : "give";
    const phrases = Masking.of(codes.mode).givesSeveral
      ? `, which ${gives} about ${listedText(codes)}`
      : "";
    return `${MissingCodesSearch.placesText(codes)} cannot be read: ${counted(codes.combinations, "combination")}, about ${counted(codes.expected, "candidate")}${phrases}.`;
  }

  /**
   * Whether `error` is the refusal of a listed search that found more candidates than a list
   * holds, which its estimate allowed: another way tells them.
   */
  static isListOverflow(error: unknown): boolean {
    return ERRORS.matches(error, ["list-overflow"]);
  }

  /** Whether so many candidates are left that only a fingerprint or an address tells them. */
  get many(): boolean {
    return listedRows(this.#codes) > MAX_LISTED;
  }

  /**
   * The ways offered for the codes: the encoded fingerprint only where the codes were masked and
   * keep a checksum (without Seedshift it is the wallet's own, which the wallet way takes), the
   * wallet always, and the list where the candidates are few.
   */
  get ways(): readonly MissingCodesWayChoice[] {
    const masked = Masking.of(this.#codes.mode).masked;
    const ways: MissingCodesWayChoice[] = [];
    if (masked && this.#codes.checksummed)
      ways.push({
        way: "encoded",
        label: "Encoded fingerprint",
        note: "the one Encode showed; no dates needed",
      });
    ways.push({
      way: "wallet",
      label: "The wallet",
      note: masked
        ? "its fingerprint or an address, after the dates"
        : "its fingerprint or an address",
    });
    if (!this.many)
      ways.push({ way: "list", label: "List every candidate", note: "compare them yourself" });
    return ways;
  }

  /**
   * Whether `way` can tell these codes when the person names it ahead, as an option does: the
   * encoded fingerprint wherever the codes keep a checksum, the wallet always, the list where the
   * estimated candidates are few. A listed run also checks its actual result size and refuses
   * an overflow; an estimate is not a completeness bound.
   */
  fits(way: MissingCodesWay): boolean {
    return this.whyNot(way) === undefined;
  }

  /** Why `way` cannot tell these codes, or undefined when it can (fits). */
  whyNot(way: MissingCodesWay): string | undefined {
    if (way === "encoded" && !this.#codes.checksummed)
      return "These codes keep no checksum, so their encoded fingerprint cannot tell them.";
    if (way === "list" && this.many) return tooManyToList(this.#codes);
    return undefined;
  }

  /** Whether the dates of these codes are needed: they were masked. */
  get needsDates(): boolean {
    return Masking.of(this.#codes.mode).masked;
  }

  /**
   * The codes whose own fingerprint is `fingerprint`, the encoded one that Encode showed, read as
   * parseMasterFingerprint reads it. Refuses one that is not eight hexadecimal characters
   * (core.wallet-check.master-fingerprint-eight-hexadecimal-characters).
   */
  byEncodedFingerprint(fingerprint: string): MissingCodesWaySearch {
    return new EncodedFingerprintWay(this.#codes, this.#fingerprint, fingerprint);
  }

  /**
   * The codes whose phrase, with `dates`, matches the wallet. Dates with forgotten digits are
   * searched for each candidate of the codes (DateSearch), so that codes and dates are found
   * together; without dates the codes were not masked.
   * An incomplete date answer is borrowed: keep it live through this way's plan and run. Refuses
   * dates with forgotten digits for codes that were not masked
   * (core.missing-codes-search.codes-were-not-masked-no-dates-search).
   */
  byWallet(walletCheck: WalletCheck, dates?: DatesAnswer): MissingCodesWaySearch {
    return dates?.hasForgottenDigits === true
      ? new WalletAndDatesWay(this.#codes, walletCheck, dates)
      : new WalletWay(this.#codes, walletCheck, dates?.known ?? []);
  }

  /**
   * Every candidate with its phrase, complete `dates` and fingerprint. Refuses at once codes whose
   * estimated rows exceed MAX_LISTED, as whyNot says (core.missing-codes-search.operation-refused),
   * and dates as ownedDates and DatesAnswer.of refuse them; its run refuses with list-overflow if
   * the actual count exceeds MAX_LISTED, even when the estimate permitted this way.
   */
  listed(dates: readonly DateShiftDate[]): MissingCodesWaySearch {
    return new ListWay(this.#codes, this.#fingerprint, dates);
  }
}

/** What a search of the codes kept, how many sets of codes passed in all, and whether it stopped. */
class SearchedCodes implements Disposable {
  #found: EncodedBackup[];
  readonly passed: number;
  readonly stopped: boolean;

  constructor(found: readonly EncodedBackup[], passed: number, stopped: boolean) {
    this.#found = [...found];
    this.passed = passed;
    this.stopped = stopped;
  }

  get found(): readonly EncodedBackup[] {
    return this.#found;
  }

  /** Transfers the sole backup, after all checks that could fail have completed. */
  takeOnly(): EncodedBackup {
    const only = defined(this.#found[0]);
    this.#found = [];
    return only;
  }

  wipe(): void {
    for (const backup of this.#found) backup.wipe();
    this.#found = [];
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The search of `codes` with `check`, with the host's progress and signal. */
async function searched(
  codes: MissingCodes,
  check: (indexes: readonly number[]) => boolean | Promise<boolean>,
  run: MissingCodesRun,
  maxFound?: number,
): Promise<SearchedCodes> {
  const result = await codes.run({
    check,
    maxFound,
    signal: run.signal,
    turn: run.turn,
    now: run.now,
    onProgress:
      run.onProgress === undefined
        ? undefined
        : ({ checked, found }) =>
            defined(run.onProgress)({ checked, total: codes.expected, found }),
  });
  return new SearchedCodes(result.found, result.passed, result.stopped || !stillRunning(run));
}

/** The way of the encoded fingerprint, which needs no dates. */
class EncodedFingerprintWay implements MissingCodesWaySearch {
  readonly #input: CodeSearchInput;
  #fingerprintOf: PhraseFingerprint | undefined;
  readonly #fingerprint: string;

  constructor(codes: MissingCodes, fingerprintOf: PhraseFingerprint, fingerprint: string) {
    // Read as every fingerprint is: a wrong one is refused when the way is made.
    this.#fingerprint = parseMasterFingerprint(fingerprint);
    this.#input = new CodeSearchInput(codes);
    this.#fingerprintOf = fingerprintOf;
  }

  async plan(limit?: number, now?: MonotonicClock): Promise<MissingCodesPlan> {
    this.#input.assertLive();
    const fingerprintOf = defined(this.#fingerprintOf);
    const perFingerprint = await DateSearch.secondsPerCheck(
      async (mnemonic) => ({
        matched: (await this.#input.checked(() => fingerprintOf(mnemonic))) === "",
      }),
      now,
    );
    const expected = this.#input.codes.expected;
    return SearchPlan.of(
      counted(expected, "candidate"),
      expected,
      expected * perFingerprint,
      limit,
    );
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const codes = this.#input.codes;
    const walletCheck = fingerprintWalletCheck(defined(this.#fingerprintOf), this.#fingerprint);
    // What the match says: the fingerprint of the codes is only a filter too (AUD-037-SEC004).
    let warning: string | undefined;
    using found = await searched(
      codes,
      async (indexes) => {
        const answer = await this.#input.checked(() => walletCheck(phraseOfIndexes(indexes)));
        if (answer.matched) warning ??= answer.warning;
        return answer.matched;
      },
      run,
    );
    this.#input.assertLive();
    // The codes are found without dates, which are asked afterwards as for complete codes.
    return foundOne(found, MISSING_CODES_TEXTS.noneByFingerprint, undefined, run, warning);
  }

  wipe(): void {
    this.#input.wipe();
    this.#fingerprintOf = undefined;
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The way of the wallet with complete dates, or none where the codes were not masked. */
class WalletWay implements MissingCodesWaySearch {
  readonly #input: CodeSearchInput;
  #walletCheck: WalletCheck | undefined;

  constructor(codes: MissingCodes, walletCheck: WalletCheck, dates: readonly DateShiftDate[]) {
    this.#input = new CodeSearchInput(codes, dates);
    this.#walletCheck = walletCheck;
  }

  /**
   * The time of the search: for each candidate, its decoding with the dates, timed on the first,
   * and the wallet checks of the phrases it gives, as many as its mode gives (checksPerDecoding).
   */
  async plan(limit?: number, now?: MonotonicClock): Promise<MissingCodesPlan> {
    const codes = this.#input.codes;
    const expected = codes.expected;
    const perCheck = await DateSearch.secondsPerCheck(
      (phrase) => this.#input.checked(() => defined(this.#walletCheck)(phrase)),
      now,
    );
    this.#input.assertLive();
    const checks = Masking.of(codes.mode).checksPerDecoding(codes.wordCount);
    const first = this.#input.first();
    let perDecoding = 0;
    if (first !== undefined) {
      try {
        using backup = EncodedBackup.of(first, codes.format, codes.mode);
        perDecoding = secondsToDecode(backup, this.#input.dates, now);
      } finally {
        first.fill(0);
      }
    }
    const seconds = expected * (perDecoding + checks * perCheck);
    this.#input.assertLive();
    return SearchPlan.of(counted(expected, "candidate"), expected, seconds, limit);
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const codes = this.#input.codes;
    let warning: string | undefined;
    using found = await searched(
      codes,
      async (indexes) => {
        this.#input.assertLive();
        using backup = EncodedBackup.of(indexes, codes.format, codes.mode);
        for (const phrase of phrasesOf(backup, this.#input.dates)) {
          const match = await this.#input.checked(() =>
            askWallet(defined(this.#walletCheck), phrase),
          );
          if (!match.matched) continue;
          warning ??= match.warning;
          return true;
        }
        return false;
      },
      run,
    );
    return foundOne(found, MISSING_CODES_TEXTS.noneByWallet, this.#input.dates, run, warning);
  }

  wipe(): void {
    this.#input.wipe();
    this.#walletCheck = undefined;
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The way of the wallet where dates have forgotten digits: codes and dates found together. */
class WalletAndDatesWay implements MissingCodesWaySearch {
  readonly #input: CodeSearchInput;
  readonly #mode: SeedshiftMode;
  #walletCheck: WalletCheck | undefined;

  constructor(codes: MissingCodes, walletCheck: WalletCheck, dates: DatesAnswer) {
    const { mode } = codes;
    if (!Masking.isMaskedMode(mode))
      throw ERRORS.create("codes-were-not-masked-no-dates-search", []);
    this.#input = new CodeSearchInput(codes, [], dates);
    this.#mode = mode;
    this.#walletCheck = walletCheck;
  }

  /**
   * The date search of one candidate of the codes: it tries every combination of the dates, and
   * keeps the first match.
   */
  #searchOf(indexes: readonly number[]): DateSearch {
    return new DateSearch({
      indexes,
      dates: this.#input.patterns,
      mode: this.#mode,
      walletCheck: (phrase) => this.#input.checked(() => defined(this.#walletCheck)(phrase)),
      maxShown: 1,
    });
  }

  async plan(limit?: number, now?: MonotonicClock): Promise<MissingCodesPlan> {
    const codes = this.#input.codes;
    const dates = this.#input.patterns;
    const size = `${counted(codes.expected, "candidate")} with ${counted(dates.combinations, "date combination")} each`;
    const count = codes.expected * dates.combinations;
    const first = this.#input.first();
    // No candidate at all: nothing to try or time, and the run finds none at once.
    if (first === undefined) return SearchPlan.of(size, 0, 0, limit);
    try {
      using probe = this.#searchOf(first);
      first.fill(0);
      const seconds = codes.expected * probe.estimatedSeconds(await probe.pace(now));
      this.#input.assertLive();
      return SearchPlan.of(size, count, seconds, limit);
    } finally {
      first.fill(0);
    }
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    // The match of the first set of codes and dates that matched, which is the result where its
    // phrase is the only one; another phrase, of other codes or of other dates of the same codes,
    // makes the result a count alone.
    let first: DateMatch | undefined;
    // Each phrase that the wallet check passed, once over the whole search: one phrase reached by
    // several sets of codes and dates is one wallet (AUD-010-FUN001, AUD-037-FUN001).
    const phrases = new Set<string>();
    // How many sets of codes and dates passed.
    let sets = 0;
    using found = await searched(
      this.#input.codes,
      async (indexes) => {
        using search = this.#searchOf(indexes);
        const result = await search.run({
          signal: run.signal,
          turn: run.turn,
          now: run.now,
          onMatch: (match) => {
            phrases.add(match.mnemonic);
            sets += 1;
          },
        });
        this.#input.assertLive();
        // A stop is heard by the search of the codes too, at its next turn.
        if (result.stopped) return false;
        const match = result.shown[0];
        if (match === undefined) return false;
        first ??= match;
        return true;
      },
      run,
      1,
    );
    this.#input.assertLive();
    if (found.stopped || !stillRunning(run)) return STOPPED;
    // Two phrases fit, which a fingerprint leaves only by chance: the wallet tells which is yours,
    // whether they differ in their codes or only in their dates (AUD-037-FUN001).
    if (phrases.size > 1) return severalSets(phrases.size, "codes and dates");
    if (found.passed === 0) return foundOne(found, MISSING_CODES_TEXTS.noneByWallet, [], run);
    const match = defined(first);
    // The codes are decoded with every date, the known ones too: the guessed ones alone give
    // another phrase (AUD-012-FUN001). Checked here, so that no host decodes another wallet.
    const decoded = defined(found.found[0]).candidates(match.allDates);
    if (!decoded.some((phrase) => phrase.recoveredMnemonic === match.mnemonic))
      throw ERRORS.create("dates-found-do-not-decode-codes-wallet-matched", []);
    if (!stillRunning(run)) return STOPPED;
    return {
      kind: "found",
      backup: found.takeOnly(),
      dates: match.allDates,
      foundDates: match.dates,
      ...(sets > 1 ? { others: sets - 1 } : {}),
      ...(match.warning === undefined ? {} : { warning: match.warning }),
    };
  }

  wipe(): void {
    this.#input.wipe();
    this.#walletCheck = undefined;
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}

/** The way of the list: every candidate, where they are few. */
class ListWay implements MissingCodesWaySearch {
  readonly #input: CodeSearchInput;
  #fingerprintOf: PhraseFingerprint | undefined;

  constructor(
    codes: MissingCodes,
    fingerprintOf: PhraseFingerprint,
    dates: readonly DateShiftDate[],
  ) {
    if (listedRows(codes) > MAX_LISTED)
      throw ERRORS.create("operation-refused", [tooManyToList(codes)]);
    this.#input = new CodeSearchInput(codes, dates);
    this.#fingerprintOf = fingerprintOf;
  }

  async plan(limit?: number): Promise<MissingCodesPlan> {
    // Said as the list's rows; counted as the sets of codes that a limit of candidates counts.
    const { codes } = this.#input;
    return SearchPlan.of(listedText(codes), codes.expected, 0, limit);
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const { codes } = this.#input;
    using result = await searched(codes, () => true, run, MAX_LISTED);
    this.#input.assertLive();
    const { found, passed, stopped } = result;
    if (stopped || !stillRunning(run)) return STOPPED;
    // expected is an average; passed counts every candidate even when storage is capped. Where
    // one set gives several phrases, more sets than the list holds give more phrases too.
    if (passed > MAX_LISTED) throw listOverflow(codes);
    const rows: MissingCodesRow[] = [];
    for (const backup of found)
      for (const phrase of phrasesOf(backup, this.#input.dates)) {
        // One set of legacy valid-last-word codes may decode to several phrases.
        if (rows.length === MAX_LISTED) throw listOverflow(codes);
        const fingerprint = await this.#input.checked(() => defined(this.#fingerprintOf)(phrase));
        if (!stillRunning(run)) return STOPPED;
        rows.push({
          codes: backup.text(),
          phrase,
          fingerprint,
        });
      }
    // The host's fingerprints are waited for after the search: a stop meanwhile lists nothing.
    return stillRunning(run) ? { kind: "list", rows } : STOPPED;
  }

  wipe(): void {
    this.#input.wipe();
    this.#fingerprintOf = undefined;
  }

  [Symbol.dispose](): void {
    this.wipe();
  }
}
