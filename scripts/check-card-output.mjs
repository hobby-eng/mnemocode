/** Manual export check using public fixture data only. Not run at startup. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { indexesToColors, representMnemonic } from '../dist/core.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import '../dist/export/platform-node.js';
import { cardTemplates, selectTemplate } from '../dist/export/templates.js';
import { shareToColors } from '../dist/sskr/transport.js';
import { renderBusinessCards } from '../dist/export/business-cards.js';
import { renderGlassCards } from '../dist/export/glass-cards.js';
const destination = resolve(process.argv[2] ?? 'goldens/current');
await mkdir(destination, { recursive: true });
const colors = indexesToColors(
  representMnemonic(
    entropyToMnemonic(
      Uint8Array.from({ length: 32 }, (_, i) => i),
      wordlist,
    ),
  ).shiftedIndexes,
);
const presentation = {
  studioName: 'Orven Studio',
  slogan: 'Details, deliberately.',
  subtitle: 'Colour options for review.',
  footer: 'CLIENT REVIEW',
  referenceLabel: 'Ref.',
};
const base = {
  kind: 'colors',
  colors,
  payload: colors.join(' '),
  presentation,
  profile: {
    company: 'VECTOR SYSTEMS',
    role: 'IT Solutions Director',
    name: 'Alex Morgan',
    email: 'alex@vector.com',
  },
  pageSize: 'wallet',
  cardQr: true,
};
const vector = JSON.parse(await readFile('vectors/sskr-v1.json', 'utf8'));
const share = {
  ...base,
  kind: 'sskr',
  colors: vector.official.firstShareColors,
  payload: vector.official.firstShareColors.join(' '),
  collectionReference: 'PUBLIC-1-1',
  qrCard: true,
  pageSize: 'business',
};
const cases = [
  ['business-full', () => renderBusinessCards('it', base), base.payload],
  [
    'business-fragment',
    () => renderBusinessCards('it', { ...base, pageSize: 'business' }, 1),
    undefined,
  ],
  ['business-sskr', () => renderBusinessCards('it', share, 0), share.payload],
  ['material-full', () => selectTemplate('material-kitchen').render(base), base.payload],
  [
    'material-fragment',
    () => selectTemplate('material-switch').renderIndividual(base, 1),
    undefined,
  ],
  ['glass-four', () => renderGlassCards(base, 0), undefined],
  ['glass-six', () => renderGlassCards(base, 0, 6), undefined],
  ['glass-eight', () => renderGlassCards({ ...base, pageSize: 'business' }, 0, 8), undefined],
  ['glass-eight-sskr', () => renderGlassCards(share, undefined, 8), share.payload],
  ...cardTemplates.map((template) => [
    template.id + '-study',
    () => template.render({ ...base, pageSize: 'business', orientation: 'landscape' }),
    base.payload,
  ]),
];
const report = [];
for (const [name, render, expected] of cases) {
  const bytes = await render();
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getCreator() ?? '', '');
  assert.equal(pdf.getTitle() ?? '', '');
  const path = resolve(destination, name + '.pdf');
  await writeFile(path, bytes, { mode: 0o600 });
  const page = pdf.getPageCount();
  assert.equal(page, 1, name + ' must remain a single page');
  const prefix = resolve(destination, name);
  execFileSync(
    'pdftoppm',
    ['-f', String(page), '-l', String(page), '-singlefile', '-r', '200', '-png', path, prefix],
    { stdio: 'pipe' },
  );
  const png = PNG.sync.read(await readFile(prefix + '.png'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
    inversionAttempts: 'dontInvert',
  });
  if (expected === undefined) {
    assert.equal(result, null, name + ' must not contain an individual-card QR');
    report.push(`${name}: ${page} page, no individual-card QR`);
  } else {
    assert.equal(result?.data, expected, name + ' QR mismatch');
    report.push(`${name}: ${page} page, exact collection QR round-trip at 200 dpi`);
  }
  console.log(report.at(-1));
}
for (const id of [
  'business-it',
  'material-kitchen',
  'business-glass-4in1',
  'business-glass-6in1',
  'business-glass-8in1',
]) {
  const doc = await PDFDocument.load(
    await selectTemplate(id).render({ ...base, pageSize: 'a6', cardQr: false }),
  );
  assert.equal(doc.getPageCount(), 1, id + ' default A6 page count');
  report.push(`${id}: default A6 without QR, 1 page`);
}
// The reported CLI regression: one member per page and the same-page QR in both export targets.
const cliDirectory = await mkdtemp(resolve(destination, 'sskr-command-'));
const shares = vector.deterministic[0].shares;
const shareFile = resolve(cliDirectory, 'public-shares.txt');
const proposal = resolve(cliDirectory, 'sskr-2of3-study.pdf');
await writeFile(shareFile, shares.join('\n') + '\n', { mode: 0o600 });
execFileSync(
  process.execPath,
  [
    'dist/mnemocode.js',
    'sskr-export',
    '--share-file',
    shareFile,
    '--card-layout',
    'collection',
    '--card-qr',
    '--template',
    'business-it',
    '--page-size',
    'business',
    '--orientation',
    'landscape',
    '--studio-name',
    'Orven Studio',
    '--card-name',
    'Alex Morgan',
    '--card-company',
    'VECTOR SYSTEMS',
    '--card-role',
    'IT Solutions Director',
    '--card-subtitle',
    'Colour options for review.',
    '--card-footer',
    'CLIENT REVIEW',
    '--pdf',
    proposal,
    '--cards-dir',
    resolve(cliDirectory, 'member-studies'),
  ],
  { stdio: 'pipe' },
);
const combined = await PDFDocument.load(await readFile(proposal));
assert.equal(combined.getPageCount(), shares.length);
for (let i = 0; i < shares.length; i++) {
  const prefix = resolve(cliDirectory, 'page-' + (i + 1));
  execFileSync(
    'pdftoppm',
    [
      '-f',
      String(i + 1),
      '-l',
      String(i + 1),
      '-singlefile',
      '-r',
      '200',
      '-png',
      proposal,
      prefix,
    ],
    { stdio: 'pipe' },
  );
  const png = PNG.sync.read(await readFile(prefix + '.png'));
  assert.equal(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    shareToColors(shares[i]).join(' '),
    'SSKR study must contain only its own member',
  );
}
report.push('SSKR command: three single-page member studies, exact same-page QR round-trips.');
console.log(report.at(-1));
console.log('Public-data proposal: ' + proposal);
if (process.argv[3]) {
  const sampleOutput = resolve(process.argv[3]);
  await mkdir(dirname(sampleOutput), { recursive: true });
  await writeFile(sampleOutput, await readFile(proposal), { flag: 'wx', mode: 0o600 });
  console.log('Saved verified public-data example: ' + sampleOutput);
}
await writeFile(resolve(destination, 'report.txt'), report.join('\n') + '\n');
console.log('Export checks completed; no full test suite executed.');
