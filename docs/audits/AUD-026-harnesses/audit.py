"""Sequential audit checks with exact source identities and sampled Linux memory bounds."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-026-evidence'
RESERVE = 3 * 1024**3
RSS_BUDGET = int(os.environ.get('AUD026_RSS_MIB', '1024')) * 1024**2
HEAP_MIB = int(os.environ.get('AUD026_HEAP_MIB', '256'))
TIMEOUT = int(os.environ.get('AUD026_TIMEOUT_SECONDS', '300'))
assert 256 * 1024**2 <= RSS_BUDGET <= 2 * 1024**3
assert 128 <= HEAP_MIB <= 768 and 1 <= TIMEOUT <= 600
EVIDENCE.mkdir(exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def source():
    names = set(subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    rows = [{'path': name, 'sha256': sha((ROOT / name).read_bytes())}
            for name in sorted(names) if not name.startswith('docs/audits/') and (ROOT / name).is_file()]
    return {'files': rows, 'fingerprint': sha(json.dumps(rows, separators=(',', ':')).encode())}


def processes():
    result = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            result[int(path.name)] = (int(fields[1]), int(fields[2]), int(fields[19]),
                                      int(fields[21]) * os.sysconf('SC_PAGE_SIZE'))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


def descendants(pid, table):
    selected = {pid}
    while True:
        found = {child for child, (parent, group, _, _) in table.items()
                 if parent in selected or group == pid}
        if found <= selected:
            return {child: table[child] for child in selected if child in table}
        selected |= found


def available():
    return next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()
                if line.startswith('MemAvailable:'))


def terminate(process, known):
    known.update(descendants(process.pid, processes()))
    for action in (signal.SIGTERM, signal.SIGKILL):
        current = processes()
        for pid, (_, _, started, _) in known.items():
            if pid in current and current[pid][2] == started:
                try:
                    os.kill(pid, action)
                except ProcessLookupError:
                    pass
        try:
            os.killpg(process.pid, action)
        except ProcessLookupError:
            pass
        if action == signal.SIGTERM:
            time.sleep(0.5)
    process.wait()


def check(label, command):
    log = EVIDENCE / f'{label}.log'
    if log.exists():
        raise SystemExit('Choose a fresh evidence label; records are immutable.')
    before = source()
    started = now()
    samples = [{'available': available(), 'processRss': 0}]
    reason = None
    env = dict(os.environ, TZ='UTC', NODE_OPTIONS=f'--max-old-space-size={HEAP_MIB}', GOMEMLIMIT='128MiB')
    with log.open('xb') as output:
        if samples[0]['available'] < RESERVE + min(RSS_BUDGET, 1024**3):
            code, reason = 125, 'insufficient-memory-before-start'
            output.write(b'Not run: preserve the host memory reserve.\n')
        else:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            known = {}
            deadline = time.monotonic() + TIMEOUT
            try:
                while process.poll() is None:
                    children = descendants(process.pid, processes())
                    known.update(children)
                    sample = {'available': available(), 'processRss': sum(row[3] for row in children.values())}
                    samples.append(sample)
                    if sample['available'] < RESERVE:
                        reason = 'host-memory-reserve-reached'
                    elif sample['processRss'] > RSS_BUDGET:
                        reason = 'process-rss-budget-reached'
                    elif time.monotonic() >= deadline:
                        reason = 'timeout'
                    if reason:
                        terminate(process, known)
                        break
                    time.sleep(0.2)
                code = process.wait()
            except BaseException:
                terminate(process, known)
                raise
    after = source()
    record = {'command': command, 'startedAtUtc': started, 'endedAtUtc': now(), 'exitCode': code,
              'stopReason': reason, 'nodeHeapMiB': HEAP_MIB, 'rssBudgetBytes': RSS_BUDGET,
              'reserveBytes': RESERVE, 'timeoutSeconds': TIMEOUT,
              'sourceBefore': before['fingerprint'], 'sourceAfter': after['fingerprint'],
              'changedFiles': [row['path'] for row in after['files'] if row not in before['files']],
              'minimumAvailableBytes': min(row['available'] for row in samples),
              'peakProcessRssBytes': max(row['processRss'] for row in samples), 'memorySamples': samples,
              'logSha256': sha(log.read_bytes()), 'runnerSha256': sha(Path(__file__).read_bytes())}
    (EVIDENCE / f'{label}.command.json').write_text(json.dumps(record, indent=2) + '\n')
    print(log.read_text(errors='replace'), end='')
    print(json.dumps({key: record[key] for key in ('exitCode', 'stopReason', 'peakProcessRssBytes', 'minimumAvailableBytes')}))
    return code


if __name__ == '__main__':
    label, *command = sys.argv[1:]
    if not label or not all(c.isalnum() or c == '-' for c in label) or not command:
        raise SystemExit('Use audit.py LABEL COMMAND [ARGUMENTS].')
    raise SystemExit(check(label, command))
