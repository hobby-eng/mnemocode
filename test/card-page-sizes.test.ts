import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { isCardPageSize, renderCards, selectTemplate, type CardContent } from '../src/cards.js';
import { indexesToColors } from '../src/core.js';
import { MM } from '../src/export/business-layout.js';
import { pageOperators } from './helpers/pdf-content.js';

const colors = indexesToColors(Array.from({ length: 12 }, (_, index) => index * 7));
const content: CardContent = { kind: 'colors', colors, payload: colors.join(' ') };

async function pages(template: string, settings: Partial<CardContent>) {
  const bytes = await renderCards([
    {
      template: selectTemplate(template, 'colors'),
      content: { ...content, ...settings } as CardContent,
    },
  ]);
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round((width / MM) * 10) / 10, Math.round((height / MM) * 10) / 10];
  });
}

describe('page size decides between a sheet and separate cards', () => {
  it('names only the business size as a card size', () => {
    expect(
      [undefined, 'a6', 'a4', 'wallet', 'business'].map((size) => isCardPageSize(size as never)),
    ).toEqual([false, false, false, false, true]);
  });

  it('puts the whole collection on one A6 sheet when no size is given', async () => {
    for (const template of ['business-it', 'material-tile', 'business-glass-4in1'])
      expect(await pages(template, {}), template).toEqual([[148, 105]]);
    expect(await pages('business-it', { pageSize: 'a4' })).toHaveLength(1);
  });

  it('gives one page per card for a card size', async () => {
    expect(await pages('business-it', { pageSize: 'business' })).toEqual(
      colors.map(() => [90, 50]),
    );
    expect(await pages('material-tile', { pageSize: 'business' })).toEqual(
      colors.map(() => [90, 50]),
    );
    await expect(pages('business-it', { pageSize: 'wallet' as never })).rejects.toThrow(
      'a6, a4 or business',
    );
    // Four references share one glass card, so eight references need two cards.
    expect(await pages('business-glass-4in1', { pageSize: 'business' })).toEqual([
      [90, 50],
      [90, 50],
    ]);
  });

  it('refuses separate cards of a sheet size', async () => {
    const { renderIndividualCards } = await import('../src/cards.js');
    const template = selectTemplate('business-it', 'colors');
    for (const pageSize of ['a6', 'a4'] as const)
      await expect(renderIndividualCards(template, { ...content, pageSize })).rejects.toThrow(
        'Separate cards have the business size.',
      );
    expect(await renderIndividualCards(template, { ...content })).toHaveLength(colors.length);
  });

  it('knows the size of every page in both orientations', async () => {
    const { pageDimensions } = await import('../src/export/card-settings.js');
    expect(pageDimensions('a4')).toEqual([210, 297]);
    expect(pageDimensions('a4', 'landscape')).toEqual([297, 210]);
    expect(pageDimensions('a6')).toEqual([148, 105]);
    expect(pageDimensions('a6', 'portrait')).toEqual([105, 148]);
    expect(pageDimensions('business', 'portrait')).toEqual([50, 90]);
  });

  it('gives a separate card rounded corners and paints nothing outside them', async () => {
    const template = selectTemplate('business-it', 'colors');
    const document = await PDFDocument.load(
      await template.renderIndividual!({ ...content, pageSize: 'business' }, 0),
    );
    const operators = pageOperators(document, 0);
    // Four curves form the corners of the clipping path; the artwork is drawn inside it.
    expect(operators.match(/ c$/gmu)).toHaveLength(4);
    expect(operators.indexOf('\nW\n')).toBeGreaterThan(-1);
    expect(operators.indexOf('\nW\n')).toBeLessThan(operators.indexOf(' Do'));
  });

  it('refuses a QR code on separate cards', async () => {
    await expect(pages('business-it', { pageSize: 'business', cardQr: true })).rejects.toThrow(
      'A QR code is printed on a sheet only.',
    );
  });
});

describe('page size decides the layout of Shamir share cards', () => {
  it('chooses the layout from the page size and rejects a conflicting request', async () => {
    const { resolveSskrLayout } = await import('../src/export/sskr-content.js');
    expect(resolveSskrLayout(undefined, undefined)).toBe('collection');
    expect(resolveSskrLayout(undefined, 'a4')).toBe('collection');
    expect(resolveSskrLayout(undefined, 'business')).toBe('individual');
    expect(resolveSskrLayout('individual', undefined)).toBe('individual');
    // A QR card holds one whole share and exists in every size.
    for (const size of [undefined, 'a6', 'business'] as const)
      expect(resolveSskrLayout('qr', size)).toBe('qr');
    expect(() => resolveSskrLayout('collection', 'business')).toThrow('gives separate cards');
    expect(() => resolveSskrLayout('individual', 'a6')).toThrow(
      'Separate cards have the business size',
    );
  });

  it('prints one sheet per share on A6 and one page per card for a card size', async () => {
    const { splitSskrMnemonic } = await import('../src/sskr/shares.js');
    const { shareToColors } = await import('../src/sskr/transport.js');
    const { renderSskrPdf } = await import('../src/export/sskr-cards.js');
    // Public BIP39 test vector; never a real wallet.
    const shares = await splitSskrMnemonic(`${'abandon '.repeat(11)}about`, 2, 3);
    const sheets = await PDFDocument.load(await renderSskrPdf(shares, { style: 'it' }));
    expect(sheets.getPageCount()).toBe(shares.length);
    const cards = await PDFDocument.load(
      await renderSskrPdf(shares, { style: 'it', pageSize: 'business' }),
    );
    const references = shares.reduce((sum, share) => sum + shareToColors(share).length, 0);
    expect(cards.getPageCount()).toBe(references);
    const { width, height } = cards.getPage(0).getSize();
    expect([Math.round(width / MM), Math.round(height / MM)]).toEqual([90, 50]);
  });

  it('prints the QR card of a share as a compact sheet of the business size', async () => {
    const { splitSskrMnemonic } = await import('../src/sskr/shares.js');
    const { renderSskrPdf } = await import('../src/export/sskr-cards.js');
    const { collectionSheetLayout } = await import('../src/export/collection-sheet.js');
    // Public BIP39 test vector; never a real wallet.
    const shares = await splitSskrMnemonic(`${'abandon '.repeat(11)}about`, 2, 3);
    const document = await PDFDocument.load(
      await renderSskrPdf(shares, { style: 'it', pageSize: 'business', layout: 'qr' }),
    );
    // One page for every share, each with its QR code: this is the only use of the compact sheet.
    expect(document.getPageCount()).toBe(shares.length);
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      expect([Math.round(width / MM), Math.round(height / MM)]).toEqual([90, 50]);
      expect(pageOperators(document, document.getPages().indexOf(page))).toContain(' Do');
    }
    expect(collectionSheetLayout({ pageSize: 'business' }, 1, 1.8, 1, 'payload').compact).toBe(
      true,
    );
    expect(collectionSheetLayout({ pageSize: 'a6' }, 1, 1.8, 1, 'payload').compact).toBe(false);
  });
});
