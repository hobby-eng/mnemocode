import './platform-node.js';
import { replacePrivateFile } from './private-file.js';
import { renderCards, type CardJob } from './render.js';

export { renderCards, type CardJob } from './render.js';

export async function exportCards(jobs: readonly CardJob[], path: string): Promise<void> {
  // Render completely before opening the destination, including for preview --all.
  const bytes = await renderCards(jobs);
  await replacePrivateFile(path, bytes);
}
