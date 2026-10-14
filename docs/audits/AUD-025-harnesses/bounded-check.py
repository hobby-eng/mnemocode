"""Run one targeted check with measured RSS and a 3 GiB host-memory reserve.

Node heap profiles and whole-command RSS budgets are selected by the documented environment
variables; the defaults are 128 and 384 MiB. Samples are not kernel-enforced memory limits.
The runner stops only its own process group and retains failed/interrupted attempts unchanged.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-025-evidence"
EVIDENCE.mkdir(exist_ok=True)
RESERVE = 3 * 1024**3
RSS_MIB = int(os.environ.get("MNEMOCODE_CHECK_RSS_MIB", "384"))
if RSS_MIB not in (256, 384, 512, 768, 1024):
    raise SystemExit("Use a documented RSS profile: 256, 384, 512, 768 or 1024 MiB.")
RSS_BUDGET = RSS_MIB * 1024**2
START_HEADROOM = min(RSS_BUDGET, 512 * 1024**2)
NODE_HEAP_MIB = int(os.environ.get("MNEMOCODE_NODE_HEAP_MIB", "128"))
if NODE_HEAP_MIB not in (128, 256, 384, 512, 768):
    raise SystemExit("Use a documented Node heap profile.")
TIMEOUT = 120


def memory():
    values = {line.split(":", 1)[0]: int(line.split()[1]) * 1024
              for line in Path("/proc/meminfo").read_text().splitlines()}
    return values["MemAvailable"]


def process_rss(group):
    processes = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
            processes[int(path.name)] = (int(fields[1]), int(fields[2]),
                                         int(fields[21]) * os.sysconf("SC_PAGE_SIZE"))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    owned = {group}
    while True:
        found = {pid for pid, (parent, process_group, _) in processes.items()
                 if parent in owned or process_group == group}
        if found <= owned:
            break
        owned |= found
    return sum(rss for pid, (_, _, rss) in processes.items() if pid in owned)


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=2)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run(label, command):
    log = EVIDENCE / f"{label}.log"
    if log.exists():
        raise SystemExit("Choose a new evidence label.")
    recorder = runpy.run_path(str(ROOT / "docs/audits/AUD-021-harnesses/run.py"))["recorder"]()
    before = recorder.source()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    samples = [{"available": memory(), "processRss": 0}]
    reason = None
    environment = dict(os.environ, NODE_OPTIONS=f"--max-old-space-size={NODE_HEAP_MIB}",
                       GOMEMLIMIT="128MiB", TZ="UTC")
    with log.open("xb") as output:
        if samples[0]["available"] < RESERVE + START_HEADROOM:
            reason, code = "insufficient-host-memory-before-start", 125
            output.write(b"Not run: the small-check RSS budget is unavailable.\n")
        else:
            process = subprocess.Popen(command, cwd=ROOT, env=environment,
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + TIMEOUT
            try:
                while process.poll() is None:
                    sample = {"available": memory(), "processRss": process_rss(process.pid)}
                    samples.append(sample)
                    if sample["available"] < RESERVE:
                        reason = "host-memory-reserve-reached"
                    elif sample["processRss"] > RSS_BUDGET:
                        reason = "process-rss-budget-reached"
                    elif time.monotonic() > deadline:
                        reason = "command-timeout"
                    if reason:
                        stop(process)
                        break
                    time.sleep(0.1)
                code = process.wait()
            except BaseException:
                stop(process)
                raise
    after = recorder.source()
    record = {"command": command, "startedAt": started,
              "endedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "exitCode": code, "stopReason": reason,
              "nodeHeapMiB": NODE_HEAP_MIB, "reserveBytes": RESERVE,
              "rssBudgetBytes": RSS_BUDGET, "timeoutSeconds": TIMEOUT,
              "startHeadroomBytes": START_HEADROOM,
              "minimumAvailableBytes": min(s["available"] for s in samples),
              "peakProcessRssBytes": max(s["processRss"] for s in samples),
              "memorySamples": samples, "sourceBefore": before["fingerprint"],
              "sourceAfter": after["fingerprint"],
              "logSha256": hashlib.sha256(log.read_bytes()).hexdigest(),
              "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (EVIDENCE / f"{label}.command.json").write_text(json.dumps(record, indent=2) + "\n")
    sys.stdout.buffer.write(log.read_bytes())
    print(json.dumps({"label": label, "exitCode": code, "stopReason": reason,
                      "minimumAvailableGiB": round(record["minimumAvailableBytes"] / 1024**3, 3),
                      "peakProcessRssMiB": round(record["peakProcessRssBytes"] / 1024**2, 1)}))
    return code


label, *command = sys.argv[1:]
if not label or not all(char.isalnum() or char == "-" for char in label) or not command:
    raise SystemExit("Use check-small.py LABEL COMMAND [ARGUMENTS].")
raise SystemExit(run(label, command))
