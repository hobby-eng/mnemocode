import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { businessFields, businessStyles } from '../src/export/business-designs.js';
import { MM } from '../src/export/business-layout.js';
import { fit } from '../src/export/business-render-primitives.js';
import {
  commonRoles,
  createCardIdentity,
  employers,
  personNames,
  sectorRoles,
  type CompanySector,
} from '../src/export/card-identities.js';

const CARD_WIDTH_MM = 90;
const longest = (values: readonly string[]) => [...values].sort((a, b) => b.length - a.length)[0]!;

describe('invented card details', () => {
  it('fit every business design, for every employer with the longest name and role', async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const font = await document.embedFont(
      readFileSync(new URL('../assets/fonts/DejaVuSans-UI.ttf', import.meta.url)),
    );
    const name = longest(personNames);
    for (const sector of Object.keys(employers) as CompanySector[]) {
      const role = longest([...sectorRoles[sector], ...commonRoles]);
      for (const company of employers[sector]) {
        const profile = createCardIdentity({ name, company, role }, sector);
        // The mixed template shows every design, so every employer meets every design.
        for (const style of businessStyles)
          for (const field of businessFields(style, profile))
            expect(
              () =>
                fit(
                  font,
                  field.value,
                  field.preferred,
                  field.minimum,
                  CARD_WIDTH_MM * MM * field.width,
                  field.label,
                ),
              `${style}: ${field.label} of ${company}`,
            ).not.toThrow();
      }
    }
  });

  it('end in the reserved example domain and shorten a long company name', () => {
    const identity = createCardIdentity({ company: 'Northern Harbour Business Services' });
    expect(identity.website).toBe('northernharbour.example');
    expect(identity.email).toBe('contact@northernharbour.example');
    // One long word has no shorter form, so it is cut.
    expect(createCardIdentity({ company: 'Abcdefghijklmnopqrstuvwxyz' }).website).toBe(
      'abcdefghijklmnopqr.example',
    );
    // A supplied address is printed as given.
    expect(createCardIdentity({ company: 'Any', website: 'any.org' }).website).toBe('any.org');
  });
});
