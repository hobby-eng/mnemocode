import { nodeCardRenderer } from "./platform-node.js";
import { publishNewPrivateFile } from "./private-file.js";
import { wipedAfterAsync } from "../core/bits.js";
import { renderCards, type CardJob } from "./render.js";

export { renderCards } from "./render.js";

/**
 * Renders `jobs` as one PDF and publishes it as a new private file at `path`, never over anything
 * that is there: a name that appears after the preflight chose it is refused with EEXIST, which a
 * save on the private screen offers to answer with another name (AUD-014-FUN003).
 */
export async function exportCards(jobs: readonly CardJob[], path: string): Promise<void> {
  // Render completely before opening the destination, including for preview --all. The cards show
  // the backup: their bytes are wiped once saved or refused.
  const bytes = await renderCards(nodeCardRenderer, jobs);
  await wipedAfterAsync(bytes, (document) => publishNewPrivateFile(path, document));
}
