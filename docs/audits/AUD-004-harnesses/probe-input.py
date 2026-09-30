"""Bounded public-data reproduction of the file-size guard; never uses an infinite device."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

ROOT = Path.cwd()
payload = b'abandon ' * 11 + b'about' + b' ' * (2 * 1024 * 1024)
with tempfile.TemporaryDirectory(prefix='mnemocode-audit-input-') as temporary:
    regular = Path(temporary) / 'regular.txt'
    fifo = Path(temporary) / 'input.fifo'
    regular.write_bytes(payload)
    os.mkfifo(fifo, 0o600)
    command = ['node', 'dist/mnemocode.js', 'encode', '--mode', 'direct', '--format', '1', '--mnemonic-file']
    control = subprocess.run(command + [str(regular)], capture_output=True, text=True, timeout=20)
    def write_fifo():
        try:
            with fifo.open('wb') as stream:
                stream.write(payload)
        except BrokenPipeError:
            pass
    writer = threading.Thread(target=write_fifo, daemon=True)
    writer.start()
    probe = subprocess.run(command + [str(fifo)], capture_output=True, text=True, timeout=20)
    writer.join(5)
    result = {'bytes': len(payload), 'fifoStatSize': fifo.stat().st_size,
              'regularExit': control.returncode, 'regularError': control.stderr.strip(),
              'fifoExit': probe.returncode, 'fifoAccepted': 'abandon abandon' in probe.stdout}
    print(json.dumps(result, indent=2))
    assert control.returncode != 0 and '1 MiB' in control.stderr
    assert probe.returncode == 0 and result['fifoAccepted'], 'Reviewed defect no longer reproduces'
