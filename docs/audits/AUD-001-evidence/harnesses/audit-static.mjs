import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import * as prettier from "prettier";
import { createHash } from 'node:crypto';
const root = process.cwd();
async function files(dir) {
  const list = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) list.push(...(await files(p)));
    else list.push(p);
  }
  return list;
}
const source = (await files('src')).filter((p) => p.endsWith('.ts'));
const owned = [...source, ...(await files('test')), ...(await files('scripts'))].filter((p) =>
  /\.(ts|mjs)$/.test(p),
);
const docFiles = [
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'tsconfig.json',
  ...(await files('docs')),
].filter((p) => /\.(md|json)$/.test(p));
const formatting = [];
for (const p of [...owned, ...docFiles]) {
  const config = await prettier.resolveConfig(p);
  if (!(await prettier.check(await readFile(p, 'utf8'), { ...config, filepath: p })))
    formatting.push(p);
}
const functionLengths = [];
let assertions = 0;
let nestedTernaries = 0;
const graph = {};
for (const p of source) {
  const text = await readFile(p, 'utf8');
  const ast = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
  function visit(n) {
    if (ts.isNonNullExpression(n)) assertions++;
    if (
      ts.isConditionalExpression(n) &&
      (ts.isConditionalExpression(n.whenTrue) || ts.isConditionalExpression(n.whenFalse))
    )
      nestedTernaries++;
    if (
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.body
    ) {
      const start = ast.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const end = ast.getLineAndCharacterOfPosition(n.end).line + 1;
      if (end - start + 1 >= 70)
        functionLengths.push({
          file: p,
          name: n.name?.getText(ast) ?? '<anonymous>',
          start,
          lines: end - start + 1,
        });
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
for (const p of (await files('dist')).filter((p) => p.endsWith('.js'))) {
  const ast = ts.createSourceFile(p, await readFile(p, 'utf8'), ts.ScriptTarget.Latest, true);
  graph[p] = ast.statements
    .filter((n) => (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier)
    .map((n) => n.moduleSpecifier.text)
    .filter((n) => n.startsWith('.'))
    .map((n) => path.normalize(path.join(path.dirname(p), n)));
}
const cycles = [];
const visited = new Set();
const active = [];
function traverse(p) {
  const i = active.indexOf(p);
  if (i >= 0) {
    cycles.push(active.slice(i).concat(p));
    return;
  }
  if (visited.has(p)) return;
  visited.add(p);
  active.push(p);
  for (const dep of graph[p] ?? []) traverse(dep);
  active.pop();
}
Object.keys(graph).forEach(traverse);
const manifest = JSON.parse(await readFile('vendor/sskr/integrity.json', 'utf8'));
const integrity = [];
for (const [p, hash] of Object.entries(manifest))
  integrity.push({
    path: p,
    match:
      createHash('sha256')
        .update(await readFile('vendor/sskr/' + p))
        .digest('hex') === hash,
  });
const vectors = JSON.parse(await readFile('vectors/mnemocode-v1.json', 'utf8'));
const sskr = JSON.parse(await readFile('vectors/sskr-v1.json', 'utf8'));
const installed = {};
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const current = JSON.parse(
    await readFile('node_modules/' + name + '/package.json', 'utf8'),
  ).version;
  installed[name] = { pinned: version, installed: current, match: current === version };
}
const data = {
  sourceFiles: source.length,
  formattedCodeFiles: owned.length,
  formatFailures: formatting,
  functionsAtLeast70Lines: functionLengths,
  nonNullAssertions: assertions,
  nestedTernaries,
  runtimeStaticImportCycles: cycles,
  integrity,
  installed,
  vectors: vectors.vectors.map((v) => ({
    name: v.name,
    words: v.sourceMnemonic.split(' ').length,
    mode: v.mode,
    sourceFingerprint: v.sourceFingerprint !== undefined,
    encodedFingerprint: v.encodedFingerprint !== undefined,
  })),
  sskr: { officialShares: sskr.official.shares.length, deterministic: sskr.deterministic.length },
};
await writeFile(
  '/tmp/mnemocode-aud-001/evidence/static-review.json',
  JSON.stringify(data, null, 2),
);
console.log(JSON.stringify(data, null, 2));
