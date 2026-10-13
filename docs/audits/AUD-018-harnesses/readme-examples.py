"""AUD-018: runs the README's command examples that need no secret prompt and draw no PDF.

    python3 docs/audits/AUD-018-harnesses/readme-examples.py [README.md]

Needs a fresh `pnpm build` (dist/mnemocode.js). Each fenced bash block is read in order: a
variable assignment applies to the commands after it in the same block, and a command continued
with "\\" is joined. A `mnemocode` command runs as `node dist/mnemocode.js` in one temporary folder
per block, so that a file one example writes is there for the next. Skipped, and listed as such:
commands with --ask-secrets (they wait for the private screen), --pdf or --cards-dir (PDF
rendering, not run in this audit), and commands of the release executable. Public test data only:
the README's own examples. Prints one JSON line per command and exits 1 when one fails.
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "dist/mnemocode.js"
SKIPPED = ("--ask-secrets", "--pdf", "--cards-dir", "mnemocode-0.", "--help")
TIMEOUT_SECONDS = 300


def commands(block):
    """The logical lines of a block: comments dropped, continuations joined."""
    lines, current = [], ""
    for raw in block.splitlines():
        line = raw.rstrip()
        if not current and (not line.strip() or line.lstrip().startswith("#")):
            continue
        if line.endswith("\\"):
            current += line[:-1] + " "
            continue
        lines.append(current + line)
        current = ""
    return lines


def main():
    readme = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "README.md"
    blocks = re.findall(r"```bash\n(.*?)```", readme.read_text(), re.S)
    failed = 0
    scratch = ROOT.parent / "tmp/mnemocode"
    scratch.mkdir(parents=True, exist_ok=True)
    for number, block in enumerate(blocks):
        with tempfile.TemporaryDirectory(prefix="aud018-readme-", dir=scratch) as folder:
            assignments = []
            for line in commands(block):
                if re.match(r"^[A-Z_]+=", line):
                    assignments.append(line)
                    continue
                if not line.startswith("mnemocode "):
                    continue
                result = {"block": number, "command": line}
                if any(marker in line for marker in SKIPPED):
                    result["outcome"] = "skipped"
                else:
                    script = "\n".join(
                        [f'mnemocode() {{ node "{CLI}" "$@"; }}', *assignments, line]
                    )
                    try:
                        run = subprocess.run(
                            ["bash", "-c", script],
                            cwd=folder,
                            capture_output=True,
                            text=True,
                            stdin=subprocess.DEVNULL,
                            timeout=TIMEOUT_SECONDS,
                        )
                        result["exitCode"] = run.returncode
                        result["outcome"] = "passed" if run.returncode == 0 else "failed"
                        result["output"] = (run.stdout + run.stderr)[-400:]
                    except subprocess.TimeoutExpired:
                        result["outcome"] = "failed"
                        result["output"] = f"timeout after {TIMEOUT_SECONDS} s"
                    failed += result["outcome"] == "failed"
                print(json.dumps(result))
    print(json.dumps({"failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
