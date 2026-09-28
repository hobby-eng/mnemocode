import { imageFormat, validateImageOptions } from './image-options.js';
import { allTemplateStyles } from '../export/templates.js';
import {
  terminalColor,
  terminalNotice,
  terminalPaint,
  terminalResultHeader,
  terminalStatus,
} from './terminal.js';
import { writeFile } from 'node:fs/promises';
import { preflightFileDestination } from './output-paths.js';
import { integerOption, value, values, type ParsedArguments } from './arguments.js';
import {
  askSecret,
  encodeFormat,
  encodedOutputLabel,
  dates,
  promptedEncodeInputs,
  readBoundedTextFile,
  textInput,
  transformMode,
} from './input.js';
import { businessOptions, businessOptionNames } from './business-options.js';
import { decodeInput, encodeMnemonic, formatEncoded, representMnemonic } from '../core.js';
import { masterFingerprint } from '../bitcoin-evidence.js';
import { combineSskrShares, splitSskrMnemonic, validateThreshold } from '../sskr/shares.js';
import { normalizeShare, shareToColors, validateShareSet } from '../sskr/transport.js';
import {
  exportSskrCards,
  exportSskrPdf,
  exportSskrImages,
  type SskrExportOptions,
} from '../export/sskr-cards.js';
import { requireNewCardDirectory } from '../export/individual-cards.js';
import { decodeQrPngFile } from './qr-input.js';
import { optionLabel } from './option-copy.js';

export const sskrExportOptions = [
  'cards-dir',
  'card-layout',
  'template',
  ...businessOptionNames,
] as const;
export const sskrInputOptions = ['share', 'share-file', 'share-qr', 'ask-secrets'] as const;

function singleOptions(args: ParsedArguments, repeatable: readonly string[] = []): void {
  for (const [key, val] of Object.entries(args)) {
    if (!repeatable.includes(key) && Array.isArray(val))
      throw new Error(`Provide only one value for the ${optionLabel(key)} setting.`);
  }
}

function exportOptions(args: ParsedArguments): SskrExportOptions | undefined {
  const directory = value(args, 'cards-dir');
  const pdf = value(args, 'pdf');
  const images = value(args, 'images-dir');
  if (!directory && !pdf && !images) {
    if (sskrExportOptions.some((key) => args[key] !== undefined))
      throw new Error(
        'SSKR card settings require an individual-card output folder, a PDF file, or an image output folder.',
      );
    return undefined;
  }
  if (directory !== undefined && !directory.trim())
    throw new Error('The individual-card output folder path must not be empty.');
  const template = value(args, 'template') ?? 'business-it';
  const entries = Object.entries(allTemplateStyles);
  const style =
    entries.find(([id]) => id === template)?.[1] ??
    (/^[1-9][0-9]*$/u.test(template) ? entries[Number(template) - 1]?.[1] : undefined);
  if (!style)
    throw new Error(
      'The selected business-card template is not available. View the template list to choose a supported design.',
    );
  const layout = value(args, 'card-layout') ?? 'collection';
  if (layout !== 'qr' && layout !== 'collection' && layout !== 'individual')
    throw new Error('The card layout must be qr, collection, or individual.');
  return {
    ...businessOptions(args, template),
    style,
    layout,
    directory: directory ?? '',
    imageFormat: args['image-format'] === undefined ? undefined : imageFormat(args),
  };
}

function shareFormat(args: ParsedArguments): 'ur' | 'colors' {
  const format = value(args, 'format') ?? 'ur';
  if (format !== 'ur' && format !== 'colors')
    throw new Error(
      'The SSKR share format must be ur or colors. These are share formats, not BIP39 representations.',
    );
  return format;
}

function printShares(shares: readonly string[], format: 'ur' | 'colors'): void {
  for (const [index, share] of shares.entries()) {
    if (
      !terminalResultHeader(`SSKR SHARE ${index + 1} / ${shares.length}`, [
        ['Format', format === 'ur' ? 'Compact UR' : 'RGB hexadecimal codes (ordered)'],
      ])
    )
      console.error(
        `SSKR share ${index + 1} — ${format === 'ur' ? 'Compact UR' : 'RGB hexadecimal codes (ordered)'}:`,
      );
    console.log(format === 'ur' ? share : shareToColors(share).join(' '));
  }
}

async function saveShares(
  shares: readonly string[],
  args: ParsedArguments,
  options?: SskrExportOptions,
): Promise<void> {
  if (options?.directory) {
    const count = await exportSskrCards(shares, options);
    terminalNotice(
      `Saved ${count} ${(options.imageFormat ?? 'pdf').toUpperCase()} files to: ${options.directory}`,
      'success',
    );
    if (options.layout === 'individual')
      terminalNotice(
        'Each collection folder is ONE SSKR share. Keep every numbered card in that folder together.',
      );
    else
      terminalNotice(
        options.imageFormat
          ? 'Each member collection contains ONE SSKR share. Keep its numbered pages together; store different shares separately.'
          : 'Each PDF contains ONE SSKR share. Store different shares separately.',
      );
  }
  const pdf = value(args, 'pdf');
  if (pdf && options) {
    await exportSskrPdf(shares, options, pdf);
    terminalNotice(`Saved SSKR collection PDF: ${pdf} (contains all supplied shares).`, 'success');
  }
  const images = value(args, 'images-dir');
  if (images && options) {
    const count = await exportSskrImages(shares, options, images, imageFormat(args));
    terminalNotice(
      `Saved ${count} ${imageFormat(args).toUpperCase()} SSKR pages to: ${images} (contains all supplied shares).`,
      'success',
    );
  }
  const output = value(args, 'output');
  if (output) {
    await writeFile(output, shares.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    terminalNotice(
      `Saved SSKR records: ${output} (one complete share per line; this file contains all supplied shares).`,
      'success',
    );
  }
}

async function destinations(args: ParsedArguments, options?: SskrExportOptions): Promise<void> {
  await validateImageOptions(args);
  if (options?.directory) await requireNewCardDirectory(options.directory);
  const paths = [value(args, 'output'), value(args, 'pdf')].filter(
    (p): p is string => p !== undefined,
  );
  for (const path of paths) await preflightFileDestination(path, false);
}

export async function runSskrSplit(args: ParsedArguments, integrated = false): Promise<void> {
  singleOptions(args, ['date']);
  const threshold = integerOption(args, 'threshold', {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const count = integerOption(args, 'shares', {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  validateThreshold(threshold, count);
  if (integrated) {
    for (const key of ['cards', 'qr', 'event', 'legacy-valid-last-word', 'title'])
      if (args[key] !== undefined)
        throw new Error(
          `The ${optionLabel(key)} setting is not available in SSKR mode. Export shares to a PDF file or an individual-card output folder instead.`,
        );
  }
  const representation = integrated ? encodeFormat(value(args, 'format')) : undefined;
  const format = integrated
    ? shareFormat({ format: value(args, 'share-format') ?? 'ur' })
    : shareFormat(args);
  const options = exportOptions(args);
  await destinations(args, options);
  const mode = transformMode(args);
  if (mode !== 'direct' && mode !== 'seedshift')
    throw new Error(
      'SSKR share creation supports direct mode and checksum-valid Seedshift, but not legacy modes.',
    );
  const prompted = promptedEncodeInputs(args, mode);
  const dateValues = prompted?.dates ?? dates(args);
  if (mode === 'direct' && dateValues.length) throw new Error('Direct mode does not accept dates.');
  if (mode === 'seedshift' && !dateValues.length)
    throw new Error('Seedshift requires at least one date.');
  const mnemonic = prompted?.mnemonic ?? textInput(args, 'mnemonic');
  const result =
    mode === 'direct' ? representMnemonic(mnemonic) : encodeMnemonic(mnemonic, dateValues);
  const shares = await splitSskrMnemonic(result.shiftedEnglish.join(' '), threshold, count);
  await saveShares(shares, args, options);
  if (
    !terminalResultHeader('SSKR EXPORT', [
      ['Threshold', `${threshold} of ${count}`],
      ['Mode', mode],
      ['Layout', options?.layout ?? 'text'],
    ])
  )
    terminalNotice(`SSKR: ${threshold} of ${count} shares required. Mode: ${mode}.`);
  if (mode === 'seedshift')
    terminalNotice(
      'Record the Seedshift mode and retain its dates separately; they are not stored in the shares.',
    );
  if (representation !== undefined) {
    if (
      !terminalResultHeader('ENCODED RESULT', [
        ['Mode', mode],
        ['Format', representation],
        ['Content', encodedOutputLabel(representation, mode)],
      ])
    )
      console.log(`${encodedOutputLabel(representation, mode)}:`);
    console.log(formatEncoded(result, representation));
  }
  printShares(shares, format);
  if (terminalColor('stderr')) {
    console.error('');
    terminalStatus('✓', 'Original fingerprint', masterFingerprint(result.sourceMnemonic));
    terminalStatus('✓', 'Encoded fingerprint', masterFingerprint(result.shiftedEnglish.join(' ')));
    console.error(
      terminalPaint('stderr', '2', '  BIP32 fingerprints above use an empty BIP39 passphrase.'),
    );
  } else {
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.sourceMnemonic)}`,
    );
    console.error(
      `Encoded BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.shiftedEnglish.join(' '))}`,
    );
  }
}

export async function readShares(args: ParsedArguments): Promise<string[]> {
  if (args['ask-secrets'] === true) {
    if (['share', 'share-file', 'share-qr'].some((key) => args[key] !== undefined))
      throw new Error('Hidden input cannot be combined with another share-input source.');
    return askSecret('SSKR shares (separate complete shares with a semicolon):')
      .split(';')
      .map(normalizeShare);
  }
  const shares = [...values(args, 'share')];
  if (values(args, 'share-file').filter((path) => path === '-').length > 1)
    throw new Error('Standard input can only be read once.');
  for (const path of values(args, 'share-file')) {
    // Text files contain one complete UR or RGB share per non-empty line.
    const text =
      path === '-'
        ? textInput({ 'input-file': '-' }, 'input')
        : readBoundedTextFile(path, 'The share file');
    shares.push(
      ...text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  for (const path of values(args, 'share-qr')) shares.push(await decodeQrPngFile(path));
  if (!shares.length)
    throw new Error(
      'Provide at least one complete share as text, in a text file, in a QR image, or through hidden input. Additional share sources may be repeated.',
    );
  return shares.map(normalizeShare);
}

export async function runSskrCombine(args: ParsedArguments): Promise<void> {
  singleOptions(args, ['share', 'share-file', 'share-qr', 'date']);
  const mode = transformMode(args);
  if (mode !== 'direct' && mode !== 'seedshift')
    throw new Error('SSKR share recovery supports direct mode or checksum-valid Seedshift.');
  const dateValues = dates(args);
  if (mode === 'direct' && dateValues.length) throw new Error('Direct mode does not accept dates.');
  if (mode === 'seedshift' && !dateValues.length && args['ask-secrets'] !== true)
    throw new Error('Seedshift recovery requires its original dates.');
  const shares = await readShares(args);
  if (mode === 'seedshift' && !dateValues.length && args['ask-secrets'] === true)
    dateValues.push(
      ...askSecret('Seedshift dates (DD-MM-YYYY, separated by spaces):')
        .split(/\s+/u)
        .flatMap((date) => dates({ date })),
    );
  if (mode === 'seedshift' && !dateValues.length)
    throw new Error('Seedshift recovery requires its original dates.');
  const recovered = await combineSskrShares(shares);
  const mnemonic =
    mode === 'direct' ? recovered : decodeInput(recovered, 'english', dateValues).recoveredMnemonic;
  if (
    !terminalResultHeader('RECOVERED RESULT', [
      ['Mode', mode],
      ['Source', 'SSKR shares'],
      ['Content', 'English BIP39 mnemonic'],
    ])
  )
    console.log('Recovered English BIP39 mnemonic:');
  console.log(mnemonic);
  if (terminalColor('stderr')) {
    terminalStatus('✓', 'Recovered fingerprint', masterFingerprint(mnemonic));
    terminalNotice('Fingerprint uses an empty BIP39 passphrase.');
  } else
    console.error(
      `BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(mnemonic)}`,
    );
}

export async function runSskrExport(args: ParsedArguments): Promise<void> {
  singleOptions(args, ['share', 'share-file', 'share-qr']);
  const format = shareFormat(args);
  const options = exportOptions(args);
  await destinations(args, options);
  const shares = validateShareSet(await readShares(args), false);
  await saveShares(shares, args, options);
  printShares(shares, format);
}
