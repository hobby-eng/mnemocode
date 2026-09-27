import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const publicMnemonic = 'abandon '.repeat(11) + 'about';

/** Damage disposable installation files only, never the real build or vectors. */
async function withInstallation(check: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mnemocode-integrity-'));
  try {
    await cp(resolve('dist'), join(directory, 'dist'), { recursive: true });
    await cp(resolve('vectors'), join(directory, 'vectors'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const name of ['node_modules', 'assets', 'vendor']) {
      await symlink(resolve(name), join(directory, name), 'junction');
    }
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Installed self-test integrity', () => {
  it('fails before encoding when the pinned word-list expectation is damaged', async () => {
    await withInstallation(async (directory) => {
      const module = join(directory, 'dist/cli/self-test.js');
      const source = await readFile(module, 'utf8');
      const corrupted = source.replace(
        '187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae',
        '0'.repeat(64),
      );
      expect(corrupted).not.toBe(source);
      await writeFile(module, corrupted);
      const result = await execute(process.execPath, [
        join(directory, 'dist/mnemocode.js'),
        'encode',
        '--mode',
        'direct',
        '--mnemonic',
        publicMnemonic,
      ]).then(
        (output) => ({ code: 0, ...output }),
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('CRITICAL: MnemoCode core self-test failed.');
      expect(result.stderr).not.toContain(publicMnemonic);
    });
  });

  it('AUD-001-FUN002: refuses an empty public-vector catalogue', async () => {
    await withInstallation(async (directory) => {
      await writeFile(
        join(directory, 'vectors/mnemocode-v1.json'),
        JSON.stringify({ version: 1, vectors: [] }),
      );
      const exitCode = await execute(process.execPath, [
        join(directory, 'dist/mnemocode.js'),
        'self-test',
      ]).then(
        () => 0,
        (error: { code: number }) => error.code,
      );
      expect(exitCode).not.toBe(0);
    });
  }, 20_000);
});
