// The written-backup check: whether a backup typed again from paper restores the seed phrase just
// encoded, without showing it. Most losses come from a backup written wrongly, not from theft. Two
// kinds of backup are checked behind one interface (BackupCheck): the encoded seed phrase, as codes
// or an MNC1 record (EncodedBackupCheck), and Shamir shares (ShareBackupCheck), each with its dates
// when Seedshift masked it. What does not fit is a finding: its part (the codes, the shares or the
// dates), its places in that part, counted from 1, and a line that says it without repeating any
// secret.
//
// From the host it needs: for shares, its SharePlatform (sskr/share-platform.ts), with which
// ShareSet (sskr/share-set.ts) restores them, also those marked with ? (JointRepair), and the name
// of its reader of an encoded seed phrase, for a phrase typed in place of shares (ShareInput); the
// host runs its SSKR self-test before, as the command line does before a split. The codes are read
// as the encoded backup reads them (EncodedBackup, Masking), the shares as the restore reads them
// (ShareInput), and the dates with the dates part (DatesAnswer, core/date-search.ts).
//
// It does not ask, print or save anything, and keeps nothing but the result it compares with; no
// value it builds shows a code, a share or a phrase through toString, toJSON or Node.js's inspect.
// A host with a form, such as the Deriver, calls check() with the whole backup. A host that asks
// part by part, as the command line does, calls the steps (read, then compare) and asks again only
// for the part that a finding names.

import { parseRecord, type RecordFormat, type RecordMode } from "../record.js";
import type { SharePlatform } from "../sskr/share-platform.js";
import { ShareInput, type TypedShare } from "../sskr/share-input.js";
import { ShareSet } from "../sskr/share-set.js";
import { readShare } from "../sskr/transport.js";
import { DatesAnswer } from "./date-search.js";
import { formatDate, ownedDate } from "./dates.js";
import { EncodedBackup } from "./encoded-backup.js";
import { Masking } from "./masking.js";
import { placesInWords } from "./places.js";
import type { DateShiftDate } from "./types.js";

/** The part of a backup that a finding is about. */
export type BackupPart = "codes" | "shares" | "dates";

/**
 * Why a part does not give the result: it cannot be read; a record names another mode; it has
 * another number of codes or dates; the codes or dates at its places are not those of the result;
 * it gives another seed phrase; or it gives this one, but some shares or repaired elements were not
 * checked.
 */
export type FindingKind = "unreadable" | "mode" | "count" | "places" | "other-phrase" | "unchecked";

/** A part of a backup that does not give the result. */
export interface BackupFinding {
  readonly part: BackupPart;
  readonly kind: FindingKind;
  /**
   * Where in the part, counted from 1: the codes, shares or dates by their places among those
   * typed. Empty when the line is about the part as a whole.
   */
  readonly places: readonly number[];
  /** One line that says it, naming places only. */
  readonly message: string;
}

/** What a whole check found, in one word. */
export type BackupVerdict = "restores" | "differs" | "unreadable" | "unchecked";

/** What a whole check found: the verdict, its line, the finding behind it, and notes. */
export interface BackupResult {
  readonly verdict: BackupVerdict;
  /** RESTORES_MESSAGE, or the finding's line. */
  readonly message: string;
  readonly finding?: BackupFinding;
  /** What was left out on the way, such as a copy of a share, one line each. */
  readonly notes: readonly string[];
}

/** A backup as written down, typed again whole. */
export interface WrittenBackup {
  /** The codes or an MNC1 record; or the shares, separated by ;, with ? for unreadable elements. */
  readonly backup: string;
  /** The dates, separated by spaces; not read for a backup without Seedshift. */
  readonly dates?: string;
}

/** A check of one kind of backup against the result just shown. */
export interface BackupCheck {
  /** Whether the backup has dates, which are typed again too: not without Seedshift. */
  readonly dated: boolean;
  /** The words of the seed phrase, which bound the number of dates. */
  readonly wordCount: number;
  /** Checks a whole backup at once; each part is read and compared, the first finding is told. */
  check(written: WrittenBackup): Promise<BackupResult>;
}

/** The line of a check that found nothing. */
export const RESTORES_MESSAGE = "The backup restores this seed phrase.";

/** What toString, toJSON and Node.js's inspect show of a value that holds part of a backup. */
const REDACTED = "[backup check: redacted]";

/** The verdict of each kind of finding: a part that can be read but does not fit differs. */
const VERDICTS: Readonly<Record<FindingKind, BackupVerdict>> = {
  unreadable: "unreadable",
  mode: "differs",
  count: "differs",
  places: "differs",
  "other-phrase": "differs",
  unchecked: "unchecked",
};

/** Why a backup of the Original Seedshift with a valid last word is not checked. */
const UNCHECKABLE =
  "A backup made with the Original Seedshift with a valid last word cannot be checked: its last word was replaced.";

function finding(
  part: BackupPart,
  kind: FindingKind,
  message: string,
  places: readonly number[] = [],
): BackupFinding {
  return Object.freeze({ part, kind, places: Object.freeze([...places]), message });
}

function resultOf(found: BackupFinding | undefined, notes: readonly string[] = []): BackupResult {
  const frozenNotes = Object.freeze([...notes]);
  return Object.freeze(
    found === undefined
      ? { verdict: "restores" as const, message: RESTORES_MESSAGE, notes: frozenNotes }
      : {
          verdict: VERDICTS[found.kind],
          message: found.message,
          finding: found,
          notes: frozenNotes,
        },
  );
}

/** The message of a refusal; anything thrown that is not an Error passes through. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) throw error;
  return error.message;
}

/** The number of words in a seed phrase as the core writes it. */
function wordCountOf(mnemonic: string): number {
  return mnemonic.split(/\s+/u).filter(Boolean).length;
}

/** The complete dates of one answer: no ?, at most as many as the phrase takes. */
function readDates(line: string, wordCount: number): readonly DateShiftDate[] {
  return DatesAnswer.parse(line, { wordCount, patterns: false }).known;
}

/**
 * How dates that can be read differ from the dates of the result: their count, or the places of
 * those that are not among them. The order does not matter: Seedshift sorts the dates.
 */
function compareDateLists(
  typed: readonly DateShiftDate[],
  original: readonly DateShiftDate[],
): BackupFinding | undefined {
  if (typed.length !== original.length)
    return finding(
      "dates",
      "count",
      `The backup was made with ${original.length} ${original.length === 1 ? "date" : "dates"}; ${typed.length} ${typed.length === 1 ? "was" : "were"} typed.`,
    );
  const left = original.map(formatDate);
  const places = typed.flatMap((date, place) => {
    const found = left.indexOf(formatDate(date));
    if (found < 0) return [place + 1];
    left.splice(found, 1);
    return [];
  });
  if (places.length === 0) return undefined;
  return finding(
    "dates",
    "places",
    places.length === 1
      ? `Date ${places[0]} is not one of the dates of this backup.`
      : `Dates ${placesInWords(places)} are not dates of this backup.`,
    places,
  );
}

// The encoded seed phrase.

/** The result just shown, which an encoded backup typed again must give. */
export interface EncodedOriginal {
  /** The seed phrase, as the core writes it. */
  readonly mnemonic: string;
  readonly format: RecordFormat;
  readonly mode: RecordMode;
  /** The codes of the result as BIP39 indexes, 0 to 2047. */
  readonly codes: readonly number[];
  readonly dates: readonly DateShiftDate[];
}

/**
 * Codes typed again: the mode they were written with, and the codes, read as the encoded backup
 * reads them (EncodedBackup, without its mode's checksum, so that a mistyped code is named by its
 * place rather than refused). Built only by `read`, so that every value holds as many codes as a
 * seed phrase has words.
 */
export class WrittenCodes {
  readonly #mode: RecordMode;
  readonly #codes: EncodedBackup;

  private constructor(mode: RecordMode, codes: EncodedBackup) {
    this.#mode = mode;
    this.#codes = codes;
  }

  /**
   * Reads the codes of a backup as written down, in `format` with `mode`, unless a record names
   * its own form and mode. Throws why they cannot be read, naming places and counts only.
   */
  static read(typed: string, format: RecordFormat, mode: RecordMode): WrittenCodes {
    const record = parseRecord(typed);
    const codes = EncodedBackup.read(record?.payload ?? typed, record?.format ?? format, "direct");
    return new WrittenCodes(record?.mode ?? mode, codes);
  }

  get mode(): RecordMode {
    return this.#mode;
  }

  get indexes(): readonly number[] {
    return this.#codes.indexes;
  }

  /**
   * Whether these codes and `dates` restore `mnemonic`, without handing out what they restore.
   * Throws when they cannot be undone, and for a mode that leaves several phrases, the Original
   * Seedshift with a valid last word, which only a search undoes.
   */
  restores(mnemonic: string, dates: readonly DateShiftDate[]): boolean {
    const masking = Masking.of(this.#mode);
    if (masking.givesSeveral) throw new Error(UNCHECKABLE);
    return masking.undo(this.#codes.indexes, dates)[0]!.recoveredMnemonic === mnemonic;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * The check of an encoded seed phrase: the codes or a record, then the dates. A class, so that a
 * host builds it once with the result just shown and calls its steps as each part is typed; it
 * keeps the result private and hands out nothing of it.
 */
export class EncodedBackupCheck implements BackupCheck {
  readonly #original: EncodedOriginal;

  /**
   * Whether a backup made in `mode` can be checked: not the Original Seedshift with a valid last
   * word, whose last word was replaced, so that only a search finds the seed phrase again.
   */
  static supports(mode: RecordMode): boolean {
    return Masking.of(mode).capabilities.backupCheck;
  }

  constructor(original: EncodedOriginal) {
    if (!EncodedBackupCheck.supports(original.mode)) throw new Error(UNCHECKABLE);
    this.#original = Object.freeze({
      ...original,
      codes: Object.freeze([...original.codes]),
      // Copied date by date: the caller keeps the originals and could change them (AUD-009-FUN001).
      // Array.from reads a hole of a sparse list as a date, which is refused; map would keep it.
      dates: Object.freeze(Array.from(original.dates, (date) => ownedDate(date))),
    });
  }

  get dated(): boolean {
    return Masking.of(this.#original.mode).masked;
  }

  get wordCount(): number {
    return this.#original.codes.length;
  }

  /** Reads the codes as written down (WrittenCodes.read), in the form and mode of the result. */
  readCodes(typed: string): WrittenCodes {
    return WrittenCodes.read(typed, this.#original.format, this.#original.mode);
  }

  /** Reads the dates as written down; throws why they cannot be read, naming dates by place. */
  readDates(line: string): readonly DateShiftDate[] {
    return readDates(line, this.wordCount);
  }

  /** How codes that can be read differ from those of the result: their mode, count or places. */
  compareCodes(codes: WrittenCodes): BackupFinding | undefined {
    const original = this.#original;
    if (codes.mode !== original.mode)
      return finding(
        "codes",
        "mode",
        `This record names ${Masking.of(codes.mode).name}; the backup was made with ${Masking.of(original.mode).name}.`,
      );
    if (codes.indexes.length !== original.codes.length)
      return finding(
        "codes",
        "count",
        `The backup has ${original.codes.length} codes; these are ${codes.indexes.length}.`,
      );
    const places = codes.indexes.flatMap((index, place) =>
      index === original.codes[place] ? [] : [place + 1],
    );
    if (places.length === 0) return undefined;
    return finding(
      "codes",
      "places",
      places.length === 1
        ? `The code at place ${places[0]} differs from the result.`
        : `The codes at places ${placesInWords(places)} differ from the result.`,
      places,
    );
  }

  /** How dates that can be read differ from the dates of the result. */
  compareDates(dates: readonly DateShiftDate[]): BackupFinding | undefined {
    return compareDateLists(dates, this.#original.dates);
  }

  /**
   * Whether the codes and the dates, each of the result, restore its seed phrase. Only a fault of
   * MnemoCode gives a finding here; it names the codes, which are then typed again.
   */
  compareRestored(codes: WrittenCodes, dates: readonly DateShiftDate[]): BackupFinding | undefined {
    if (codes.restores(this.#original.mnemonic, this.dated ? dates : [])) return undefined;
    return finding(
      "codes",
      "other-phrase",
      "The backup gives another seed phrase: check the codes and the dates.",
    );
  }

  async check(written: WrittenBackup): Promise<BackupResult> {
    let codes: WrittenCodes;
    try {
      codes = this.readCodes(written.backup);
    } catch (error) {
      return resultOf(finding("codes", "unreadable", messageOf(error)));
    }
    const codesFinding = this.compareCodes(codes);
    if (codesFinding !== undefined || !this.dated)
      return resultOf(codesFinding ?? this.compareRestored(codes, []));
    let dates: readonly DateShiftDate[];
    try {
      dates = this.readDates(written.dates ?? "");
    } catch (error) {
      return resultOf(finding("dates", "unreadable", messageOf(error)));
    }
    return resultOf(this.compareDates(dates) ?? this.compareRestored(codes, dates));
  }
}

// Shamir shares.

/** The result just shown, which Shamir shares typed again must give. */
export interface ShareOriginal {
  /** The seed phrase, as the core writes it. */
  readonly mnemonic: string;
  readonly mode: "direct" | "seedshift";
  /** The shares that restore it: as many are asked for. */
  readonly threshold: number;
  /** The dates of the result, when known: a date that is not one of them is named by its place. */
  readonly dates?: readonly DateShiftDate[] | undefined;
}

/** "This is one share" or "These are 3 shares": the shares of an answer, before a semicolon. */
function sharesTyped(count: number): string {
  return count === 1 ? "This is one share" : `These are ${count} shares`;
}

/**
 * The shares typed again, each once: an exact copy of a share typed before it is left out, with a
 * note, by the rule sskr-combine uses (ShareInput.copiesOf). A share with ? is kept as it is: only
 * its repair tells what it holds. A class built only by `of`, so that the shares kept, their
 * places among those typed and the notes always agree.
 */
export class KeptShares {
  readonly #kept: readonly TypedShare[];
  readonly #notes: readonly string[];

  private constructor(kept: readonly TypedShare[], notes: readonly string[]) {
    this.#kept = Object.freeze(kept);
    this.#notes = Object.freeze(notes);
  }

  /**
   * The shares of `texts`, in their order. Each share without ? must read: ShareBackupCheck's
   * shareProblem tells first why one does not.
   */
  static of(texts: readonly string[]): KeptShares {
    const typed: TypedShare[] = texts.map((text, index) => ({ place: index + 1, text }));
    const complete = typed
      .filter((share) => !share.text.includes("?"))
      .map((share) => ({ place: share.place, ur: readShare(share.text).ur }));
    const copies = ShareInput.copiesOf(complete);
    const copied = new Set(copies.map((copy) => copy.place));
    return new KeptShares(
      typed.filter((share) => !copied.has(share.place)),
      copies.map((copy) => copy.message),
    );
  }

  /** The shares kept, as typed. */
  get texts(): readonly string[] {
    return this.#kept.map((share) => share.text);
  }

  /** The places of the shares kept, among those typed. */
  get places(): readonly number[] {
    return this.#kept.map((share) => share.place);
  }

  /** One line for each copy left out. */
  get notes(): readonly string[] {
    return this.#notes;
  }

  /** Whether each share kept is at its place among those typed: no copy before it was left out. */
  get namedAsTyped(): boolean {
    return this.#kept.every((share, index) => share.place === index + 1);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * Shares as restored: the phrase they hold, and the places, among the shares typed, of those that
 * were not checked. A class, so that the phrase stays inside it, as in ShareSet: it is compared,
 * never handed out, and toString, toJSON and inspect show none of it. ShareBackupCheck.restore
 * builds it.
 */
export class RestoredShares {
  readonly #set: ShareSet;
  readonly #unchecked: readonly number[];

  private constructor(set: ShareSet, unchecked: readonly number[]) {
    this.#set = set;
    this.#unchecked = Object.freeze(unchecked);
  }

  /**
   * `set` as restored from `kept`. The set counts its shares from 1 among those it was given; they
   * are named here by their places among those typed.
   */
  static of(set: ShareSet, kept: KeptShares): RestoredShares {
    const places = kept.places;
    const shares = [...set.unchecked, ...set.unsettled.map((element) => element.share)];
    const unchecked = [...new Set(shares.map((share) => places[share - 1]!))];
    unchecked.sort((a, b) => a - b);
    return new RestoredShares(set, unchecked);
  }

  /** Whether the shares hold `phrase`: the seed phrase, or the one Seedshift masked it as. */
  holds(phrase: string): boolean {
    return this.#set.mnemonic === phrase;
  }

  /** Whether the phrase that the shares hold, with Seedshift undone with `dates`, is `mnemonic`. */
  unmasksTo(mnemonic: string, dates: readonly DateShiftDate[]): boolean {
    const masked = EncodedBackup.read(this.#set.mnemonic, "english", "seedshift");
    return masked.decode(dates).recoveredMnemonic === mnemonic;
  }

  /** Places of the shares that took no part, or that hold elements nothing settles. */
  get unchecked(): readonly number[] {
    return this.#unchecked;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/** The least threshold of a share check: the restore asks for the quorum the shares record. */
const MIN_THRESHOLD = 1;

/**
 * The check of Shamir shares: the shares, then the dates. A class, so that a host builds it once
 * with the result just shown and its SharePlatform, and calls its steps as each part is typed; it
 * keeps the result private and hands out nothing of it.
 */
export class ShareBackupCheck implements BackupCheck {
  readonly #original: ShareOriginal;
  readonly #platform: SharePlatform;
  /** The rules by which the restore reads typed shares, which the check reads them by too. */
  readonly #input: ShareInput;
  /** The phrase that shares of the result hold, when it is known (heldPhrase). */
  readonly #held: string | undefined;

  /**
   * `decodeEntry` names the host's reader of an encoded seed phrase, which a phrase typed in place
   * of the shares is sent to (ShareInput).
   */
  constructor(
    original: ShareOriginal,
    platform: SharePlatform,
    texts: { readonly decodeEntry: string },
  ) {
    // A JavaScript host may pass any mode, and shares are made in these two only (Masking's
    // capabilities). Another mode would ask no dates and, without the dates of the result, compare
    // nothing, so that any shares that restore would pass.
    if (original.mode !== "direct" && original.mode !== "seedshift")
      throw new Error("Shares are made without Seedshift or with MnemoCode Seedshift.");
    if (!Number.isSafeInteger(original.threshold) || original.threshold < MIN_THRESHOLD)
      throw new Error("A share check needs a whole threshold of at least 1.");
    this.#original = Object.freeze({
      ...original,
      dates:
        original.dates === undefined
          ? undefined
          : Object.freeze(Array.from(original.dates, (date) => ownedDate(date))),
    });
    this.#platform = platform;
    this.#input = new ShareInput({ decodeEntry: texts.decodeEntry });
    this.#held = heldPhrase(this.#original);
  }

  get dated(): boolean {
    return this.#original.mode === "seedshift";
  }

  get wordCount(): number {
    return wordCountOf(this.#original.mnemonic);
  }

  /** The shares asked for. */
  get threshold(): number {
    return this.#original.threshold;
  }

  /**
   * The shares of one answer, as the restore reads them (ShareInput.sharesOfAnswer): separated by
   * ; or line breaks, a share wrapped over lines joined again, a seed phrase refused as one; at
   * least the threshold. Throws when too few.
   */
  sharesOf(answer: string): string[] {
    const shares = this.#input.sharesOfAnswer(answer);
    if (shares.length < this.threshold)
      throw new Error(`${sharesTyped(shares.length)}; type ${this.threshold}, separated by ;.`);
    return shares;
  }

  /**
   * Why the share at `place` cannot be read, or undefined when it can, as the restore says it
   * (ShareInput.readProblem): a share with ? for an unreadable element is read with the others, by
   * the restore, once its marks are few enough.
   */
  shareProblem(place: number, text: string): string | undefined {
    return this.#input.readProblem(place, text);
  }

  /** Reads the dates as written down; throws why they cannot be read, naming dates by place. */
  readDates(line: string): readonly DateShiftDate[] {
    return readDates(line, this.wordCount);
  }

  /**
   * Restores the shares kept (ShareSet.combine); throws why they cannot be, after which they are
   * all typed again. The set names a share by its place among those it was given, which is its
   * place among those typed only while no copy came before it; otherwise the refusal names none.
   */
  async restore(kept: KeptShares): Promise<RestoredShares> {
    const count = kept.texts.length;
    if (count < this.threshold)
      throw new Error(
        kept.notes.length === 0
          ? `${sharesTyped(count)}; type ${this.threshold}, separated by ;.`
          : `Once the copies are left out, ${count === 1 ? "one share is" : `${count} shares are`} left; type ${this.threshold} different shares.`,
      );
    let set: ShareSet;
    try {
      set = await ShareSet.combine(kept.texts, this.#platform);
    } catch (error) {
      const message = messageOf(error);
      throw new Error(
        kept.namedAsTyped
          ? `The shares cannot be restored: ${message}`
          : "The shares cannot be restored: one of them is wrong, or of another set.",
        { cause: error },
      );
    }
    return RestoredShares.of(set, kept);
  }

  /** Whether shares that can be restored hold the phrase of the result, when it is known. */
  compareShares(restored: RestoredShares): BackupFinding | undefined {
    if (this.#held === undefined || restored.holds(this.#held)) return undefined;
    return finding(
      "shares",
      "other-phrase",
      "These shares restore another seed phrase: they are not of this backup.",
    );
  }

  /**
   * How the dates typed with shares that can be restored differ from those of the result: with
   * the dates of the result, each date is compared; without them, the seed phrase they restore.
   */
  compareDates(
    restored: RestoredShares,
    dates: readonly DateShiftDate[],
  ): BackupFinding | undefined {
    const original = this.#original;
    if (original.dates !== undefined) {
      const differs = compareDateLists(dates, original.dates);
      if (differs !== undefined) return differs;
    }
    // The dates are accepted only when the shares with them really give the seed phrase back,
    // also when they equal the dates of the result (AUD-009-FUN001).
    if (restored.unmasksTo(original.mnemonic, dates)) return undefined;
    return finding(
      "dates",
      "other-phrase",
      "The shares with these dates give another seed phrase: check the dates and the shares.",
    );
  }

  /** Whether the shares left a part unchecked: a group not complete, or a repair not settled. */
  compareChecked(restored: RestoredShares): BackupFinding | undefined {
    if (restored.unchecked.length === 0) return undefined;
    return finding(
      "shares",
      "unchecked",
      "The phrase matches, but some shares or repaired elements were not checked. Supply complete groups and check the marks.",
      restored.unchecked,
    );
  }

  async check(written: WrittenBackup): Promise<BackupResult> {
    let texts: string[];
    try {
      texts = this.sharesOf(written.backup);
    } catch (error) {
      return resultOf(finding("shares", "unreadable", messageOf(error)));
    }
    for (const [index, text] of texts.entries()) {
      const problem = this.shareProblem(index + 1, text);
      if (problem !== undefined)
        return resultOf(finding("shares", "unreadable", problem, [index + 1]));
    }
    const kept = KeptShares.of(texts);
    let restored: RestoredShares;
    try {
      restored = await this.restore(kept);
    } catch (error) {
      return resultOf(finding("shares", "unreadable", messageOf(error)), kept.notes);
    }
    const sharesFinding = this.compareShares(restored);
    if (sharesFinding !== undefined || !this.dated)
      return resultOf(sharesFinding ?? this.compareChecked(restored), kept.notes);
    let dates: readonly DateShiftDate[];
    try {
      dates = this.readDates(written.dates ?? "");
    } catch (error) {
      return resultOf(finding("dates", "unreadable", messageOf(error)), kept.notes);
    }
    return resultOf(
      this.compareDates(restored, dates) ?? this.compareChecked(restored),
      kept.notes,
    );
  }
}

/**
 * The phrase that shares of the result hold, as far as it is known: the seed phrase itself, or
 * the phrase that Seedshift masked it as with the dates of the result.
 */
function heldPhrase(original: ShareOriginal): string | undefined {
  const masking = Masking.of(original.mode);
  if (!masking.masked) return original.mnemonic;
  if (original.dates === undefined) return undefined;
  return masking.encode(original.mnemonic, original.dates).shiftedEnglish.join(" ");
}
