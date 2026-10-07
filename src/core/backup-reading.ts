// How a backup that a person types, pastes or reads from a file is to be read, before its dates:
// its MNC1 record header, if it has one (record.ts); a record without Seedshift where only a
// Seedshift backup will do; a Shamir share given where an encoded seed phrase was asked for; the
// mode, from the record or from the host, and what to say when the two differ; the form of the
// codes, from the record, from the host, or every form that fits; and then the codes themselves
// (EncodedBackup, core/encoded-backup.ts). The command line and a page ask the person in between,
// each its own way; the rules and their lines are here.
//
// Needs from the host: the name of its own reader of Shamir shares, which a share typed here is
// sent to ("Restore a seed phrase from Shamir shares" in the command line's menu, "the Shares tab"
// on a page).
// Does not: ask anything, read files or QR codes, check the dates or the wallet, or search. Its
// messages name places, counts, modes and forms, never a code.
//
// Host-neutral: it reaches record.ts, the encoded backup and the share forms (sskr/transport.ts),
// for the share it refuses.

import { parseRecord, type MnemoCodeRecord } from "../record.js";
import { markedReadings, readingSpace } from "../sskr/repair.js";
import { Share } from "../sskr/transport.js";
import { EncodedBackup, type EncodedFormat, type EncodedMode } from "./encoded-backup.js";
import { Masking } from "./masking.js";
import { MissingCodes } from "./missing-codes.js";
import { detectInputFormats } from "./representations.js";

/** What a host reads a backup for. */
export interface ReadingRules {
  /**
   * Only a Seedshift backup will do, as for a search of forgotten date digits: a record without
   * Seedshift is refused.
   */
  readonly seedshiftOnly: boolean;
  /** Where the host reads Shamir shares, for the refusal of a share typed here. */
  readonly shareReader: string;
}

/**
 * What a text given in place of an encoded seed phrase is, as shareKind tells it: a Shamir share,
 * or either a share or the codes, which only the person can tell.
 */
export type ShareKind = "share" | "either";

/**
 * Unknown bits of a marked share below which its solution settles that the text is a share: its
 * CRC-32 alone is 32 bits, and its version, length and layout add some 20 more.
 */
const SURE_SHARE_UNKNOWN_BITS = 32;

/** What toString, toJSON and Node.js's inspect show of a reading: never its codes. */
const REDACTED = "[BackupReading: redacted]";

/**
 * One backup as given, before its codes are read: the text and its record header. A class, so
 * that the header is read once, the refusals that need nothing but the text come first, and every
 * later rule works on the same reading; it keeps the text, which may be the seed phrase itself, out
 * of toString, toJSON and Node.js's inspect.
 */
export class BackupReading {
  readonly #record: MnemoCodeRecord | undefined;
  readonly #payload: string;

  private constructor(record: MnemoCodeRecord | undefined, payload: string) {
    this.#record = record;
    this.#payload = payload;
  }

  /**
   * Reads the record header of `text`, if it has one, and refuses at once what no answer to a
   * later question can mend: a header that cannot be read, a record without Seedshift where only
   * Seedshift will do, and a Shamir share where an encoded seed phrase was asked for.
   */
  static of(text: string, rules: ReadingRules): BackupReading {
    const record = parseRecord(text);
    if (record?.mode === "direct" && rules.seedshiftOnly)
      throw new Error("Date recovery is available only for records created with Seedshift.");
    const payload = record?.payload ?? text;
    // A share's own checksum makes a phrase's codes read as one only by a chance of about one in
    // four billion (transport.ts); a record header says it is no share.
    if (record === undefined && Share.reads(payload))
      throw new Error(
        `This is a Shamir share, not an encoded seed phrase: ${rules.shareReader} reads it.`,
      );
    return new BackupReading(record, payload);
  }

  /**
   * Whether `text`, given in place of an encoded seed phrase, is a Shamir share: "share" when it
   * reads as one and not as codes, "either" when it reads as both, which only the person can
   * tell; undefined when it is no share, or carries a record header, which only codes have. A
   * complete share's own checksum makes codes read as one only by a chance of about one in four
   * billion. Marked with ?, it is a share when one of its readings as a share has a solution
   * (sskr/repair.ts); word numbers and Unicode codes of 21 or 24 may then also be the codes of a
   * phrase with the same marks: with few marks the share's checksum settles it, with many they
   * are "either".
   */
  static shareKind(text: string): ShareKind | undefined {
    if (parseRecord(text) !== undefined) return undefined;
    if (Share.reads(text)) return "share";
    if (!MissingCodes.marked(text)) return undefined;
    let spaces: ReturnType<typeof readingSpace>[] = [];
    try {
      spaces = markedReadings(text.trim()).map(readingSpace);
    } catch {
      return undefined;
    }
    const solved = spaces.filter((space) => space !== undefined);
    if (solved.length === 0) return undefined;
    // A share's checksum and layout are more than 50 bits of rules: marks of up to 32 unknown bits
    // that still meet them leave no doubt, while text of another kind meets them by chance only.
    if (solved.some((space) => space.unknownBits <= SURE_SHARE_UNKNOWN_BITS)) return "share";
    return MissingCodes.formats(text).length > 0 ? "either" : "share";
  }

  /** Whether the text has an MNC1 record header, which names the mode and the form. */
  get hasRecord(): boolean {
    return this.#record !== undefined;
  }

  /**
   * The mode of the codes: the record's, or `given` by the host; undefined when neither names it,
   * and the host asks the person. Where the record and `given` differ, it is the record's, which
   * the host offers after modeConflict.
   */
  mode(given?: EncodedMode): EncodedMode | undefined {
    return this.#record?.mode ?? given;
  }

  /** The line that says that the record names another mode than `given`, or undefined. */
  modeConflict(given?: EncodedMode): string | undefined {
    const record = this.#record;
    if (record === undefined || given === undefined || given === record.mode) return undefined;
    return `The record was made with ${Masking.of(record.mode).name}, not with ${Masking.of(given).name}.`;
  }

  /** The line that says that the record holds codes of another form than `given`, or undefined. */
  formatConflict(given?: EncodedFormat): string | undefined {
    const record = this.#record;
    if (record === undefined || given === undefined || given === record.format) return undefined;
    return `The record holds ${record.format} codes, not ${given}.`;
  }

  /**
   * The forms that the codes may be in: the record's, or `given`, or every form that they fit,
   * of which the host asks for one when there are several. Throws why the codes fit no form, as
   * the form that their characters most likely are names it.
   */
  formats(given?: EncodedFormat): EncodedFormat[] {
    if (this.#record !== undefined) return [this.#record.format];
    if (given !== undefined) return [given];
    const fitting = detectInputFormats(this.#payload);
    if (fitting.length === 0) throw new Error(EncodedBackup.whyUnreadable(this.#payload));
    return fitting;
  }

  /** Whether the codes mark some that cannot be read (MissingCodes.marked), to be searched. */
  get marked(): boolean {
    return MissingCodes.marked(this.#payload);
  }

  /**
   * The forms that the marked codes may be in: the record's, or `given`, or every form that they
   * fit (MissingCodes.formats). Throws when they fit none.
   */
  markedFormats(given?: EncodedFormat): EncodedFormat[] {
    if (this.#record !== undefined) return [this.#record.format];
    if (given !== undefined) return [given];
    const fitting = MissingCodes.formats(this.#payload);
    if (fitting.length === 0)
      throw new Error(
        "These codes fit no form of an encoded seed phrase: mark each code that cannot be read with ?, in its place.",
      );
    return fitting;
  }

  /** The marked codes in `format`, taken as not masked until the host gives their mode. */
  missingCodes(format: EncodedFormat): MissingCodes {
    return MissingCodes.read(this.#payload, format, "direct");
  }

  /**
   * The codes in `format`, held to the rules that need no mode: their count, and that each is a
   * code of that form (EncodedBackup.read). The host then gives them their mode (withMode), which
   * may find the checksum missing (MissingChecksum).
   */
  codes(format: EncodedFormat): EncodedBackup {
    return EncodedBackup.read(this.#payload, format, "direct");
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
