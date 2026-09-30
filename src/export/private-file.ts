import { link, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Replace an export only after its complete contents have been written privately.
 * The temporary directory is on the destination filesystem so rename is atomic.
 * A new file replaces the destination itself, including an existing symlink;
 * this never writes through the symlink into some other file.
 */
export async function replacePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  const destination = resolve(path);
  const staging = await mkdtemp(join(dirname(destination), '.mnemocode-export-'));
  try {
    const temporary = join(staging, 'document');
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Errors of file systems that cannot make hard links, such as FAT and exFAT. */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

/**
 * Create a new export only after its complete contents have been written privately, and never
 * replace an existing file. The final name is made a hard link to the finished temporary file, which
 * fails if the name exists. On a file system without hard links, the name is first reserved with an
 * empty private file, which also fails if it exists, and the finished file then replaces that
 * reservation in one rename; an interruption can leave only the empty reservation, never part of
 * the contents.
 */
export async function publishNewPrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  const destination = resolve(path);
  const staging = await mkdtemp(join(dirname(destination), '.mnemocode-export-'));
  try {
    const temporary = join(staging, 'document');
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, destination);
    } catch (error) {
      if (!NO_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await writeFile(destination, new Uint8Array(), { flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
