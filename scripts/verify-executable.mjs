// Runs a built executable (scripts/build-executable.mjs) from an empty folder, away from the
// checkout, and checks that it works on its own: version, full self-test, a seedshift encoding,
// a Shamir split and recovery, a card PDF and the help. Public test data only.
//
//   node scripts/verify-executable.mjs [executable or its folder]   (default dist/executable)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** The executable itself, or the one executable in a folder written by build-executable.mjs. */
function findExecutable(path) {
  if (!statSync(path).isDirectory()) return path;
  const found = readdirSync(path).filter(
    (name) => name.startsWith('mnemocode-') && !name.endsWith('.sha256'),
  );
  if (found.length !== 1)
    throw new Error(`Expected one executable in ${path}, found ${found.length}.`);
  return join(path, found[0]);
}

const executable = findExecutable(resolve(process.argv[2] ?? join(root, 'dist', 'executable')));

/** The public BIP39 test phrase, and its seedshift encoding with the date 23-09-2026. */
const TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SHIFTED = 'wool abuse actual wool abuse actual wool abuse actual wool abuse congress';

const folder = mkdtempSync(join(tmpdir(), 'mnemocode-executable-'));
const run = (...arguments_) =>
  execFileSync(executable, arguments_, {
    cwd: folder,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const check = (condition, what) => {
  if (!condition) throw new Error(`The executable failed: ${what}.`);
  console.log(`ok  ${what}`);
};

try {
  check(run('--version') === `mnemocode ${version}\n`, `prints version ${version}`);
  check(run('self-test').includes('PASS'), 'passes the full self-test');
  const shifted = run(
    'encode',
    '--mnemonic',
    TEST_PHRASE,
    '--dates',
    '23-09-2026',
    '--format',
    '1',
  );
  check(shifted.includes(SHIFTED), 'masks the test phrase with a date');
  run(
    'encode',
    '--sskr',
    '--mnemonic',
    TEST_PHRASE,
    '--threshold',
    '2',
    '--shares',
    '3',
    '--output',
    'shares.txt',
  );
  const shares = readFileSync(join(folder, 'shares.txt'), 'utf8').trim().split('\n');
  writeFileSync(join(folder, 'two.txt'), `${shares[0]}\n${shares[2]}\n`);
  check(
    run('sskr-combine', '--share-file', 'two.txt').includes(TEST_PHRASE),
    'restores the phrase from 2 of 3 Shamir shares',
  );
  run('preview', '--template', 'business-it', '--pdf', 'preview.pdf');
  check(
    readFileSync(join(folder, 'preview.pdf')).subarray(0, 5).toString() === '%PDF-',
    'draws a card PDF with its embedded artwork',
  );
  check(run('encode', '--help').includes('Usage: mnemocode encode'), 'prints the help');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
