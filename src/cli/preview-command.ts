import { preflightFileDestination } from './output-paths.js';
import { imageFormat, validateImageOptions } from './image-options.js';
import { exportPageImages } from '../export/image-export.js';
import { terminalNotice, terminalResultHeader } from './terminal.js';
import { exportIndividualCards, requireNewCardDirectory } from '../export/individual-cards.js';
import { validateCardOptions } from './card-options.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { businessOptions, businessOptionNames } from './business-options.js';
import { encodeMnemonic, formatEncoded, indexesToColors, parseDate } from '../core.js';
import { exportCards, renderCards } from '../export/pdf.js';
import { cardTemplates, selectTemplate, type CardContent } from '../export/templates.js';
import { value, type ParsedArguments } from './arguments.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DATES = ['31-10-2008', '03-01-2009', '12-01-2009', '22-05-2010'].map(parseDate);
const LABELS = [
  'Bitcoin whitepaper',
  'Genesis block',
  'First Bitcoin transaction',
  'Bitcoin Pizza Day',
];

export async function runPreview(args: ParsedArguments): Promise<void> {
  const path = value(args, 'pdf');
  const directory = value(args, 'cards-dir');
  const images = value(args, 'images-dir');
  const id = value(args, 'template');
  if (args.list === true) {
    if (
      images !== undefined ||
      args['image-format'] !== undefined ||
      path !== undefined ||
      directory !== undefined ||
      id !== undefined ||
      args.all === true ||
      value(args, 'title') !== undefined ||
      args.words !== undefined ||
      businessOptionNames.some((key) => args[key] !== undefined)
    ) {
      throw new Error('--list cannot be combined with preview output options.');
    }
    terminalResultHeader('CARD TEMPLATES', [['Installed', String(cardTemplates.length)]]);
    if (!cardTemplates.length)
      console.log(
        'No approved card templates are installed yet. Each design will be added after individual approval.',
      );
    for (const template of cardTemplates)
      console.log(`${template.id}\t${template.kind}\t${template.name}\t${template.description}`);
    return;
  }
  if (!path && !directory && !images)
    throw new Error(
      'To save a preview, specify --pdf PATH, --images-dir PATH, or --cards-dir PATH. To list templates, use --list.',
    );
  await validateImageOptions(args);
  if (path !== undefined) await preflightFileDestination(path, true);
  if (directory !== undefined) {
    if (args.all === true)
      throw new Error('For individual-card previews, select one --template per folder.');
    validateCardOptions(args, 'colors', 'direct');
    await requireNewCardDirectory(directory);
  }
  if (args.all === true && id !== undefined)
    throw new Error('--all cannot be combined with --template.');
  const selected = args.all === true ? cardTemplates : [selectTemplate(id)];
  if (!selected.length) selectTemplate();
  const settings = businessOptions(args);
  if (args.words !== undefined && typeof args.words !== 'string')
    throw new Error('--words must be supplied once.');
  const words = value(args, 'words') ?? '12';
  if (!['12', '15', '18', '21', '24'].includes(words))
    throw new Error('Preview --words must be 12, 15, 18, 21, or 24.');
  const mnemonic =
    words === '12'
      ? MNEMONIC
      : entropyToMnemonic(new Uint8Array((Number(words) / 3) * 4), wordlist);
  const result = encodeMnemonic(mnemonic, DATES);
  const colors = indexesToColors(result.shiftedIndexes);
  const jobs = selected.map((template) => {
    const content: CardContent =
      template.kind === 'colors'
        ? {
            ...settings,
            kind: 'colors',
            colors,
            payload: colors.join(' '),
            title: value(args, 'title'),
          }
        : {
            kind: 'unicode',
            dates: result.dates,
            eventLabels: LABELS,
            payload: formatEncoded(result, 'unicode'),
            title: value(args, 'title'),
          };
    return { template, content };
  });
  if (directory !== undefined) {
    const job = jobs[0]!;
    const count = await exportIndividualCards(
      job.template,
      job.content,
      directory,
      args['image-format'] === undefined ? 'pdf' : imageFormat(args),
    );
    terminalNotice(`Saved ${count} individual card preview files to: ${directory}`, 'success');
  }
  if (path !== undefined) {
    await exportCards(jobs, path);
    terminalNotice(
      `Saved preview PDF (${selected.length} ${selected.length === 1 ? 'template' : 'templates'}): ${path}`,
      'success',
    );
  }
  if (images !== undefined) {
    const count = await exportPageImages(await renderCards(jobs), images, imageFormat(args));
    terminalNotice(
      `Saved ${count} ${imageFormat(args).toUpperCase()} preview pages to: ${images}`,
      'success',
    );
  }
}
