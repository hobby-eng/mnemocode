// Lists the npm packages that the single executable bundles, with the same esbuild options as
// scripts/build-executable.mjs, and checks whether a release folder carries a license notice
// file that names each of them and Node.js (AUD-005-BLD002).
//
//   node docs/audits/AUD-005-harnesses/bundled-licenses.mjs [release folder]   (default release)
//
// Exit 0 means a notice file `mnemocode-*-licenses.txt` exists for every executable in the folder
// and names every bundled package and Node.js; otherwise the gaps are listed and the exit code is 1.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const folder = resolve(process.argv[2] ?? join(root, 'release'));
const result = await build({
  entryPoints: [join(root, 'src/mnemocode.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  metafile: true,
  outfile: 'mnemocode.cjs',
  define: { 'import.meta.url': 'undefined' },
  logLevel: 'silent',
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  // The last node_modules segment names the package that owns the file.
  const match = input.match(/node_modules\/(?!.*node_modules\/)(@[^/]+\/[^/]+|[^/]+)/u);
  if (match) packages.add(match[1]);
}
const executables = existsSync(folder)
  ? readdirSync(folder).filter(
      (name) => /^mnemocode-.+-(x64|arm64)(\.exe)?$/u.test(name),
    )
  : [];
const gaps = [];
for (const executable of executables) {
  const notices = join(folder, `${executable.replace(/\.exe$/u, '')}-licenses.txt`);
  if (!existsSync(notices)) {
    gaps.push(`${executable}: no license notice file`);
    continue;
  }
  const text = readFileSync(notices, 'utf8');
  for (const name of [...packages, 'Node.js'])
    if (!text.includes(name)) gaps.push(`${executable}: ${name} is not named`);
}
console.log(JSON.stringify({ bundledPackages: [...packages].sort(), executables, gaps }, null, 2));
process.exitCode = executables.length > 0 && gaps.length === 0 ? 0 : 1;
