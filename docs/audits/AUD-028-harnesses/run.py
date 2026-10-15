"""AUD-028: reuse the retained Linux process/memory guard without copying its implementation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / 'docs/audits/AUD-026-harnesses/audit.py'
SPEC = importlib.util.spec_from_file_location('aud028_memory_guard', GUARD)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.EVIDENCE = ROOT / 'docs/audits/AUD-028-evidence'
MODULE.EVIDENCE.mkdir(exist_ok=True)

if __name__ == '__main__':
    label, *command = sys.argv[1:]
    if not label or not all(c.isalnum() or c == '-' for c in label) or not command:
        raise SystemExit('Use run.py LABEL COMMAND [ARGUMENTS].')
    code = MODULE.check(label, command)
    record_path = MODULE.EVIDENCE / f'{label}.command.json'
    record = json.loads(record_path.read_text())
    record['auditId'] = 'AUD-028'
    record['wrapperSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    raise SystemExit(code)
