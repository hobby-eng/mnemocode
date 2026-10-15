"""Validate the separate AUD-028 remediation phase without rewriting baseline evidence."""
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-028-evidence'
BASELINE_VALIDATOR = Path(__file__).with_name('validate-report.py')
SPEC = importlib.util.spec_from_file_location('aud028_baseline', BASELINE_VALIDATOR)
BASELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASELINE)


def validate():
    report_path = ROOT / 'docs/audits/AUD-028-2026-10-15.json'
    report = BASELINE.read_json(report_path)
    before = BASELINE.read_json(EVIDENCE / 'baseline-report.json')
    schema = BASELINE.read_json(BASELINE.SCHEMA)
    BASELINE.jsonschema.Draft202012Validator(schema).validate(report)
    for key, value in before.items():
        if key != 'remediation':
            assert report[key] == value, 'Changed original baseline field: ' + key
    markdown = report_path.with_suffix('.md').read_text()
    assert markdown.startswith((EVIDENCE / 'baseline-report.md').read_text())
    addition = report['remediationAddendum']
    ids = {row['id'] for row in report['findings']}
    assert len(ids) == 17
    assert {row['id'] for row in addition['fixes']} == ids
    assert {row['id'] for row in report['remediation']} == ids
    assert all(row['status'] == 'fixed' for row in report['remediation'])
    assert all(row['status'] == 'fixed' for row in addition['fixes'])
    assert all(row['id'] in markdown and row['checks'] for row in addition['fixes'])
    assert addition['releaseAcceptance'] is False
    paths = set(subprocess.check_output(
        ['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT,
    ).decode().split('\0')) - {''}
    source = [{'path': name, 'sha256': BASELINE.sha(ROOT / name)} for name in sorted(paths)
              if not name.startswith('docs/audits/') and (ROOT / name).is_file()]
    fingerprint = hashlib.sha256(json.dumps(source, separators=(',', ':')).encode()).hexdigest()
    assert fingerprint == addition['sourceFingerprint']
    assert source == addition['sourceFiles']
    for row in addition['executions']:
        path = EVIDENCE / (row['label'] + '.command.json')
        assert BASELINE.sha(path) == row['recordSha256']
        record = BASELINE.read_json(path)
        assert BASELINE.sha(EVIDENCE / (row['label'] + '.log')) == record['logSha256']
        assert record['logSha256'] == row['logSha256']
        assert row['exitCode'] == record['exitCode']
    gates = [row for row in addition['executions'] if row['label'] == addition['finalGateLabel']]
    assert len(gates) == 1 and gates[0]['exitCode'] == 0
    assert gates[0]['sourceBefore'] == gates[0]['sourceAfter'] == fingerprint
    for name, digest in addition['sskrPins'].items():
        assert BASELINE.sha(ROOT / 'sskr-wasm' / name) == digest
    owner = Path.home().name.lower()
    for path in [report_path, report_path.with_suffix('.md'), Path(__file__)]:
        text = path.read_text()
        assert owner not in text.lower() if owner not in ('root', 'runner', 'user') else True
        if path.suffix in ('.json', '.md'):
            assert not re.search(r'/home/(?!user/)[^/\s]+/', text)
    staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=ROOT).decode()
    assert 'AUD-028-evidence/' not in staged
    result = {
        'auditId': 'AUD-028', 'phase': 'remediation', 'baselinePreserved': True,
        'findingsFixed': len(ids), 'sourceFingerprint': fingerprint,
        'sourceFiles': len(source), 'releaseAcceptance': False,
        'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'reportSha256': BASELINE.sha(report_path),
        'markdownSha256': BASELINE.sha(report_path.with_suffix('.md')),
    }
    (EVIDENCE / 'remediation-report-validation.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(validate(), indent=2))
