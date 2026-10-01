import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const vendor = resolve('vendor/sskr');

async function manifest(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(vendor, 'integrity.json'), 'utf8'));
}

async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(vendor, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

/** A disposable installation whose SSKR files can be damaged without touching the checkout. */
async function withDamagedInstallation(
  damaged: string,
  check: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mnemocode-sskr-integrity-'));
  try {
    await cp(resolve('dist'), join(directory, 'dist'), { recursive: true });
    await cp(resolve('vectors'), join(directory, 'vectors'), { recursive: true });
    await cp(vendor, join(directory, 'vendor/sskr'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const name of ['node_modules', 'assets'])
      await symlink(resolve(name), join(directory, name), 'junction');
    const path = join(directory, 'vendor/sskr', damaged);
    const bytes = await readFile(path);
    bytes[bytes.length - 1]! ^= 0x01;
    await writeFile(path, bytes);
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('SSKR integrity (AUD-005-BLD005)', () => {
  it('pins every vendored source, build and generated file with its current hash', async () => {
    const pins = await manifest();
    for (const [path, digest] of Object.entries(pins)) {
      const bytes = await readFile(join(vendor, path));
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(digest);
    }
    // A refreshed or added file must be pinned too; a Cargo build folder is not part of the bridge.
    const pinnable = [
      ...(await filesBelow(join(vendor, 'generated'))),
      ...(await filesBelow(join(vendor, 'rust'))),
    ].filter((path) => !path.startsWith('rust/target/'));
    expect(Object.keys(pins).sort()).toEqual(pinnable.sort());
  });

  it.each(['generated/recovery_sskr_wasm_bg.wasm', 'generated/recovery_sskr_wasm.js'])(
    'refuses Shamir work when %s differs by one byte',
    async (damaged) => {
      const vectors = JSON.parse(await readFile('vectors/sskr-v1.json', 'utf8'));
      const quorum: string[] = vectors.official.validQuorums[0].map(
        (index: number) => vectors.official.shares[index],
      );
      await withDamagedInstallation(damaged, async (directory) => {
        const result = await execute(
          process.execPath,
          [
            join(directory, 'dist/mnemocode.js'),
            'sskr-combine',
            ...quorum.flatMap((share) => ['--share', share]),
          ],
          { env: { ...process.env, NO_COLOR: '1' } },
        ).then(
          (output) => ({ code: 0, ...output }),
          (error: { code: number; stdout: string; stderr: string }) => error,
        );
        expect(result.code).not.toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(
          'SSKR dependency integrity check failed. No secret was processed.',
        );
      });
    },
  );
});
