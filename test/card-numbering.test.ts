import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderIndividualCards, selectTemplate, type CardContent } from '../src/cards.js';
import { indexesToColors } from '../src/core.js';

// Reading the printed text needs Poppler; without it the check is skipped, not faked.
const hasPoppler = spawnSync('pdftotext', ['-v']).error === undefined;

const colors = indexesToColors(Array.from({ length: 12 }, (_, index) => index * 7));
const content: CardContent = { kind: 'colors', colors, payload: colors.join(' ') };

function printedText(bytes: Uint8Array): string {
  const directory = mkdtempSync(join(tmpdir(), 'mnemocode-numbering-'));
  try {
    const file = join(directory, 'card.pdf');
    writeFileSync(file, bytes);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!hasPoppler)('numbers on separate cards', () => {
  for (const template of ['business-it', 'material-tile', 'business-glass-4in1'])
    it(`prints the position of every reference on ${template} cards`, async () => {
      const cards = await renderIndividualCards(selectTemplate(template, 'colors'), { ...content });
      const perCard = selectTemplate(template, 'colors').referencesPerCard ?? 1;
      expect(cards).toHaveLength(Math.ceil(colors.length / perCard));
      for (const [cardIndex, card] of cards.entries()) {
        const text = printedText(card.bytes).replace(/\s+/gu, ' ');
        for (let offset = 0; offset < perCard; offset += 1) {
          const index = cardIndex * perCard + offset;
          const color = colors[index];
          if (color === undefined) continue;
          const number = String(index + 1).padStart(2, '0');
          // The number stands directly before its code, possibly with the size of the set between them.
          expect(text).toMatch(
            new RegExp(`${number}(?: / \\d{2})? ${color.slice(1).toUpperCase()}`, 'u'),
          );
        }
      }
    });
});
