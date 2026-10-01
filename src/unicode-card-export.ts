import { parseInput, parseDate, formatDate, type DateShiftDate } from './core.js';
import { exportCards } from './export/pdf.js';
import { cardTemplates, selectTemplate } from './export/templates.js';

export type UnicodeCardTemplateId = string;
export const unicodeCardTemplates = cardTemplates.filter((item) => item.kind === 'unicode');
export interface UnicodeCardExportOptions {
  readonly unicodePayload: string;
  readonly dates: readonly DateShiftDate[];
  readonly eventLabels?: readonly string[];
  readonly pdfPath: string;
  readonly template?: UnicodeCardTemplateId;
  readonly title?: string;
}

export async function exportUnicodeCard(options: UnicodeCardExportOptions): Promise<void> {
  parseInput(options.unicodePayload, 'unicode');
  const labels = options.eventLabels;
  if (
    options.dates.length === 0 ||
    labels === undefined ||
    labels.length !== options.dates.length
  ) {
    throw new Error('Provide exactly one non-empty event label for every card date.');
  }
  const entries = options.dates
    .map((date, index) => {
      parseDate(formatDate(date));
      const label = labels[index]?.trim();
      if (!label) throw new Error('Card event labels must not be empty.');
      return { date, label };
    })
    .sort(
      (a, b) => a.date.year - b.date.year || a.date.month - b.date.month || a.date.day - b.date.day,
    );
  await exportCards(
    [
      {
        template: selectTemplate(options.template, 'unicode'),
        content: {
          kind: 'unicode',
          payload: options.unicodePayload,
          dates: entries.map((item) => item.date),
          eventLabels: entries.map((item) => item.label),
          title: options.title,
        },
      },
    ],
    options.pdfPath,
  );
}
