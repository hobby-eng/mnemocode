/** Audit-only end-to-end probe: real SSKR card exports, rasterized QR decoding, quorum recovery. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { normalizeShare, shareToColors } from '../../../../dist/sskr/transport.js';

const root = resolve('.');
const cli = join(root, 'dist/mnemocode.js');
const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const W = mkdtempSync(join(tmpdir(), 'mnemocode-aud-002-sskr-'));
const env = { ...process.env, NO_COLOR: '1' };
const sh = (args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const report = { workspace: W, steps: [] };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

function decodeQrsFromPdf(pdf) {
  const dir = mkdtempSync(join(tmpdir(), 'raster-'));
  if (pdf.endsWith('.png')) writeFileSync(join(dir, 'p-1.png'), readFileSync(pdf));
  else execFileSync('pdftoppm', ['-r', '200', '-png', pdf, join(dir, 'p')]);
  return readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => {
    const png = PNG.sync.read(readFileSync(join(dir, f)));
    const found = jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), png.width, png.height, { inversionAttempts: 'dontInvert' });
    return { page: f, qr: found?.data ?? null };
  });
}

// 1. 3-of-5 split with combined PDF, QR cards and PNG pages in one invocation.
const t0 = Date.now();
const out = sh(['encode', '--sskr', '--threshold', '3', '--shares', '5', '--mnemonic', M, '--output', join(W, 'shares.txt'),
  '--cards-dir', join(W, 'qr-cards'), '--card-layout', 'qr', '--template', 'business-glass-6in1', '--pdf', join(W, 'all.pdf')]);
const shares = readFileSync(join(W, 'shares.txt'), 'utf8').trim().split('\n');
step('split-3-of-5', { ms: Date.now() - t0, shares: shares.length, qrCardFiles: readdirSync(join(W, 'qr-cards')).length, stdoutHasShares: shares.every((s) => out.includes(s)) });
// 1b. Image export of the same set through sskr-export: PNG pages of the combined collection.
const t0b = Date.now();
sh(['sskr-export', '--share-file', join(W, 'shares.txt'), '--template', 'business-glass-6in1', '--card-layout', 'qr', '--images-dir', join(W, 'pages'), '--image-format', 'png']);
const pagePngs = readdirSync(join(W, 'pages')).sort();
const pageQrs = pagePngs.map((f) => decodeQrsFromPdf(join(W, 'pages', f))[0].qr).filter(Boolean).map((q) => normalizeShare(q));
step('png-pages', { ms: Date.now() - t0b, pngPages: pagePngs.length, qrPages: pageQrs.length, distinctMembers: new Set(pageQrs).size, allKnown: pageQrs.every((p) => shares.includes(p)), dirMode: (statSync(join(W, 'pages')).mode & 0o777).toString(8) });

// 2. Each QR card holds exactly its own member, as ordered RGB codes.
const qrPayloads = [];
for (const file of readdirSync(join(W, 'qr-cards')).sort()) {
  const pages = decodeQrsFromPdf(join(W, 'qr-cards', file));
  const qrs = pages.map((p) => p.qr).filter(Boolean);
  const normalized = qrs.map((q) => normalizeShare(q));
  const member = shares.find((s) => normalized.includes(s));
  qrPayloads.push(...normalized);
  step('qr-card', { file, pages: pages.length, qrCount: qrs.length, matchesOneShare: member !== undefined && new Set(normalized).size === 1, expectedColors: member ? shareToColors(member).join(' ') === qrs[0] : false });
}
step('qr-cards-cover-all-members', { distinctMembers: new Set(qrPayloads).size, expected: 5, allKnown: qrPayloads.every((p) => shares.includes(p)) });

// 3. Recover with three decoded QR payloads; two must fail.
const recovered = sh(['sskr-combine', '--share', qrPayloads[0], '--share', qrPayloads[2], '--share', qrPayloads[4]]);
let twoFailed = false; try { sh(['sskr-combine', '--share', qrPayloads[0], '--share', qrPayloads[1]]); } catch { twoFailed = true; }
step('quorum-from-qr', { recoveredOriginal: recovered.includes(M), twoSharesRejected: twoFailed });

// 4. Individual fragments with --card-qr: each fragment QR carries only its own printed references.
const t1 = Date.now();
sh(['sskr-export', '--share-file', join(W, 'shares.txt'), '--cards-dir', join(W, 'fragments'), '--card-layout', 'individual', '--template', 'business-it', '--card-qr', '--page-size', 'business']);
const folders = readdirSync(join(W, 'fragments')).sort();
let fragmentsChecked = 0, fragmentQrOk = 0, fragmentQrLeak = 0, filesTotal = 0;
for (const folder of folders) {
  const files = readdirSync(join(W, 'fragments', folder)).sort();
  filesTotal += files.length;
  const id = folder.replace('collection-', '');
  const member = shares.find((s) => { const c = shareToColors(s); return files.length === c.length; });
  for (const [i, file] of files.slice(0, 3).entries()) {
    const pages = decodeQrsFromPdf(join(W, 'fragments', folder, file));
    const qrs = pages.map((p) => p.qr).filter(Boolean);
    fragmentsChecked += 1;
    const own = member ? shareToColors(member)[i] : undefined;
    if (qrs.length === 1 && own !== undefined && qrs[0] === own) fragmentQrOk += 1;
    if (qrs.some((q) => q.split(' ').length > 1)) fragmentQrLeak += 1;
  }
  step('fragment-folder', { folder, id, files: files.length, expectedFilesFromShareColors: member ? shareToColors(member).length : null });
}
step('fragments-summary', { ms: Date.now() - t1, folders: folders.length, filesTotal, fragmentsChecked, fragmentQrExactlyOwnReference: fragmentQrOk, fragmentQrWithMultipleReferences: fragmentQrLeak });

// 5. Existing destination refused; nothing overwritten.
let refused = false; try { sh(['sskr-export', '--share-file', join(W, 'shares.txt'), '--cards-dir', join(W, 'fragments'), '--card-layout', 'individual']); } catch (e) { refused = /already exists/u.test(String(e.stderr)); }
step('existing-folder-refused', { refused, filesAfter: folders.reduce((n, f) => n + readdirSync(join(W, 'fragments', f)).length, 0) });

// 6. Combined PDF page count and size, file modes.
const combined = decodeQrsFromPdf(join(W, 'all.pdf'));
step('combined-pdf', { pages: combined.length, qrPages: combined.filter((p) => p.qr).length, mode: (statSync(join(W, 'all.pdf')).mode & 0o777).toString(8), qrCardsDirMode: (statSync(join(W, 'qr-cards')).mode & 0o777).toString(8) });
writeFileSync(join(root, 'docs/audits/AUD-002-evidence/sskr-cards-probe.json'), JSON.stringify(report, null, 2));
console.log('DONE');
