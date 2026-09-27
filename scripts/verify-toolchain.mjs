import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const versionSource = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8');

const expectedEngine = `>=${nodeVersion}`;
if (packageJson.engines?.node !== expectedEngine) {
  throw new Error(`package.json engines.node must be ${expectedEngine}`);
}

if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageJson.packageManager ?? '')) {
  throw new Error('package.json packageManager must pin an exact pnpm version');
}

if (!workflow.includes('node-version-file: .node-version')) {
  throw new Error('CI must read Node.js from .node-version');
}

if (/\n\s+version:\s+\d+\.\d+\.\d+\s*$/mu.test(workflow)) {
  throw new Error('CI must read pnpm from package.json packageManager');
}

const sourceVersion = versionSource.match(/MNEMOCODE_VERSION = '([^']+)'/u)?.[1];
if (sourceVersion !== packageJson.version) {
  throw new Error('src/version.ts MNEMOCODE_VERSION must match package.json version');
}

console.log(
  `Version and toolchain pins agree: MnemoCode ${sourceVersion}; Node.js ${nodeVersion}; ${packageJson.packageManager}.`,
);
