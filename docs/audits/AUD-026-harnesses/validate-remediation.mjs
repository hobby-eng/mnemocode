// Remediation closure reuses the frozen baseline schema/duplicate-key validators.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (holds, message) => { if (!holds) throw Error(message); };
const baselineValidator = readFileSync('docs/audits/AUD-026-harnesses/validate-report.mjs', 'utf8');
const boundary = baselineValidator.indexOf('let detectsDuplicate = false;');
requireThat(boundary > 0, 'Frozen validator library boundary');
const { uniqueJson, validate } = await import('data:text/javascript,' + encodeURIComponent(
  baselineValidator.slice(0, boundary) + '\nexport { uniqueJson, validate };\n'));
const jsonPath = 'docs/audits/AUD-026-2026-10-14.json';
const mdPath = jsonPath.replace(/\.json$/u, '.md');
const jsonText = readFileSync(jsonPath, 'utf8');
const markdown = readFileSync(mdPath, 'utf8');
const report = uniqueJson(jsonText);
const schemaPath = '../multi-chain-wallet-tools/docs/audit-report.schema.json';
const schema = uniqueJson(readFileSync(schemaPath, 'utf8'));
validate(report, schema, schema);
const before = uniqueJson(readFileSync('docs/audits/AUD-026-evidence/baseline-report.json', 'utf8'));
const clearStatuses = value => JSON.stringify(value.map(({status, ...rest}) => rest));
requireThat(clearStatuses(report.findings) === clearStatuses(before.findings), 'Original finding content changed');
for (const field of ['snapshot','scope','checks','observations','coverage','executions','counts','assessment','candidateAdjudication'])
  requireThat(JSON.stringify(report[field]) === JSON.stringify(before[field]), 'Original baseline field changed: ' + field);
requireThat(report.findings.length === 22 && report.findings.every(row => row.status === 'fixed'), 'Fixed register');
const addition = report.remediationAddendum;
requireThat(addition.fixes.length === 22 && new Set(addition.fixes.map(row => row.id)).size === 22, 'Fix mapping');
for (const row of addition.fixes) requireThat(markdown.includes(row.id) && report.findings.some(f => f.id === row.id), 'Unmatched fix ID');
const names = [...new Set(execFileSync('git', ['ls-files','-co','--exclude-standard','-z'], {encoding:'utf8'}).split('\0').filter(Boolean))].sort();
const source = names.filter(path => !path.startsWith('docs/audits/') && existsSync(path)).map(path => ({path,sha256:hash(readFileSync(path))}));
requireThat(hash(JSON.stringify(source)) === addition.sourceFingerprint, 'Remediated source fingerprint');
requireThat(JSON.stringify(source) === JSON.stringify(addition.sourceFiles), 'Remediated manifest');
for (const record of [...report.executions, ...addition.executions])
  requireThat(hash(readFileSync('docs/audits/' + record.localEvidence)) === record.logSha256, 'Changed command log: ' + record.label);
requireThat(addition.executions.some(row => row.label === addition.finalGateLabel && row.exitCode === 0 && row.sourceBefore === addition.sourceFingerprint && row.sourceAfter === addition.sourceFingerprint), 'Final gates missing current source binding');
const owner = resolve('.').split('/')[2];
requireThat(!new RegExp('\\b' + owner + '\\b','iu').test(jsonText + markdown), 'Report username');
requireThat(!/\/home\/(?!user\/)[^/\s]+\//u.test(jsonText + markdown), 'Report home path');
requireThat(addition.completedAtUtc.endsWith('+00:00') && markdown.includes('UTC'), 'UTC addendum');
for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
  const target = match[1];
  if (!target.includes('://') && !target.startsWith('#'))
    requireThat(existsSync(resolve(dirname(mdPath), target.split('#')[0])), 'Broken report link: ' + target);
}
requireThat(!execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).includes('AUD-026-evidence'), 'Evidence staged');
const result = {auditId:'AUD-026',phase:'remediation',checkedAtUtc:new Date().toISOString(),schemaSha256:hash(readFileSync(schemaPath)),baselineValidatorSha256:hash(baselineValidator),reportSha256:hash(jsonText),markdownSha256:hash(markdown),baselinePreserved:true,findings:22,status:'fixed',sourceFingerprint:addition.sourceFingerprint,sourceFiles:source.length,commandLogsChecked:report.executions.length + addition.executions.length,releaseAcceptance:false};
writeFileSync('docs/audits/AUD-026-evidence/remediation-report-validation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
