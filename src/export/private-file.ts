import { chmod, link, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";
import { describeError, errorCode } from "../core/refusal.js";
import { ExportFileName } from "./file-name.js";
import {
  fillingFolder,
  makeTemporaryFolder,
  removeTemporaryFolder,
  sameFolder,
} from "./temporary-folders.js";

const ERRORS = new ErrorCatalog("export.private-file", {
  "new-folder-path-empty-one-refused": () => "A new folder needs a path; an empty one is refused.",
  "absent-path-refused": suppliedMessage,
});

/** Owner-only access to a file of a backup: read and write for its owner, nothing for others. */
const PRIVATE_FILE_MODE = 0o600;
/** Owner-only access to a folder of a backup's files. */
const PRIVATE_FOLDER_MODE = 0o700;

/** A child output path; refuses separators, traversal and Windows special name characters. */
export function privateChildPath(folder: string, name: string): string {
  return join(folder, ExportFileName.checked(name));
}

/**
 * Writes `bytes` as a new file at `path` that only its owner may read, where the file system keeps
 * Unix permissions (Linux and macOS; not Windows ACLs or FAT and exFAT media); fails with EEXIST
 * when something is there already, so that nothing is ever written over or through it.
 */
export async function writeNewPrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path, bytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
}

/**
 * Makes the new folder `path`, which only its owner may open where the file system keeps Unix
 * permissions (Linux and macOS; not Windows ACLs or FAT and exFAT media).
 */
export async function makePrivateFolder(path: string): Promise<void> {
  await mkdir(path, { mode: PRIVATE_FOLDER_MODE });
}

/**
 * The codes of this module's own errors: a file saved whose staging copy was left behind, and a
 * save that failed whose staging copy was left behind too.
 */
export type PrivateFileErrorCode = "left-staging-copy" | "failed-save-left-staging-copy";

/**
 * A file saved in full whose private staging folder could not be removed afterwards. It may
 * retain an extra copy after hard-link publication, or be empty after rename publication.
 * Not a failed save: the person is told that the file is saved and the folder needs cleanup
 * (AUD-014, adjudication "Cleanup can fail after file publication").
 */
export class LeftStagingCopyError extends Error {
  /** Stable code distinguishing completed publication with failed staging cleanup. */
  readonly code: PrivateFileErrorCode = "left-staging-copy";
  /** Destination reported as successfully published, rather than a failed-save path. */
  readonly saved: string;
  /** Retained private staging folder requiring cleanup; it may still contain an extra copy. */
  readonly staging: string;

  constructor(saved: string, staging: string, cause: unknown) {
    super(
      `Saved ${saved}, but its private staging folder ${staging}, which may still hold a copy of it, could not be removed: delete it.`,
      { cause },
    );
    this.name = "LeftStagingCopyError";
    this.saved = saved;
    this.staging = staging;
  }
}

/**
 * A save that failed, whose private staging folder could not be removed either: it may hold a
 * private copy. The failure of the save is its `cause`, which says why the save failed
 * (AUD-037-SEC007).
 */
export class FailedSaveLeftCopyError extends Error {
  /** Stable code distinguishing a failed save that also left its staging folder. */
  readonly code: PrivateFileErrorCode = "failed-save-left-staging-copy";
  /** The private staging folder left behind, which may hold a copy. */
  readonly staging: string;

  constructor(staging: string, cause: unknown) {
    super(
      `The save failed (${describeError(cause).replace(/\.$/u, "")}), and its private staging folder ${staging}, which may hold a copy, could not be removed: delete it.`,
      { cause },
    );
    this.name = "FailedSaveLeftCopyError";
    this.staging = staging;
  }
}

/**
 * Removes `staging` after a save failed with `failure`, and gives what the caller throws: the
 * failure, or, where the folder cannot be removed either, a FailedSaveLeftCopyError that keeps it.
 */
async function afterFailedSave(staging: string, failure: unknown): Promise<unknown> {
  try {
    await removeTemporaryFolder(staging);
    return failure;
  } catch {
    return new FailedSaveLeftCopyError(staging, failure);
  }
}

/**
 * Writes `bytes` to a new private file in a staging folder beside `destination`, on its file
 * system, so that a link to it or a rename of it is atomic, and hands it to `publish`; the staging
 * folder is removed afterwards, whatever happens. A removal that fails after the file was
 * published is a LeftStagingCopyError, not a failed save; one that fails after a failed save is a
 * FailedSaveLeftCopyError.
 */
async function withStagedFile(
  destination: string,
  bytes: Uint8Array,
  publish: (temporary: string) => Promise<void>,
): Promise<void> {
  const staging = await makeTemporaryFolder(join(dirname(destination), ".mnemocode-export-"));
  try {
    const temporary = join(staging, "document");
    await writeNewPrivateFile(temporary, bytes);
    await publish(temporary);
  } catch (error) {
    // A removal that fails is heard of beside the failure, as the folder may hold a copy.
    throw await afterFailedSave(staging, error);
  }
  try {
    await removeTemporaryFolder(staging);
  } catch (error) {
    throw new LeftStagingCopyError(destination, staging, error);
  }
}

/** Errors of file systems that cannot make hard links, such as FAT and exFAT. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

/**
 * Create a new export only after its complete contents have been written privately, and never
 * replace an existing file. The final name is made a hard link to the finished temporary file,
 * which fails if the name exists. On a file system without hard links, the name is first reserved
 * with an empty private file, which also fails if it exists, and the finished file then replaces
 * that reservation in one rename. If that rename fails, the reservation is removed again; only a
 * crash between the two steps can leave it, empty, never with part of the contents.
 */
export async function publishNewPrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  const destination = resolve(path);
  await withStagedFile(destination, bytes, async (temporary) => {
    try {
      await link(temporary, destination);
    } catch (error) {
      if (!NO_HARD_LINKS.has(errorCode(error) ?? "")) throw error;
      await writeNewPrivateFile(destination, new Uint8Array());
      try {
        await rename(temporary, destination);
      } catch (renameError) {
        // The reservation was created just above with 'wx', so it is this program's own empty file.
        await rm(destination, { force: true });
        throw renameError;
      }
    }
  });
}

/** What is at `path`: nothing, a folder, or something else; a link is not followed. */
export async function entryAt(path: string): Promise<"none" | "folder" | "other"> {
  try {
    return (await lstat(path)).isDirectory() ? "folder" : "other";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "none";
    throw error;
  }
}

/**
 * `path` resolved, when nothing is there yet, not even a link; otherwise refused with `taken`. Its
 * parent may be missing. A blank path, which would be the current folder, is refused. Every new
 * folder of an export is checked so, before the secrets are read and again when it is published.
 */
export async function absentPath(path: string, taken: string): Promise<string> {
  if (path.trim() === "") throw ERRORS.create("new-folder-path-empty-one-refused", []);
  const target = resolve(path);
  if ((await entryAt(target)) !== "none") throw ERRORS.create("absent-path-refused", [taken]);
  return target;
}

/**
 * Publishes a new private folder at `target`: `write` fills a staging folder beside it, made with
 * `prefix` on the same file system. mkdir reserves the final name without replacement after the
 * contents are complete. Its completed children move into that private reservation on every
 * platform, without replacing a destination directory. Publication of several children is not
 * atomic: a crash can leave an empty or partial folder. This guards concurrent creation, not
 * hostile interference by another process with the same account. On failure the staging folder
 * and the unchanged owned reservation are removed. Resolves with what `write` returns.
 */
export async function publishNewFolder<T>(
  target: string,
  prefix: string,
  taken: string,
  write: (staging: string) => Promise<T>,
): Promise<T> {
  await mkdir(dirname(target), { recursive: true });
  const staging = await makeTemporaryFolder(join(dirname(target), prefix));
  let reservation: Stats | undefined;
  // While the finished files are moved in, an exit at once removes the folder part filled.
  let filled: (() => void) | undefined;
  try {
    const result = await write(staging);
    // Everything is prepared privately before claiming the final name with mkdir.
    await chmod(staging, PRIVATE_FOLDER_MODE);
    try {
      await makePrivateFolder(target);
    } catch (error) {
      if (errorCode(error) === "EEXIST") throw ERRORS.create("absent-path-refused", [taken]);
      throw error;
    }
    reservation = await lstat(target);
    filled = fillingFolder(target, reservation);
    for (const name of await readdir(staging))
      await rename(privateChildPath(staging, name), privateChildPath(target, name));
    // Every file was moved: a staging folder that is not empty fails the export.
    await removeTemporaryFolder(staging, { empty: true });
    return result;
  } catch (error) {
    const thrown = await afterFailedSave(staging, error);
    if (reservation !== undefined) {
      // A reservation already gone leaves nothing to remove, and the failure stays the one thrown.
      const now = await lstat(target).catch((missing: unknown) => {
        if (errorCode(missing) === "ENOENT") return undefined;
        throw missing;
      });
      if (sameFolder(now, reservation)) await rm(target, { recursive: true, force: true });
    }
    throw thrown;
  } finally {
    filled?.();
  }
}

/**
 * A new folder of an export, claimed before anything is rendered and published afterwards under
 * the same name. A class, so that the folder that is checked first is the one published, both
 * refused with the same `taken` message.
 */
export class NewFolder {
  readonly #target: string;
  readonly #taken: string;

  private constructor(target: string, taken: string) {
    this.#target = target;
    this.#taken = taken;
  }

  /** Claims `directory`, refused with `taken` when something is there already (absentPath). */
  static async claim(directory: string, taken: string): Promise<NewFolder> {
    return new NewFolder(await absentPath(directory, taken), taken);
  }

  /**
   * Has `write` fill a private staging folder named from `prefix`, then publishes it under the
   * claimed name, refused when something took the name meanwhile (publishNewFolder).
   */
  publish<T>(prefix: string, write: (staging: string) => Promise<T>): Promise<T> {
    return publishNewFolder(this.#target, prefix, this.#taken, write);
  }
}
