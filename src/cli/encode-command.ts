import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  legacyChecksumValidResult,
  representMnemonic,
  type EncodedResult,
  type DateShiftDate,
} from '../core.js';
import { type ParsedArguments, value, values } from './arguments.js';
import {
  dates,
  encodeFormat,
  promptedEncodeInputs,
  textInput,
  transformMode,
  type EncodedFormat,
  type TransformMode,
} from './input.js';
import { validateCardOptions, completeEventLabels } from './card-options.js';
import { validateImageOptions } from './image-options.js';
import { preflightFileDestination } from './output-paths.js';
import { requireNewCardDirectory } from '../export/individual-cards.js';
import { runSskrSplit } from './sskr-command.js';
import { printEncodeResult } from './encode-report.js';
import { saveEncodeResult } from './encode-export.js';

export interface EncodeOutcome {
  readonly mode: TransformMode;
  readonly recordMode: TransformMode;
  readonly format: EncodedFormat;
  readonly enteredDates: readonly DateShiftDate[];
  readonly baseResult: EncodedResult;
  readonly result: EncodedResult;
  readonly encoded: string;
  readonly legacyAlternative?: EncodedResult;
  readonly legacyChanged: boolean;
  readonly useLegacyValid: boolean;
}

async function validateEncodeOptions(
  args: ParsedArguments,
): Promise<{ mode: TransformMode; format: EncodedFormat }> {
  for (const key of ['threshold', 'shares', 'share-format', 'card-layout']) {
    if (args[key] !== undefined) throw new Error(`--${key} requires --sskr.`);
  }
  const mode = transformMode(args);
  const format = encodeFormat(value(args, 'format'));
  if (mode === 'seedshift-legacy-valid')
    throw new Error('Use --mode seedshift-legacy --legacy-valid-last-word when encoding.');
  if (args['legacy-valid-last-word'] === true && mode !== 'seedshift-legacy')
    throw new Error('--legacy-valid-last-word requires --mode seedshift-legacy.');
  if (args.cards === true && format !== 'colors' && format !== 'colors-unicode')
    throw new Error('Terminal color cards require --format colors (5) or colors-unicode (6).');
  validateCardOptions(args, format, mode);
  // Validate all destinations before prompting or reading a mnemonic.
  await validateImageOptions(args);
  const directory = value(args, 'cards-dir');
  if (directory !== undefined) await requireNewCardDirectory(directory);
  for (const key of ['output', 'pdf', 'qr']) {
    const path = value(args, key);
    if (path !== undefined) await preflightFileDestination(path, true);
  }
  return { mode, format };
}

function transformMnemonic(
  mnemonic: string,
  enteredDates: readonly DateShiftDate[],
  mode: TransformMode,
): EncodedResult {
  if (mode === 'direct') return representMnemonic(mnemonic);
  if (mode === 'seedshift-legacy') return encodeMnemonicLegacy(mnemonic, enteredDates);
  return encodeMnemonic(mnemonic, enteredDates);
}

function createOutcome(
  args: ParsedArguments,
  mode: TransformMode,
  format: EncodedFormat,
): EncodeOutcome {
  const prompted = promptedEncodeInputs(args, mode);
  const enteredDates = prompted?.dates ?? dates(args);
  if (mode === 'direct' && enteredDates.length > 0)
    throw new Error('--dates cannot be used with --mode direct.');
  if (mode !== 'direct' && enteredDates.length === 0)
    throw new Error(`${mode} requires at least one date.`);
  const mnemonic = prompted?.mnemonic ?? textInput(args, 'mnemonic');
  const baseResult = transformMnemonic(mnemonic, enteredDates, mode);
  const legacyAlternative =
    mode === 'seedshift-legacy' ? legacyChecksumValidResult(baseResult) : undefined;
  const legacyChanged =
    legacyAlternative !== undefined &&
    legacyAlternative.shiftedIndexes.at(-1) !== baseResult.shiftedIndexes.at(-1);
  const useLegacyValid = args['legacy-valid-last-word'] === true;
  const result = useLegacyValid && legacyChanged ? legacyAlternative! : baseResult;
  const recordMode = useLegacyValid && legacyChanged ? 'seedshift-legacy-valid' : mode;
  return {
    mode,
    recordMode,
    format,
    enteredDates,
    baseResult,
    result,
    encoded: formatEncoded(result, format),
    legacyAlternative,
    legacyChanged,
    useLegacyValid,
  };
}

export async function runEncode(args: ParsedArguments): Promise<void> {
  if (args.sskr === true) return runSskrSplit(args, true);
  const { mode, format } = await validateEncodeOptions(args);
  const outcome = createOutcome(args, mode, format);
  const hasCardExport = value(args, 'pdf') !== undefined || value(args, 'images-dir') !== undefined;
  const eventLabels =
    hasCardExport && format === 'unicode'
      ? await completeEventLabels(outcome.enteredDates, values(args, 'event'))
      : [];
  printEncodeResult(outcome);
  await saveEncodeResult(args, outcome, eventLabels);
}
