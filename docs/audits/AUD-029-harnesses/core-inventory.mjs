// Read-only syntax inventory for the scoped CORE review; counts are leads, not violations.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(resolve(root, '../tmp/cancel-check/node_modules/typescript'));
const evidence = resolve(root, 'docs/audits/AUD-029-evidence');
mkdirSync(evidence, { recursive: true });
const below = folder => readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? below(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]);
const paths = [...below('src'), ...below('scripts')].filter(path => /\.(?:ts|mjs)$/u.test(path));
const files = [];
const declarations = [];
const owners = [];
const nativeErrors = [];
const catches = [];
const importedBarrels = [];
const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
for (const path of paths) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  files.push({ path, sha256: createHash('sha256').update(text).digest('hex'),
    lines: text.split('\n').length - 1, parseDiagnostics: source.parseDiagnostics.length });
  const at = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  function visit(node) {
    if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const row = { path, line: at(node), name: node.name?.text ?? '(anonymous)',
        kind: ts.isClassDeclaration(node) ? 'class' : 'function', exported: exported(node),
        lines: at({ getStart: () => node.end }) - at(node) + 1 };
      declarations.push(row);
      if (ts.isClassDeclaration(node) && node.heritageClauses?.some(clause =>
        clause.types.some(type => type.expression.getText(source) === 'Redacted'))) {
        owners.push({ ...row, methods: node.members.filter(member =>
          ts.isMethodDeclaration(member)).map(member => member.name.getText(source)),
        fields: node.members.filter(member => ts.isPropertyDeclaration(member)).map(member => ({
          name: member.name.getText(source), type: member.type?.getText(source) ?? null })) });
      }
    }
    if (ts.isNewExpression(node) && /^(?:Error|TypeError|RangeError|AggregateError)$/u.test(node.expression.getText(source)))
      nativeErrors.push({ path, line: at(node), kind: node.expression.getText(source) });
    if (ts.isCatchClause(node)) catches.push({ path, line: at(node),
      empty: node.block.statements.length === 0 });
    if (ts.isImportDeclaration(node) && /(?:^|\/)core\.js$/u.test(node.moduleSpecifier.text))
      importedBarrels.push({ path, line: at(node), from: node.moduleSpecifier.text });
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const result = { parserVersion: ts.version, files, declarations, redactedOwners: owners,
  nativeErrors, catches, importedBarrels,
  summary: { files: files.length, sourceFiles: files.filter(row => row.path.startsWith('src/')).length,
    exportedClasses: declarations.filter(row => row.exported && row.kind === 'class').length,
    exportedFunctions: declarations.filter(row => row.exported && row.kind === 'function').length,
    classlessSourceModules: files.filter(file => file.path.startsWith('src/') &&
      !declarations.some(row => row.path === file.path && row.kind === 'class')).length,
    redactedOwners: owners.length, ownersWithoutWipe: owners.filter(row => !row.methods.includes('wipe')).length,
    nativeErrorSites: nativeErrors.length, emptyCatchSites: catches.filter(row => row.empty).length,
    implementationBarrelImports: importedBarrels.length,
    parseDiagnostics: files.reduce((count, row) => count + row.parseDiagnostics, 0) } };
writeFileSync(resolve(evidence, 'core-inventory.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.summary, null, 2));
if (result.summary.parseDiagnostics !== 0) process.exitCode = 1;
