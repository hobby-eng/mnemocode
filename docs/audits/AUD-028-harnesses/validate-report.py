"""Validate AUD-028 records, source/artifact bindings and local evidence without product execution."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import resource
import subprocess
import sys
import traceback

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-028-evidence'
REPORT = ROOT / 'docs/audits/AUD-028-2026-10-15.json'
SCHEMA = ROOT.parent / 'multi-chain-wallet-tools/docs/audit-report.schema.json'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while data := source.read(1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON object key: ' + key)
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def validate():
    report = read_json(REPORT)
    schema = read_json(SCHEMA)
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.Draft202012Validator(schema).validate(report)
    markdown = REPORT.with_suffix('.md').read_text()
    ids = [row['id'] for row in report['findings']]
    assert len(ids) == len(set(ids))
    headings = re.findall(r'^#### (AUD-\d+-(?:SEC|FUN|API|BLD|DOC|UI|ARC)\d+) —', markdown, re.M)
    assert headings == ids
    for row in report['findings']:
        expected = f"#### {row['id']} — {row['severity'].title()} — {row['title']}"
        assert expected in markdown
        assert row['status'] == 'open'
    assert len(report['checks']) == 32
    assert len({row['checkId'] for row in report['checks']}) == 32
    assert report['testSummary'] == {
        'passed': 1220, 'failed': 15, 'skippedBySelection': 131, 'selectedFiles': 80,
        'unhandledRejections': 2,
        'nonoverlap': 'All executed Vitest file/name groups are disjoint. Do not add retained/host counts to these totals.',
        'fullSuite': False,
    }
    assert len(report['findings']) == 17
    assert sum(row['releaseBlocking'] for row in report['findings']) == 6
    snapshot = read_json(EVIDENCE / 'snapshot.json')
    changed = []
    for row in snapshot['files']:
        path = ROOT / row['path']
        if not path.is_file() or sha(path) != row['sha256']:
            changed.append(row['path'])
    assert set(changed) <= {'docs/audits/README.md'}, changed
    names = set(subprocess.check_output(
        ['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT,
    ).decode().split('\0')) - {''}
    source = [{'path': name, 'sha256': sha(ROOT / name)} for name in sorted(names)
              if not name.startswith('docs/audits/') and (ROOT / name).is_file()]
    fingerprint = hashlib.sha256(json.dumps(source, separators=(',', ':')).encode()).hexdigest()
    assert fingerprint == report['snapshot']['sourceFingerprint'] == snapshot['sourceFingerprint']
    for row in read_json(EVIDENCE / 'artifacts-before.json'):
        if row['path'].startswith('release/'):
            assert sha(ROOT / row['path']) == row['sha256']
    commands = []
    for row in report['executions']:
        label = row['label']
        path = EVIDENCE / (label + '.command.json')
        record = read_json(path)
        assert sha(path) == row['recordSha256']
        assert sha(EVIDENCE / (label + '.log')) == record['logSha256'] == row['logSha256']
        assert record['sourceBefore'] == record['sourceAfter'] == fingerprint
        assert record['exitCode'] == row['exitCode']
        commands.append(label)
    totals = {key: sum(row.get('testCounts', {}).get(key, 0) for row in report['executions'])
              for key in ('passed', 'failed', 'skipped', 'files')}
    assert totals == {'passed': 1220, 'failed': 15, 'skipped': 131, 'files': 80}, totals
    selected = []
    for row in report['executions']:
        if 'testCounts' not in row:
            continue
        selected.extend(arg for arg in row['command'] if arg.startswith('test/') and arg.endswith('.test.ts'))
    assert len(selected) == len(set(selected)) == 80
    published = [REPORT, REPORT.with_suffix('.md'), *sorted((ROOT / 'docs/audits/AUD-028-harnesses').glob('*'))]
    owner = Path.home().name.lower()
    for path in published:
        if not path.is_file():
            continue
        text = path.read_text()
        assert owner not in text.lower() if owner not in ('root', 'runner', 'user') else True
        timestamps = re.findall(
            r'\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})',
            text,
        )
        assert all(offset in ('Z', '+00:00', '+0000') for offset in timestamps)
        if path.suffix == '.md':
            assert 'UTC' in text
            for target in re.findall(r'\]\(([^)]+)\)', text):
                if re.match(r'[a-z][a-z0-9+.-]*:', target, re.I):
                    continue
                file = target.split('#', 1)[0]
                assert not file or (path.parent / file).exists(), (path.name, target)
    staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '-z'], cwd=ROOT).decode()
    assert not re.search(r'(?:^|\0)docs/audits/[^\0]*-evidence/', staged)
    assert subprocess.run(['git', 'check-ignore', '-q', str(EVIDENCE / 'snapshot.json')], cwd=ROOT).returncode == 0
    return {
        'schema': True, 'duplicateJsonKeysAbsent': True, 'markdownJsonFindingsAgree': True,
        'checklistItems': 32, 'findingCount': 17, 'releaseBlockers': 6,
        'testTotals': totals, 'nonoverlappingSelectedFiles': len(selected),
        'sourceFingerprint': fingerprint, 'baselineChanges': changed,
        'nativeArtifactUnchanged': True, 'commandLogBindings': len(commands),
        'newReportLinksResolve': True, 'reportPrivacyUtc': True,
        'evidenceIgnoredAndNotStaged': True,
        'markdownSha256': sha(REPORT.with_suffix('.md')), 'jsonSha256': sha(REPORT),
    }


if __name__ == '__main__':
    label = sys.argv[1] if len(sys.argv) > 1 else 'report-validation-final'
    assert re.fullmatch(r'[a-z0-9-]+', label)
    started = now()
    output = EVIDENCE / (label + '.log')
    assert not output.exists(), 'Use a fresh validation label.'
    try:
        result, code = validate(), 0
    except Exception as error:
        result, code = {'validationError': str(error), 'errorType': type(error).__name__,
                        'localTraceback': traceback.format_exc()}, 1
    result.update(startedAtUtc=started, endedAtUtc=now(), exitCode=code,
                  pythonMaximumRssKiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    rendered = json.dumps(result, indent=2) + '\n'
    output.write_text(rendered)
    (EVIDENCE / 'report-validation.json').write_text(rendered)
    record = {'command': ['python3', '-B', 'docs/audits/AUD-028-harnesses/validate-report.py', label],
              'startedAtUtc': started, 'endedAtUtc': result['endedAtUtc'], 'exitCode': code,
              'logSha256': sha(output), 'validatorSha256': sha(Path(__file__).resolve())}
    (EVIDENCE / (label + '.command.json')).write_text(json.dumps(record, indent=2) + '\n')
    checksums = [f'{sha(path)}  {path.relative_to(EVIDENCE)}' for path in sorted(EVIDENCE.rglob('*'))
                 if path.is_file() and path.name != 'SHA256SUMS']
    (EVIDENCE / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    print(rendered, end='')
    raise SystemExit(code)
