"""Refuse a timed-out child even if its SIGTERM handler exits successfully."""
import importlib.util
import json
import sys
from pathlib import Path

if not __debug__:
    raise SystemExit("Run this check without Python optimization.")

SPEC = importlib.util.spec_from_file_location(
    "release_runner", Path(__file__).with_name("run.py")
)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)
RUNNER.GATE.TIMEOUT = 1

if __name__ == "__main__":
    label, = sys.argv[1:]
    code = RUNNER.run(label, [
        sys.executable, "-c",
        "import signal,time; "
        "signal.signal(signal.SIGTERM, lambda *_: exit(0)); "
        "time.sleep(30)",
    ])
    receipt = RUNNER.GATE.EVIDENCE / f"{label}.command.json"
    record = json.loads(receipt.read_text())
    assert record["stopReason"] == "timeout", record["stopReason"]
    assert record["exitCode"] == 0, record["exitCode"]
    assert code != 0, "A monitor stop must fail even with a zero child status."
    assert record["wrapperExitCode"] == code
    assert len(record["wrapperSha256"]) == 64
    print("PASS: timeout remains a failure when the child exits zero.")
