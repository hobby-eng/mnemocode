// Checks the SSKR integrity mechanism (AUD-005):
//   1. every file named in vendor/sskr/integrity.json has that SHA-256, and every code, build or
//      generated file under vendor/sskr/generated and vendor/sskr/rust is named in it;
//   2. a disposable installation whose WASM or bridge differs by one byte refuses SSKR work with
//      the integrity error before printing a phrase, while the unchanged copy restores it.
// Only the official BCR-2020-011 shares are used. The checkout is never modified: the damaged
// copies live in a fresh folder under the ignored docs/audits/AUD-005-evidence/.
//
//   node docs/audits/AUD-005-harnesses/sskr-integrity.mjs      (after pnpm build)
//
// Exit 0 means all checks passed; any failure is listed and exits 1.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const vendor = join(root, 'vendor/sskr');
const manifest = JSON.parse(readFileSync(join(vendor, 'integrity.json'), 'utf8'));
const vectors = JSON.parse(readFileSync(join(root, 'vectors/sskr-v1.json'), 'utf8'));
const failures = [];
const results = {};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function files(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// 1. Manifest against the files.
for (const [path, digest] of Object.entries(manifest)) {
  const actual = sha256(join(vendor, path));
  results[path] = actual === digest ? 'match' : `MISMATCH ${actual}`;
  if (actual !== digest) failures.push(`${path} does not match integrity.json`);
}
const pinnable = [...files(join(vendor, 'generated')), ...files(join(vendor, 'rust'))]
  .map((path) => relative(vendor, path))
  .filter((path) => !path.startsWith('rust/target/'));
for (const path of pinnable)
  if (!(path in manifest)) failures.push(`${path} is not named in integrity.json`);

// 2. Damaged installations.
const evidence = join(root, 'docs/audits/AUD-005-evidence');
mkdirSync(evidence, { recursive: true });
// The first published restoring quorum (two groups); five arbitrary shares are not one.
const shares = vectors.official.validQuorums[0].map((index) => vectors.official.shares[index]);
const { entropyToMnemonic } = await import(join(root, 'node_modules/@scure/bip39/index.js'));
const { wordlist } = await import(join(root, 'node_modules/@scure/bip39/wordlists/english.js'));
const expectedPhrase = entropyToMnemonic(Buffer.from(vectors.official.entropy, 'hex'), wordlist);
function installation(damage) {
  const folder = mkdtempSync(join(evidence, 'sskr-integrity-'));
  cpSync(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
  cpSync(join(root, 'vectors'), join(folder, 'vectors'), { recursive: true });
  cpSync(vendor, join(folder, 'vendor/sskr'), { recursive: true });
  writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
  for (const name of ['node_modules', 'assets']) symlinkSync(join(root, name), join(folder, name));
  if (damage !== undefined) {
    const path = join(folder, 'vendor/sskr', damage);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0x01;
    writeFileSync(path, bytes);
  }
  return folder;
}
function combine(folder) {
  const args = ['sskr-combine', ...shares.flatMap((share) => ['--share', share])];
  try {
    const stdout = execFileSync(process.execPath, [join(folder, 'dist/mnemocode.js'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

const intact = combine(installation());
const restored = intact.code === 0 && intact.stdout.trim().split('\n').at(-1) === expectedPhrase;
results.intact = restored ? 'restored the official entropy' : `failed: ${intact.stderr}`;
if (!restored) failures.push('intact copy did not restore');
for (const damaged of ['generated/recovery_sskr_wasm_bg.wasm', 'generated/recovery_sskr_wasm.js']) {
  const outcome = combine(installation(damaged));
  const refused =
    outcome.code !== 0 &&
    outcome.stdout === '' &&
    outcome.stderr.includes('SSKR dependency integrity check failed. No secret was processed.');
  results[`damaged ${damaged}`] = refused ? 'refused' : `NOT REFUSED (${outcome.code})`;
  if (!refused) failures.push(`damaged ${damaged} was not refused`);
}

console.log(JSON.stringify({ results, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
