// The temporary folders that hold private copies while an export is made: the staging folders
// beside an output (private-file.ts) and the raster folder of image export (image-export.ts). Each
// is removed by its owner when the export ends, whatever happens. A process that must end at once,
// such as one stopped by Ctrl+C while it works (private-screen.ts), removes those still there
// before it exits (removeLeftFolders) and can name any it could not remove.

import { lstatSync, rmSync, type Stats } from "node:fs";
import { mkdtemp, rm, rmdir } from "node:fs/promises";

/** The temporary folders made and not yet removed by their owners. */
const folders = new Set<string>();
/**
 * The output folders being filled from a staging folder (private-file.ts publishNewFolder), each
 * with the identity it was made with: one that an exit at once leaves part filled goes too, while
 * it is still the one made.
 */
const filling = new Map<string, Pick<Stats, "dev" | "ino">>();

/**
 * Makes a new temporary folder whose name starts with `prefix`, a path (mkdtemp); rejects with the
 * error of the file system. Its owner removes it, in a finally, with removeTemporaryFolder.
 */
export async function makeTemporaryFolder(prefix: string): Promise<string> {
  const folder = await mkdtemp(prefix);
  folders.add(folder);
  return folder;
}

/**
 * Removes the temporary `folder` with everything in it, or, where it must be `empty` by then,
 * only when it is; rejects with the error of the file system, and one that cannot be removed stays
 * known, for removeLeftFolders.
 */
export async function removeTemporaryFolder(
  folder: string,
  { empty = false }: { readonly empty?: boolean } = {},
): Promise<void> {
  await (empty ? rmdir(folder) : rm(folder, { recursive: true, force: true }));
  folders.delete(folder);
}

/**
 * Notes that the output folder `path`, made as `made`, is being filled; returns what ends the note
 * once it is filled or removed.
 */
export function fillingFolder(path: string, made: Pick<Stats, "dev" | "ino">): () => void {
  filling.set(path, { dev: made.dev, ino: made.ino });
  return () => {
    filling.delete(path);
  };
}

/**
 * Removes at once every temporary folder that its owner has not removed, and every output folder
 * still being filled, for a process about to end; returns those that could not be removed, which
 * may still hold a private copy.
 */
export function removeLeftFolders(): string[] {
  const left: string[] = [];
  const remove = (folder: string): void => {
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      left.push(folder);
    }
  };
  for (const folder of folders) remove(folder);
  for (const [folder, made] of filling) {
    const now = lstatSync(folder, { throwIfNoEntry: false });
    if (now?.dev === made.dev && now.ino === made.ino) remove(folder);
  }
  folders.clear();
  filling.clear();
  return left;
}
