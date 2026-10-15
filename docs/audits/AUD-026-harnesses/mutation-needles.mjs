// Read-only admission of installed self-test mutations; never run a renderer or alter dist.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve('../tmp/cancel-check/package.json'));
const ts = require('typescript');
const source = ts.createSourceFile('test/self-test-integrity.test.ts', readFileSync('test/self-test-integrity.test.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const constants = new Map();
const inventories = new Map();
function collect(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
    if (ts.isStringLiteral(node.initializer)) constants.set(node.name.text, node.initializer.text);
    if (['DAMAGED_ANSWERS', 'LOST_REFUSALS'].includes(node.name.text)) inventories.set(node.name.text, node.initializer);
  }
  ts.forEachChild(node, collect);
}
collect(source);
if (inventories.size !== 2) throw Error('Both known mutation inventories must be found.');
let missing = 0;
let count = 0;
for (const [registry, cases] of inventories) {
  if (!ts.isArrayLiteralExpression(cases)) throw Error('Unhandled mutation inventory initializer.');
  for (const object of cases.elements) {
  if (!ts.isObjectLiteralExpression(object)) throw Error('Unhandled mutation inventory expression.');
  const fields = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = property.initializer;
    if (ts.isStringLiteral(value)) fields[property.name.getText(source)] = value.text;
    else if (ts.isIdentifier(value)) fields[property.name.getText(source)] = constants.get(value.text);
  }
  if (!fields.file || !fields.from || !fields.name) throw Error('Unhandled mutation inventory field.');
  const text = readFileSync(fields.file, 'utf8');
  const found = text.includes(fields.from);
  if (!found) missing++;
  count++;
  console.log(JSON.stringify({ registry, name: fields.name, file: fields.file, needleExists: found, sourceLine: source.getLineAndCharacterOfPosition(object.getStart(source)).line + 1 }));
  }
}
console.log(JSON.stringify({ cases: count, missingNeedles: missing, changedFiles: 0, rendererExecutions: 0 }));
process.exitCode = missing === 0 ? 0 : 1;
