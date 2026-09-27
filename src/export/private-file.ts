import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
