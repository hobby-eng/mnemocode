import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replacePrivateFile } from '../src/export/private-file.js';

describe('Private export replacement', () => {
  it('replaces a destination symlink without modifying its target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-private-'));
    try {
      const target = join(directory, 'target');
      const destination = join(directory, 'export');
      await writeFile(target, 'Keep this content.');
      await symlink(target, destination);
      await replacePrivateFile(destination, Buffer.from('Public test output.'));
      expect(await readFile(target, 'utf8')).toBe('Keep this content.');
      expect(await readFile(destination, 'utf8')).toBe('Public test output.');
      if (process.platform !== 'win32') expect((await stat(destination)).mode & 0o777).toBe(0o600);
      expect((await readdir(directory)).sort()).toEqual(['export', 'target']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains an existing directory and removes staging files after a failed rename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-private-'));
    try {
      const destination = await mkdtemp(join(directory, 'keep-'));
      await writeFile(join(destination, 'marker'), 'Keep this content.');
      await expect(
        replacePrivateFile(destination, Buffer.from('Public test output.')),
      ).rejects.toThrow();
      expect(await readFile(join(destination, 'marker'), 'utf8')).toBe('Keep this content.');
      expect(await readdir(directory)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
