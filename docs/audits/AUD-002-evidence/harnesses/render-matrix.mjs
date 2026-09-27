/** Audit-only: render every installed template at every page size and orientation with QR enabled. */
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { cardTemplates } from '../../../../dist/export/templates.js';
import { renderCards } from '../../../../dist/export/pdf.js';
import { representMnemonic, indexesToColors } from '../../../../dist/core.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
const colors = indexesToColors(representMnemonic(entropyToMnemonic(Uint8Array.from({ length: 32 }, (_, i) => i * 7 % 256), wordlist)).shiftedIndexes);
const results = [];
const started = Date.now();
for (const template of cardTemplates)
  for (const pageSize of ['a4', 'a6', 'wallet', 'business'])
    for (const orientation of ['landscape', 'portrait']) {
      const t0 = Date.now();
      try {
        const bytes = await renderCards([{ template, content: { kind: 'colors', colors, payload: colors.join(' '), pageSize, orientation, cardQr: true,
          profile: { name: 'Alex Morgan', company: 'VECTOR SYSTEMS', role: 'IT SOLUTIONS DIRECTOR', email: 'alex@vector.com', website: 'vector.com', phone: '+44 20 7946 0281', location: 'International' },
          presentation: { studioName: 'VECTOR STUDIO', slogan: 'Design with purpose.', subtitle: 'Selected finishes', footer: 'Crafted with care.', referenceLabel: 'Ref.' } } }]);
        const pdf = await PDFDocument.load(bytes);
        const p = pdf.getPage(0);
        results.push({ template: template.id, pageSize, orientation, ok: true, pages: pdf.getPageCount(), widthMm: +(p.getWidth() * 25.4 / 72).toFixed(1), heightMm: +(p.getHeight() * 25.4 / 72).toFixed(1), bytes: bytes.length, ms: Date.now() - t0 });
      } catch (error) {
        results.push({ template: template.id, pageSize, orientation, ok: false, error: String(error.message), ms: Date.now() - t0 });
      }
      console.log(JSON.stringify(results.at(-1)));
    }
const summary = { total: results.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), totalMs: Date.now() - started, words: 24, references: colors.length, results };
writeFileSync('docs/audits/AUD-002-evidence/render-matrix.json', JSON.stringify(summary, null, 2));
console.log('SUMMARY', summary.total, summary.ok, summary.totalMs);
