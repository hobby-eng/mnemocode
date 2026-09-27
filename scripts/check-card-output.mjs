/** Manual export check using public fixture data only. Not run at startup. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { indexesToColors, representMnemonic } from '../dist/core.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { selectTemplate } from '../dist/export/templates.js';
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
    colors[1],
  ],
  ['business-sskr', () => renderBusinessCards('it', share, 0), share.payload],
  ['material-full', () => selectTemplate('material-kitchen').render(base), base.payload],
  [
    'material-fragment',
    () => selectTemplate('material-switch').renderIndividual(base, 1),
    colors[1],
  ],
  ['glass-four', () => renderGlassCards(base, 0), colors.slice(0, 4).join(' ')],
  ['glass-six', () => renderGlassCards(base, 0, 6), colors.slice(0, 6).join(' ')],
  [
    'glass-eight',
    () => renderGlassCards({ ...base, pageSize: 'business' }, 0, 8),
    colors.slice(0, 8).join(' '),
  ],
  ['glass-eight-sskr', () => renderGlassCards(share, undefined, 8), share.payload],
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
  assert.equal(result?.data, expected, name + ' QR mismatch');
  report.push(`${name}: ${page} page(s), exact QR round-trip at 200 dpi`);
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
await writeFile(resolve(destination, 'report.txt'), report.join('\n') + '\n');
console.log('Export checks completed; no full test suite executed.');
