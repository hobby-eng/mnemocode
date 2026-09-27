import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pageOperators } from './helpers/pdf-content.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { indexesToColors, representMnemonic, colorsToUnicode } from '../src/core.js';
import { businessPages, MM } from '../src/export/business-layout.js';
import { resolveProfile, validateProfile, parsePageSize } from '../src/export/card-settings.js';
import { selectTemplate } from '../src/export/templates.js';
import { renderCards } from '../src/export/pdf.js';
import { parseArguments } from '../src/cli/arguments.js';
import { businessOptions } from '../src/cli/business-options.js';
import { validateCardOptions } from '../src/cli/card-options.js';
import { resolveCardPresentation } from '../src/export/card-copy.js';

const colors = indexesToColors(
  representMnemonic(entropyToMnemonic(new Uint8Array(32), wordlist)).shiftedIndexes,
);

describe('business card collections', () => {
  it('uses defaults only for omitted fields and validates Latin names', () => {
    const profile = resolveProfile('architect', { name: ' Alex Morgan ', email: 'me@example.com' });
    expect(profile.name).toBe('Alex Morgan');
    expect(resolveProfile('it', { name: 'Jean-Luc D’Angelo' }).name).toBe('Jean-Luc D’Angelo');
    expect(() => validateProfile({ name: 'Сергей Иванов' })).toThrow('Latin letters only');
    expect(profile.role).toBe('ARCHITECT');
    expect(profile.email).toBe('me@example.com');
    expect(profile.website).toBe('vector.com');
    expect(resolveProfile('it').name).toBe('Alex Morgan');
    expect(resolveProfile('it').role).toBe('IT SOLUTIONS DIRECTOR');
  });

  it('rejects silent fallbacks for invalid or repeated options and requires a PDF', () => {
    for (const name of ['', '  ', 'x\ny', '\x1b[0m', 'x'.repeat(101)])
      expect(() => validateProfile({ name })).toThrow();
    expect(parsePageSize('wallet')).toBe('wallet');
    expect(parsePageSize('business')).toBe('business');
    expect(() =>
      businessOptions(parseArguments(['--card-name', 'One', '--card-name', 'Two'])),
    ).toThrow('exactly once');
    expect(() =>
      validateCardOptions(parseArguments(['--card-email', 'me@example.com']), 'colors', 'direct'),
    ).toThrow('require --pdf');
    expect(() =>
      validateCardOptions(
        parseArguments(['--pdf', 'a.pdf', '--page-size', 'a3']),
        'colors',
        'direct',
      ),
    ).toThrow('Page size');
  });

  it.each([8, 10, 12, 14, 16])(
    'fits %i samples on A6 and paginates full-size A4 without overlap',
    (count) => {
      for (const size of ['a6', 'a4'] as const) {
        const pages = businessPages(count, size);
        expect(pages).toHaveLength(size === 'a6' ? 1 : Math.ceil(count / 8));
        expect(pages.flatMap((p) => p.cards.map((b) => b.index))).toEqual(
          Array.from({ length: count }, (_, i) => i),
        );
        for (const page of pages)
          for (const box of page.cards) {
            expect(box.x).toBeGreaterThan(0);
            expect(box.y).toBeGreaterThan(10);
            expect(box.x + box.width).toBeLessThan(page.width);
            expect(box.y + box.height + 3).toBeLessThan(size === 'a6' ? 87 : 269);
            if (size === 'a4') expect([box.width, box.height]).toEqual([90, 50]);
            for (const other of page.cards.filter((b) => b.index !== box.index)) {
              expect(
                box.x + box.width <= other.x ||
                  other.x + other.width <= box.x ||
                  box.y + box.height + 3 <= other.y ||
                  other.y + other.height + 3 <= box.y,
              ).toBe(true);
            }
          }
      }
    },
  );

  it('renders both designs with real fonts/artwork, custom fields and both raw QR formats', async () => {
    for (const [id, size, payload] of [
      ['business-architect', 'a6', colors.join(' ')],
      ['business-it', 'a4', colorsToUnicode(colors)],
    ] as const) {
      const bytes = await renderCards([
        {
          template: selectTemplate(id),
          content: {
            kind: 'colors',
            colors,
            payload,
            pageSize: size,
            cardQr: true,
            presentation: resolveCardPresentation({}, {}, () => 0).presentation,
            profile: {
              name: 'Alex Morgan',
              email: 'me@example.com',
              company: 'VECTOR SYSTEMS',
              role: 'IT SOLUTIONS DIRECTOR',
              website: 'vector.com',
              phone: '+1 202 555 0148',
              location: 'International',
            },
          },
        },
      ]);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(size === 'a6' ? 2 : 3);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo((size === 'a6' ? 148 : 210) * MM, 3);
        expect(page.getHeight()).toBeCloseTo((size === 'a6' ? 105 : 297) * MM, 3);
      }
      expect(pdf.getTitle() ?? '').toBe('');
      // Enabling QR may append a reverse side, but must not alter any front.
      // Count-free comparison: decorative fills are unrelated to QR presence.
      const plain = await PDFDocument.load(
        await renderCards([
          {
            template: selectTemplate(id),
            content: {
              kind: 'colors',
              colors,
              payload,
              pageSize: size,
              cardQr: false,
              presentation: resolveCardPresentation({}, {}, () => 0).presentation,
              profile: {
                name: 'Alex Morgan',
                email: 'me@example.com',
                company: 'VECTOR SYSTEMS',
                role: 'IT SOLUTIONS DIRECTOR',
                website: 'vector.com',
                phone: '+1 202 555 0148',
                location: 'International',
              },
            },
          },
        ]),
      );
      expect(pdf.getPageCount()).toBe(plain.getPageCount() + 1);
      for (let index = 0; index < plain.getPageCount(); index++) {
        expect(pageOperators(pdf, index)).toBe(pageOperators(plain, index));
      }
    }
  }, 180_000);

  it('fails on mismatched QR data and unprintable personal fields before returning a PDF', async () => {
    const template = selectTemplate('business-it');
    const content = { kind: 'colors' as const, colors, payload: colors.join(' ') };
    await expect(template.render({ ...content, payload: 'MNC1:secret' })).rejects.toThrow();
    await expect(template.render({ ...content, profile: { company: '🛸' } })).rejects.toThrow(
      'not supported',
    );
    await expect(
      template.render({ ...content, profile: { email: 'x'.repeat(95) } }),
    ).rejects.toThrow('too long');
  });
});
