import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { pageOperators } from './helpers/pdf-content.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderCards, exportCards } from '../src/export/pdf.js';
import {
  cardTemplates,
  selectTemplate,
  type CardContent,
  type CardTemplate,
} from '../src/export/templates.js';
import { parseArguments, values } from '../src/cli/arguments.js';
import { completeEventLabels } from '../src/cli/card-options.js';
import { indexesToColors, parseDate } from '../src/core.js';
import { resolveCardPresentation } from '../src/export/card-copy.js';
import { resolveProfile } from '../src/export/card-settings.js';

// Blank PDF fixture tests the export transport only. It is never a registered design.
async function fixture(pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++)
    doc
      .addPage([100, 60])
      .drawRectangle({ x: 8, y: 12, width: 26, height: 18, color: rgb(0.2, 0.4, 0.6) });
  doc.setTitle('Private fixture title');
  doc.setAuthor('Private fixture author');
  doc.setSubject('Private fixture subject');
  doc.setKeywords(['Private fixture keyword']);
  doc.setCreator('Private fixture creator');
  doc.setProducer('Private fixture producer');
  return doc.save();
}
const content: CardContent = { kind: 'colors', colors: [], payload: 'public test' };
const fragmentColors = indexesToColors(Array.from({ length: 12 }, (_, index) => index));

// Identity and sheet copy are chosen randomly per export; pin them so paired
// renders can differ only through the setting under test.
const fixedIdentity = {
  presentation: resolveCardPresentation({}, {}, () => 0).presentation,
  profile: resolveProfile('it', { name: 'Alex Morgan' }),
};

describe('export infrastructure', () => {
  it('ships sixteen approved templates with individual export', () => {
    expect(cardTemplates).toHaveLength(16);
    expect(new Set(cardTemplates.map((t) => t.id)).size).toBe(16);
    for (const template of cardTemplates) expect(template.renderIndividual).toBeTypeOf('function');
  });

  it.each([
    'material-vehicle',
    'material-enclosure',
    'material-tile',
    'material-switch',
    'material-kitchen',
    'business-glass-4in1',
    'business-glass-6in1',
    'business-glass-8in1',
  ])('keeps an enabled collection QR off the individual %s front', async (id) => {
    const template = selectTemplate(id);
    for (const pageSize of ['wallet', 'business'] as const) {
      const withQr = await PDFDocument.load(
        await template.renderIndividual!(
          {
            kind: 'colors',
            colors: fragmentColors,
            payload: fragmentColors.join(' '),
            cardQr: true,
            pageSize,
            ...fixedIdentity,
          },
          0,
        ),
      );
      const withoutQr = await PDFDocument.load(
        await template.renderIndividual!(
          {
            kind: 'colors',
            colors: fragmentColors,
            payload: fragmentColors.join(' '),
            cardQr: false,
            pageSize,
            ...fixedIdentity,
          },
          0,
        ),
      );
      expect(withQr.getPageCount()).toBe(1);
      expect(pageOperators(withQr, 0)).toBe(pageOperators(withoutQr, 0));
    }
  });

  it('preserves page content and removes private metadata in preview and saved PDFs', async () => {
    const bytes = await fixture();
    const template: CardTemplate = {
      id: 'test-only',
      kind: 'colors',
      name: '',
      description: '',
      render: vi.fn(async () => bytes),
    };
    const jobs = [{ template, content }];
    const original = await PDFDocument.load(bytes);
    const preview = await PDFDocument.load(await renderCards(jobs), { updateMetadata: false });
    const verify = (document: PDFDocument) => {
      expect(document.getPageCount()).toBe(original.getPageCount());
      expect(document.getPage(0).getSize()).toEqual(original.getPage(0).getSize());
      expect(pageOperators(document, 0)).toBe(pageOperators(original, 0));
      for (const value of [
        document.getTitle(),
        document.getAuthor(),
        document.getSubject(),
        document.getKeywords(),
        document.getCreator(),
        document.getProducer(),
      ])
        expect(value ?? '').toBe('');
    };
    verify(preview);
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-export-'));
    try {
      const path = join(directory, 'test.pdf');
      await exportCards(jobs, path);
      verify(await PDFDocument.load(await readFile(path), { updateMetadata: false }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(template.render).toHaveBeenCalledTimes(2);
    expect(template.render).toHaveBeenCalledWith(
      expect.objectContaining({
        ...content,
        cardQr: false,
        profile: expect.any(Object),
        presentation: expect.any(Object),
      }),
    );
  });

  it('merges all renderers into a single PDF with unchanged page dimensions', async () => {
    const template: CardTemplate = {
      id: 'test-only',
      kind: 'colors',
      name: '',
      description: '',
      render: () => fixture(),
    };
    const output = await PDFDocument.load(
      await renderCards([
        { template, content },
        { template, content },
      ]),
    );
    expect(output.getPageCount()).toBe(2);
    for (const page of output.getPages())
      expect(page.getSize()).toEqual({ width: 100, height: 60 });
  });

  it('rejects empty jobs and wrong card types, and preserves multi-page collections', async () => {
    const template: CardTemplate = {
      id: 'test-only',
      kind: 'colors',
      name: '',
      description: '',
      render: () => fixture(2),
    };
    await expect(renderCards([])).rejects.toThrow('No approved');
    expect(
      (
        await PDFDocument.load(
          await renderCards([
            { template, content },
            { template, content },
          ]),
        )
      ).getPageCount(),
    ).toBe(4);
    await expect(
      renderCards([{ template: { ...template, kind: 'unicode' }, content }]),
    ).rejects.toThrow('does not support');
  });

  it('keeps date and label lists in entered order and validates the number of labels', async () => {
    const args = parseArguments([
      '--dates',
      '23-09-2026',
      '08-08-1988',
      '--events',
      'Project review',
      'Birthday',
    ]);
    expect(values(args, 'date')).toEqual(['23-09-2026', '08-08-1988']);
    expect(values(args, 'event')).toEqual(['Project review', 'Birthday']);
    const dates = values(args, 'date').map(parseDate);
    expect(await completeEventLabels(dates, values(args, 'event'))).toEqual([
      'Project review',
      'Birthday',
    ]);
    await expect(completeEventLabels(dates, ['A', 'B', 'C'])).rejects.toThrow('exactly one');
    await expect(completeEventLabels(dates, ['A', ' '])).rejects.toThrow('must not be empty');
  });
});
