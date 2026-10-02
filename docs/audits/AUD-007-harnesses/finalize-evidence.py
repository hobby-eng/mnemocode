"""Validate AUD-007 records and evidence; does not alter product files."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import datetime
import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-007-evidence'
REPORT = ROOT / 'docs/audits/AUD-007-2026-10-02'
PROCEDURE = ROOT.parent / 'multi-chain-wallet-tools'

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}')
        result[key] = value
    return result

def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

report = read(REPORT.with_suffix('.json'))
text = REPORT.with_suffix('.md').read_text()
jsonschema.validate(report, read(PROCEDURE / 'docs/audit-report.schema.json'))
expected_checks = set(re.findall(r'^### (CHECK-\w+-\d+)',
    (PROCEDURE / 'docs/FULL_AUDIT_GUIDE.md').read_text(), re.M))
actual_checks = [c['checkId'] for c in report['coverageLedger']]
assert len(actual_checks) == len(set(actual_checks)) == 32
assert set(actual_checks) == expected_checks
ids = [f['id'] for f in report['findings'] + report['observations']]
assert len(ids) == len(set(ids))
assert all(f'### {i}' in text for i in ids)
assert report['snapshot']['commit'] in text
snapshot = read(EVIDENCE / 'snapshot.json')
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == snapshot['commit']
changes = []
for path, expected in snapshot['files'].items():
    if path == 'docs/audits/README.md':
        continue
    if digest(ROOT / path) != expected:
        changes.append(path)
assert not changes, changes
for path, expected in read(EVIDENCE / 'procedure-hashes.json').items():
    assert digest(PROCEDURE / path) == expected, path
commands = list(EVIDENCE.glob('*.command.json'))
for path in commands:
    command = read(path)
    assert digest(EVIDENCE / command['log']) == command['logSha256'], path
for check in report['checks']:
    record = read(EVIDENCE / check['record'])
    assert check['exitCode'] == record['exitCode'], check['record']
for link in re.findall(r'\]\(([^)]+)\)', text):
    if '://' not in link and not link.startswith('#'):
        assert (REPORT.parent / link.split('#')[0]).exists(), link
staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=ROOT, text=True)
assert not any('-evidence/' in p for p in staged.splitlines())
result = {'validatedAt': datetime.datetime.now(datetime.UTC).isoformat(), 'schema': 'passed',
          'checklistIds': len(actual_checks), 'pairedFindings': len(ids), 'commandRecords': len(commands),
          'baselineProductFilesUnchanged': True, 'stagedEvidence': False}
(EVIDENCE / 'report-validation.json').write_text(json.dumps(result, indent=2) + '\n')
files = sorted(p for p in EVIDENCE.rglob('*') if p.is_file() and p.name != 'SHA256SUMS')
(EVIDENCE / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.relative_to(EVIDENCE)}\n' for p in files))
print(json.dumps(result, indent=2))
