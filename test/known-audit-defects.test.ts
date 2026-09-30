import { describe, expect, it } from 'vitest';
import { matchBitcoinEvidence } from '../src/bitcoin-evidence.js';
import { parseInput, representMnemonic, formatEncoded, type OutputFormat } from '../src/core.js';
import { serializeRecord } from '../src/record.js';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { readBoundedFile } from '../src/cli/bounded-read.js';
import { publishNewPrivateFile } from '../src/export/private-file.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const publicMnemonic = 'abandon '.repeat(11) + 'about';

describe('AUD-001 regression contracts', () => {
  it('AUD-001-SEC002: protects input through an alias of its parent directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-alias-'));
    try {
      const real = join(directory, 'real');
      await mkdir(real);
      await symlink(real, join(directory, 'alias'), 'junction');
      const source = join(real, 'input.txt');
      await writeFile(source, publicMnemonic);
      const result = await promisify(execFile)(process.execPath, [
        resolve('dist/mnemocode.js'),
        'encode',
        '--mode',
        'seedshift',
        '--mnemonic-file',
        source,
        '--dates',
        '23-09-2026',
        '--output',
        join(directory, 'alias', 'input.txt'),
      ]).then(
        () => 0,
        (error: { code: number }) => error.code,
      );
      expect(await readFile(source, 'utf8')).toBe(publicMnemonic);
      expect(result).not.toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('AUD-001-FUN001: accepts a valid uppercase BIP84 address', () => {
    expect(
      matchBitcoinEvidence(publicMnemonic, {
        kind: 'address',
        value: 'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU',
        profiles: ['native-segwit'],
        location: { network: 'mainnet', account: 0, branch: 0, index: 0 },
      }).matched,
    ).toBe(true);
  });

  it('AUD-001-API001: rejects an unknown input format at the JavaScript boundary', () => {
    expect(() =>
      parseInput(publicMnemonic, 'misspelled' as Exclude<OutputFormat, 'json'>),
    ).toThrow();
  });

  it('AUD-001-API001: rejects an unknown output format at the JavaScript boundary', () => {
    expect(() =>
      formatEncoded(representMnemonic(publicMnemonic), 'misspelled' as OutputFormat),
    ).toThrow();
  });

  it('AUD-001-API001: cannot serialize an unreadable record format', () => {
    expect(() =>
      serializeRecord('direct', 'misspelled' as Exclude<OutputFormat, 'json'>, publicMnemonic),
    ).toThrow();
  });
});

describe('AUD-004 regression contracts', () => {
  it('AUD-004-API001: rejects an unknown evidence kind instead of reporting a non-match', () => {
    expect(() =>
      matchBitcoinEvidence(publicMnemonic, {
        kind: 'address-typo',
        value: 'irrelevant',
        profiles: ['native-segwit'],
        location: { network: 'mainnet', account: 0, branch: 0, index: 0 },
      } as unknown as Parameters<typeof matchBitcoinEvidence>[1]),
    ).toThrow('Unsupported Bitcoin evidence kind.');
  });

  it('AUD-004-SEC001: bounds what is read, not what the file reports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-bounded-'));
    const limit = 16;
    try {
      const exact = join(directory, 'exact');
      await writeFile(exact, 'a'.repeat(limit));
      expect(readBoundedFile(exact, limit, 'too large').toString()).toBe('a'.repeat(limit));
      const over = join(directory, 'over');
      await writeFile(over, 'a'.repeat(limit + 1));
      expect(() => readBoundedFile(over, limit, 'too large')).toThrow('too large');
      if (process.platform !== 'win32') {
        // A named pipe reports size 0; the bound must still stop at the limit.
        const pipe = join(directory, 'pipe');
        await promisify(execFile)('mkfifo', [pipe]);
        const writer = writeFile(pipe, 'a'.repeat(limit * 4));
        expect(() => readBoundedFile(pipe, limit, 'too large')).toThrow('too large');
        await writer.catch(() => undefined);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('AUD-004-DOC001: publishes a new private file whole and never replaces an existing one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-publish-'));
    try {
      const target = join(directory, 'shares.txt');
      await publishNewPrivateFile(target, new TextEncoder().encode('complete\n'));
      expect(await readFile(target, 'utf8')).toBe('complete\n');
      if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600);
      await expect(
        publishNewPrivateFile(target, new TextEncoder().encode('other\n')),
      ).rejects.toThrow();
      expect(await readFile(target, 'utf8')).toBe('complete\n');
      // Nothing is left of the private staging folder.
      expect((await readdir(directory)).sort()).toEqual(['shares.txt']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
