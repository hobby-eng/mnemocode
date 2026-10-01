// Builds MnemoCode as one executable file for the computer it runs on, with Node.js, the
// command-line program and every file it reads built in: card artwork and fonts, the SSKR engine
// and the public vectors. Nothing needs to be installed to run it.
//
//   node scripts/build-executable.mjs [output folder]   (default dist/executable)
//
// Writes mnemocode-<version>-<system>-<processor>[.exe] and its line of SHA256SUMS. A Node.js
// single executable is built from the running Node.js binary, so each system builds its own:
// CI builds Linux, Windows and macOS (.github/workflows/executable.yml).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, 'dist', 'executable'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const nodeVersion = readFileSync(join(root, '.node-version'), 'utf8').trim();

/** "linux-x64", "win-x64", "macos-arm64": the names Node.js uses for its own downloads. */
const systemNames = { linux: 'linux', win32: 'win', darwin: 'macos' };
const system = systemNames[process.platform];
if (system === undefined) throw new Error(`No executable is built for ${process.platform}.`);
const name = `mnemocode-${version}-${system}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;

// The executable carries the running Node.js, so it must be the version the project is tested on.
if (process.version !== `v${nodeVersion}`)
  throw new Error(`Build with Node.js ${nodeVersion} from .node-version, not ${process.version}.`);

/** Every file the program reads at run time, by its path from the package root; see bundled-files.ts. */
function bundledFiles() {
  const files = [
    'vendor/sskr/integrity.json',
    'vendor/sskr/generated/recovery_sskr_wasm.js',
    'vendor/sskr/generated/recovery_sskr_wasm_bg.wasm',
    'vectors/mnemocode-v1.json',
  ];
  const walk = (folder) => {
    for (const entry of readdirSync(join(root, folder)).sort()) {
      const path = `${folder}/${entry}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('assets');
  return files;
}

const work = join(output, 'build');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// One CommonJS file: a Node.js single executable starts from a single script. The SSKR bridge is
// bundled too; its WASM bytes and the other files come from the embedded assets.
await build({
  entryPoints: [join(root, 'src', 'mnemocode.ts')],
  outfile: join(work, 'mnemocode.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${nodeVersion.split('.')[0]}`,
  legalComments: 'inline',
  // Only bundled-files.ts reads it, on the path that the executable never takes.
  define: { 'import.meta.url': 'undefined' },
  logLevel: 'warning',
});

const assets = Object.fromEntries(bundledFiles().map((path) => [path, join(root, path)]));
const executable = join(output, name);
const config = join(work, 'sea-config.json');
writeFileSync(
  config,
  `${JSON.stringify(
    {
      main: join(work, 'mnemocode.cjs'),
      output: executable,
      disableExperimentalSEAWarning: true,
      // Neither is reproducible across machines, and start-up is fast enough without them.
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2,
  )}\n`,
);
rmSync(executable, { force: true });
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
// macOS runs only signed programs; the injected executable needs a new ad-hoc signature.
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', executable]);

const digest = createHash('sha256').update(readFileSync(executable)).digest('hex');
writeFileSync(join(output, `${name}.sha256`), `${digest}  ${name}\n`);
console.log(`${relative(root, executable)}  ${digest}`);
