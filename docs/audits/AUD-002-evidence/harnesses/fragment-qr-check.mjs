/** Audit-only follow-up: decode the QR of every individual SSKR fragment and compare with its own printed reference. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { shareToColors, shareInfo, urToTransport } from '../../../../dist/sskr/transport.js';
const W = JSON.parse(readFileSync('docs/audits/AUD-002-evidence/sskr-cards-probe.json', 'utf8')).workspace;
const shares = readFileSync(join(W, 'shares.txt'), 'utf8').trim().split('\n');
const byId = new Map(shares.map((s) => { const i = shareInfo(urToTransport(s)); return [`${i.identifier.toString(16).padStart(4, '0')}-${i.groupIndex + 1}-${i.memberIndex + 1}`.toUpperCase(), s]; }));
const rows = [];
for (const folder of readdirSync(join(W, 'fragments')).sort()) {
  const share = byId.get(folder.replace('collection-', ''));
  const colors = shareToColors(share);
  for (const [i, file] of readdirSync(join(W, 'fragments', folder)).sort().entries()) {
    const dir = mkdtempSync(join(tmpdir(), 'frag-'));
    for (const dpi of [200, 300]) {
      execFileSync('pdftoppm', ['-r', String(dpi), '-png', join(W, 'fragments', folder, file), join(dir, `p${dpi}`)]);
    }
    const decode = (dpi) => readdirSync(dir).filter((f) => f.startsWith(`p${dpi}`)).sort().map((f) => { const png = PNG.sync.read(readFileSync(join(dir, f))); return jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), png.width, png.height, { inversionAttempts: 'attemptBoth' })?.data ?? null; });
    const q200 = decode(200), q300 = decode(300);
    const payload = (q300.find(Boolean) ?? q200.find(Boolean)) ?? null;
    rows.push({ folder, file, pages: q300.length, decoded200: q200.filter(Boolean).length, decoded300: q300.filter(Boolean).length, payload, ownReference: colors[i], exactlyOwn: payload === colors[i], containsOtherReferences: payload !== null && payload.split(' ').length > 1 });
  }
}
const summary = { fragments: rows.length, exactlyOwn: rows.filter((r) => r.exactlyOwn).length, undecoded: rows.filter((r) => r.payload === null).length, leaks: rows.filter((r) => r.containsOtherReferences).length, mismatched: rows.filter((r) => r.payload !== null && !r.exactlyOwn), rows };
writeFileSync('docs/audits/AUD-002-evidence/fragment-qr-check.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ fragments: summary.fragments, exactlyOwn: summary.exactlyOwn, undecoded: summary.undecoded, leaks: summary.leaks, mismatched: summary.mismatched.length }));
for (const r of rows.filter((x) => !x.exactlyOwn)) console.log(JSON.stringify(r));
