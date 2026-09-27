import { describe, expect, it } from 'vitest';
import { matchBitcoinEvidence } from '../src/bitcoin-evidence.js';
import { parseInput, representMnemonic, formatEncoded, type OutputFormat } from '../src/core.js';
import { serializeRecord } from '../src/record.js';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
