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
// Host-neutral: it reaches only core modules, the text helpers of sskr/repair-report.ts and the
// BIP39 word list.

import { RepairReport } from "../sskr/repair-report.js";
import type { SeedshiftMode } from "./date-recovery.js";
import { DateSearch, type DatesAnswer } from "./date-search.js";
import { parseDate } from "./dates.js";
import { EncodedBackup } from "./encoded-backup.js";
import { Masking } from "./masking.js";
import type { MissingCodes } from "./missing-codes.js";
import { QUESTION_SECONDS } from "./search-turns.js";
import type { DateShiftDate } from "./types.js";
import type { WalletCheck } from "./wallet-check.js";
import { englishWordlist } from "./words.js";

/** How the right codes are told. */
export type MissingCodesWay = "encoded" | "wallet" | "list";

/** A way offered for codes, with the words a host shows for it. */
export interface MissingCodesWayChoice {
  readonly way: MissingCodesWay;
  readonly label: string;
  readonly note: string;
}

/** The texts that every host shows as they are. */
export const MISSING_CODES_TEXTS = Object.freeze({
  question: "How can MnemoCode tell the right codes?",
  many: "A fingerprint or an address tells the right codes among them.",
  noneByFingerprint: "No codes fit this fingerprint: check it, and the codes.",
  noneByWallet: "No codes give this wallet: check the dates, the wallet and the codes.",
  correct: "Correct the written copy; then check the wallet that comes back.",
  list: "Each line: the codes, the seed phrase they give, and its fingerprint with an empty BIP39 passphrase. Compare the fingerprint with your wallet.",
});

/** One candidate of a listed search: the codes, the phrase they give, and its fingerprint. */
export interface MissingCodesRow {
  readonly codes: string;
  readonly phrase: string;
  readonly fingerprint: string;
}

/** What one way found. */
export type MissingCodesResult =
  /**
   * The one set of codes that fits, with the dates it was decoded with, found or known; none
   * where the way needed no dates, which the host then asks as for complete codes.
   */
  | {
      readonly kind: "found";
      readonly backup: EncodedBackup;
      readonly dates?: readonly DateShiftDate[] | undefined;
      /** The dates as found by a search of their forgotten digits, as DD-MM-YYYY joined by spaces. */
      readonly foundDates?: string | undefined;
    }
  /** Every candidate, for the person to compare. */
  | { readonly kind: "list"; readonly rows: readonly MissingCodesRow[] }
  /** No codes fit: `message` says what to check. */
  | { readonly kind: "none"; readonly message: string }
  /** Several sets fit, which a fingerprint leaves only by chance: the wallet tells them apart. */
  | { readonly kind: "several"; readonly count: number; readonly message: string };

/** A search of one way before it starts: what the person is told, and whether they are asked. */
export interface MissingCodesPlan {
  /** What is searched, such as "128 candidates" or "128 candidates with 10 date combinations each". */
  readonly size: string;
  /** The combinations tried, counted against the person's limit. */
  readonly count: number;
  /** About how long it takes in this host, in seconds. */
  readonly seconds: number;
  /** Whether it is asked for first: over the limit, or without one longer than twelve hours. */
  readonly ask: boolean;
  /** Whether its time is said before it starts, when it is not asked for: a minute or more. */
  readonly tell: boolean;
}

/** The host's services for a run. */
export interface MissingCodesRun {
  readonly signal?: AbortSignal | undefined;
  /** Called as the candidates are checked: how many so far, of about how many, and found. */
  readonly onProgress?:
    | ((progress: {
        readonly count: number;
        readonly expected: number;
        readonly found: number;
      }) => void)
    | undefined;
}

/** One way prepared with its answers: its plan first, then its run. */
export interface MissingCodesWaySearch {
  plan(limit?: number): Promise<MissingCodesPlan>;
  run(run?: MissingCodesRun): Promise<MissingCodesResult>;
}

/** The master fingerprint of a phrase with an empty BIP39 passphrase; it may answer later. */
export type PhraseFingerprint = (mnemonic: string) => string | PromiseLike<string>;

/** Candidates few enough to be listed for the person to compare. */
const MAX_LISTED = 16;
/** A search expected to take at least this long has its time said before it starts. */
const LONG_SEARCH_SECONDS = 60;

/** The phrase of codes as English words, which a fingerprint is taken of. */
function phraseOf(indexes: readonly number[]): string {
  return indexes.map((index) => englishWordlist[index]!).join(" ");
}

/** The phrases that `backup` gives with `dates` and that pass their own checksum. */
function phrasesOf(backup: EncodedBackup, dates: readonly DateShiftDate[]): string[] {
  return backup
    .candidates(dates)
    .filter((result) => result.checksumValid)
    .map((result) => result.recoveredMnemonic);
}

/** A plan from its size, count and time, with `limit`, the person's own, if they gave one. */
function planOf(
  size: string,
  count: number,
  seconds: number,
  limit: number | undefined,
): MissingCodesPlan {
  const ask = limit !== undefined ? count > limit : seconds > QUESTION_SECONDS;
  return { size, count, seconds, ask, tell: !ask && seconds >= LONG_SEARCH_SECONDS };
}

/** The one set found, none, or several, as a result. */
function foundOne(
  found: readonly EncodedBackup[],
  nothing: string,
  dates: readonly DateShiftDate[] | undefined,
): MissingCodesResult {
  if (found.length === 0) return { kind: "none", message: nothing };
  if (found.length === 1) return { kind: "found", backup: found[0]!, dates };
  return {
    kind: "several",
    count: found.length,
    message: `${found.length} sets of codes fit; the wallet tells which is yours.`,
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

  constructor(codes: MissingCodes, fingerprint: PhraseFingerprint) {
    if (typeof fingerprint !== "function")
      throw new TypeError("The search needs the host's fingerprint function.");
    this.#codes = codes;
    this.#fingerprint = fingerprint;
  }

  /** "Code 6", "Codes 6 and 9", "Codes 2, 6 and 9". */
  static placesText(places: readonly number[]): string {
    if (places.length === 1) return `Code ${places[0]}`;
    return `Codes ${places.slice(0, -1).join(", ")} and ${places.at(-1)}`;
  }

  get codes(): MissingCodes {
    return this.#codes;
  }

  /** What cannot be read, and how many candidates that leaves. */
  get unreadable(): string {
    const codes = this.#codes;
    return `${MissingCodesSearch.placesText(codes.missingPlaces)} cannot be read: ${RepairReport.counted(codes.combinations, "combination")}, about ${RepairReport.counted(codes.expected, "candidate")}.`;
  }

  /** Whether so many candidates are left that only a fingerprint or an address tells them. */
  get many(): boolean {
    return this.#codes.expected > MAX_LISTED;
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
   * candidates are few.
   */
  fits(way: MissingCodesWay): boolean {
    if (way === "encoded") return this.#codes.checksummed;
    if (way === "list") return !this.many;
    return true;
  }

  /** Whether the dates of these codes are needed: they were masked. */
  get needsDates(): boolean {
    return Masking.of(this.#codes.mode).masked;
  }

  /** The codes whose own fingerprint is `fingerprint`, the encoded one that Encode showed. */
  byEncodedFingerprint(fingerprint: string): MissingCodesWaySearch {
    return new EncodedFingerprintWay(this.#codes, this.#fingerprint, fingerprint);
  }

  /**
   * The codes whose phrase, with `dates`, matches the wallet. Dates with forgotten digits are
   * searched for each candidate of the codes (DateSearch), so that codes and dates are found
   * together; without dates the codes were not masked.
   */
  byWallet(walletCheck: WalletCheck, dates?: DatesAnswer): MissingCodesWaySearch {
    return dates?.hasForgottenDigits === true
      ? new WalletAndDatesWay(this.#codes, walletCheck, dates)
      : new WalletWay(this.#codes, walletCheck, dates?.known ?? []);
  }

  /** Every candidate with its phrase, with the complete `dates`, and its fingerprint. */
  listed(dates: readonly DateShiftDate[]): MissingCodesWaySearch {
    return new ListWay(this.#codes, this.#fingerprint, dates);
  }
}

/** The search of `codes` with `check`, with the host's progress and signal. */
async function searched(
  codes: MissingCodes,
  check: (indexes: readonly number[]) => boolean | Promise<boolean>,
  run: MissingCodesRun,
): Promise<readonly EncodedBackup[]> {
  const result = await codes.run({
    check,
    signal: run.signal,
    onProgress:
      run.onProgress === undefined
        ? undefined
        : ({ count, found }) => run.onProgress!({ count, expected: codes.expected, found }),
  });
  return result.found;
}

/** The way of the encoded fingerprint, which needs no dates. */
class EncodedFingerprintWay implements MissingCodesWaySearch {
  readonly #codes: MissingCodes;
  readonly #fingerprintOf: PhraseFingerprint;
  readonly #fingerprint: string;

  constructor(codes: MissingCodes, fingerprintOf: PhraseFingerprint, fingerprint: string) {
    this.#codes = codes;
    this.#fingerprintOf = fingerprintOf;
    this.#fingerprint = fingerprint;
  }

  async plan(limit?: number): Promise<MissingCodesPlan> {
    const fingerprintOf = this.#fingerprintOf;
    const perFingerprint = await DateSearch.secondsPerCheck(async (mnemonic) => ({
      matched: (await fingerprintOf(mnemonic)) === "",
      path: "m",
    }));
    const expected = this.#codes.expected;
    return planOf(
      RepairReport.counted(expected, "candidate"),
      expected,
      expected * perFingerprint,
      limit,
    );
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const found = await searched(
      this.#codes,
      async (indexes) => (await this.#fingerprintOf(phraseOf(indexes))) === this.#fingerprint,
      run,
    );
    // The codes are found without dates, which are asked afterwards as for complete codes.
    return foundOne(found, MISSING_CODES_TEXTS.noneByFingerprint, undefined);
  }
}

/** The way of the wallet with complete dates, or none where the codes were not masked. */
class WalletWay implements MissingCodesWaySearch {
  readonly #codes: MissingCodes;
  readonly #walletCheck: WalletCheck;
  readonly #dates: readonly DateShiftDate[];

  constructor(codes: MissingCodes, walletCheck: WalletCheck, dates: readonly DateShiftDate[]) {
    this.#codes = codes;
    this.#walletCheck = walletCheck;
    this.#dates = dates;
  }

  async plan(limit?: number): Promise<MissingCodesPlan> {
    const expected = this.#codes.expected;
    const seconds = expected * (await DateSearch.secondsPerCheck(this.#walletCheck));
    return planOf(RepairReport.counted(expected, "candidate"), expected, seconds, limit);
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const codes = this.#codes;
    const found = await searched(
      codes,
      async (indexes) => {
        for (const phrase of phrasesOf(
          EncodedBackup.of(indexes, codes.format, codes.mode),
          this.#dates,
        ))
          if ((await this.#walletCheck(phrase)).matched) return true;
        return false;
      },
      run,
    );
    return foundOne(found, MISSING_CODES_TEXTS.noneByWallet, this.#dates);
  }
}

/** The way of the wallet where dates have forgotten digits: codes and dates found together. */
class WalletAndDatesWay implements MissingCodesWaySearch {
  readonly #codes: MissingCodes;
  readonly #walletCheck: WalletCheck;
  readonly #dates: DatesAnswer;

  constructor(codes: MissingCodes, walletCheck: WalletCheck, dates: DatesAnswer) {
    if (!Masking.of(codes.mode).masked)
      throw new Error("Codes that were not masked have no dates to search.");
    this.#codes = codes;
    this.#walletCheck = walletCheck;
    this.#dates = dates;
  }

  /** The date search of one candidate of the codes, which stops at its first match. */
  #searchOf(indexes: readonly number[]): DateSearch {
    return new DateSearch({
      indexes,
      dates: this.#dates,
      // Checked masked in the constructor.
      mode: this.#codes.mode as SeedshiftMode,
      walletCheck: this.#walletCheck,
      maxShown: 1,
    });
  }

  async plan(limit?: number): Promise<MissingCodesPlan> {
    const codes = this.#codes;
    const dates = this.#dates;
    const size = `${RepairReport.counted(codes.expected, "candidate")} with ${RepairReport.counted(dates.combinations, "date combination")} each`;
    const count = codes.expected * dates.combinations;
    const first = codes.candidates().next();
    // No candidate at all: nothing to try or time, and the run finds none at once.
    if (first.done === true) return planOf(size, 0, 0, limit);
    const probe = this.#searchOf(first.value);
    const seconds = codes.expected * probe.estimatedSeconds(await probe.pace());
    return planOf(size, count, seconds, limit);
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    // The dates of each set of codes that matched, by its codes, to decode them as they are.
    const matchedDates = new Map<string, string>();
    const found = await searched(
      this.#codes,
      async (indexes) => {
        const result = await this.#searchOf(indexes).run({ signal: run.signal });
        const match = result.shown[0];
        if (match === undefined) return false;
        matchedDates.set(indexes.join(" "), match.dates);
        return true;
      },
      run,
    );
    const result = foundOne(found, MISSING_CODES_TEXTS.noneByWallet, []);
    if (result.kind !== "found") return result;
    const foundDates = matchedDates.get(result.backup.indexes.join(" "))!;
    return { ...result, dates: foundDates.split(" ").map(parseDate), foundDates };
  }
}

/** The way of the list: every candidate, where they are few. */
class ListWay implements MissingCodesWaySearch {
  readonly #codes: MissingCodes;
  readonly #fingerprintOf: PhraseFingerprint;
  readonly #dates: readonly DateShiftDate[];

  constructor(
    codes: MissingCodes,
    fingerprintOf: PhraseFingerprint,
    dates: readonly DateShiftDate[],
  ) {
    if (codes.expected > MAX_LISTED)
      throw new Error(
        `A list holds at most ${MAX_LISTED} candidates; these codes have about ${RepairReport.counted(codes.expected, "candidate")}.`,
      );
    this.#codes = codes;
    this.#fingerprintOf = fingerprintOf;
    this.#dates = dates;
  }

  async plan(limit?: number): Promise<MissingCodesPlan> {
    const expected = this.#codes.expected;
    return planOf(RepairReport.counted(expected, "candidate"), expected, 0, limit);
  }

  async run(run: MissingCodesRun = {}): Promise<MissingCodesResult> {
    const found = await searched(this.#codes, () => true, run);
    const rows: MissingCodesRow[] = [];
    for (const backup of found)
      for (const phrase of phrasesOf(backup, this.#dates))
        rows.push({
          codes: backup.text(),
          phrase,
          fingerprint: await this.#fingerprintOf(phrase),
        });
    return { kind: "list", rows };
  }
}
