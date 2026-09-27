import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { indexesToColors } from '../src/core.js';
import { materialArtwork, chooseMaterialFinish } from '../src/export/material-artwork.js';
import { renderMaterialCard, type MaterialPageSize } from '../src/export/material-cards.js';
import { resolveCardPresentation } from '../src/export/card-copy.js';

const colors = indexesToColors(Array.from({ length: 24 }, (_, i) => i * 73 + 1));
const presentation = resolveCardPresentation(
  {},
  { studioName: 'NORTHLINE STUDIO' },
  () => 0,
).presentation;
const content = { kind: 'colors' as const, colors, payload: colors.join(' '), presentation };
afterEach(() => vi.restoreAllMocks());
function textSpy() {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  return () => spy.mock.calls.map((call) => call[0]);
}
function operators(pdf: PDFDocument) {
  return pdf.getPages().map((page) => {
    const refs = page.node.Contents();
    const streams = refs && 'asArray' in refs ? refs.asArray() : [refs];
    return streams
      .map((ref) => {
        const stream = pdf.context.lookup(ref);
        return stream instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
          : '';
      })
      .join('\n');
  });
}

describe('material selection cards', () => {
  it('selects approved real finishes deterministically, with names tied to their photographs', () => {
    for (const style of ['vehicle', 'enclosure', 'tile', 'switch'] as const) {
      for (const finish of materialArtwork[style].finishes)
        expect(chooseMaterialFinish(style, finish.color)).toBe(finish);
      for (const code of colors) {
        expect(materialArtwork[style].finishes).toContain(chooseMaterialFinish(style, code));
        expect(chooseMaterialFinish(style, code.toLowerCase())).toBe(
          chooseMaterialFinish(style, code),
        );
      }
    }
    for (const invalid of ['123', '#1234567', 'oops!!'])
      expect(() => chooseMaterialFinish('vehicle', invalid)).toThrow();
  });

  it.each(['wallet', 'business', 'a6', 'a4'] as const)(
    'honors both orientations for %s',
    async (size) => {
      const expected: Record<MaterialPageSize, [number, number]> = {
        wallet: [85.6, 54],
        business: [90, 50],
        a6: [148, 105],
        a4: [297, 210],
      };
      for (const orientation of ['landscape', 'portrait'] as const) {
        const pdf = await PDFDocument.load(
          await renderMaterialCard('vehicle', { ...content, orientation }, { pageSize: size }),
        );
        const dimensions =
          orientation === 'portrait' ? [...expected[size]].reverse() : expected[size];
        expect(pdf.getPageCount()).toBe(1);
        for (const page of pdf.getPages()) {
          expect((page.getWidth() * 25.4) / 72).toBeCloseTo(dimensions[0], 3);
          expect((page.getHeight() * 25.4) / 72).toBeCloseTo(dimensions[1], 3);
        }
      }
    },
  );

  it('prints all exact ordered references and real finish names, replaces the studio, and confines QR to the back', async () => {
    const texts = textSpy();
    const pdf = await PDFDocument.load(
      await renderMaterialCard('vehicle', {
        ...content,
        cardQr: true,
        presentation: resolveCardPresentation({}, { studioName: 'AURORA STUDIO' }, () => 0)
          .presentation,
        profile: { name: 'John Smith' },
      }),
    );
    expect(texts()).toContain('AURORA STUDIO');
    expect(texts()).toContain('Prepared for John Smith');
    expect(texts()).not.toContain('NORTHLINE STUDIO');
    for (const [i, code] of colors.entries()) {
      expect(texts()).toContain(`${String(i + 1).padStart(2, '0')}  ${code.slice(1)}`);
      expect(texts()).toContain(chooseMaterialFinish('vehicle', code).name);
    }
    const streams = operators(pdf);
    expect((streams[0].match(/\nf\n/gu) ?? []).length).toBeLessThan(10);
    expect((streams[1].match(/\nf\n/gu) ?? []).length).toBeGreaterThan(100);
  });

  it('uses the resolved studio and exposes only one reference in an individual fragment, without QR', async () => {
    const texts = textSpy();
    const pdf = await PDFDocument.load(
      await renderMaterialCard('switch', content, { individualIndex: 2, pageSize: 'business' }),
    );
    expect(pdf.getPageCount()).toBe(1);
    expect(texts()).toContain('NORTHLINE STUDIO');
    expect(texts().filter((t) => /^\d{2}  [0-9A-F]{6}$/u.test(t))).toEqual([
      `03  ${colors[2].slice(1)}`,
    ]);
    expect(texts()).not.toContain(content.payload);
    expect((operators(pdf)[0].match(/\nf\n/gu) ?? []).length).toBeLessThan(10);
  });

  it('rejects mismatched QR data and invalid fragment indices', async () => {
    await expect(
      renderMaterialCard('tile', { ...content, payload: 'MNC1:unrelated' }),
    ).rejects.toThrow();
    await expect(
      renderMaterialCard('enclosure', content, { individualIndex: colors.length }),
    ).rejects.toThrow('index');
  });
});
