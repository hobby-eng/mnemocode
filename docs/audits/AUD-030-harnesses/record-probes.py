"""Check historical replay metadata without executing, copying or changing old harnesses."""
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[3]
ROWS = []


def check(name, actual, expected):
    ROWS.append({"name": name, "actual": actual, "expected": expected,
                 "passed": actual == expected})


for relative in ("docs/audits/AUD-001-harnesses/README.md",
                 "docs/audits/AUD-002-harnesses/README.md"):
    source = ROOT / relative
    match = re.search(r"\[Commit identifiers in these reports\]\(([^)]+)\)",
                      source.read_text())
    check(relative + " contains provenance link", match is not None, True)
    if match:
        target, fragment = match.group(1).split("#")
        linked = source.parent / target
        headings = [re.sub(r"[^a-z0-9 -]", "", heading.lower()).replace(" ", "-")
                    for heading in re.findall(r"^#+ (.+)$", linked.read_text(), re.M)]
        check(relative + " provenance fragment resolves", fragment in headings, True)

# This is pure path evaluation of the actual ../../.. expression in lib.sh.
helper = (ROOT / "docs/audits/AUD-002-harnesses/lib.sh").read_text()
check("recorded helper still uses three-parent ROOT", '/../../.." && pwd)' in helper, True)
for relative in ("docs/audits/AUD-002-harnesses",
                 "docs/audits/AUD-002-evidence/harnesses"):
    directory = PurePosixPath("/repo") / relative
    check(relative + " recorded cwd matches repository-root invocation",
          str(directory.parents[2]), "/repo")

print(json.dumps({"rows": ROWS, "failed": sum(not row["passed"] for row in ROWS)}, indent=2))
raise SystemExit(1 if any(not row["passed"] for row in ROWS) else 0)
