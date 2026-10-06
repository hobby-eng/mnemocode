import { terminalNotice } from "./terminal.js";
import { choose, writePrompt } from "./terminal-choice.js";
import { displayWidth, readLine, terminalAvailable, withRawTerminal } from "./terminal-input.js";
import { onPrivateScreen } from "./private-screen.js";
import {
  detectInputFormats,
  maximumDates,
  parseDate,
  parseInput,
  type Bip39WordCount,
  type DateShiftDate,
  type OutputFormat,
} from "../core.js";
import { WORD_COUNT_SET } from "../core/words.js";
import { readBoundedDescriptor, readBoundedFile } from "./bounded-read.js";
import { decodeQrPngFile } from "./qr-input.js";
import { parseRecord, type MnemoCodeRecord, type RecordMode } from "../record.js";
import { type ParsedArguments, value, values } from "./arguments.js";

export type EncodedFormat = Exclude<OutputFormat, "json">;
export type TransformMode = RecordMode;

const MAX_TEXT_INPUT_BYTES = 1024 * 1024;

function readBoundedStdin(): string {
  const tooLarge = "Text input exceeds the 1 MiB safety limit.";
  return readBoundedDescriptor(0, MAX_TEXT_INPUT_BYTES, tooLarge).toString("utf8");
}

export function readBoundedTextFile(path: string, inputName = "The text input"): string {
  try {
    const tooLarge = `${inputName} exceeds the 1 MiB safety limit.`;
    return readBoundedFile(path, MAX_TEXT_INPUT_BYTES, tooLarge).toString("utf8");
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds the 1 MiB safety limit")) {
      throw error;
    }
    throw new Error(`${inputName} could not be read. Check that the file exists and is readable.`);
  }
}

export function textInput(arguments_: ParsedArguments, key: "input" | "mnemonic"): string {
  const direct = value(arguments_, key);
  const path = value(arguments_, `${key}-file`);
  const subject = key === "mnemonic" ? "the mnemonic" : "the encoded input";
  if (direct !== undefined && path !== undefined)
    throw new Error(`Provide ${subject} either as direct text or in a file, but not both.`);
  if (direct === undefined && path === undefined)
    throw new Error(`Provide ${subject} as direct text, in a file, or through --ask-secrets.`);
  return (
    direct ??
    (path === "-"
      ? readBoundedStdin()
      : readBoundedTextFile(
          path!,
          key === "mnemonic" ? "The mnemonic file" : "The encoded input file",
        ))
  );
}

export async function encodedInput(arguments_: ParsedArguments): Promise<string> {
  const qrPath = value(arguments_, "qr-file");
  if (qrPath === undefined) return textInput(arguments_, "input");
  if (value(arguments_, "input") !== undefined || value(arguments_, "input-file") !== undefined) {
    throw new Error("Choose one encoded input source: a QR image, direct text, or a text file.");
  }
  return decodeQrPngFile(qrPath);
}

export function inputFormat(value_: string): EncodedFormat {
  const aliases: Readonly<Record<string, OutputFormat>> = {
    "1": "english",
    "2": "indexes",
    "3": "unicode",
    "4": "colors-unicode",
    "5": "colors",
  };
  const format = aliases[value_] ?? value_;
  if (!(Object.values(aliases) as string[]).includes(format)) {
    const numbered = Object.entries(aliases).map(([number, name]) => `${number} ${name}`);
    throw new Error(
      `The representation format must be one of: ${numbered.join(", ")}. Use the number or the name.`,
    );
  }
  return format as EncodedFormat;
}

async function chooseInputFormat(candidates: readonly EncodedFormat[]): Promise<EncodedFormat> {
  if (!terminalAvailable()) {
    if (candidates.length === 0) {
      throw new Error(
        "The input representation could not be detected. Choose the recorded format explicitly and check the source data.",
      );
    }
    throw new Error(
      `The input matches several formats (${candidates.join(", ")}). Choose the recorded format explicitly.`,
    );
  }
  const numbers: Readonly<Record<EncodedFormat, number>> = {
    english: 1,
    indexes: 2,
    unicode: 3,
    "colors-unicode": 4,
    colors: 5,
  };
  const choices =
    candidates.length === 0 ? (Object.keys(numbers) as EncodedFormat[]) : [...candidates];
  const selected = await choose(
    candidates.length === 0
      ? "The format could not be recognised. Which format was recorded?"
      : "The input fits more than one format. Which format was recorded?",
    choices.map((format) => ({ label: format, digit: numbers[format], value: format })),
    { label: "Format", quit: "cancels" },
  );
  if (selected === undefined) throw new Error("No input format was chosen.");
  return selected;
}

export async function recordedInputFormat(
  arguments_: ParsedArguments,
  encoded: string,
  record?: MnemoCodeRecord,
): Promise<EncodedFormat> {
  const explicit = value(arguments_, "format");
  if (record !== undefined) {
    if (explicit !== undefined && inputFormat(explicit) !== record.format) {
      throw new Error(
        `The selected format (${inputFormat(explicit)}) conflicts with the format stored in the record (${record.format}).`,
      );
    }
    return record.format;
  }
  if (explicit !== undefined) return inputFormat(explicit);
  const candidates = detectInputFormats(encoded);
  const detected = candidates.length === 1 ? candidates[0]! : await chooseInputFormat(candidates);
  terminalNotice(`Detected input format: ${detected}.`);
  return detected;
}

export function encodeFormat(value_: string | undefined): EncodedFormat {
  return value_ === undefined ? "english" : inputFormat(value_);
}

export function transformMode(
  arguments_: ParsedArguments,
  embedded?: TransformMode,
): TransformMode {
  const explicit = value(arguments_, "mode");
  if (
    explicit !== undefined &&
    !["direct", "seedshift", "seedshift-legacy", "seedshift-legacy-valid"].includes(explicit)
  ) {
    throw new Error(
      "The transformation mode must be direct, seedshift, seedshift-legacy, or seedshift-legacy-valid.",
    );
  }
  if (explicit !== undefined && embedded !== undefined && explicit !== embedded) {
    throw new Error(
      `The selected transformation mode (${explicit}) conflicts with the mode stored in the record (${embedded}).`,
    );
  }
  if (explicit !== undefined) return explicit as TransformMode;
  if (embedded !== undefined) return embedded;
  return values(arguments_, "date").length > 0 ? "seedshift" : "direct";
}

export function encodedOutputLabel(format: EncodedFormat, mode: TransformMode): string {
  const shifted = mode === "direct" ? "" : "Shifted ";
  switch (format) {
    case "english":
      return `${shifted}English BIP39 words`;
    case "indexes":
      return `${shifted}BIP39 word indexes (1-2048)`;
    case "unicode":
      return "Unicode code points";
    case "colors":
      return `${shifted}BIP39Colors RGB hexadecimal codes`;
    case "colors-unicode":
      return `${shifted}MnemoCode color Unicode code points`;
  }
}

export function dates(arguments_: ParsedArguments): DateShiftDate[] {
  return values(arguments_, "date").map(parseDate);
}

/**
 * Asks for a secret at a prompt on the terminal (terminal-input.ts), the same on Linux, macOS and
 * Windows. On the private screen, which is cleared afterwards, the answer is shown as it is typed,
 * so that it can be checked; anywhere else nothing typed or pasted is shown.
 */
export async function askSecret(prompt: string): Promise<string> {
  if (!terminalAvailable()) {
    throw new Error(
      "--ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-).",
    );
  }
  const secret = await withRawTerminal(async (next, moreWithin) => {
    writePrompt(`${prompt} `);
    try {
      // Escape alone does nothing here: a slip of the finger must not lose what was typed.
      return await readLine(next, {
        echo: onPrivateScreen(),
        moreWithin,
        promptWidth: displayWidth(`${prompt} `),
      });
    } finally {
      // The terminal did not show the Enter key either.
      process.stderr.write("\n");
    }
  });
  if (secret === undefined) throw new Error("Secret input was cancelled or failed.");
  const trimmed = secret.trim();
  if (trimmed.length === 0) throw new Error("Secret input must not be empty.");
  return trimmed;
}

/**
 * "up to N, " for a seed phrase of `wordCount` words, which takes one date for every three words
 * (maximumDates); nothing when the count is not known yet.
 */
function mostDates(wordCount: number | undefined): string {
  return wordCount !== undefined && WORD_COUNT_SET.has(wordCount)
    ? `up to ${maximumDates(wordCount as Bip39WordCount)}, `
    : "";
}

/** The question for dates, which says how many the seed phrase takes; the answer is split at spaces. */
export function datesPrompt(wordCount: number | undefined): string {
  return `Dates (${mostDates(wordCount)}DD-MM-YYYY, separated by spaces):`;
}

/** The number of words in typed text, such as a seed phrase. */
export function wordCountOf(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/**
 * How many words an encoded seed phrase stands for, when that can be told before its form is
 * settled: from the form given, or when every form that fits it gives the same count.
 */
export function encodedWordCount(encoded: string, format?: EncodedFormat): number | undefined {
  const counts = new Set<number>();
  for (const candidate of format === undefined ? detectInputFormats(encoded) : [format]) {
    try {
      counts.add(parseInput(encoded, candidate).length);
    } catch {
      // A form that does not fit says nothing about the count.
    }
  }
  return counts.size === 1 ? [...counts][0] : undefined;
}

export async function promptedEncodeInputs(
  arguments_: ParsedArguments,
  mode: TransformMode,
): Promise<{ readonly mnemonic: string; readonly dates: DateShiftDate[] } | undefined> {
  if (arguments_["ask-secrets"] !== true) return undefined;
  if (
    value(arguments_, "mnemonic") !== undefined ||
    value(arguments_, "mnemonic-file") !== undefined ||
    values(arguments_, "date").length > 0
  ) {
    throw new Error(
      "--ask-secrets cannot be combined with a mnemonic supplied on the command line, a mnemonic file, or command-line dates.",
    );
  }
  const mnemonic = await askSecret("Seed phrase (English BIP39 words):");
  if (mode === "direct") return { mnemonic, dates: [] };
  const dateLine = await askSecret(datesPrompt(wordCountOf(mnemonic)));
  return { mnemonic, dates: dateLine.split(/\s+/u).filter(Boolean).map(parseDate) };
}

/**
 * The answers of recover-date asked by --ask-secrets: the encoded record, which a record file or a
 * QR image may give instead, and the dates with ? for each forgotten digit.
 */
export async function promptedRecoveryInputs(
  arguments_: ParsedArguments,
  checkRecord: (record: MnemoCodeRecord | undefined) => void = () => {},
): Promise<{ readonly encoded: string; readonly dateValues: string[] } | undefined> {
  if (arguments_["ask-secrets"] !== true) return undefined;
  if (value(arguments_, "input") !== undefined || values(arguments_, "date").length > 0) {
    throw new Error(
      "--ask-secrets cannot be combined with direct encoded text or command-line dates.",
    );
  }
  const fromFile =
    value(arguments_, "input-file") !== undefined || value(arguments_, "qr-file") !== undefined;
  // Read first, so that the question for dates can say how many the seed phrase takes.
  const encoded = fromFile
    ? await encodedInput(arguments_)
    : await askSecret("Encoded seed phrase or record:");
  const record = parseRecord(encoded);
  // What the record says, such as its mode, is checked before the dates are typed.
  checkRecord(record);
  const wordCount = encodedWordCount(record?.payload ?? encoded, record?.format);
  const dateLine = await askSecret(
    `Dates with ? for each forgotten digit (${mostDates(wordCount)}one to three of them incomplete):`,
  );
  return { encoded, dateValues: dateLine.split(/\s+/u).filter(Boolean) };
}
