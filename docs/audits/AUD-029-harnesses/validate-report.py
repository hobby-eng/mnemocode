"""Validate the scoped CORE record, exact source and local evidence without product execution."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-029-evidence'


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate():
    path = ROOT / 'docs/audits/AUD-029-2026-10-15.json'
    report = json.loads(path.read_text(), object_pairs_hook=unique)
    schema = json.loads((ROOT.parent / 'multi-chain-wallet-tools/docs/audit-report.schema.json').read_text())
    jsonschema.Draft202012Validator(schema).validate(report)
    markdown = path.with_suffix('.md').read_text()
    ids = [row['id'] for row in report['findings']]
    assert len(ids) == len(set(ids)) == 8
    assert all('#### ' + identifier + ' —' in markdown for identifier in ids)
    assert len({row['id'] for row in report['coreRules']}) == 52
    assert len({row['checkId'] for row in report['checks']}) == 32
    names = set(subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    source = [{'path': name, 'sha256': sha(ROOT / name)} for name in sorted(names)
              if not name.startswith('docs/audits/') and (ROOT / name).is_file()]
    fingerprint = hashlib.sha256(json.dumps(source, separators=(',', ':')).encode()).hexdigest()
    assert fingerprint == report['snapshot']['sourceFingerprint']
    for row in report['executions']:
        record_path = EVIDENCE / (row['label'] + '.command.json')
        assert sha(record_path) == row['recordSha256']
        record = json.loads(record_path.read_text())
        assert sha(EVIDENCE / (row['label'] + '.log')) == record['logSha256']
        assert record['sourceBefore'] == record['sourceAfter'] == fingerprint
    for row in report['retainedEvidence']:
        assert sha(ROOT / row['path']) == row['recordSha256']
        assert row['exactSourceMatch']
    staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=ROOT).decode()
    assert 'AUD-029-evidence/' not in staged
    result = {'auditId': 'AUD-029', 'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'findings': len(ids), 'sourceFingerprint': fingerprint,
              'reportSha256': sha(path), 'markdownSha256': sha(path.with_suffix('.md')),
              'scope': 'focused CORE assessment', 'releaseAcceptance': False}
    (EVIDENCE / 'report-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(validate(), indent=2))
