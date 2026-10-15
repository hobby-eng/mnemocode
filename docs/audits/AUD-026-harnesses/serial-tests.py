"""One admitted test file per guarded process; no shared worker/cache across files."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/audits/AUD-026-evidence'
plan = json.loads((EVIDENCE / 'test-execution-plan.json').read_text())
rows = [row for row in plan if row['execution'] == 'serial-light-batch']
results = []
for index, row in enumerate(rows, 1):
    label = 'file-' + Path(row['path']).name.removesuffix('.test.ts')
    environment = dict(os.environ, AUD026_TIMEOUT_SECONDS='180')
    run = subprocess.run(['python3', '-B', 'docs/audits/AUD-026-harnesses/audit.py', label,
                          'node', 'node_modules/vitest/vitest.mjs', 'run', row['path'],
                          '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=dot'],
                         cwd=ROOT, env=environment, capture_output=True, text=True)
    record_path = EVIDENCE / f'{label}.command.json'
    if not record_path.exists():
        print(run.stdout + run.stderr, flush=True)
        raise SystemExit('Runner failed without an evidence record.')
    record = json.loads(record_path.read_text())
    results.append({'path': row['path'], 'label': label, 'exitCode': record['exitCode'],
                    'stopReason': record['stopReason'], 'logSha256': record['logSha256']})
    print(f'{index}/{len(rows)} {row["path"]}: exit {record["exitCode"]}; {record["stopReason"] or "completed"}', flush=True)
    (EVIDENCE / 'serial-tests-progress.json').write_text(json.dumps(results, indent=2) + '\n')
    if record['stopReason']:
        raise SystemExit('Stopped at the memory/time boundary; investigate before continuing.')
raise SystemExit(1 if any(row['exitCode'] != 0 for row in results) else 0)
