"""Fingerprint source and collect exact clone candidates; no execution of project code.

The relative import graph is a lexical inventory, not a complete TypeScript resolver.
Clone candidates are search aids, never the semantic finding count.
"""

from collections import defaultdict
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path.cwd()
evidence = root / "docs/audits/AUD-011-evidence"
evidence.mkdir(parents=True, exist_ok=True)
label = sys.argv[1] if len(sys.argv) > 1 else "baseline"
if not re.fullmatch(r"[a-z0-9-]+", label):
    raise SystemExit("Invalid snapshot label")
git = lambda *args: subprocess.check_output(["git", *args])
sha = lambda data: hashlib.sha256(data).hexdigest()
paths = sorted(set(git("ls-files", "-c", "-o", "--exclude-standard", "-z").decode().split("\0")) - {""})
paths = [p for p in paths if not p.startswith("docs/audits/")]
source = [[p, sha((root / p).read_bytes()) if (root / p).exists() else "deleted"] for p in paths]
snapshot = {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "head": git("rev-parse", "HEAD").decode().strip(),
            "branch": git("branch", "--show-current").decode().strip(),
            "workingTree": git("status", "--short").decode(),
            "diffSha256": sha(git("diff", "HEAD", "--binary")),
            "source": source, "fingerprint": sha(json.dumps(source, separators=(",", ":")).encode())}
(evidence / (label + "-snapshot.json")).write_text(json.dumps(snapshot, indent=2) + "\n")
if label == "baseline":
    (evidence / "snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    procedures = ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
                  "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]
    hashes = {"multi-chain-wallet-tools/" + p: sha((root.parent / "multi-chain-wallet-tools" / p).read_bytes())
              for p in procedures}
    (evidence / "procedure-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
files = [p for p in paths if (p.startswith("src/") or p.startswith("scripts/"))
         and Path(p).suffix in {".ts", ".mjs", ".py"}
         and p != "src/export/world-map-data.ts" and p != "src/sskr/bytewords-list.ts"]
texts = {p: (root / p).read_text() for p in files}
windows = defaultdict(list)
window_size = 10
for path, text in texts.items():
    lines = [(i + 1, line.strip()) for i, line in enumerate(text.splitlines())
             if line.strip() and not line.strip().startswith(("//", "/*", "*", "#"))]
    for i in range(len(lines) - window_size + 1):
        block = tuple(s for _, s in lines[i:i + window_size])
        if sum(len(s) for s in block) >= 200:
            windows[block].append({"path": path, "line": lines[i][0],
                                   "endLine": lines[i + window_size - 1][0]})
clones = [{"occurrences": places, "text": "\n".join(block)} for block, places in windows.items()
          if len(places) > 1]
clones.sort(key=lambda item: (-len(item["occurrences"]), item["occurrences"][0]["path"],
                             item["occurrences"][0]["line"]))
imports = {}
unresolved = []
for path, text in texts.items():
    if Path(path).suffix != ".ts":
        continue
    specs = re.findall(r"\bfrom\s*[\"']([^\"']+)[\"']|\bimport\s*\(?\s*[\"']([^\"']+)[\"']", text)
    targets = []
    for pair in specs:
        spec = next(s for s in pair if s)
        if not spec.startswith("."):
            continue
        base = (root / path).parent / spec
        choices = [base.with_suffix(".ts"), base] if base.suffix == ".js" else [base, base.with_suffix(".ts"), base / "index.ts"]
        resolved = next((p.resolve() for p in choices if p.is_file()), None)
        if resolved is None:
            unresolved.append({"path": path, "specifier": spec})
        else:
            targets.append(str(resolved.relative_to(root)))
    imports[path] = sorted(set(targets))
# Tarjan's strongly connected components over resolved local source paths.
indices, lows, stack, active, cycles = {}, {}, [], set(), []
def visit(node):
    indices[node] = lows[node] = len(indices)
    stack.append(node)
    active.add(node)
    for target in imports.get(node, []):
        if target not in imports:
            continue
        if target not in indices:
            visit(target)
            lows[node] = min(lows[node], lows[target])
        elif target in active:
            lows[node] = min(lows[node], indices[target])
    if lows[node] == indices[node]:
        component = []
        while True:
            target = stack.pop()
            active.remove(target)
            component.append(target)
            if target == node:
                break
        if len(component) > 1 or node in imports.get(node, []):
            cycles.append(sorted(component))
for node in imports:
    if node not in indices:
        visit(node)
inventory = {"files": len(files), "lines": sum(len(t.splitlines()) for t in texts.values()),
             "largestFiles": sorted([[p, len(t.splitlines())] for p, t in texts.items()], key=lambda x: -x[1])[:25],
             "cloneWindowSize": window_size, "cloneCandidates": clones,
             "relativeImports": imports, "unresolvedRelativeImports": unresolved, "cycles": cycles}
(evidence / (label + "-inventory.json")).write_text(json.dumps(inventory, indent=2) + "\n")
print(json.dumps({"label": label, "head": snapshot["head"], "fingerprint": snapshot["fingerprint"],
                  "sourceFiles": len(source), "reviewFiles": len(files), "reviewLines": inventory["lines"],
                  "cloneCandidateWindows": len(clones), "cycles": cycles,
                  "unresolvedRelativeImports": unresolved, "largestFiles": inventory["largestFiles"]}, indent=2))
