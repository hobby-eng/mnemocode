"""Sequential AUD-013 checks with a host memory reserve and bounded Node heaps."""

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
EVIDENCE = ROOT / "docs/audits/AUD-013-evidence"
GIB = 1024 ** 3
AVAILABLE_RESERVE = 2 * GIB
NODE_HEAP_MIB = 512
CHECK_TIMEOUT_SECONDS = 90
POLL_SECONDS = 0.25


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class MemoryGuard:
    """Observe other sessions too; stop only the process group owned by this check."""

    def __init__(self):
        self.samples = []
        self.peak_group_rss = 0

    def sample(self, group=None):
        memory = {
            line.split(":", 1)[0]: int(line.split()[1]) * 1024
            for line in Path("/proc/meminfo").read_text().splitlines()
        }
        sample = {"at": now(), "total": memory["MemTotal"],
                  "available": memory["MemAvailable"],
                  "swapUsed": memory["SwapTotal"] - memory["SwapFree"]}
        self.samples.append(sample)
        if group is not None:
            rss = 0
            for process in Path("/proc").iterdir():
                if not process.name.isdigit():
                    continue
                try:
                    fields = (process / "stat").read_text().rsplit(")", 1)[1].split()
                    if int(fields[2]) != group:
                        continue
                    for line in (process / "status").read_text().splitlines():
                        if line.startswith("VmRSS:"):
                            rss += int(line.split()[1]) * 1024
                except (OSError, ValueError, IndexError):
                    # A child can exit between the process list and its status read.
                    continue
            self.peak_group_rss = max(self.peak_group_rss, rss)
        return sample["available"] >= AVAILABLE_RESERVE

    @staticmethod
    def stop(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except ProcessLookupError:
            return
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


label, *command = sys.argv[1:]
assert label and command and all(character.isalnum() or character == "-" for character in label)
EVIDENCE.mkdir(exist_ok=True)
guard = MemoryGuard()
started = now()
environment = os.environ.copy()
environment["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + environment["PATH"]
environment["NODE_OPTIONS"] = f"--max-old-space-size={NODE_HEAP_MIB}"
log = EVIDENCE / (label + ".log")
reason = None
with log.open("wb") as output:
    if not guard.sample() or guard.samples[0]["available"] < AVAILABLE_RESERVE + NODE_HEAP_MIB * 1024 ** 2:
        output.write(b"Not run: insufficient free memory for the check and reserve.\n")
        code = 125
        reason = "insufficient-memory-before-start"
    else:
        process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + CHECK_TIMEOUT_SECONDS
        try:
            while process.poll() is None:
                if not guard.sample(process.pid):
                    reason = "host-memory-reserve-reached"
                    guard.stop(process)
                    break
                if time.monotonic() > deadline:
                    reason = "check-timeout"
                    guard.stop(process)
                    break
                time.sleep(POLL_SECONDS)
        except BaseException:
            guard.stop(process)
            raise
        code = process.wait()
guard.sample()
record = {"command": command, "cwd": str(ROOT), "startedAt": started, "endedAt": now(),
          "exitCode": code, "stopReason": reason, "nodeHeapMiB": NODE_HEAP_MIB,
          "reserveBytes": AVAILABLE_RESERVE, "timeoutSeconds": CHECK_TIMEOUT_SECONDS,
          "peakProcessGroupRssBytes": guard.peak_group_rss, "memorySamples": guard.samples,
          "minimumAvailableBytes": min(sample["available"] for sample in guard.samples),
          "logSha256": hashlib.sha256(log.read_bytes()).hexdigest()}
(EVIDENCE / (label + ".command.json")).write_text(json.dumps(record, indent=2) + "\n")
sys.stdout.buffer.write(log.read_bytes())
print(json.dumps({"label": label, "exitCode": code, "stopReason": reason,
                  "minimumAvailableGiB": round(record["minimumAvailableBytes"] / GIB, 2),
                  "peakProcessGroupRssMiB": round(guard.peak_group_rss / 1024 ** 2, 1)}))
raise SystemExit(code)
