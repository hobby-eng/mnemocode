// An encoded seed phrase before its dates: its codes as BIP39 indexes, the format they were written
// in, and the mode that masked them (core/masking.ts), with every check that needs no date, the
// fingerprint of the codes themselves (the "encoded fingerprint" that encode shows), the decoding
// with complete dates, and the codes written again in their form or as an MNC1 record. A program
// that reads or writes encoded backups takes this module and the core modules it imports
// (representations, masking, words, and record.ts for the record); it needs nothing about shares,
// cards or terminals.
//
// From the host it needs, for the encoded fingerprint only, a function that gives the BIP32 master
// fingerprint of a phrase with an empty BIP39 passphrase, at once or later: WalletEvidenceCheck's
// fingerprint or fingerprintAsync with the host's PBKDF2 (core/wallet-evidence.ts).
//
// It does not ask, print or read files; it does not settle how a typed backup is to be read, with
// its record header and the mode and form a host was given (core/backup-reading.ts does), and does
// not search dates with ? (core/date-search.ts). Its messages name places and counts, never a code.
//
// Host-neutral: it imports only @scure/bip39 and the core modules above.

import { validateMnemonic } from "@scure/bip39";
import { serializeRecord } from "../record.js";
import { Masking, type MaskingMode } from "./masking.js";
import { formatEncoded, parseInput, resultFromIndexes } from "./representations.js";
import type { DateShiftDate, DecodedResult, OutputFormat } from "./types.js";
import { BIP39_DICTIONARY_SIZE, englishWordlist, WORD_COUNT_SET } from "./words.js";

/** How the codes were made: not masked, or one of the Seedshift variants (core/masking.ts). */
export type EncodedMode = MaskingMode;
/** The forms that codes are written in. */
export type EncodedFormat = Exclude<OutputFormat, "json">;

/** The modes by the names that the menu and the help use (Masking.name). */
export const ENCODED_MODE_NAMES: Readonly<Record<EncodedMode, string>> = Object.freeze(
  Object.fromEntries(Masking.MODES.map((mode) => [mode, Masking.of(mode).name])) as Record<
    EncodedMode,
    string
  >,
);

/** What toString, toJSON and Node.js's inspect show of an encoded backup: never its codes. */
const REDACTED = "[EncodedBackup: redacted]";
/** The forms that encode writes codes in. */
const FORMATS: ReadonlySet<string> = new Set<EncodedFormat>([
  "english",
  "indexes",
  "unicode",
  "colors",
  "colors-unicode",
]);

/** The codes read as English BIP39 words, joined by spaces. */
function wordsOf(indexes: readonly number[]): string {
  return indexes.map((index) => englishWordlist[index]!).join(" ");
}

/** What a format's codes are called in a message about their count. */
function unitOf(format: EncodedFormat): string {
  if (format === "indexes") return "word numbers";
  return format === "english" ? "words" : "codes";
}

/** The format that typed codes most likely are, judged by their characters. */
function likelyFormat(text: string): EncodedFormat {
  if (text.includes("#")) return "colors";
  // MnemoCode's colour codes are characters of the Private Use Areas (colors.ts).
  if (/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFD}]/u.test(text)) return "colors-unicode";
  if (/^[\d\s,]+$/u.test(text)) return "indexes";
  if (/^[\s0-9a-f]+$/iu.test(text)) return "unicode";
  return "english";
}

/**
 * Codes that lack the BIP39 checksum that their mode gives them: they were mistyped, or made with
 * the Original Seedshift, whose codes usually lack it. A host offers that mode or asks again.
 */
export class MissingChecksum extends Error {
  readonly mode: EncodedMode;

  constructor(mode: EncodedMode) {
    super(`These codes lack the BIP39 checksum that ${Masking.of(mode).name} gives them.`);
    this.name = "MissingChecksum";
    this.mode = mode;
  }
}

/**
 * The codes of one encoded seed phrase with their format and mode. A class pays off here: it is
 * built only by `read` or `of`, and its constructor refuses codes that no seed phrase has or that
 * their mode cannot have written, so every EncodedBackup can be decoded; it never changes afterwards
 * (`withMode` gives another); and it keeps the codes, which without Seedshift are the seed phrase
 * itself, out of toString, toJSON and Node.js's inspect.
 */
export class EncodedBackup {
  readonly #indexes: readonly number[];
  readonly #format: EncodedFormat;
  readonly #mode: EncodedMode;

  /**
   * Holds the codes to the rules of `of`. They are checked here, not in `of` alone: a private
   * constructor is private to TypeScript only, and a JavaScript host can call it (AUD-009-API002).
   */
  private constructor(indexes: readonly number[], format: EncodedFormat, mode: EncodedMode) {
    // A JavaScript host may pass any value; another mode would silently decode another way.
    const masking = Masking.of(mode);
    if (!FORMATS.has(format)) throw new Error("Unsupported encoded format.");
    // Copied first and the copy checked: Array.from turns holes into undefined, which is refused,
    // where some() alone would skip them, and a getter cannot give the check one value and the
    // copy another.
    const codes = Array.from(indexes);
    if (!WORD_COUNT_SET.has(codes.length))
      throw new Error(
        `These are ${codes.length} ${unitOf(format)}; an encoded seed phrase has 12, 15, 18, 21 or 24.`,
      );
    if (
      codes.some((index) => !Number.isInteger(index) || index < 0 || index >= BIP39_DICTIONARY_SIZE)
    )
      throw new Error("Every BIP39 index must be an integer from 0 through 2047.");
    if (masking.keepsChecksum && !validateMnemonic(wordsOf(codes), englishWordlist))
      throw new MissingChecksum(mode);
    this.#indexes = Object.freeze(codes);
    this.#format = format;
    this.#mode = mode;
  }

  /**
   * Reads codes written in `format` as the codes of a seed phrase made with `mode`. Throws why
   * they cannot be, naming places and counts only; MissingChecksum for a checksum-keeping mode.
   */
  static read(text: string, format: EncodedFormat, mode: EncodedMode): EncodedBackup {
    return EncodedBackup.of(parseInput(text, format), format, mode);
  }

  /** Codes read elsewhere, as BIP39 indexes from 0 to 2047, held to the same rules as `read`. */
  static of(indexes: readonly number[], format: EncodedFormat, mode: EncodedMode): EncodedBackup {
    return new EncodedBackup(indexes, format, mode);
  }

  /**
   * Why codes that fit no format cannot be read: as the format that their characters most likely
   * are, naming places or the count only.
   */
  static whyUnreadable(text: string): string {
    const format = likelyFormat(text);
    try {
      EncodedBackup.read(text, format, "direct");
    } catch (error) {
      if (error instanceof Error) return error.message;
      throw error;
    }
    return "These codes fit no format of an encoded seed phrase.";
  }

  /**
   * Whether `mode` writes codes that are a valid BIP39 phrase themselves. Such a mode gives a
   * valid phrase for every date too, so that only the wallet tells the right dates.
   */
  static keepsChecksum(mode: EncodedMode): boolean {
    return Masking.of(mode).keepsChecksum;
  }

  /** The same codes as made with `mode`, held to the rules of `of`. */
  withMode(mode: EncodedMode): EncodedBackup {
    return EncodedBackup.of(this.#indexes, this.#format, mode);
  }

  get mode(): EncodedMode {
    return this.#mode;
  }

  get format(): EncodedFormat {
    return this.#format;
  }

  /** The codes as BIP39 indexes, 0 to 2047: 12, 15, 18, 21 or 24 of them. */
  get indexes(): readonly number[] {
    return this.#indexes;
  }

  /** Whether complete dates still leave several phrases: the Original Seedshift's valid last word. */
  get givesSeveral(): boolean {
    return Masking.of(this.#mode).givesSeveral;
  }

  /**
   * The encoded fingerprint: the BIP32 master fingerprint of the codes read as a phrase, by
   * `fingerprintOf` (the host's, with an empty BIP39 passphrase), or undefined when they are no
   * valid BIP39 phrase, as the Original Seedshift's codes usually are not. `fingerprintOf` may
   * answer at once or with a promise, which is then handed back. Compared with the one that encode
   * showed, it shows a mistyped code before any date is typed.
   */
  fingerprint<T>(fingerprintOf: (mnemonic: string) => T): T | undefined {
    const words = wordsOf(this.#indexes);
    return validateMnemonic(words, englishWordlist) ? fingerprintOf(words) : undefined;
  }

  /** The codes written in their form, as encode writes them. */
  text(): string {
    return formatEncoded(resultFromIndexes([], this.#indexes, [], []), this.#format);
  }

  /** The codes as an MNC1 record, which names their mode and form (record.ts). */
  record(): string {
    return serializeRecord(this.#mode, this.#format, this.text());
  }

  /**
   * The seed phrase that the codes and the complete `dates` give, with its checksum. A mode that
   * gives several phrases (givesSeveral) is refused: `candidates` gives them.
   */
  decode(dates: readonly DateShiftDate[]): DecodedResult {
    if (this.givesSeveral)
      throw new Error(
        "The Original Seedshift with a valid last word gives several phrases: take its candidates.",
      );
    return Masking.of(this.#mode).undo(this.#indexes, dates)[0]!;
  }

  /** Every phrase that the codes and the complete `dates` may give: one unless givesSeveral. */
  candidates(dates: readonly DateShiftDate[]): DecodedResult[] {
    return Masking.of(this.#mode).undo(this.#indexes, dates);
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
