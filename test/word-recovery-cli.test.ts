import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'dist', 'mnemocode.js');
const incomplete =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ?';

async function run(arguments_: readonly string[]) {
  return execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
}

describe('recover-word CLI', () => {
  it('prints every checksum-valid candidate with word and checksum metadata', async () => {
    const result = await run(['recover-word', '--mnemonic', incomplete]);
    const lines = result.stdout.trim().split('\n');

    expect(lines).toHaveLength(129);
    expect(lines[0]).toBe('candidate\tword\tword-index\tchecksum-bits\tmnemonic');
    expect(lines).toContain(
      '1\tabout\t4\t0011\tabandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    expect(result.stderr).toContain('Displayed every checksum-valid replacement');
  });

  it('marks evidence matches without removing non-matching candidates', async () => {
    const result = await run([
      'recover-word',
      '--mnemonic',
      incomplete,
      '--master-fingerprint',
      '73c5da0a',
    ]);
    const lines = result.stdout.trim().split('\n');

    expect(lines).toHaveLength(129);
    expect(lines[0]).toContain('\tevidence\t');
    expect(lines.some((line) => line.includes('\tmatched at m\t'))).toBe(true);
    expect(lines.some((line) => line.includes('\tnot matched\t'))).toBe(true);
  });

  it('rejects input without exactly one placeholder', async () => {
    await expect(
      run(['recover-word', '--mnemonic', incomplete.replace('?', 'about')]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('exactly one ? placeholder') });
  });
});
