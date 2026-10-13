"""AUD-019: the SSKR engine's files against sskr-wasm/integrity.json (part of CHECK-BLD-004).

    python3 docs/audits/AUD-019-harnesses/sskr-manifest.py

Compares the SHA-256 of every file that the manifest names, and checks that the manifest names
every file of sskr-wasm/generated/ and the Rust source. This is the local freshness gate only; it
does not rebuild the engine in Docker (pnpm verify:sskr), so it cannot show that the source gives
these bytes. Exits 1 on a mismatch, a missing file or an unlisted one.
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = ROOT / "sskr-wasm"


def main():
    manifest = json.loads((BRIDGE / "integrity.json").read_text())
    problems = []
    for name, expected in manifest.items():
        path = BRIDGE / name
        if not path.is_file():
            problems.append({"file": name, "problem": "missing"})
        elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            problems.append({"file": name, "problem": "hash differs"})
    present = {
        str(p.relative_to(BRIDGE))
        for folder in ["generated", "rust/src"]
        for p in (BRIDGE / folder).rglob("*")
        if p.is_file()
    }
    for name in sorted(present - set(manifest)):
        problems.append({"file": name, "problem": "not in the manifest"})
    for problem in problems:
        print(json.dumps(problem))
    print(json.dumps({"listed": len(manifest), "problems": len(problems)}))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
