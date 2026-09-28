import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchBitcoinEvidence } from '../src/bitcoin-evidence.js';
import { integerOption } from '../src/cli/arguments.js';
import { bip39Passphrase, bitcoinEvidence } from '../src/cli/bitcoin-options.js';
import { readBoundedTextFile } from '../src/cli/input.js';
import { validateOutputPaths } from '../src/cli/output-paths.js';
import { decodeQrPngFile } from '../src/cli/qr-input.js';
import { runRecoverDate } from '../src/cli/recover-date-command.js';
import { readShares, runSskrSplit } from '../src/cli/sskr-command.js';
import { runTable } from '../src/cli/table-command.js';

const publicMnemonic = 'abandon '.repeat(11) + 'about';
const location = { network: 'mainnet' as const, account: 0, branch: 0, index: 0 };

async function runWithStdin(arguments_: readonly string[], input: Uint8Array) {
  return new Promise<{ code: number | null; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('dist/mnemocode.js'), ...arguments_], {
      cwd: process.cwd(),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

function pngHeader(
  signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
  chunk = 'IHDR',
  width = 1,
  height = 1,
): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set(signature);
  bytes.writeUInt32BE(13, 8);
  bytes.write(chunk, 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('AUD-002-API001 canonical integer options', () => {
  it.each(['0x10', '1e3', '+1', '01', '1.0', ' 1', '1 '])(
    'rejects non-canonical integer syntax %j',
    (raw) => {
      expect(() => integerOption({ count: raw }, 'count', { min: 0, max: 2047 })).toThrow(
        'base-10 integer',
      );
    },
  );

  it('accepts canonical bounds and supplies an explicit default', () => {
    expect(integerOption({ count: '0' }, 'count', { min: 0, max: 2047 })).toBe(0);
    expect(integerOption({ count: '2047' }, 'count', { min: 0, max: 2047 })).toBe(2047);
    expect(integerOption({}, 'count', { defaultValue: 7, min: 0, max: 2047 })).toBe(7);
    expect(() => integerOption({ count: '2048' }, 'count', { min: 0, max: 2047 })).toThrow(
      'base-10 integer',
    );
  });

  it('applies the shared parser to every affected command family', async () => {
    expect(() => runTable({ index: '0x10' })).toThrow('base-10 integer');
    expect(() =>
      bitcoinEvidence({
        'bitcoin-address': 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        account: '1e3',
      }),
    ).toThrow('base-10 integer');
    await expect(runRecoverDate({ 'max-results': '+1' })).rejects.toThrow('base-10 integer');
    await expect(runSskrSplit({ threshold: '01', shares: '3' })).rejects.toThrow('base-10 integer');
  });
});

describe('AUD-002-SEC001 bounded secret-bearing files', () => {
  it('enforces the 1 MiB limit for WIF, passphrase, and SSKR share files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-bounds-'));
    const path = join(directory, 'oversized.txt');
    try {
      await writeFile(path, Buffer.alloc(1024 * 1024 + 1, 0x61));
      expect(() => bitcoinEvidence({ 'wif-file': path })).toThrow('1 MiB safety limit');
      expect(() => bip39Passphrase({ 'bip39-passphrase-file': path })).toThrow(
        '1 MiB safety limit',
      );
      await expect(readShares({ 'share-file': path })).rejects.toThrow('1 MiB safety limit');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts exactly 1 MiB and rejects oversized standard input before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-exact-bound-'));
    const path = join(directory, 'exact.txt');
    try {
      await writeFile(path, Buffer.alloc(1024 * 1024, 0x61));
      expect(readBoundedTextFile(path)).toHaveLength(1024 * 1024);
      const result = await runWithStdin(
        ['decode', '--input-file', '-', '--mode', 'direct', '--format', 'english'],
        Buffer.alloc(1024 * 1024 + 1, 0x61),
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('Text input exceeds the 1 MiB safety limit.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns a stable option-specific error for an unreadable text file', () => {
    const missing = join(tmpdir(), 'mnemocode-file-that-does-not-exist');
    expect(() => readBoundedTextFile(missing, 'The WIF file')).toThrow(
      'The WIF file could not be read. Check that the file exists and is readable.',
    );
  });
});

describe('AUD-002-API002 stable validation errors and paths', () => {
  it('does not echo malformed address, WIF, or extended-key evidence', () => {
    const cases = [
      {
        evidence: {
          kind: 'address' as const,
          value: 'bc1q-private-invalid-value',
          profiles: ['native-segwit' as const],
          location,
        },
        message: 'The address is not valid for Bitcoin mainnet.',
      },
      {
        evidence: {
          kind: 'wif' as const,
          value: 'L1-private-invalid-value',
          profiles: ['legacy' as const],
          location,
        },
        message: 'The WIF is not valid for Bitcoin mainnet.',
      },
      {
        evidence: {
          kind: 'master-xpub' as const,
          value: 'xpub-private-invalid-value',
          network: 'mainnet' as const,
        },
        message: 'The extended public key is not valid.',
      },
    ];
    for (const testCase of cases) {
      let message = '';
      try {
        matchBitcoinEvidence(publicMnemonic, testCase.evidence);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(testCase.message);
      expect(message).not.toContain(testCase.evidence.value);
    }
  });

  it('resolves nested output paths even when their parent chain does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-outputs-'));
    try {
      await expect(
        validateOutputPaths({ pdf: join(directory, 'new', 'nested', 'result.pdf') }),
      ).resolves.toBeUndefined();
      await expect(
        validateOutputPaths({
          'cards-dir': join(directory, 'new-cards'),
          pdf: join(directory, 'new-cards', 'all.pdf'),
        }),
      ).rejects.toThrow('must use separate, non-overlapping paths');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports missing source paths with an option-specific error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-sources-'));
    try {
      await expect(
        validateOutputPaths({
          output: join(directory, 'result.txt'),
          'mnemonic-file': join(directory, 'missing.txt'),
        }),
      ).rejects.toThrow(
        'The mnemonic file could not be read. Check that the file exists and is readable.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('AUD-002-API003 PNG structure validation', () => {
  async function rejected(bytes: Uint8Array, expected: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-png-'));
    const path = join(directory, 'input.png');
    try {
      await writeFile(path, bytes);
      await expect(decodeQrPngFile(path)).rejects.toThrow(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('distinguishes truncated, non-PNG, missing-IHDR, zero, excessive, and corrupt inputs', async () => {
    await rejected(Uint8Array.of(137, 80, 78), 'not a complete PNG');
    await rejected(pngHeader(new Uint8Array(8)), 'not a PNG file');
    const wrongLength = pngHeader();
    wrongLength.writeUInt32BE(12, 8);
    await rejected(wrongLength, 'invalid IHDR chunk length');
    await rejected(pngHeader(undefined, 'IDAT'), 'does not begin with an IHDR');
    await rejected(pngHeader(undefined, undefined, 0, 1), 'dimensions must be non-zero');
    await rejected(pngHeader(undefined, undefined, 4097, 1), 'dimensions exceed');
    await rejected(pngHeader(), 'not a valid PNG file');
  });

  it('rejects a PNG above the 16 MiB byte budget before decoding', async () => {
    await rejected(Buffer.alloc(16 * 1024 * 1024 + 1), '16 MiB safety limit');
  });

  it('returns a stable error for a missing PNG path', async () => {
    await expect(
      decodeQrPngFile(join(tmpdir(), 'mnemocode-qr-that-does-not-exist.png')),
    ).rejects.toThrow('The QR PNG input could not be read.');
  });
});
