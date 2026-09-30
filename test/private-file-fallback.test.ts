import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A file system without hard links whose final rename fails: nothing may be left under the name.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const noHardLinks = Object.assign(new Error('hard links are not supported'), { code: 'EPERM' });
  const renameFails = Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
  return {
    ...original,
    link: vi.fn(() => Promise.reject(noHardLinks)),
    rename: vi.fn(() => Promise.reject(renameFails)),
  };
});

const { publishNewPrivateFile } = await import('../src/export/private-file.js');

describe('publishNewPrivateFile without hard links', () => {
  it('removes its empty name reservation when the final rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-fallback-'));
    try {
      await expect(
        publishNewPrivateFile(
          join(directory, 'shares.txt'),
          new TextEncoder().encode('complete\n'),
        ),
      ).rejects.toThrow('synthetic rename failure');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
