// Execute admitted files separately; each subprocess receives the audit memory guard.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const checks = [
  ['long-sskr-joint-repair', 'test/sskr-joint-repair.test.ts'],
  ['long-sskr-repair-engine', 'test/sskr-repair-engine.test.ts'],
  ['long-date-search-core', 'test/date-search-core.test.ts'],
  ['long-missing-codes-search', 'test/missing-codes-search.test.ts'],
  ['long-word-recovery', 'test/word-recovery.test.ts'],
  ['long-menu', 'test/menu.test.ts'],
  ['saved-documents-wiped', 'test/saved-documents-wiped.test.ts'],
  ['startup-library-selected', 'test/self-test-library.test.ts', '--testNamePattern', 'leaves out|stops at|fails when|quick'],
  ['export-selected', 'test/export.test.ts', '--testNamePattern', 'ships thirteen|keeps a date list'],
];
const records = [];
for (const [label, file, ...filter] of checks) {
  const child = spawnSync('python3', ['-B', 'docs/audits/AUD-026-harnesses/audit.py', label,
    'node', 'node_modules/vitest/vitest.mjs', 'run', file, ...filter,
    '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=dot'],
  { env: { ...process.env, AUD026_TIMEOUT_SECONDS: '300' }, encoding: 'utf8' });
  const record = JSON.parse(readFileSync(`docs/audits/AUD-026-evidence/${label}.command.json`, 'utf8'));
  records.push({ label, file, filter, exitCode: record.exitCode, stopReason: record.stopReason, logSha256: record.logSha256 });
  console.log(JSON.stringify(records.at(-1)));
  writeFileSync('docs/audits/AUD-026-evidence/followup-progress.json', JSON.stringify(records, null, 2) + '\n');
  if (record.stopReason || child.error) throw Error('Memory, time or runner boundary reached; review before resuming.');
}
process.exitCode = records.some(record => record.exitCode !== 0) ? 1 : 0;
