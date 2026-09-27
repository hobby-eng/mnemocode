import { terminalNotice } from './terminal.js';
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { detectInputFormats, parseDate, type DateShiftDate, type OutputFormat } from '../core.js';
import { decodeQrPngFile } from './qr-input.js';
import { type MnemoCodeRecord, type RecordMode } from '../record.js';
import { type ParsedArguments, value, values } from './arguments.js';

export type EncodedFormat = Exclude<OutputFormat, 'json'>;
export type TransformMode = RecordMode;

const MAX_TEXT_INPUT_BYTES = 1024 * 1024;

function readBoundedStdin(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_TEXT_INPUT_BYTES + 1 - total));
    const length = readSync(0, chunk, 0, chunk.length, null);
    if (length === 0) break;
    total += length;
    if (total > MAX_TEXT_INPUT_BYTES) throw new Error('Text input exceeds the 1 MiB safety limit.');
    chunks.push(chunk.subarray(0, length));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function readBoundedTextFile(path: string, inputName = 'Text input'): string {
  try {
    if (statSync(path).size > MAX_TEXT_INPUT_BYTES)
      throw new Error(`${inputName} exceeds the 1 MiB safety limit.`);
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds the 1 MiB safety limit')) {
      throw error;
    }
    throw new Error(`${inputName} could not be read.`);
  }
}

export function textInput(arguments_: ParsedArguments, key: 'input' | 'mnemonic'): string {
  const direct = value(arguments_, key);
  const path = value(arguments_, `${key}-file`);
  if ((direct === undefined) === (path === undefined)) {
    throw new Error(`Provide exactly one of --${key} or --${key}-file.`);
  }
  return (
    direct ?? (path === '-' ? readBoundedStdin() : readBoundedTextFile(path!, `--${key}-file`))
  );
}

export async function encodedInput(arguments_: ParsedArguments): Promise<string> {
  const qrPath = value(arguments_, 'qr-file');
  if (qrPath === undefined) return textInput(arguments_, 'input');
  if (value(arguments_, 'input') !== undefined || value(arguments_, 'input-file') !== undefined) {
    throw new Error('Provide --qr-file or one --input source, not both.');
  }
  return decodeQrPngFile(qrPath);
}

export function inputFormat(value_: string): EncodedFormat {
  const aliases: Readonly<Record<string, OutputFormat>> = {
    '1': 'english',
    '2': 'indexes',
    '3': 'unicode',
    '4': 'unicode',
    '5': 'colors',
    '6': 'colors-unicode',
  };
  const format = aliases[value_] ?? value_;
  const supported = ['english', 'indexes', 'unicode', 'colors', 'colors-unicode'];
  if (!supported.includes(format))
    throw new Error(`--format must be one of: ${supported.join(', ')}.`);
  return format as EncodedFormat;
}

async function chooseInputFormat(candidates: readonly EncodedFormat[]): Promise<EncodedFormat> {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    if (candidates.length === 0) {
      throw new Error(
        'Could not detect the input representation. Specify --format explicitly and check the recorded data.',
      );
    }
    throw new Error(
      `Input format is ambiguous (${candidates.join(', ')}). Specify --format explicitly.`,
    );
  }
  const numbers: Readonly<Record<EncodedFormat, string>> = {
    english: '1',
    indexes: '2',
    unicode: '3',
    colors: '5',
    'colors-unicode': '6',
  };
  const choices =
    candidates.length === 0 ? (Object.keys(numbers) as EncodedFormat[]) : [...candidates];
  console.error(
    candidates.length === 0
      ? 'The input representation could not be identified. Choose the recorded format:'
      : 'The input matches more than one representation:',
  );
  for (const candidate of choices) console.error(`  ${numbers[candidate]}  ${candidate}`);
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await terminal.question('Choose the recorded input format: ');
    const selected = inputFormat(answer.trim());
    if (candidates.length > 0 && !candidates.includes(selected))
      throw new Error(`The selected format ${selected} does not match the input.`);
    return selected;
  } finally {
    terminal.close();
  }
}

export async function recordedInputFormat(
  arguments_: ParsedArguments,
  encoded: string,
  record?: MnemoCodeRecord,
): Promise<EncodedFormat> {
  const explicit = value(arguments_, 'format');
  if (record !== undefined) {
    if (explicit !== undefined && inputFormat(explicit) !== record.format) {
      throw new Error(
        `--format ${inputFormat(explicit)} conflicts with the record format ${record.format}.`,
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
  return value_ === undefined ? 'english' : inputFormat(value_);
}

export function transformMode(
  arguments_: ParsedArguments,
  embedded?: TransformMode,
): TransformMode {
  const explicit = value(arguments_, 'mode');
  if (
    explicit !== undefined &&
    !['direct', 'seedshift', 'seedshift-legacy', 'seedshift-legacy-valid'].includes(explicit)
  ) {
    throw new Error(
      '--mode must be direct, seedshift, seedshift-legacy, or seedshift-legacy-valid.',
    );
  }
  if (explicit !== undefined && embedded !== undefined && explicit !== embedded) {
    throw new Error(`--mode ${explicit} conflicts with the record mode ${embedded}.`);
  }
  if (explicit !== undefined) return explicit as TransformMode;
  if (embedded !== undefined) return embedded;
  return values(arguments_, 'date').length > 0 ? 'seedshift' : 'direct';
}

export function encodedOutputLabel(format: EncodedFormat, mode: TransformMode): string {
  const shifted = mode === 'direct' ? '' : 'Shifted ';
  switch (format) {
    case 'english':
      return `${shifted}English BIP39 words`;
    case 'indexes':
      return `${shifted}BIP39 word indexes (1-2048)`;
    case 'unicode':
      return 'Unicode code points';
    case 'colors':
      return `${shifted}BIP39Colors RGB hexadecimal codes`;
    case 'colors-unicode':
      return `${shifted}MnemoCode Private Use Unicode color symbols`;
  }
}

export function dates(arguments_: ParsedArguments): DateShiftDate[] {
  return values(arguments_, 'date').map(parseDate);
}

export function askSecret(prompt: string): string {
  // A pipe or /dev/null makes systemd-ask-password fall back to a UI agent.
  // Use the controlling terminal even when CLI stdout/stderr are redirected.
  let terminal: number;
  try {
    terminal = openSync('/dev/tty', 'r+');
  } catch {
    throw new Error(
      '--ask-secrets requires an interactive terminal. Run this command in a terminal, or use a file/stdin input option.',
    );
  }
  try {
    const result = spawnSync('systemd-ask-password', ['--echo=no', '--', prompt], {
      encoding: 'utf8',
      stdio: [terminal, 'pipe', terminal],
    });
    if (result.error !== undefined)
      throw new Error(`Could not start systemd-ask-password: ${result.error.message}`);
    if (result.status !== 0) throw new Error('Secret input was cancelled or failed.');
    const secret = result.stdout.trim();
    if (secret.length === 0) throw new Error('Secret input must not be empty.');
    return secret;
  } finally {
    closeSync(terminal);
  }
}

export function promptedEncodeInputs(
  arguments_: ParsedArguments,
  mode: TransformMode,
): { readonly mnemonic: string; readonly dates: DateShiftDate[] } | undefined {
  if (arguments_['ask-secrets'] !== true) return undefined;
  if (
    value(arguments_, 'mnemonic') !== undefined ||
    value(arguments_, 'mnemonic-file') !== undefined ||
    values(arguments_, 'date').length > 0
  ) {
    throw new Error(
      '--ask-secrets cannot be combined with --mnemonic, --mnemonic-file, or --dates.',
    );
  }
  const mnemonic = askSecret('BIP39 mnemonic:');
  if (mode === 'direct') return { mnemonic, dates: [] };
  const dateLine = askSecret('Date list (DD-MM-YYYY, separated by spaces):');
  return { mnemonic, dates: dateLine.split(/\s+/u).filter(Boolean).map(parseDate) };
}

export function promptedRecoveryInputs(
  arguments_: ParsedArguments,
): { readonly encoded: string; readonly dateValues: string[] } | undefined {
  if (arguments_['ask-secrets'] !== true) return undefined;
  if (
    value(arguments_, 'input') !== undefined ||
    value(arguments_, 'input-file') !== undefined ||
    value(arguments_, 'qr-file') !== undefined ||
    values(arguments_, 'date').length > 0
  ) {
    throw new Error(
      '--ask-secrets cannot be combined with --input, --input-file, --qr-file, or --dates.',
    );
  }
  const encoded = askSecret('Encoded record:');
  const dateLine = askSecret('Date list with one unknown part (for example ??-07-1963):');
  return { encoded, dateValues: dateLine.split(/\s+/u).filter(Boolean) };
}
