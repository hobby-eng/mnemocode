// The temporary folders that hold private copies while an export is made: the staging folders
// beside an output (private-file.ts), which image export writes its pages into too, as it never
// keeps a page in a folder of its own (image-export.ts). Each is removed by its owner when the
// export ends, whatever happens. A process that must end at once, such as any command stopped by
// Ctrl+C while it works (interruption.ts), removes those still there before it exits
// (TemporaryFolders.removeLeft) and can name any it could not remove.

import { lstatSync, rmSync, type Stats } from "node:fs";
import { mkdtemp, rm, rmdir } from "node:fs/promises";

/**
 * What tells a folder from another: its device and inode. No time goes with them: a birth time is
 * the change time on some systems, which filling the folder changes. A folder removed and made
 * again at its path may get the same inode, as on ext4, but that takes another process removing a
 * private folder while it is filled, which these folders do not guard against.
 */
type Identity = Pick<Stats, "dev" | "ino">;

/** Whether the folder `now` is the one `made`, by their identities; no folder is none. */
export function sameFolder(now: Identity | undefined, made: Identity): boolean {
  return now?.dev === made.dev && now.ino === made.ino;
}

/**
 * The record of the process's temporary folders and of the output folders being filled, which
 * removeLeft removes at an exit at once. One record for the process: the exports that note their
 * folders and the handler of Ctrl+C that removes them share it. A class, so that a folder stays
 * known from the moment it is made until its owner has removed it.
 */
export class TemporaryFolders {
  /** The temporary folders made and not yet removed by their owners. */
  static readonly #folders = new Set<string>();
  /**
   * The output folders being filled from a staging folder (private-file.ts publishNewFolder), each
   * with the identity it was made with: one that an exit at once leaves part filled goes too, while
   * it is still the one made.
   */
  static readonly #filling = new Map<string, Identity>();

  /**
   * Makes a new temporary folder whose name starts with `prefix`, a path (mkdtemp); rejects with
   * the error of the file system. Its owner removes it, in a finally, with remove.
   */
  static async make(prefix: string): Promise<string> {
    const folder = await mkdtemp(prefix);
    TemporaryFolders.#folders.add(folder);
    return folder;
  }

  /**
   * Removes the temporary `folder` with everything in it, or, where it must be `empty` by then,
   * only when it is; rejects with the error of the file system, and one that cannot be removed
   * stays known, for removeLeft.
   */
  static async remove(
    folder: string,
    { empty = false }: { readonly empty?: boolean } = {},
  ): Promise<void> {
    await (empty ? rmdir(folder) : rm(folder, { recursive: true, force: true }));
    TemporaryFolders.#folders.delete(folder);
  }

  /**
   * Notes that the output folder `path`, made as `made`, is being filled; returns what ends the
   * note once it is filled or removed.
   */
  static filling(path: string, made: Identity): () => void {
    TemporaryFolders.#filling.set(path, { dev: made.dev, ino: made.ino });
    return () => {
      TemporaryFolders.#filling.delete(path);
    };
  }

  /**
   * Removes at once every temporary folder that its owner has not removed, and every output folder
   * still being filled, for a process about to end; returns those that could not be removed, which
   * may still hold a private copy.
   */
  static removeLeft(): string[] {
    const left: string[] = [];
    const remove = (folder: string): void => {
      try {
        rmSync(folder, { recursive: true, force: true });
      } catch {
        left.push(folder);
      }
    };
    for (const folder of TemporaryFolders.#folders) remove(folder);
    for (const [folder, made] of TemporaryFolders.#filling) {
      try {
        if (sameFolder(lstatSync(folder, { throwIfNoEntry: false }), made)) remove(folder);
      } catch {
        left.push(folder);
      }
    }
    TemporaryFolders.#folders.clear();
    TemporaryFolders.#filling.clear();
    return left;
  }
}
