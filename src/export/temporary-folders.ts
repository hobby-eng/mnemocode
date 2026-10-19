// The temporary folders that hold private copies while an export is made: the staging folders
// beside an output (private-file.ts) and the raster folder of image export (image-export.ts). Each
// is removed by its owner when the export ends, whatever happens. A process that must end at once,
// such as one stopped by Ctrl+C while it works (private-screen.ts), removes those still there
// before it exits (removeLeftFolders) and can name any it could not remove.

import { rmSync } from "node:fs";
import { mkdtemp, rm, rmdir } from "node:fs/promises";

/** The temporary folders made and not yet removed by their owners. */
const folders = new Set<string>();

/** Makes a new temporary folder whose name starts with `prefix`, a path (mkdtemp). */
export async function makeTemporaryFolder(prefix: string): Promise<string> {
  const folder = await mkdtemp(prefix);
  folders.add(folder);
  return folder;
}

/**
 * Removes the temporary `folder` with everything in it, or, where it must be `empty` by then,
 * only when it is; one that cannot be removed stays known, for removeLeftFolders.
 */
export async function removeTemporaryFolder(
  folder: string,
  { empty = false }: { readonly empty?: boolean } = {},
): Promise<void> {
  await (empty ? rmdir(folder) : rm(folder, { recursive: true, force: true }));
  folders.delete(folder);
}

/**
 * Removes at once every temporary folder that its owner has not removed, for a process about to
 * end; returns those that could not be removed, which may still hold a private copy.
 */
export function removeLeftFolders(): string[] {
  const left: string[] = [];
  for (const folder of folders)
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      left.push(folder);
    }
  folders.clear();
  return left;
}
