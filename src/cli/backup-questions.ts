// The encoded seed phrase that the commands undoing Seedshift ask for on the private screen, typed
// or read from --input-file or --qr-file, with everything that can be checked before the dates, in
// the order of BackupReading (core/backup-reading.ts): askEncodedBackup and askEncodedCodes, as the
// API in date-search.ts describes them. Every question is asked again until its answer can be
// used; what was answered before is kept.

import { BackupReading } from "../core/backup-reading.js";
import { EncodedBackup, MissingChecksumError } from "../core/encoded-backup.js";
import type { MissingCodes } from "../core/missing-codes.js";
import { Masking, PHRASE_WORDS, type MaskingMode } from "../core/masking.js";
import { masterFingerprint } from "../bitcoin-evidence.js";
import { parseRecord } from "../record.js";
import { value, type ParsedArguments, choiceOption } from "./arguments.js";
import {
  askAfterFailure,
  askSecretUntil,
  askValueUntil,
  droppedPath,
  WHAT_NOW,
  askOrCancel,
} from "./ask.js";
import {
  encodedInput,
  givenInputFormat,
  detectedFormat,
  phraseWords,
  SHARE_READER,
} from "./input.js";
import { readBoundedTextFile } from "./text-file.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import {
  SEEDSHIFT_CHOICES,
  ENCODED_SEEDSHIFT_QUESTION,
  WHICH_SEEDSHIFT_QUESTION,
  ENCODED_SEEDSHIFT_CHOICES,
} from "./seedshift-choices.js";
import { decodeQrPngFile } from "./qr-input.js";
import { terminalNotice } from "./terminal.js";
import { choose, type Choice } from "./terminal-choice.js";
import { refusal } from "./terminal-input.js";
import { reportFingerprint, plainFingerprintLine } from "./fingerprint-report.js";
import type { EncodedFormat } from "../core/types.js";
import { EncodedForm } from "../core/encoded-form.js";
import { defined } from "../core/defined.js";

// The encoded seed phrase, before its dates.

/** What askEncodedBackup asks for. */
export interface BackupQuestion {
  /**
   * The command's options: --input-file or --qr-file name the file to read first, --mode and
   * --format what was given; the caller has checked their values before the first question.
   */
  readonly args: ParsedArguments;
  /**
   * Only a Seedshift mode will do. The mode is asked when neither a record header nor --mode names
   * it: which Seedshift was used, or, without seedshiftOnly, whether one was used at all.
   */
  readonly seedshiftOnly: boolean;
  /**
   * The mode that the record read before named, for codes typed after it without a header: they
   * are undone as the record says rather than asked about. Never an answer given on the screen,
   * which the person may want to change by typing the codes again.
   */
  readonly recordMode?: MaskingMode | undefined;
  /** Codes marked with ? are read as codes to search (MissingCodes), as Decode searches them. */
  readonly marks?: boolean;
  /** A Shamir share given here is offered to the restore from shares, the share kept. */
  readonly shares?: boolean;
  /**
   * What a text that may be a Shamir share is read as, as --input-kind says: "share" restores from
   * it without asking, "codes" reads it as the codes; undefined asks where it is a share.
   */
  readonly inputKind?: InputKind | undefined;
}

/** What --input-kind reads a text as that may be a Shamir share. */
const INPUT_KINDS = Object.freeze(["codes", "share"] as const);

export type InputKind = (typeof INPUT_KINDS)[number];

/** --input-kind, checked before the first question. */
export function inputKindOf(args: ParsedArguments): InputKind | undefined {
  return choiceOption(args, "input-kind", INPUT_KINDS);
}

/** An encoded seed phrase as askEncodedBackup read it, with the mode its record named, if any. */
export interface ReadCodes {
  readonly kind: "codes";
  readonly backup: EncodedBackup;
  readonly recordMode: MaskingMode | undefined;
}

/**
 * What askEncodedBackup read: the codes; codes marked with ?, where the question takes them; or a
 * Shamir share that the person chose to restore from, where the question offers it.
 */
export type ReadBackup =
  | ReadCodes
  | {
      readonly kind: "missing";
      readonly codes: MissingCodes;
      readonly recordMode: MaskingMode | undefined;
    }
  /** A Shamir share, with whether it was read from a QR code image, for the restore it goes to. */
  | { readonly kind: "share"; readonly text: string; readonly fromQr: boolean };

/** Options that name the file of the encoded seed phrase, left out when it is typed again. */
const FILE_SOURCES = ["input-file", "qr-file"] as const;

/**
 * The options for typing the encoded seed phrase after it was read: without its file, which would
 * give the same phrase. --mode and --format stay; the answers given on the screen do not, so that
 * they are asked again for the codes typed.
 */
export function typedAfterFile(args: ParsedArguments): ParsedArguments {
  const typed = { ...args };
  for (const key of FILE_SOURCES) delete typed[key];
  return typed;
}

/** Whether the options name a file of the encoded seed phrase. */
export function fromFile(args: ParsedArguments): boolean {
  return FILE_SOURCES.some((key) => value(args, key) !== undefined);
}

/**
 * The encoded fingerprint of the codes, before their dates, when they form a valid BIP39 phrase
 * (EncodedBackup.fingerprint, ShareSet.fingerprint), as encode shows it: compared with the one
 * noted then, it shows a mistyped code before any date is typed. Nothing for undefined.
 */
export function showEncodedFingerprint(fingerprint: string | undefined): void {
  if (fingerprint === undefined) return;
  reportFingerprint(
    PHRASE_WORDS.encodedFingerprint,
    fingerprint,
    plainFingerprintLine("encoded", fingerprint, true),
  );
}

/** The encoded fingerprint of `backup` with Node's PBKDF2 (masterFingerprint). */
export function encodedFingerprintOf(backup: EncodedBackup): string | undefined {
  return backup.fingerprint(masterFingerprint);
}

/** Where the encoded seed phrase comes from: typed, or a file read again after a problem. */
class BackupSource {
  #typed: boolean;
  readonly #qr: boolean;
  #reads = 0;
  readonly #args: ParsedArguments;

  constructor(args: ParsedArguments) {
    this.#args = args;
    this.#qr = value(args, "qr-file") !== undefined;
    this.#typed = !this.#qr && value(args, "input-file") === undefined;
  }

  /** Whether the text read last came from a QR code image. */
  get readsQr(): boolean {
    return !this.#typed && this.#qr;
  }

  /** The choice that asks for the phrase again, for the questions after a problem. */
  againChoice(): Choice<"again"> {
    return this.#typed
      ? { label: "Type the encoded seed phrase again", value: "again" }
      : { label: "Read another file", note: "or type the encoded seed phrase", value: "again" };
  }

  /**
   * The text of the next attempt; `problem`, shown first, is why the last one could not be used.
   */
  async next(problem: string | undefined): Promise<string> {
    if (this.#typed) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      return askSecretUntil("Encoded seed phrase or record:", recordText, {
        what: "the encoded seed phrase or its record",
        hints: EncodedForm.typedWords,
      });
    }
    if (this.#reads === 0) {
      this.#reads += 1;
      try {
        return await encodedInput(this.#args);
      } catch (error) {
        problem = refusal(error);
      }
    }
    return this.#otherSource(problem);
  }

  /** After a file could not be used: another file, the phrase typed instead, or Stop. */
  async #otherSource(problem: string | undefined): Promise<string> {
    for (;;) {
      if (problem !== undefined) terminalNotice(problem, "warning");
      problem = undefined;
      const next = await askOrCancel(WHAT_NOW, [
        { label: "Read another file", value: "file" },
        { label: "Type the encoded seed phrase", note: "or paste it", value: "typed" },
      ] as const);
      if (next === "typed") {
        this.#typed = true;
        return this.next(undefined);
      }
      const text = await askValueUntil(
        this.#qr ? "QR code file name:" : "Record file name:",
        (answer) => {
          const path = droppedPath(answer);
          return this.#qr ? decodeQrPngFile(path) : readBoundedTextFile(path, "The file");
        },
        { what: "the name of the file" },
      );
      if (text !== undefined) return text;
    }
  }
}

/**
 * A typed answer whose record header, if it has one, can be read; the record's refusal says what
 * helps, such as a newer MnemoCode for a newer version.
 */
function recordText(text: string): string {
  parseRecord(text);
  return text;
}

/** A further attempt, with why the last one could not be used, if anything is to be said. */
interface Again {
  readonly again: string | undefined;
}

/**
 * Asks for the encoded seed phrase on the private screen, or reads the file given, and checks it as
 * described at the top, until it passes; the caller asks for the dates then.
 */
export async function askEncodedBackup(question: BackupQuestion): Promise<ReadBackup> {
  const source = new BackupSource(question.args);
  for (let problem: string | undefined; ;) {
    const checked = await checkedBackup(await source.next(problem), question, source);
    if (!("again" in checked)) return checked;
    problem = checked.again;
  }
}

/** The codes alone, for a command that takes neither marks nor shares (askEncodedBackup). */
export async function askEncodedCodes(
  question: Omit<BackupQuestion, "marks" | "shares">,
): Promise<ReadCodes> {
  const read = await askEncodedBackup(question);
  if (read.kind !== "codes") throw new Error("Only complete codes are read here.");
  return read;
}

/**
 * Whether a Shamir share given in place of the codes is restored from (BackupReading.shareKind):
 * "share" restores from it, "codes" reads it as the codes after all, "again" asks for them again;
 * undefined when it is no share. A text that is surely a share goes to the restore at once, kept
 * as its first share, so that nothing makes the person read it again; only a text that may also
 * be the codes is asked about, unless --input-kind answers it.
 */
async function offeredRestore(
  text: string,
  source: BackupSource,
  inputKind: InputKind | undefined,
): Promise<"share" | "codes" | "again" | undefined> {
  const kind = BackupReading.shareKind(text);
  if (kind === undefined) return undefined;
  if (inputKind === "share") return "share";
  if (kind === "share") {
    terminalNotice(
      `These are the codes of a Shamir share: they go to "${MENU_ENTRY_NAMES.restore.label}" as its first share.`,
    );
    return "share";
  }
  return askAfterFailure(
    "These may be the codes of a Shamir share, or of the encoded seed phrase.",
    [
      {
        label: MENU_ENTRY_NAMES.restore.label,
        note: "kept as the first share",
        value: "share",
      },
      { label: "The encoded seed phrase", note: "its codes with ? are searched", value: "codes" },
      source.againChoice(),
    ] as const,
    { escape: "asks again" },
  );
}

async function checkedBackup(
  text: string,
  question: BackupQuestion,
  source: BackupSource,
): Promise<ReadBackup | Again> {
  // --input-kind codes reads every text as codes, a share among them.
  if (question.shares === true && question.inputKind !== "codes") {
    const offered = await offeredRestore(text, source, question.inputKind);
    if (offered === "share") return { kind: "share", text, fromQr: source.readsQr };
    if (offered === "again") return { again: undefined };
  }
  let reading: BackupReading;
  try {
    reading = BackupReading.of(text, {
      seedshiftOnly: question.seedshiftOnly,
      shareReader: SHARE_READER,
      words: phraseWords(question.args),
    });
  } catch (error) {
    return { again: refusal(error) };
  }
  const settled = await settledMode(reading, question, source);
  if (settled === undefined) return { again: undefined };
  if (reading.marked) return markedBackup(reading, settled, question, source);
  // Read first as not masked, which has no rule beyond the codes and their count: codes that name
  // no mode are asked about only once they are known to be a phrase's.
  const read = await codesAndMode(reading, settled, question, source, false, (format) =>
    reading.codes(format),
  );
  if ("again" in read) return read;
  const { codes, mode } = read;
  const recordMode = reading.mode();
  try {
    return { kind: "codes", backup: codes.withMode(mode), recordMode };
  } catch (error) {
    if (!(error instanceof MissingChecksumError)) throw error;
    const choice = await askAfterFailure(
      error.message,
      [{ label: "It was the Original Seedshift", value: "legacy" }, source.againChoice()] as const,
      { escape: "asks again" },
    );
    return choice === "again"
      ? { again: undefined }
      : { kind: "codes", backup: codes.withMode("seedshift-legacy"), recordMode };
  }
}

/**
 * Codes marked with ? where the question takes them, in their form and mode, as checkedBackup
 * reads complete ones; elsewhere they are asked for again, every code needed.
 */
async function markedBackup(
  reading: BackupReading,
  settled: MaskingMode | "ask",
  question: BackupQuestion,
  source: BackupSource,
): Promise<ReadBackup | Again> {
  if (question.marks !== true)
    return { again: "Every code is needed here: Decode searches codes marked with ?." };
  const read = await codesAndMode(reading, settled, question, source, true, (format) =>
    reading.missingCodes(format),
  );
  if ("again" in read) return read;
  return { kind: "missing", codes: read.codes.withMode(read.mode), recordMode: reading.mode() };
}

/**
 * The codes of `reading`, `marked` or complete, read by `read` in their settled form, with their
 * mode, `settled` or asked once they read; Again where the form, the codes or the mode are refused
 * or left with Escape.
 */
async function codesAndMode<Codes>(
  reading: BackupReading,
  settled: MaskingMode | "ask",
  question: BackupQuestion,
  source: BackupSource,
  marked: boolean,
  read: (format: EncodedFormat) => Codes,
): Promise<{ readonly codes: Codes; readonly mode: MaskingMode } | Again> {
  const format = await settledFormat(reading, question.args, source, marked);
  if (typeof format !== "string") return format;
  let codes: Codes;
  try {
    codes = read(format);
  } catch (error) {
    return { again: refusal(error) };
  }
  const mode = settled === "ask" ? await askedMode(question.seedshiftOnly) : settled;
  if (mode === undefined) return { again: undefined };
  return { codes, mode };
}

/**
 * The mode of the codes: the record's, which wins over another --mode when the person agrees, or
 * --mode, or the mode of the record read before; "ask" when none names it. Undefined asks for the
 * codes again.
 */
async function settledMode(
  reading: BackupReading,
  question: BackupQuestion,
  source: BackupSource,
): Promise<MaskingMode | "ask" | undefined> {
  const given = value(question.args, "mode") as MaskingMode | undefined;
  const conflict = reading.modeConflict(given);
  if (conflict !== undefined) {
    const named = defined(reading.mode());
    const choice = await askAfterFailure(
      conflict,
      [
        { label: "As the record says", note: Masking.of(named).name, value: "record" },
        source.againChoice(),
      ] as const,
      { escape: "asks again" },
    );
    return choice === "record" ? named : undefined;
  }
  // Nothing names how these codes were made, whether typed, in a QR code or in a file without
  // the record header: taken as not masked, masked codes would be shown as the recovered seed
  // phrase. So it is asked, once the codes are known to be a phrase's; the menu, which asks
  // about Seedshift itself, passes --mode, also --mode direct for No.
  return reading.mode(given) ?? question.recordMode ?? "ask";
}

/**
 * How codes that name no mode were masked: which Seedshift, or, unless `seedshiftOnly`, whether
 * one was used at all, after saying that no record header names it. Undefined (Escape) asks for
 * the codes again.
 */
async function askedMode(seedshiftOnly: boolean): Promise<MaskingMode | undefined> {
  if (!seedshiftOnly)
    terminalNotice(
      "These codes have no MNC1 record header, so they do not say how they were made.",
    );
  return choose(
    seedshiftOnly ? WHICH_SEEDSHIFT_QUESTION : ENCODED_SEEDSHIFT_QUESTION,
    seedshiftOnly ? SEEDSHIFT_CHOICES : ENCODED_SEEDSHIFT_CHOICES,
    { label: "Seedshift", quit: "asks for the codes again" },
  );
}

/**
 * The format of the codes: the record's, --format, or the one that fits; asked when several fit.
 * Undefined, or a problem, asks for the codes again.
 */
async function settledFormat(
  reading: BackupReading,
  args: ParsedArguments,
  source: BackupSource,
  marked = false,
): Promise<EncodedFormat | Again> {
  const given = givenInputFormat(args);
  const conflict = reading.formatConflict(given);
  if (conflict !== undefined) {
    const [recorded] = reading.formats();
    const choice = await askAfterFailure(
      conflict,
      [
        { label: `Read them as ${defined(recorded)}`, value: "record" },
        source.againChoice(),
      ] as const,
      { escape: "asks again" },
    );
    return choice === "record" ? defined(recorded) : { again: undefined };
  }
  let fitting: EncodedFormat[];
  try {
    fitting = marked ? reading.markedFormats(given) : reading.formats(given);
  } catch (error) {
    return { again: refusal(error) };
  }
  // A record or --format names the format; only a detected one is announced.
  if (reading.hasRecord || given !== undefined) return defined(fitting[0]);
  const format = await detectedFormat(fitting, "asks for the codes again");
  return format ?? { again: undefined };
}
