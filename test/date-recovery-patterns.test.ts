import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  datePatternCandidateCount,
  datePatternCombinationCount,
  datePatternCombinations,
  expandDatePattern,
  parseDatePattern,
} from '../src/core.js';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'dist', 'mnemocode.js');
const publicMnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function run(arguments_: readonly string[]) {
  return execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
}

describe('date recovery patterns', () => {
  it('supports partial digits and several forgotten components', () => {
    expect(expandDatePattern(parseDatePattern('?3-09-2026')).map((date) => date.day)).toEqual([
      3, 13, 23,
    ]);
    expect(expandDatePattern(parseDatePattern('0?-09-2026')).map((date) => date.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(expandDatePattern(parseDatePattern('??-??-2026'))).toHaveLength(365);
  });

  it('counts a complete calendar without allocating every candidate', () => {
    expect(datePatternCandidateCount(parseDatePattern('??-??-????'))).toBe(3_652_059);
  });

  it('does not repeat permutations of identical incomplete dates', () => {
    const pattern = parseDatePattern('?3-09-2026');
    expect(datePatternCombinationCount([pattern, pattern])).toBe(6);
    expect([...datePatternCombinations([pattern, pattern])]).toHaveLength(6);
  });

  it('recovers several incomplete dates with per-digit wildcards', async () => {
    const encoded = await run([
      'encode',
      '--mode',
      'seedshift-legacy',
      '--mnemonic',
      publicMnemonic,
      '--dates',
      '10-07-1963',
      '23-09-2026',
      '--format',
      'english',
    ]);
    const raw = encoded.stdout.trim().split('\n').at(-1)!;
    const recovered = await run([
      'recover-date',
      '--mode',
      'seedshift-legacy',
      '--input',
      raw,
      '--dates',
      '?0-07-1963',
      '2?-09-2026',
      '--max-candidates',
      '100',
    ]);
    expect(recovered.stderr).toContain('Recovery search contains 30 date combinations.');
    expect(recovered.stdout).toContain(`10-07-1963 23-09-2026\t${publicMnemonic}`);
  }, 15_000);

  it('requires explicit authorization for a complete-calendar search', async () => {
    const encoded = await run([
      'encode',
      '--mode',
      'seedshift-legacy',
      '--mnemonic',
      publicMnemonic,
      '--dates',
      '10-07-1963',
      '--format',
      'english',
    ]);
    const raw = encoded.stdout.trim().split('\n').at(-1)!;
    await expect(
      run(['recover-date', '--mode', 'seedshift-legacy', '--input', raw, '--dates', '??-??-????']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Increase the candidate search limit to at least 3,652,059'),
    });
  }, 15_000);
});
