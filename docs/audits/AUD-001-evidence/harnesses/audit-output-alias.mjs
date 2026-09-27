import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = '/tmp/mnemocode-aud-001/alias-probe';
await mkdir(root + '/real', { recursive: true });
await symlink(root + '/real', root + '/alias');
const input = 'abandon '.repeat(11) + 'about';
await writeFile(root + '/real/input.txt', input, { mode: 0o600 });
const argv = [
  'dist/mnemocode.js',
  'encode',
  '--mode',
  'seedshift',
  '--mnemonic-file',
  root + '/real/input.txt',
  '--dates',
  '23-09-2026',
  '--output',
  root + '/alias/input.txt',
];
const stdout = execFileSync(process.execPath, argv, { encoding: 'utf8' });
const after = await readFile(root + '/real/input.txt', 'utf8');
const result = { argv, initial: input, after, sourceOverwritten: after !== input, stdout };
await writeFile(
  '/tmp/mnemocode-aud-001/evidence/output-alias.json',
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
