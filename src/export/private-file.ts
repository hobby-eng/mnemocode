import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";
import { errorCode } from "../core/refusal.js";
import { ExportFileName } from "./file-name.js";

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
 * Writes `bytes` as a new file at `path` that only its owner may read; fails with EEXIST when
 * something is there already, so that nothing is ever written over or through it.
 */
export async function writeNewPrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path, bytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
}

/** Makes the new folder `path`, which only its owner may open. */
export async function makePrivateFolder(path: string): Promise<void> {
  await mkdir(path, { mode: PRIVATE_FOLDER_MODE });
}

/** The code of a file saved whose staging copy was left behind, this module's own error. */
export type PrivateFileErrorCode = "left-staging-copy";

/**
 * A file saved in full whose private staging folder, which holds a copy of it, could not be
 * removed afterwards. Not a failed save: the file is complete, and the person is told that it is
 * saved and that the folder is to be deleted, never left unaware of the copy (AUD-014,
 * adjudication "Cleanup can fail after file publication").
 */
export class LeftStagingCopyError extends Error {
  readonly code: PrivateFileErrorCode = "left-staging-copy";
  readonly saved: string;
  readonly staging: string;

  constructor(saved: string, staging: string, cause: unknown) {
    super(
      `Saved ${saved}, but its private staging folder ${staging}, which holds a copy of it, could not be removed: delete it.`,
      { cause },
    );
    this.name = "LeftStagingCopyError";
    this.saved = saved;
    this.staging = staging;
  }
}

/**
 * Writes `bytes` to a new private file in a staging folder beside `destination`, on its file
 * system, so that a link to it or a rename of it is atomic, and hands it to `publish`; the staging
 * folder is removed afterwards, whatever happens. A removal that fails after the file was
 * published is a LeftStagingCopyError, not a failed save.
 */
async function withStagedFile(
  destination: string,
  bytes: Uint8Array,
  publish: (temporary: string) => Promise<void>,
): Promise<void> {
  const staging = await mkdtemp(join(dirname(destination), ".mnemocode-export-"));
  try {
    const temporary = join(staging, "document");
    await writeNewPrivateFile(temporary, bytes);
    await publish(temporary);
  } catch (error) {
    // A removal that fails is what the caller hears of, as the folder may hold a copy.
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  try {
    await rm(staging, { recursive: true, force: true });
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
      if (!NO_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "none";
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
  const staging = await mkdtemp(join(dirname(target), prefix));
  let reservation: Awaited<ReturnType<typeof lstat>> | undefined;
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
    for (const name of await readdir(staging))
      await rename(privateChildPath(staging, name), privateChildPath(target, name));
    await rmdir(staging);
    return result;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (reservation !== undefined) {
      const current = await lstat(target);
      if (current.dev === reservation.dev && current.ino === reservation.ino)
        await rm(target, { recursive: true, force: true });
    }
    throw error;
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
