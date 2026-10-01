// Runs the documented README and docs/SSKR.md command examples against dist/ with the public
// BIP39 test phrase and checks what they print (AUD-005). Files go to a fresh folder under the
// ignored docs/audits/AUD-005-evidence/, never into the checkout.
//
//   node docs/audits/AUD-005-harnesses/readme-examples.mjs     (after pnpm build)
//
// Exit 0 means every documented result was reproduced; each failed check is listed and exits 1.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const evidence = join(root, 'docs/audits/AUD-005-evidence');
mkdirSync(evidence, { recursive: true });
const work = mkdtempSync(join(evidence, 'readme-examples-'));
const cli = join(root, 'dist/mnemocode.js');
const PHRASE = `${'abandon '.repeat(11)}about`;
const SHIFTED = 'wool abuse actual wool abuse actual wool abuse actual wool abuse congress';
const failures = [];
let passed = 0;

function run(...args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function expect(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(`${name} ${detail}`.trim());
}

// README "How checksum-valid Seedshift works".
let result = run('encode', '--mode', 'seedshift', '--mnemonic', PHRASE, '--dates', '23-09-2026', '--format', '1');
// Without colour, encode prints a label line before the result on stdout.
expect('seedshift example', result.stdout.trim().split('\n').at(-1) === SHIFTED, result.stdout);

// README legacy decode of a record typed by hand.
result = run('decode', '--mode', 'seedshift-legacy', '--input', '8F44901950118F44901950118F44901950118F4490194F5C', '--format', '3', '--dates', '23-09-2026');
expect('legacy unicode decode', result.stdout.trim() === PHRASE, result.stdout);

// README legacy-valid record: 128 candidates, one of them the original phrase.
run('encode', '--mode', 'seedshift-legacy', '--legacy-valid-last-word', '--mnemonic', PHRASE, '--dates', '23-09-2026', '--format', '1', '--output', 'legacy-valid.txt');
expect('legacy-valid header', readFileSync(join(work, 'legacy-valid.txt'), 'utf8').startsWith('MNC1:seedshift-legacy-valid:english:'));
result = run('decode', '--input-file', 'legacy-valid.txt', '--dates', '23-09-2026');
const rows = result.stdout.trim().split('\n');
expect('legacy-valid 128 candidates', rows.length === 128, String(rows.length));
expect('legacy-valid contains original', rows.some((row) => row.split('\t')[1] === PHRASE && row.endsWith('73c5da0a')));

// README complete encode and decode examples, every format, with and without dates.
for (const format of ['1', '2', '3', '4', '5']) {
  run('encode', '--mode', 'seedshift', '--mnemonic', PHRASE, '--dates', '23-09-2026', '08-08-1988', '07-11-1951', '--format', format, '--output', `shifted-${format}.txt`);
  result = run('decode', '--input-file', `shifted-${format}.txt`, '--dates', '23-09-2026', '08-08-1988', '07-11-1951');
  expect(`record round trip format ${format}`, result.stdout.trim() === PHRASE, result.stdout);
  run('encode', '--mode', 'direct', '--mnemonic', PHRASE, '--format', format, '--output', `direct-${format}.txt`);
  result = run('decode', '--mode', 'direct', '--input-file', `direct-${format}.txt`, '--format', format);
  expect(`direct round trip format ${format}`, result.stdout.trim() === PHRASE, result.stdout);
}

// README recovery checks: fingerprint, address, account xpub, compressed public key.
const recovery = ['recover-date', '--mode', 'seedshift', '--input', SHIFTED, '--format', '1', '--dates', '??-09-2026'];
for (const [name, extra, path] of [
  ['fingerprint', ['--master-fingerprint', '73c5da0a'], 'm'],
  ['address', ['--bitcoin-address', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', '--bitcoin-profile', 'native-segwit'], "m/84'/0'/0'/0/0"],
  ['account xpub', ['--account-xpub', 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', '--bitcoin-profile', 'native-segwit'], "m/84'/0'/0'"],
  ['public key', ['--compressed-public-key', '03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115', '--bitcoin-profile', 'taproot', '--account', '0', '--branch', '0', '--index', '0'], "m/86'/0'/0'/0/0"],
]) {
  result = run(...recovery, ...extra);
  const lines = result.stdout.trim().split('\n').filter((line) => line.includes('\t'));
  expect(`recover-date ${name}`, lines.length === 1 && lines[0] === `23-09-2026\t${PHRASE}\tmatched at ${path}`, result.stdout);
}

// README forgotten-word recovery: 128 candidates for a 12-word phrase.
result = run('recover-word', '--mnemonic', `${'abandon '.repeat(11)}?`);
const candidates = result.stdout.trim().split('\n').filter((line) => /^\d+\t/u.test(line));
expect('recover-word candidates', candidates.length === 128, String(candidates.length));

// README table lookups.
expect('table word', run('table', '--word', 'abandon').stdout.includes('index:       1'));
expect('table index', run('table', '--index', '1').stdout.includes('english:     abandon'));
expect('table unicode', run('table', '--unicode', '5BF6').stdout.includes('index:'));

// README: a QR code holds only the encoded phrase; decode finds the format by itself.
run('encode', '--mode', 'seedshift', '--mnemonic', PHRASE, '--dates', '23-09-2026', '--format', '5', '--qr', 'palette.png');
result = run('decode', '--mode', 'seedshift', '--qr-file', 'palette.png', '--dates', '23-09-2026');
expect('QR round trip', result.stdout.trim() === PHRASE, result.stdout);

// docs/SSKR.md: 2 of 3 shares, any two restore; an existing file is never replaced.
run('encode', '--sskr', '--mnemonic', PHRASE, '--threshold', '2', '--shares', '3', '--output', 'shares.txt');
const shares = readFileSync(join(work, 'shares.txt'), 'utf8').trim().split('\n');
expect('three shares', shares.length === 3);
for (const pair of [[0, 1], [0, 2], [1, 2]]) {
  writeFileSync(join(work, 'two.txt'), `${shares[pair[0]]}\n${shares[pair[1]]}\n`);
  expect(`combine ${pair}`, run('sskr-combine', '--share-file', 'two.txt').stdout.trim().endsWith(PHRASE));
}
writeFileSync(join(work, 'one.txt'), `${shares[0]}\n`);
expect('one share refused', run('sskr-combine', '--share-file', 'one.txt').code !== 0);
expect('no SSKR overwrite', run('encode', '--sskr', '--mnemonic', PHRASE, '--threshold', '2', '--shares', '3', '--output', 'shares.txt').code !== 0);

console.log(JSON.stringify({ folder: work, passed, failed: failures.length, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
