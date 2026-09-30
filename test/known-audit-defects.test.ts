import { describe, expect, it } from 'vitest';
import { matchBitcoinEvidence } from '../src/bitcoin-evidence.js';
import { parseInput, representMnemonic, formatEncoded, type OutputFormat } from '../src/core.js';
import { serializeRecord } from '../src/record.js';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { readBoundedFile } from '../src/cli/bounded-read.js';
import { decodeQrPngFile } from '../src/cli/qr-input.js';
import { publishNewPrivateFile } from '../src/export/private-file.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
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

  it('AUD-004-SEC001: stops endless and growing input at the limit', async () => {
    const limit = 16;
    if (process.platform !== 'win32') {
      // /dev/zero reports size 0 and never ends: the strongest form of a file that keeps growing.
      expect(() => readBoundedFile('/dev/zero', limit, 'too large')).toThrow('too large');
    }
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-growing-'));
    const growing = join(directory, 'growing');
    await writeFile(growing, '');
    // Another process appends to the file while it is read. Whether the read meets the end of the
    // file first or passes the limit depends on timing; either way it never returns more than the
    // limit.
    const writer = spawn(process.execPath, [
      '-e',
      `const fs = require('node:fs'); const end = Date.now() + 1500;
       while (Date.now() < end) fs.appendFileSync(${JSON.stringify(growing)}, 'a'.repeat(4096));`,
    ]);
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          expect(readBoundedFile(growing, 64 * 1024, 'too large').length).toBeLessThanOrEqual(
            64 * 1024,
          );
        } catch (error) {
          expect(String(error)).toContain('too large');
        }
      }
    } finally {
      writer.kill();
      await new Promise((done) => writer.once('close', done));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('AUD-004-SEC001: refuses a QR PNG one byte over 16 MiB before decoding it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-png-limit-'));
    try {
      const large = join(directory, 'large.png');
      await writeFile(large, new Uint8Array(16 * 1024 * 1024 + 1));
      await expect(decodeQrPngFile(large)).rejects.toThrow('exceeds the 16 MiB safety limit');
      if (process.platform !== 'win32') {
        await expect(decodeQrPngFile('/dev/zero')).rejects.toThrow(
          'exceeds the 16 MiB safety limit',
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('AUD-004-DOC001: a publication killed at any moment leaves no partial file under the final name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-killed-'));
    // Thirty-two publications of 1 MiB last long enough for every kill to land inside one, and each
    // round deletes its files, so the disk use stays small.
    const size = 1024 * 1024;
    const publications = 32;
    const publisher = `
      import { publishNewPrivateFile } from ${JSON.stringify(resolve('src/export/private-file.ts'))};
      const bytes = new Uint8Array(${size}).fill(97);
      for (let index = 0; index < ${publications}; index += 1) {
        await publishNewPrivateFile(${JSON.stringify(directory)} + '/shares-' + index + '.txt', bytes);
      }`;
    let interrupted = 0;
    try {
      for (let round = 0; round < 8; round += 1) {
        const child = spawn(process.execPath, [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          publisher,
        ]);
        let errors = '';
        child.stderr.on('data', (chunk) => (errors += String(chunk)));
        let running = true;
        const ended = new Promise<number | null>((done) =>
          child.once('close', (code) => {
            running = false;
            done(code);
          }),
        );
        // Wait until the first file is published, so that the child is past its start-up, then
        // kill it a different number of milliseconds later in each round.
        while (running && !(await readdir(directory)).some((name) => name.startsWith('shares-'))) {
          await new Promise((done) => setTimeout(done, 1));
        }
        await new Promise((done) => setTimeout(done, round * 2));
        const killedWhileRunning = running;
        child.kill('SIGKILL');
        const code = await ended;
        expect(code === 0 || code === null, errors).toBe(true);
        const finals = (await readdir(directory)).filter((name) => name.startsWith('shares-'));
        if (killedWhileRunning && finals.length < publications) interrupted += 1;
        for (const name of finals) {
          const bytes = await readFile(join(directory, name));
          expect(bytes.length, name).toBe(size);
          expect(
            bytes.every((byte) => byte === 97),
            name,
          ).toBe(true);
        }
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory);
      }
      // Most kills must land while files are still being published, or the test proves nothing.
      expect(interrupted).toBeGreaterThanOrEqual(6);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

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
