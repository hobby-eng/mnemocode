// Public counting entropy and published SSKR vectors only. Run from the repository root.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
const root = process.cwd();
const load = (name) => import(pathToFileURL(resolve(root, 'dist', name)).href);
await load('export/platform-node.js');
const { cardTemplates, allTemplateStyles, selectTemplate } = await load('export/templates.js');
const { renderCards, renderIndividualCards } = await load('export/render.js');
const { renderSskrPdf } = await load('export/sskr-cards.js');
const { combineSskrShares } = await load('sskr/shares.js');
const { shareToColors } = await load('sskr/transport.js');
const { indexesToColors, decodeInputDirect } = await load('core.js');
const vectors = JSON.parse(await readFile('vectors/sskr-v1.json', 'utf8'));
const colors = indexesToColors(Array.from({ length: 24 }, (_, index) => index * 79));
const base = { kind: 'colors', colors, payload: colors.join(' '), pageSize: 'a6', cardQr: true,
  profile: { name: 'Alex Morgan', company: 'PUBLIC TEST', email: 'test@example.test' } };
const out = resolve('docs/audits/AUD-004-evidence/rendered');
await mkdir(out, { recursive: true });
const results = [];
async function inspect(name, bytes, expected, refs) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 1, name);
  for (const field of ['getAuthor', 'getTitle', 'getCreator', 'getProducer']) assert.equal(pdf[field]() ?? '', '', name);
  const prefix = resolve(out, name);
  await writeFile(prefix + '.pdf', bytes, { mode: 0o600 });
  execFileSync('/usr/bin/pdftocairo', ['-png', '-singlefile', '-r', '200', prefix + '.pdf', prefix]);
  const png = PNG.sync.read(await readFile(prefix + '.png'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'dontInvert' });
  assert.equal(decoded?.data, expected, name + ' QR');
  const text = execFileSync('/usr/bin/pdftotext', ['-layout', prefix + '.pdf', '-'], { encoding: 'utf8' });
  for (const ref of refs) assert.ok(text.includes(ref.slice(1)), name + ' printed ' + ref);
  const entry = { name, qr: expected === undefined ? 'absent' : 'exact', references: refs.length,
    widthMm: pdf.getPage(0).getWidth() * 25.4 / 72, heightMm: pdf.getPage(0).getHeight() * 25.4 / 72 };
  results.push(entry); console.log(JSON.stringify(entry));
  return decoded?.data;
}
const share = vectors.deterministic.at(-1).shares[0];
for (const template of cardTemplates) {
  await inspect(template.id + '-ordinary', await renderCards([{ template, content: base }]), base.payload, colors);
  const refs = shareToColors(share);
  await inspect(template.id + '-share', await renderSskrPdf([share], {
    style: allTemplateStyles[template.id], layout: 'collection', pageSize: 'a6', cardQr: true,
  }), refs.join(' '), refs);
}
for (const id of ['business-it', 'material-tile', 'business-glass-4in1', 'business-glass-6in1', 'business-glass-8in1']) {
  const template = selectTemplate(id);
  const fragments = await renderIndividualCards(template, { ...base, pageSize: undefined });
  const per = template.referencesPerCard ?? 1;
  await inspect(id + '-fragment', fragments[0].bytes, undefined, colors.slice(0, per));
}
const recoveredShares = [];
for (let i = 0; i < 2; i++) {
  const record = vectors.deterministic.at(-1).shares[i];
  const refs = shareToColors(record);
  recoveredShares.push(await inspect('recovery-' + i, await renderSskrPdf([record], {
    style: 'it', layout: 'qr', pageSize: 'business',
  }), refs.join(' '), refs));
}
const recovered = await combineSskrShares(recoveredShares);
assert.equal(recovered, await combineSskrShares(vectors.deterministic.at(-1).shares.slice(0, 2)));
console.log(JSON.stringify({ result: 'PASS', documents: results.length, sskrQrQuorumRestored: true }));
await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
