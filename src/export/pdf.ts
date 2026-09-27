import { resolveIdentityFor, sectorForTemplate } from './card-identities.js';
import { resolvePresentationFor } from './card-copy.js';
import { clearDocumentMetadata } from './document-metadata.js';
import { replacePrivateFile } from './private-file.js';
import { PDFDocument } from 'pdf-lib';
import type { CardContent, CardTemplate } from './templates.js';

export interface CardJob {
  readonly template: CardTemplate;
  readonly content: CardContent;
}

/** Preview and encode share this path; no simplified preview renderer exists. */
export async function renderCards(jobs: readonly CardJob[]): Promise<Uint8Array> {
  if (jobs.length === 0) throw new Error('No approved card templates are installed yet.');
  const presentation = resolvePresentationFor(jobs[0]!.content);
  const profile = resolveIdentityFor(jobs[0]!.content, sectorForTemplate(jobs[0]!.template.id));
  const pages: Uint8Array[] = [];
  for (const { template, content } of jobs) {
    if (template.kind !== content.kind)
      throw new Error(`Template ${template.id} does not support ${content.kind}.`);
    const bytes = await template.render({
      ...content,
      presentation: content.presentation ?? presentation,
      profile: { ...profile, ...content.profile },
      cardQr: content.cardQr === true,
    });
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() === 0)
      throw new Error(`Template ${template.id} rendered an empty document.`);
    pages.push(bytes);
  }
  if (pages.length === 1) {
    const document = await PDFDocument.load(pages[0]!);
    clearDocumentMetadata(document);
    return document.save();
  }
  const merged = await PDFDocument.create();
  for (const bytes of pages) {
    const source = await PDFDocument.load(bytes);
    for (const page of await merged.copyPages(source, source.getPageIndices()))
      merged.addPage(page);
  }
  clearDocumentMetadata(merged);
  return merged.save();
}

export async function exportCards(jobs: readonly CardJob[], path: string): Promise<void> {
  // Render completely before opening the destination, including for preview --all.
  const bytes = await renderCards(jobs);
  await replacePrivateFile(path, bytes);
}
