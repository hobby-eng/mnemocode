// Canonical envelope, evidence closure, privacy and source checks without added packages.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw Error(message); };
function uniqueJson(text) {
  const value = JSON.parse(text);
  const frames = [];
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu) ?? [];
  for (const token of tokens) {
    const parent = frames.at(-1);
    if (token === '{' || token === '[') {
      if (parent) parent.state = 'comma';
      frames.push({ object: token === '{', state: token === '{' ? 'key' : 'value', keys: new Set() });
    } else if (token === '}' || token === ']') frames.pop();
    else if (token === ',') parent.state = parent.object ? 'key' : 'value';
    else if (token === ':') parent.state = 'value';
    else if (parent?.object && parent.state === 'key') {
      const key = JSON.parse(token);
      if (parent.keys.has(key)) fail('Duplicate JSON key: ' + key);
      parent.keys.add(key); parent.state = 'colon';
    } else if (parent) parent.state = 'comma';
  }
  return value;
}
function validate(value, rule, root, path = '$') {
  if (rule.$ref) {
    const target = rule.$ref.slice(2).split('/').reduce((current, part) => current[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
    validate(value, target, root, path);
  }
  for (const entry of rule.allOf ?? []) validate(value, entry, root, path);
  const typeOf = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some(type => type === typeOf || type === 'integer' && Number.isInteger(value))) fail(path + ': type');
  }
  if ('const' in rule && value !== rule.const) fail(path + ': const');
  if (rule.enum && !rule.enum.includes(value)) fail(path + ': enum');
  if (typeof value === 'string') {
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail(path + ': pattern');
    if (rule.minLength !== undefined && value.length < rule.minLength) fail(path + ': minLength');
  }
  if (typeof value === 'number' && rule.minimum !== undefined && value < rule.minimum) fail(path + ': minimum');
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(path + ': missing ' + key);
    for (const [key, child] of Object.entries(rule.properties ?? {})) if (Object.hasOwn(value, key)) validate(value[key], child, root, path + '.' + key);
  }
  if (Array.isArray(value) && rule.items) value.forEach((child, index) => validate(child, rule.items, root, path + '[' + index + ']'));
}

let detectsDuplicate = false;
try { uniqueJson('{"a":{"x":1,"x":2}}'); } catch { detectsDuplicate = true; }
if (!detectsDuplicate || uniqueJson('{"a":{"x":1},"b":{"x":2}}').a.x !== 1) fail('Duplicate-key validator controls');
const reportPath = process.argv[2];
if (!reportPath) fail('Supply the AUD-026 JSON report path from the repository root.');
const reportText = readFileSync(reportPath, 'utf8');
const report = uniqueJson(reportText);
const schemaPath = '../multi-chain-wallet-tools/docs/audit-report.schema.json';
const schema = uniqueJson(readFileSync(schemaPath, 'utf8'));
validate(report, schema, schema);
const markdownPath = reportPath.replace(/\.json$/u, '.md');
const markdown = readFileSync(markdownPath, 'utf8');
const identifiers = report.findings.map(row => row.id);
if (new Set(identifiers).size !== identifiers.length) fail('Duplicate finding ID');
for (const finding of [...report.findings, ...report.observations]) if (!markdown.includes(finding.id)) fail('Missing MD record ' + finding.id);
const allIds = new Set([...identifiers, ...report.observations.map(row => row.id)]);
const historicalIds = new Set();
for (const name of readdirSync('docs/audits').filter(name => /^AUD-\d{3,}-\d{4}-\d{2}-\d{2}\.json$/u.test(name))) {
  const previous = uniqueJson(readFileSync('docs/audits/' + name, 'utf8'));
  for (const record of [...previous.findings, ...previous.observations]) historicalIds.add(record.id);
}
for (const id of markdown.match(/AUD-\d{3,}-(?:SEC|FUN|API|BLD|DOC|UI|ARC)\d{3,}/gu) ?? [])
  if (!allIds.has(id) && !historicalIds.has(id)) fail('Unknown MD record ' + id);
if (report.checks.length !== 32 || new Set(report.checks.map(row => row.id)).size !== 32) fail('CHECK ledger');
if (report.coverage.fileInventory.length !== 882 || new Set(report.coverage.fileInventory.map(row => row.path)).size !== 882) fail('File coverage ledger');
const names = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
const source = names.filter(path => !path.startsWith('docs/audits/') && existsSync(path)).map(path => ({ path, sha256: hash(readFileSync(path)) }));
if (hash(JSON.stringify(source)) !== report.snapshot.sourceFingerprint) fail('Changed non-audit source');
for (const record of report.executions) {
  if (hash(readFileSync('docs/audits/' + record.localEvidence)) !== record.logSha256) fail('Changed log ' + record.label);
  if (record.sourceBefore !== report.snapshot.sourceFingerprint || record.sourceAfter !== report.snapshot.sourceFingerprint) fail('Wrong command source binding');
}
const owner = resolve('.').split('/')[2];
if (new RegExp('\\b' + owner + '\\b', 'iu').test(reportText + markdown)) fail('Owner name in report');
if (/\/home\/(?!user\/)[^/\s]+\//u.test(reportText + markdown)) fail('Home path privacy');
if (!markdown.includes('UTC') || !report.completedAtUtc.endsWith('+00:00')) fail('UTC metadata');
for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
  const target = match[1];
  if (!target.includes('://') && !target.startsWith('#') && !existsSync(resolve(dirname(markdownPath), target.split('#')[0]))) fail('Broken published link ' + target);
}
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
if (staged.includes('AUD-026-evidence')) fail('Evidence staged');
const result = {
  auditId: 'AUD-026', checkedAtUtc: new Date().toISOString(),
  schemaPath, schemaSha256: hash(readFileSync(schemaPath)),
  validationMethod: 'All applicable keywords in the pinned small canonical schema: ref/allOf/type/const/enum/pattern/minLength/minimum/required/properties/items; duplicate-key token scan and controls.',
  report: basename(reportPath), reportSha256: hash(reportText), markdownSha256: hash(markdown),
  findings: identifiers.length, checks: 32, fileCoverage: 882,
  sourceFingerprint: report.snapshot.sourceFingerprint,
  unchangedSource: true, commandLogBindings: true, idsAndLinks: true, privacy: true, evidenceUnstaged: true,
};
writeFileSync('docs/audits/AUD-026-evidence/report-validation.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
