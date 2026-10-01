// Reproduces the AUD-005 findings that can be shown by running code, with public data only.
//
//   node docs/audits/AUD-005-harnesses/defect-probes.mjs            (baseline: expect every defect)
//   node docs/audits/AUD-005-harnesses/defect-probes.mjs --fixed    (after remediation: expect none)
//
// Needs a fresh `pnpm build`. Generated files go to a fresh folder under the ignored
// docs/audits/AUD-005-evidence/. Exit 0 means every probe gave the expected answer for the chosen
// mode; otherwise the probes that differ are listed and the exit code is 1.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const expectFixed = process.argv.includes('--fixed');
const evidence = join(root, 'docs/audits/AUD-005-evidence');
mkdirSync(evidence, { recursive: true });
const work = mkdtempSync(join(evidence, 'defect-probes-'));
const library = await import(join(root, 'dist/index.js'));
const PHRASE = `${'abandon '.repeat(11)}about`;
const probes = {};

function throws(action) {
  try {
    action();
    return undefined;
  } catch (error) {
    return error.message;
  }
}

// API001: a record header with a non-canonical version number is read as version 1.
probes['AUD-005-API001'] =
  throws(() => library.parseRecord(`MNC01:direct:english:${PHRASE}`)) === undefined;

// API002: legacy-valid decoding reports an index outside 0..2047 as a checksum failure.
const outOfRange = [2048, ...Array(11).fill(0)];
probes['AUD-005-API002'] = /checksum/u.test(
  throws(() => library.decodeIndexesLegacyValid(outOfRange, [library.parseDate('01-01-2000')])) ?? '',
);

// UI002: a line of the main help is wider than the 80-column help width.
const help = execFileSync(process.execPath, [join(root, 'dist/mnemocode.js'), '--help'], {
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
});
probes['AUD-005-UI002'] = help.split('\n').some((line) => line.length > 80);

// UI001: hidden input does not know that systemd-ask-password exists only on Linux. With the
// platform reported as Windows, the message still blames a missing terminal or program.
const windows = spawnSync(
  process.execPath,
  [
    '--import',
    "data:text/javascript,Object.defineProperty(process,'platform',{value:'win32'})",
    join(root, 'dist/mnemocode.js'),
    'encode',
    '--ask-secrets',
  ],
  { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
);
probes['AUD-005-UI001'] = !/Linux/u.test(windows.stderr);

// BLD003: the executable check refuses a release folder that holds the other systems' files.
const release = join(work, 'release');
mkdirSync(release);
for (const name of ['linux-x64', 'macos-arm64', 'win-x64.exe'])
  writeFileSync(join(release, `mnemocode-0.1.0-${name}`), '');
const verify = spawnSync(process.execPath, [join(root, 'scripts/verify-executable.mjs'), release], {
  encoding: 'utf8',
});
probes['AUD-005-BLD003'] = /Expected one executable/u.test(verify.stderr);

// BLD004: the default output folder of the card scripts is not ignored by Git.
const ignored = spawnSync('git', ['check-ignore', '-q', 'goldens/current/x.pdf'], { cwd: root });
probes['AUD-005-BLD004'] = ignored.status !== 0;

// BLD005: no test exercises the SSKR integrity refusal or the manifest coverage.
const integrityTests = spawnSync('git', ['grep', '-l', 'SSKR dependency integrity', '--', 'test'], {
  cwd: root,
  encoding: 'utf8',
});
probes['AUD-005-BLD005'] = integrityTests.stdout.trim() === '';

// SEC001: the per-share folders of SSKR card fragments do not get private permissions.
const shares = JSON.parse(readFileSync(join(root, 'vectors/sskr-v1.json'), 'utf8')).official.shares;
writeFileSync(join(work, 'share.txt'), `${shares[0]}\n`);
const cardsDir = join(work, 'fragments');
const exported = spawnSync(
  '/bin/sh',
  [
    '-c',
    // A common umask, so that the default folder mode is visible.
    `umask 022 && exec "${process.execPath}" "${join(root, 'dist/mnemocode.js')}" sskr-export --share-file "${join(work, 'share.txt')}" --cards-dir "${cardsDir}" --page-size business`,
  ],
  { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
);
if (exported.status !== 0) throw new Error(`sskr-export failed: ${exported.stderr}`);
const shareFolder = join(cardsDir, spawnSync('ls', [cardsDir], { encoding: 'utf8' }).stdout.trim());
probes['AUD-005-SEC001'] = (statSync(shareFolder).mode & 0o077) !== 0;

const reproduced = Object.entries(probes);
const unexpected = reproduced.filter(([, value]) => value === expectFixed).map(([id]) => id);
console.log(
  JSON.stringify(
    { mode: expectFixed ? 'expect fixed' : 'expect reproduced', reproduced: probes, unexpected },
    null,
    2,
  ),
);
process.exitCode = unexpected.length === 0 ? 0 : 1;
