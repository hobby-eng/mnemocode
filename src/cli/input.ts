import { terminalNotice } from "./terminal.js";
import { askSecretUntil } from "./ask.js";
import { choose } from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import {
  ENCODED_FORMATS,
  MASKING_MODES,
  maximumDates,
  parseDate,
  type DateShiftDate,
} from "../core.js";
import { BackupReading, modeConflictOf } from "../core/backup-reading.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { DatesAnswer } from "../core/date-search.js";
import { WordList } from "../core/word-hints.js";
import { DATE_COUNT_WORDS, Masking, type DateCountWords } from "../core/masking.js";
import { validatedEnglishWords } from "../core/words.js";
import { MAX_TEXT_INPUT_BYTES, readBoundedDescriptor } from "./bounded-read.js";
import { decodedText, readBoundedTextFile } from "./text-file.js";
import { decodeQrPngFile } from "./qr-input.js";

import {
  type ParsedArguments,
  value,
  values,
  assertAskedNotGiven,
  integerOption,
} from "./arguments.js";
import { formatNumber, formatLegend } from "./format-numbers.js";
import {
  BIP39_WORD_COUNTS,
  WORD_COUNTS_TEXT,
  WORD_NUMBERS_SPAN,
  isBip39WordCount,
  type Bip39WordCount,
} from "../core/bip39-sizes.js";
import { englishTokens } from "../core/english-words.js";
import { listInWords } from "../core/places.js";
import { DATE_FORMAT_TEXT } from "../core/dates.js";
import type { MaskingMode, EncodedFormat } from "../core/types.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.input", {
  "mnemonic-word-count": (value0: string) => `The mnemonic word count must be ${value0}.`,
  "provide-either-as-direct-text-file-but-not": (value0: string) =>
    `Provide ${value0} either as direct text or in a file, but not both.`,
  "provide-as-direct-text-file-through-ask-secrets": (value0: string) =>
    `Provide ${value0} as direct text, in a file, or through --ask-secrets.`,
  "choose-one-encoded-input-source-qr-image-direct": () =>
    "Choose one encoded input source: a QR image, direct text, or a text file.",
  "representation-format-one-use-number-name": (value0: string) =>
    `The representation format must be one of: ${value0}. Use the number or the name.`,
  "backup-from-options-refused": suppliedMessage,
  "input-matches-several-formats-choose-recorded-format-explicitly": (value0: string) =>
    `The input matches several formats (${value0}). Choose the recorded format explicitly.`,
  "transformation-mode": (value0: string) => `The transformation mode must be ${value0}.`,
  "transform-mode-refused": suppliedMessage,
});

/**
 * The words of the seed phrase that --words gives, or undefined: of codes from printed cards, which
 * end with decoys, only those of so many words from the start are read (BackupReading).
 */
export function phraseWords(args: ParsedArguments): Bip39WordCount | undefined {
  if (value(args, "words") === undefined) return undefined;
  const words = integerOption(args, "words", {
    min: BIP39_WORD_COUNTS[0],
    max: defined(BIP39_WORD_COUNTS.at(-1)),
    label: "mnemonic word count",
  });
  if (!isBip39WordCount(words)) throw ERRORS.create("mnemonic-word-count", [`${WORD_COUNTS_TEXT}`]);
  return words;
}

/** Standard input, as its refusals name it. */
const STANDARD_INPUT = "Text input";
/** The file descriptor of standard input. */
const STANDARD_INPUT_DESCRIPTOR = 0;

function readBoundedStdin(): string {
  return decodedText(
    readBoundedDescriptor(STANDARD_INPUT_DESCRIPTOR, MAX_TEXT_INPUT_BYTES, STANDARD_INPUT),
    STANDARD_INPUT,
  );
}

export function textInput(arguments_: ParsedArguments, key: "input" | "mnemonic"): string {
  const direct = value(arguments_, key);
  const path = value(arguments_, `${key}-file`);
  const subject = key === "mnemonic" ? "the mnemonic" : "the encoded input";
  if (direct !== undefined && path !== undefined)
    throw ERRORS.create("provide-either-as-direct-text-file-but-not", [`${subject}`]);
  if (direct === undefined && path === undefined)
    throw ERRORS.create("provide-as-direct-text-file-through-ask-secrets", [`${subject}`]);
  return (
    direct ??
    (path === "-"
      ? readBoundedStdin()
      : readBoundedTextFile(
          defined(path),
          key === "mnemonic" ? "The mnemonic file" : "The encoded input file",
        ))
  );
}

/**
 * Refuses encoded text or dates on the command line with --ask-secrets, whose questions ask for
 * both on the private screen; a file or a QR image of the codes may still be named. Decode and
 * recover-date check it before their first question.
 */
export function assertAskedEncodedInput(arguments_: ParsedArguments): void {
  assertAskedNotGiven(arguments_, [...ENCODED_SECRET_OPTIONS, DATES_OPTION]);
}

/**
 * The options that give an encoded seed phrase as text; a file or a QR image is no secret typed.
 */
export const ENCODED_SECRET_OPTIONS = Object.freeze(["input"] as const);
/** The options that give a seed phrase. */
export const PHRASE_SECRET_OPTIONS = Object.freeze(["mnemonic", "mnemonic-file"] as const);
/** The option that gives dates, which --ask-secrets asks for on the private screen too. */
export const DATES_OPTION = "date";

/** Refuses a QR image together with encoded text or a text file: only one source is read. */
export function assertOneEncodedSource(arguments_: ParsedArguments): void {
  if (
    value(arguments_, "qr-file") !== undefined &&
    (value(arguments_, "input") !== undefined || value(arguments_, "input-file") !== undefined)
  )
    throw ERRORS.create("choose-one-encoded-input-source-qr-image-direct", []);
}

export async function encodedInput(arguments_: ParsedArguments): Promise<string> {
  assertOneEncodedSource(arguments_);
  const qrPath = value(arguments_, "qr-file");
  return qrPath === undefined ? textInput(arguments_, "input") : decodeQrPngFile(qrPath);
}

// The numbers of the forms, here too for the questions that take them with the input.
export { formatNumber };

/** The form that --format names, by its number or its name. */
export function inputFormat(value_: string): EncodedFormat {
  const format = ENCODED_FORMATS.find(
    (name) => value_ === name || value_ === String(formatNumber(name)),
  );
  if (format === undefined) {
    throw ERRORS.create("representation-format-one-use-number-name", [`${formatLegend()}`]);
  }
  return format;
}

/**
 * The form that --format names, checked by inputFormat; undefined without the option. What a
 * record or the codes say against it is the library's to tell (BackupReading.formatConflict).
 */
export function givenInputFormat(arguments_: ParsedArguments): EncodedFormat | undefined {
  const option = value(arguments_, "format");
  return option === undefined ? undefined : inputFormat(option);
}

/** Where the person reads Shamir shares, for a share given in place of the codes. */
export const SHARE_READER = MENU_ENTRY_NAMES.restore.label;

/** The question of a form when codes fit several, as every reader of codes asks it. */
const WHICH_FORMAT = "The input fits more than one format. Which format was recorded?";

/**
 * The form of codes that `fitting` forms read, as detected: the one, or the one the person picks,
 * each said in one line. Undefined when the person leaves with Escape, which `quit` names,
 * CANCELLED at Ctrl+C.
 */
export async function detectedFormat(
  fitting: readonly EncodedFormat[],
  quit: string,
): Promise<EncodedFormat | undefined | Cancelled> {
  const format =
    fitting.length === 1
      ? fitting[0]
      : await choose(
          WHICH_FORMAT,
          fitting.map((form) => ({ label: form, value: form })),
          { label: "Format", quit },
        );
  if (format !== undefined && format !== CANCELLED)
    terminalNotice(`Detected input format: ${format}.`);
  return format;
}

/**
 * The encoded seed phrase given with the options, read as the screen reads typed codes
 * (BackupReading, EncodedBackup): a share, a header that cannot be read or codes that fit no form
 * are refused with the library's reason, and a mode or form that the record contradicts too. Codes
 * that fit several forms are asked about on a terminal; anywhere else they end the command.
 * `modeKnown` is called with the mode as soon as it is settled, before the form is: a refusal by
 * the mode, such as a wrong number of dates, comes before any question about the form. CANCELLED
 * when the person leaves the question about the form.
 */
export async function backupFromOptions(
  arguments_: ParsedArguments,
  seedshiftOnly: boolean,
  modeKnown?: (mode: MaskingMode) => void,
): Promise<{ readonly backup: EncodedBackup; readonly mode: MaskingMode } | Cancelled> {
  const reading = BackupReading.of(await encodedInput(arguments_), {
    seedshiftOnly,
    shareReader: SHARE_READER,
    words: phraseWords(arguments_),
  });
  const mode = transformMode(arguments_, reading.mode());
  modeKnown?.(mode);
  const given = givenInputFormat(arguments_);
  const conflict = reading.formatConflict(given);
  if (conflict !== undefined) throw ERRORS.create("backup-from-options-refused", [conflict]);
  const fitting = reading.formats(given);
  let format = defined(fitting[0]);
  // A record or --format names the form; only a detected one is announced.
  if (!reading.hasRecord && given === undefined) {
    if (fitting.length > 1 && !terminalAvailable())
      throw ERRORS.create("input-matches-several-formats-choose-recorded-format-explicitly", [
        `${fitting.join(", ")}`,
      ]);
    const chosen = await detectedFormat(fitting, "cancels");
    // Escape is the person leaving, as the hint says, not an error of MnemoCode.
    if (chosen === undefined || chosen === CANCELLED) return CANCELLED;
    format = chosen;
  }
  return { backup: reading.codes(format).withMode(mode), mode };
}

export function encodeFormat(value_: string | undefined): EncodedFormat {
  return value_ === undefined ? "english" : inputFormat(value_);
}

export function transformMode(arguments_: ParsedArguments, embedded?: MaskingMode): MaskingMode {
  const explicit = value(arguments_, "mode");
  if (explicit !== undefined && !Masking.isMode(explicit)) {
    throw ERRORS.create("transformation-mode", [`${listInWords(MASKING_MODES, "or")}`]);
  }
  const conflict = modeConflictOf(embedded, explicit as MaskingMode | undefined);
  if (conflict !== undefined) throw ERRORS.create("transform-mode-refused", [conflict]);
  if (explicit !== undefined) return explicit as MaskingMode;
  if (embedded !== undefined) return embedded;
  return values(arguments_, "date").length > 0 ? "seedshift" : "direct";
}

export function encodedOutputLabel(format: EncodedFormat, mode: MaskingMode): string {
  return `${FORM_LABELS[format]} of ${Masking.of(mode).holds}`;
}

/** The forms of encoded output, as a result names them. */
const FORM_LABELS: Readonly<Record<EncodedFormat, string>> = {
  english: "English BIP39 words",
  indexes: `BIP39 word indexes (${WORD_NUMBERS_SPAN})`,
  unicode: "Unicode code points",
  colors: "BIP39Colors RGB hexadecimal codes",
  "colors-unicode": "MnemoCode color Unicode code points",
};

export function dates(arguments_: ParsedArguments): DateShiftDate[] {
  return values(arguments_, "date").map(parseDate);
}

/**
 * "up to N, " for a seed phrase of `wordCount` words, which takes one date for every three words
 * (maximumDates); nothing when the count is not known yet. Every question for dates says it so.
 */
export function mostDates(wordCount: number | undefined): string {
  return wordCount !== undefined && isBip39WordCount(wordCount)
    ? `up to ${maximumDates(wordCount)}, `
    : "";
}

/**
 * The question for dates, which says how many the seed phrase takes; the answer is split at spaces.
 */
export function datesPrompt(wordCount: number | undefined): string {
  return `Dates (${mostDates(wordCount)}${DATE_FORMAT_TEXT}, separated by spaces):`;
}

/**
 * A typed seed phrase as Encode takes it: 12 to 24 English BIP39 words with a valid checksum,
 * written as the core writes them. A wrong count, a word at a place or the checksum is named, and
 * no word is repeated.
 */
function typedSeedPhrase(answer: string): string {
  return validatedEnglishWords(answer).join(" ");
}

/**
 * The dates of one answer for Encode, which never searches them: every date in full, each wrong
 * one named by its place and never repeated, and at most one for every three words, by the rules
 * and words of the core's dates (DatesAnswer.parse without ?).
 */
function typedDates(line: string, wordCount: number | undefined): DateShiftDate[] {
  return DatesAnswer.parse(line, { wordCount, patterns: false }).known;
}

/**
 * The seed phrase and the dates of a backup, for encode and for a split into shares: asked on the
 * private screen with --ask-secrets, or read from the options. The dates are counted for the mode
 * before the phrase is read: the library's rule (Masking.assertDateCount), refused early in the
 * command's `words`. A `known` phrase, which Re-encode decoded and confirmed, is neither asked nor
 * read: only its dates are. CANCELLED when the person cancels a question.
 */
export async function phraseAndDates(
  args: ParsedArguments,
  mode: MaskingMode,
  words: DateCountWords = DATE_COUNT_WORDS.codes,
  known?: string,
): Promise<{ readonly mnemonic: string; readonly dates: readonly DateShiftDate[] } | Cancelled> {
  const prompted = await promptedEncodeInputs(args, mode, known);
  if (prompted === CANCELLED) return CANCELLED;
  const dateValues = prompted?.dates ?? dates(args);
  Masking.of(mode).assertDateCount(dateValues.length, false, words);
  return {
    mnemonic: prompted?.mnemonic ?? known ?? textInput(args, "mnemonic"),
    dates: dateValues,
  };
}

/**
 * The seed phrase and the dates of Encode with --ask-secrets, each asked again until it can be
 * used (askSecretUntil): the phrase first, checked at once, unless it is `known`, then the dates
 * alone, which a second try asks without the phrase. CANCELLED when the person cancels.
 */
export async function promptedEncodeInputs(
  arguments_: ParsedArguments,
  mode: MaskingMode,
  known?: string,
): Promise<{ readonly mnemonic: string; readonly dates: DateShiftDate[] } | undefined | Cancelled> {
  if (arguments_["ask-secrets"] !== true) return undefined;
  assertAskedNotGiven(arguments_, [...PHRASE_SECRET_OPTIONS, DATES_OPTION]);
  const mnemonic =
    known ??
    (await askSecretUntil("Seed phrase (English BIP39 words):", typedSeedPhrase, {
      what: "the words of the seed phrase",
      hints: WordList.BIP39,
    }));
  if (mnemonic === CANCELLED) return CANCELLED;
  if (!Masking.of(mode).masked) return { mnemonic, dates: [] };
  const wordCount = englishTokens(mnemonic).length;
  const dates = await askSecretUntil(
    datesPrompt(wordCount),
    (line) => typedDates(line, wordCount),
    {
      what: "the dates",
    },
  );
  if (dates === CANCELLED) return CANCELLED;
  return { mnemonic, dates };
}
