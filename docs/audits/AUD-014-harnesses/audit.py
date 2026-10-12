"""AUD-014: source identity and sequential, memory-bounded audit command evidence."""

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
EVIDENCE = ROOT / "docs/audits/AUD-014-evidence"
GIB = 1024**3
RESERVE = 3 * GIB
NODE_HEAP_MIB = 768
TIMEOUT_SECONDS = 120
POLL_SECONDS = 0.25


class AuditRun:
    """Own only audit evidence; never modify implementation files or other processes."""

    def __init__(self):
        EVIDENCE.mkdir(exist_ok=True)

    @staticmethod
    def now():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    @staticmethod
    def digest(data):
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()

    def source(self):
        paths = set(self.git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))
        files = []
        for name in sorted(paths - {""}):
            path = ROOT / name
            if name.startswith("docs/audits/") or not path.is_file():
                continue
            files.append({"path": name, "sha256": self.digest(path.read_bytes())})
        return {"files": files, "fingerprint": self.digest(
            json.dumps(files, separators=(",", ":")).encode())}

    def snapshot(self, label):
        value = {"capturedAt": self.now(), "commit": self.git("rev-parse", "HEAD"),
                 "branch": self.git("branch", "--show-current"),
                 "repository": self.git("remote", "get-url", "origin"),
                 "workingTree": self.git("status", "--short"), **self.source()}
        with (EVIDENCE / f"{label}-snapshot.json").open("x") as out:
            out.write(json.dumps(value, indent=2) + "\n")
        print(json.dumps({key: value[key] for key in ["commit", "fingerprint", "capturedAt"]}))

    @staticmethod
    def memory():
        values = {line.split(":", 1)[0]: int(line.split()[1]) * 1024
                  for line in Path("/proc/meminfo").read_text().splitlines()}
        return {"available": values["MemAvailable"], "total": values["MemTotal"],
                "swapUsed": values["SwapTotal"] - values["SwapFree"]}

    @staticmethod
    def stop(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()

    def check(self, label, command):
        target = EVIDENCE / f"{label}.log"
        if target.exists():
            raise SystemExit("Choose a new label; original evidence is never overwritten")
        before = self.source()
        started = self.now()
        samples = [self.memory()]
        reason = None
        environment = os.environ.copy()
        environment["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + environment["PATH"]
        environment["NODE_OPTIONS"] = f"--max-old-space-size={NODE_HEAP_MIB}"
        with target.open("xb") as output:
            if samples[0]["available"] < RESERVE + GIB:
                reason, code = "insufficient-host-memory-before-start", 125
                output.write(b"Not run: host memory reserve unavailable.\n")
            else:
                process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=output,
                                           stderr=subprocess.STDOUT, start_new_session=True)
                deadline = time.monotonic() + TIMEOUT_SECONDS
                try:
                    while process.poll() is None:
                        samples.append(self.memory())
                        if samples[-1]["available"] < RESERVE:
                            reason = "host-memory-reserve-reached"
                        elif time.monotonic() > deadline:
                            reason = "command-timeout"
                        if reason:
                            self.stop(process)
                            break
                        time.sleep(POLL_SECONDS)
                    code = process.wait()
                except BaseException:
                    self.stop(process)
                    raise
        samples.append(self.memory())
        after = self.source()
        a = {x["path"]: x["sha256"] for x in before["files"]}
        b = {x["path"]: x["sha256"] for x in after["files"]}
        record = {"command": command, "cwd": str(ROOT), "startedAt": started,
                  "endedAt": self.now(), "exitCode": code, "stopReason": reason,
                  "logSha256": self.digest(target.read_bytes()), "nodeHeapMiB": NODE_HEAP_MIB,
                  "reserveBytes": RESERVE, "timeoutSeconds": TIMEOUT_SECONDS,
                  "memorySamples": samples,
                  "minimumAvailableBytes": min(x["available"] for x in samples),
                  "sourceBefore": before["fingerprint"], "sourceAfter": after["fingerprint"],
                  "changedFiles": sorted(p for p in a.keys() | b.keys() if a.get(p) != b.get(p))}
        (EVIDENCE / f"{label}.command.json").write_text(json.dumps(record, indent=2) + "\n")
        sys.stdout.buffer.write(target.read_bytes())
        print(json.dumps({"label": label, "exitCode": code, "stopReason": reason,
                          "minimumAvailableGiB": round(record["minimumAvailableBytes"] / GIB, 3),
                          "changedFiles": record["changedFiles"]}))
        return code


mode, label, *command = sys.argv[1:]
if not label or not all(c.isalnum() or c == "-" for c in label):
    raise SystemExit("Use a short alphanumeric/hyphen label")
run = AuditRun()
if mode == "snapshot":
    run.snapshot(label)
elif mode == "check" and command:
    raise SystemExit(run.check(label, command))
else:
    raise SystemExit("Usage: audit.py snapshot LABEL | check LABEL COMMAND [ARGUMENTS]")
