#!/usr/bin/env python3
"""AUD-008: interrupt real date recovery on a PTY; kill its process group within 3 seconds."""

import errno
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import subprocess
import time


def main():
    flags = json.loads(Path("src/cli/protection-flags.json").read_text())
    master, slave = pty.openpty()
    # Public zero entropy, used as an arbitrary checksum-valid shifted phrase.
    phrase = "abandon " * 11 + "about"
    command = [str(Path.home() / ".local/bin/node"), *flags, "dist/mnemocode.js", "recover-date",
               "--mode", "seedshift", "--format", "english", "--input", phrase,
               "--date", "01-01-????", "--master-fingerprint", "deadbeef",
               "--max-candidates", "10000", "--progress-every", "1"]
    started = time.monotonic()
    child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                             env={**os.environ, "TERM": "xterm", "NO_COLOR": "1"},
                             start_new_session=True)
    os.close(slave)
    transcript = bytearray()
    interrupted = None
    progressed_after_signal = 0
    forced = False
    try:
        while time.monotonic() - started < 2.6:
            ready, _, _ = select.select([master], [], [], 0.02)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                transcript.extend(chunk)
            counts = [int(n) for n in re.findall(rb"Checked (\d+)/9999 date combinations", transcript)]
            if interrupted is None and counts:
                interrupted = time.monotonic()
                os.kill(child.pid, signal.SIGINT)
                at_signal = counts[-1]
            elif interrupted is not None:
                progressed_after_signal = (counts[-1] - at_signal) if counts else 0
                if child.poll() is not None:
                    break
                if time.monotonic() - interrupted >= 0.75:
                    forced = True
                    break
        if child.poll() is None:
            forced = True
            os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=0.2)
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=0.2)
        os.close(master)
    report = {
        "privateScreenEntered": b"\x1b[?1049h" in transcript,
        "sigintSent": interrupted is not None,
        "candidatesAfterSigint": progressed_after_signal,
        "privateScreenLeft": b"\x1b[?1049l" in transcript,
        "forcedKill": forced,
        "returnCode": child.returncode,
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "transcriptBytes": len(transcript),
    }
    print(json.dumps(report, sort_keys=True))
    passed = report["sigintSent"] and child.returncode == 130 and not forced and report["privateScreenLeft"]
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
