// Exercise the real --check wrapper with a public synthetic Docker-output adapter.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('../tmp/mnemocode-aud-026/build-cleanup');
await mkdir(root, { recursive: true });
const scratch = await mkdtemp(root + '/run-');
await mkdir(scratch + '/bin');
await mkdir(scratch + '/temporary');
const adapter = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const argument = process.argv.find(value => value.startsWith('type=local,dest='));
if (!argument) throw Error('The actual build wrapper did not request local output.');
const folder = argument.slice('type=local,dest='.length);
const stem = folder + '/recovery_sskr_wasm';
writeFileSync(stem + '_bg.wasm', Uint8Array.of(0,97,115,109,1,0,0,0));
writeFileSync(stem + '.js', '\\nasync function __wbg_load() {}\\nfunction initSync() {}\\nasync function __wbg_init() {}\\nexport { initSync, __wbg_init as default };');
writeFileSync(stem + '.d.ts', 'export function initSync(): void;\\n/** Async initialization. */\\nexport default function __wbg_init(): Promise<void>;\\n');
writeFileSync(stem + '_bg.wasm.d.ts', 'export const memory: WebAssembly.Memory;\\n');
`;
await writeFile(scratch + '/bin/docker', adapter, { mode: 0o700 });
const child = spawnSync(process.execPath, ['scripts/build-sskr-wasm.mjs', '--check'], {
  env: { ...process.env, PATH: scratch + '/bin:' + process.env.PATH, TMPDIR: scratch + '/temporary' },
  encoding: 'utf8',
});
console.log(child.stdout);
console.log(child.stderr);
const leftovers = (await readdir(scratch + '/temporary')).filter(name => name.startsWith('mnemocode-sskr-'));
console.log(JSON.stringify({ actualWrapperExit: child.status, leftoverDirectories: leftovers.length, expected: 'nonzero comparison status and zero temporary directories' }));
process.exitCode = child.status !== 0 && leftovers.length === 0 ? 0 : 1;
