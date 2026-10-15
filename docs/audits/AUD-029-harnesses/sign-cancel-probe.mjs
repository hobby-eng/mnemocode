// Isolate the existing pre-child cancellation branch. Never load release main or run a child.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ts = createRequire(import.meta.url)(resolve(root, '../tmp/cancel-check/node_modules/typescript'));
const text = readFileSync(resolve(root, 'scripts/sign-release.mjs'), 'utf8');
const source = ts.createSourceFile('sign-release.mjs', text, ts.ScriptTarget.Latest, true);
const cancelled = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Cancelled');
const run = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'run');
if (!cancelled || !run) throw new Error('The retained cancellation probe needs the original two declarations.');
let children = 0;
const outcome = await runInNewContext(
  `${cancelled.getText(source)}\n${run.getText(source)}\nrun(['unused', []]);`,
  { interrupted: true, root: '.', nextTurn: async () => undefined,
    spawn: () => { children++; throw new Error('No child may run in this read-only probe.'); } },
).then(value => ({ kind: 'returned', value: String(value) }), error => ({
  kind: 'rejected', className: error.constructor.name, hasCode: typeof error.code === 'string',
}));
console.log(JSON.stringify({ childrenStarted: children, outcome }, null, 2));
if (children !== 0 || outcome.kind !== 'returned') process.exitCode = 1;
