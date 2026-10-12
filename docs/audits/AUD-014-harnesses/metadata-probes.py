"""AUD-014: inspect local integrity, package targets and current documentation links."""

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
checks = []
manifest = json.loads((ROOT / "sskr-wasm/integrity.json").read_text())
for name, expected in manifest.items():
    observed = hashlib.sha256((ROOT / "sskr-wasm" / name).read_bytes()).hexdigest()
    checks.append({"name": f"SSKR integrity {name}", "passed": observed == expected,
                   "expected": expected, "observed": observed})
package = json.loads((ROOT / "package.json").read_text())
for entry, targets in package["exports"].items():
    for kind, path in targets.items():
        checks.append({"name": f"package export {entry} ({kind})", "passed": (ROOT / path).is_file(),
                       "target": path})
documents = [ROOT / "README.md", ROOT / "SECURITY.md", ROOT / "THIRD_PARTY_NOTICES.md",
             *sorted((ROOT / "docs").glob("*.md"))]
missing = []
for document in documents:
    for target in re.findall(r"\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)", document.read_text()):
        if re.match(r"[a-zA-Z][a-zA-Z+.-]*:", target) or target.startswith("#"):
            continue
        local = target.split("#", 1)[0]
        if local and not (document.parent / local).exists():
            missing.append({"document": str(document.relative_to(ROOT)), "target": target})
checks.append({"name": "current documentation relative file links", "passed": not missing,
               "documents": len(documents), "missing": missing,
               "limit": "Anchors, web reachability and frozen historical audit links not checked here"})
print(json.dumps({"checks": checks}, indent=2))
if any(not check["passed"] for check in checks):
    raise SystemExit(1)
