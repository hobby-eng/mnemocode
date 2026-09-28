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

export function readBoundedTextFile(path: string, inputName = 'The text input'): string {
  try {
    if (statSync(path).size > MAX_TEXT_INPUT_BYTES)
      throw new Error(`${inputName} exceeds the 1 MiB safety limit.`);
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds the 1 MiB safety limit')) {
      throw error;
    }
    throw new Error(`${inputName} could not be read. Check that the file exists and is readable.`);
  }
}

export function textInput(arguments_: ParsedArguments, key: 'input' | 'mnemonic'): string {
  const direct = value(arguments_, key);
  const path = value(arguments_, `${key}-file`);
  if ((direct === undefined) === (path === undefined)) {
    throw new Error(
      key === 'mnemonic'
        ? 'Provide the mnemonic either as direct text or in a file, but not both.'
        : 'Provide the encoded input either as direct text or in a file, but not both.',
    );
  }
  return (
    direct ??
    (path === '-'
      ? readBoundedStdin()
      : readBoundedTextFile(
          path!,
          key === 'mnemonic' ? 'The mnemonic file' : 'The encoded input file',
        ))
  );
}

export async function encodedInput(arguments_: ParsedArguments): Promise<string> {
  const qrPath = value(arguments_, 'qr-file');
  if (qrPath === undefined) return textInput(arguments_, 'input');
  if (value(arguments_, 'input') !== undefined || value(arguments_, 'input-file') !== undefined) {
    throw new Error('Choose one encoded input source: a QR image, direct text, or a text file.');
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
    throw new Error(`The representation format must be one of: ${supported.join(', ')}.`);
  return format as EncodedFormat;
}

async function chooseInputFormat(candidates: readonly EncodedFormat[]): Promise<EncodedFormat> {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    if (candidates.length === 0) {
      throw new Error(
        'The input representation could not be detected. Choose the recorded format explicitly and check the source data.',
      );
    }
    throw new Error(
      `The input matches several formats (${candidates.join(', ')}). Choose the recorded format explicitly.`,
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
      'The transformation mode must be direct, seedshift, seedshift-legacy, or seedshift-legacy-valid.',
    );
  }
  if (explicit !== undefined && embedded !== undefined && explicit !== embedded) {
    throw new Error(
      `The selected transformation mode (${explicit}) conflicts with the mode stored in the record (${embedded}).`,
    );
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
      return `${shifted}MnemoCode color Unicode code points`;
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
      'Hidden input requires an interactive terminal. Run the command in a terminal, or read the secret from a file or standard input.',
    );
  }
  try {
    const result = spawnSync('systemd-ask-password', ['--echo=no', '--', prompt], {
      encoding: 'utf8',
      stdio: [terminal, 'pipe', terminal],
    });
    if (result.error !== undefined)
      throw new Error(
        'The secure hidden-input prompt could not be started. Ensure that systemd-ask-password is installed and available.',
      );
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
      'Hidden input cannot be combined with a mnemonic supplied on the command line, a mnemonic file, or command-line dates.',
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
      'Hidden input cannot be combined with direct encoded text, an encoded input file, a QR input file, or command-line dates.',
    );
  }
  const encoded = askSecret('Encoded record:');
  const dateLine = askSecret(
    'Date list with ? for each forgotten digit (one to three incomplete dates):',
  );
  return { encoded, dateValues: dateLine.split(/\s+/u).filter(Boolean) };
}
