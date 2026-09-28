import './platform-node.js';
import { renderIndividualCards } from './render.js';
import { writeRenderedDocument, type DocumentFormat } from './image-export.js';
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CardContent, CardTemplate } from './templates.js';

export async function requireNewCardDirectory(path: string): Promise<string> {
  const target = resolve(path);
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
    throw error;
  }
  throw new Error(
    'The card folder already exists. Choose a new folder to avoid mixing separate card collections.',
  );
}

/** Stages every file before publishing the folder. No manifest contains the full payload. */
export async function exportIndividualCards(
  template: CardTemplate,
  content: CardContent,
  directory: string,
  format: DocumentFormat = 'pdf',
): Promise<number> {
  if (content.kind !== 'colors' || !template.renderIndividual)
    throw new Error('This template does not support individual business cards.');
  if (!content.colors.length) throw new Error('The card collection is empty.');
  const target = await requireNewCardDirectory(directory);
  // Every card is rendered before anything is written.
  const cards = await renderIndividualCards(template, content);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), '.card-collection-'));
  let files = 0;
  try {
    for (const card of cards)
      files += await writeRenderedDocument(card.bytes, join(staging, card.name), format);
    await requireNewCardDirectory(target);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return files;
}
