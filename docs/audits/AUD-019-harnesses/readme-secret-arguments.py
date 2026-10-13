"""AUD-019 remediation: every README example with --ask-secrets is accepted up to its secret prompt.

    python3 docs/audits/AUD-019-harnesses/readme-secret-arguments.py [README.md]

Needs a fresh `pnpm build`. Runs each README command that has --ask-secrets as `node
dist/mnemocode.js` with standard input from /dev/null, in a temporary folder, so that it stops at
the private screen's terminal check instead of asking. A command whose options are accepted ends
with the refusal TERMINAL_REFUSAL; any other message means the example itself is refused
(AUD-019-DOC001). Nothing is asked and nothing is written. Prints one JSON line per command and
exits 1 when one is refused for another reason.
"""

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
CLI = ROOT / "dist/mnemocode.js"
TERMINAL_REFUSAL = "--ask-secrets needs a terminal"

spec = importlib.util.spec_from_file_location("readme_examples", HERE / "readme-examples.py")
examples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(examples)


def main():
    readme = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "README.md"
    blocks = re.findall(r"```bash\n(.*?)```", readme.read_text(), re.S)
    refused = 0
    scratch = ROOT.parent / "tmp/mnemocode"
    scratch.mkdir(parents=True, exist_ok=True)
    for number, block in enumerate(blocks):
        for line in examples.commands(block):
            if not line.startswith("mnemocode ") or "--ask-secrets" not in line:
                continue
            with tempfile.TemporaryDirectory(prefix="aud018-secret-args-", dir=scratch) as folder:
                run = subprocess.run(
                    ["bash", "-c", f'mnemocode() {{ node "{CLI}" "$@"; }}\n{line}'],
                    cwd=folder, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=120,
                )
            output = (run.stdout + run.stderr).strip()
            accepted = run.returncode != 0 and TERMINAL_REFUSAL in output
            refused += not accepted
            print(json.dumps({"block": number, "command": line, "accepted": accepted,
                              "output": output[-300:]}))
    print(json.dumps({"refused": refused}))
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
