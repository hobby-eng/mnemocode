"""AUD-019: source identity, environment and sequential, memory-bounded command evidence.

    python3 docs/audits/AUD-019-harnesses/audit.py environment
    python3 docs/audits/AUD-019-harnesses/audit.py snapshot LABEL
    python3 docs/audits/AUD-019-harnesses/audit.py check LABEL [--timeout SECONDS] COMMAND ...

Every record goes to the ignored docs/audits/AUD-019-evidence/ and is never overwritten. A check
writes LABEL.log (stdout and stderr) and LABEL.command.json (command, UTC start and end, exit code,
log SHA-256, host memory samples, source fingerprint before and after, changed files) and exits
with the command's exit code, or 124 when it was stopped.
"""

import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-019-evidence"
PROCEDURE = ROOT.parent / "multi-chain-wallet-tools/docs"
PROCEDURE_FILES = [
    "FULL_AUDIT_GUIDE.md",
    "audits/AUDIT_STANDARD.md",
    "audits/AUDIT_TEMPLATE.md",
    "audit-report.schema.json",
]
GIB = 1024**3
# Leave this much memory to the rest of the host; a check that would take it is stopped.
RESERVE_BYTES = int(1.2 * GIB)
NODE_HEAP_MIB = 1536
DEFAULT_TIMEOUT_SECONDS = 900
POLL_SECONDS = 0.25


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()


def source():
    """Every tracked or untracked, not ignored file outside docs/audits/, with its SHA-256."""
    names = set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0")) - {""}
    files = [
        {"path": name, "sha256": digest((ROOT / name).read_bytes())}
        for name in sorted(names)
        if not name.startswith("docs/audits/") and (ROOT / name).is_file()
    ]
    return {"files": files, "fingerprint": digest(json.dumps(files, separators=(",", ":")).encode())}


def memory():
    values = {
        line.split(":", 1)[0]: int(line.split()[1]) * 1024
        for line in Path("/proc/meminfo").read_text().splitlines()
    }
    return {"available": values["MemAvailable"], "total": values["MemTotal"]}


def write_new(name, value):
    with (EVIDENCE / name).open("x") as out:
        out.write(json.dumps(value, indent=2) + "\n")


def tool(argv):
    try:
        result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=30)
        return {"command": argv, "exitCode": result.returncode, "output": result.stdout.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": argv, "exitCode": None, "output": str(error)}


def environment():
    pins = json.loads((ROOT / "package.json").read_text())
    installed = {}
    for name in ["typescript", "vitest", "prettier", *pins["dependencies"]]:
        path = ROOT / "node_modules" / name / "package.json"
        installed[name] = json.loads(path.read_text())["version"] if path.exists() else None
    procedure = {name: digest((PROCEDURE / name).read_bytes()) for name in PROCEDURE_FILES}
    value = {
        "capturedAt": now(),
        "os": platform.platform(),
        "architecture": platform.machine(),
        "tools": [
            tool(["node", "--version"]),
            tool(["pnpm", "--version"]),
            tool(["python3", "--version"]),
            tool(["pdftoppm", "-v"]),
            tool(["docker", "--version"]),
        ],
        "packageManager": pins["packageManager"],
        "nodePin": (ROOT / ".node-version").read_text().strip(),
        "declaredDependencies": pins["dependencies"],
        "declaredDevDependencies": pins["devDependencies"],
        "installedPackages": installed,
        "lockfileSha256": digest((ROOT / "pnpm-lock.yaml").read_bytes()),
        "bridgeManifest": json.loads((ROOT / "sskr-wasm/integrity.json").read_text()),
        "procedureHashes": procedure,
        "memoryTotalBytes": memory()["total"],
    }
    write_new("environment.json", value)
    write_new("procedure-hashes.json", procedure)
    print(json.dumps({"procedureHashes": procedure, "installed": installed}, indent=2))


def snapshot(label):
    value = {
        "capturedAt": now(),
        "commit": git("rev-parse", "HEAD"),
        "branch": git("branch", "--show-current"),
        "workingTree": git("status", "--short"),
        "uncommittedDiffSha256": digest(subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=ROOT)),
        **source(),
    }
    write_new(f"{label}-snapshot.json", value)
    print(json.dumps({k: value[k] for k in ["commit", "fingerprint", "capturedAt"]}))


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def check(label, timeout, command):
    target = EVIDENCE / f"{label}.log"
    if target.exists():
        raise SystemExit("Choose a new label; recorded evidence is never overwritten")
    before = source()
    started = now()
    samples = [memory()]
    reason = None
    env = os.environ.copy()
    env["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + env["PATH"]
    env["NODE_OPTIONS"] = f"--max-old-space-size={NODE_HEAP_MIB}"
    with target.open("xb") as output:
        process = subprocess.Popen(
            command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True
        )
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                samples.append(memory())
                if samples[-1]["available"] < RESERVE_BYTES:
                    reason = "host-memory-reserve-reached"
                elif time.monotonic() > deadline:
                    reason = "command-timeout"
                if reason:
                    stop(process)
                    break
                time.sleep(POLL_SECONDS)
            code = process.wait() if reason is None else 124
        except BaseException:
            stop(process)
            raise
    samples.append(memory())
    after = source()
    old = {f["path"]: f["sha256"] for f in before["files"]}
    new = {f["path"]: f["sha256"] for f in after["files"]}
    record = {
        "command": command,
        "startedAt": started,
        "endedAt": now(),
        "exitCode": code,
        "stopReason": reason,
        "timeoutSeconds": timeout,
        "nodeHeapMiB": NODE_HEAP_MIB,
        "reserveBytes": RESERVE_BYTES,
        "minimumAvailableBytes": min(s["available"] for s in samples),
        "logSha256": digest(target.read_bytes()),
        "sourceBefore": before["fingerprint"],
        "sourceAfter": after["fingerprint"],
        "changedFiles": sorted(p for p in old.keys() | new.keys() if old.get(p) != new.get(p)),
    }
    write_new(f"{label}.command.json", record)
    summary = {k: record[k] for k in ["exitCode", "stopReason", "changedFiles"]}
    summary["label"] = label
    summary["minimumAvailableGiB"] = round(record["minimumAvailableBytes"] / GIB, 3)
    tail = target.read_bytes()[-3000:].decode("utf-8", "replace")
    print(tail)
    print(json.dumps(summary))
    return code


def main(argv):
    EVIDENCE.mkdir(exist_ok=True)
    if argv[:1] == ["environment"]:
        return environment()
    if len(argv) < 2 or not all(c.isalnum() or c == "-" for c in argv[1]):
        raise SystemExit(__doc__)
    mode, label, *rest = argv
    if mode == "snapshot":
        return snapshot(label)
    timeout = DEFAULT_TIMEOUT_SECONDS
    if rest[:1] == ["--timeout"]:
        timeout, rest = int(rest[1]), rest[2:]
    if mode == "check" and rest:
        return check(label, timeout, rest)
    raise SystemExit(__doc__)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]) or 0)
