import { resolveIdentityFor, sectorForTemplate } from './card-identities.js';
import { resolvePresentationFor } from './card-copy.js';
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
    'The card folder already exists. Choose a new --cards-dir path to avoid mixing collections.',
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
  const resolvedContent: CardContent = {
    ...content,
    presentation: resolvePresentationFor(content),
    profile: resolveIdentityFor(content, sectorForTemplate(template.id)),
    cardQr: content.cardQr === true,
  };
  const target = await requireNewCardDirectory(directory);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), '.card-collection-'));
  const perCard = template.referencesPerCard ?? 1;
  const count = Math.ceil(content.colors.length / perCard);
  let files = 0;
  try {
    for (let i = 0; i < count; i++) {
      const code = content.colors[i * perCard]!.replace(/^#/u, '').toUpperCase();
      if (!/^[0-9A-F]{6}$/u.test(code)) throw new Error('Invalid RGB reference.');
      const bytes = await template.renderIndividual(resolvedContent, i);
      files += await writeRenderedDocument(
        bytes,
        join(staging, `${String(i + 1).padStart(2, '0')}-${code}`),
        format,
      );
    }
    await requireNewCardDirectory(target);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return files;
}
