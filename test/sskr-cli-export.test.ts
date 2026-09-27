import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mnemonic = `${'abandon '.repeat(11)}about`;
function cli(args: string[]) {
  const result = spawnSync(process.execPath, ['dist/mnemocode.js', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  return result;
}
describe('integrated SSKR CLI', () => {
  it('shares transformed entropy once and reverses the dates with a quorum', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnc-cli-'));
    try {
      const path = join(dir, 'shares.txt');
      const split = cli([
        'encode',
        '--sskr',
        '--mnemonic',
        mnemonic,
        '--dates',
        '23-09-2026',
        '--format',
        '3',
        '--share-format',
        'colors',
        '--threshold',
        '2',
        '--shares',
        '3',
        '--output',
        path,
      ]);
      expect(split.status, split.stderr).toBe(0);
      expect(split.stdout).toContain('Unicode code points:');
      expect(split.stdout).toContain('#');
      expect(split.stdout + split.stderr).not.toContain('\x1b');
      const records = readFileSync(path, 'utf8').trim().split('\n');
      expect(records).toHaveLength(3);
      const restored = cli([
        'sskr-combine',
        '--share',
        records[0]!,
        '--share',
        records[2]!,
        '--dates',
        '23-09-2026',
      ]);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toContain(mnemonic);
      const refused = cli([
        'encode',
        '--sskr',
        '--mnemonic',
        mnemonic,
        '--threshold',
        '2',
        '--shares',
        '3',
        '--output',
        path,
      ]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('already exists');
      expect(readFileSync(path, 'utf8').trim().split('\n')).toEqual(records);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects unsupported and orphan options before secret input', () => {
    for (const extras of [
      ['--threshold', '2'],
      ['--share-format', 'colors'],
      ['--card-layout', 'qr'],
    ]) {
      const result = cli(['encode', '--ask-secrets', ...extras]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('requires --sskr');
    }
    const result = cli([
      'encode',
      '--sskr',
      '--ask-secrets',
      '--threshold',
      '2',
      '--shares',
      '3',
      '--qr',
      'x.png',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not supported with --sskr');
  });
  it('keeps terminal color swatches plain when redirected', () => {
    const result = cli(['encode', '--mnemonic', mnemonic, '--format', '5', '--cards']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('\x1b');
  });
});
