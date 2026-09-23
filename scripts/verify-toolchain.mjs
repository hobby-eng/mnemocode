import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

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

console.log(`Toolchain pins agree: Node.js ${nodeVersion}; ${packageJson.packageManager}.`);
