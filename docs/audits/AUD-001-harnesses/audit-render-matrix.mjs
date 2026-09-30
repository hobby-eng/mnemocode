import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { cardTemplates } from './dist/export/templates.js';
import { representMnemonic, indexesToColors } from './dist/core.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
const colors = indexesToColors(
  representMnemonic(entropyToMnemonic(new Uint8Array(32).fill(255), wordlist)).shiftedIndexes,
);
const results = [];
const profile = {
  name: 'Lukas Weber',
  company: 'Rillford Technologies',
  role: 'Senior DevOps Engineer',
  email: 'contact@rillfordtechnologies.com',
  website: 'rillfordtechnologies.com',
  phone: '+44 20 7946 0281',
  location: 'International',
};
const presentation = {
  studioName: 'Marlow Type & Print',
  slogan: 'Considered design for everyday business.',
  subtitle: 'Colour options for review.',
  footer: 'CLIENT REVIEW',
  referenceLabel: 'Ref.',
};
for (const template of cardTemplates)
  for (const pageSize of ['a6', 'a4', 'wallet', 'business'])
    for (const orientation of ['landscape', 'portrait']) {
      const content = {
        kind: 'colors',
        colors,
        payload: colors.join(' '),
        profile,
        presentation,
        pageSize,
        orientation,
        cardQr: true,
      };
      const name = `${template.id}-${pageSize}-${orientation}`;
      try {
        const bytes = await template.render(content);
        const pdf = await PDFDocument.load(bytes);
        const dimensions = pdf
          .getPages()
          .map((p) => [(p.getWidth() * 25.4) / 72, (p.getHeight() * 25.4) / 72]);
        results.push({ name, status: 'rendered', pages: dimensions.length, dimensions });
        await writeFile(
          '/tmp/mnemocode-aud-001/evidence/render-matrix-progress.json',
          JSON.stringify(results, null, 2),
        );
        if (pageSize === 'business' && orientation === 'portrait' && template.id.includes('glass'))
          await writeFile(`/tmp/mnemocode-aud-001/evidence/${name}.pdf`, bytes);
      } catch (error) {
        results.push({ name, status: 'failed', error: error.message });
        console.log(JSON.stringify(results.at(-1)));
      }
    }
await writeFile(
  '/tmp/mnemocode-aud-001/evidence/render-matrix.json',
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify({
    cases: results.length,
    rendered: results.filter((r) => r.status === 'rendered').length,
    failed: results.filter((r) => r.status === 'failed').length,
  }),
);
