"""AUD-019: the published audit records against the repository's history (CHECK-DOC-003).

    python3 docs/audits/AUD-019-harnesses/record-integrity.py

For every committed record in docs/audits/ (Markdown and JSON, the harness READMEs included):
- every full 40-hex commit that the text names in a commit context resolves to a commit of HEAD,
  or of the HEAD of the sibling checkout multi-chain-wallet-tools, whose procedure files the
  records cite, or is one that the index's section "Commit identifiers in these reports" explains:
  "`OLD` is `NEW`" with NEW a commit of HEAD, or "`OLD`, which … has no commit of its own";
- every JSON record parses without duplicate keys and its finding IDs appear in its Markdown twin;
- the index (docs/audits/README.md) has one row per numbered record.
A relative link whose target is missing is a warning, not a problem: a record links the source as
it was reviewed, and a file removed later leaves that link without a target.
Prints one JSON line per problem or warning and a summary; exits 1 when there is a problem.

The index rule and the sibling checkout were added in the remediation of AUD-019-DOC002; the audit's own run counted every
unresolved citation and every missing link target as a problem.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
SIBLING = ROOT.parent / "multi-chain-wallet-tools"
COMMIT_CONTEXT = re.compile(r"(?i)commit[^0-9a-f\n]{0,40}`?([0-9a-f]{40})\b")
MAPPED = re.compile(r"`([0-9a-f]{40})` is `([0-9a-f]{40})`")
UNPUBLISHED = re.compile(r"`([0-9a-f]{40})`, which [^.]*? has no commit of its own")


def git(*args, cwd=ROOT):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True).stdout


def unique(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key}")
        seen[key] = value
    return seen


def explained_commits(index, history):
    """The commits outside the history that the index names, each with its explanation."""
    explained = {}
    for old, new in MAPPED.findall(index):
        if new in history:
            explained[old] = f"is {new}"
    for old in UNPUBLISHED.findall(index):
        explained[old] = "has no commit of its own"
    return explained


def main():
    history = set(git("rev-list", "HEAD").split())
    sibling = set(git("rev-list", "HEAD", cwd=SIBLING).split()) if SIBLING.is_dir() else set()
    tracked = [p for p in git("ls-files", "docs/audits").split("\n") if p]
    documents = [p for p in tracked if p.endswith((".md", ".json")) and "-evidence/" not in p]
    index = (AUDITS / "README.md").read_text()
    explained = explained_commits(index, history)
    problems, warnings = [], []
    cited = explained_cited = sibling_cited = links = 0
    for name in documents:
        path = ROOT / name
        text = path.read_text()
        for commit in set(COMMIT_CONTEXT.findall(text)):
            cited += 1
            if commit in history:
                continue
            if commit in explained:
                explained_cited += 1
                continue
            if commit in sibling:
                sibling_cited += 1
                continue
            problems.append({"file": name, "commit": commit, "problem": "not a commit of HEAD"})
        if name.endswith(".md"):
            for target in re.findall(r"\[[^\]]*\]\(([^)\s]+)\)", text):
                if re.match(r"[a-zA-Z][a-zA-Z+.-]*:", target) or target.startswith("#"):
                    continue
                links += 1
                if not (path.parent / target.split("#", 1)[0]).exists():
                    warnings.append({"file": name, "link": target, "warning": "missing target"})
        if name.endswith(".json") and re.match(r"docs/audits/AUD-\d+-[\d-]+\.json$", name):
            try:
                record = json.loads(text, object_pairs_hook=unique)
            except ValueError as error:
                problems.append({"file": name, "problem": str(error)})
                continue
            twin = path.with_suffix(".md")
            markdown = twin.read_text() if twin.exists() else ""
            for finding in record.get("findings", []):
                if finding["id"] not in markdown:
                    problems.append({"file": name, "finding": finding["id"], "problem": "not in Markdown"})
    for name in documents:
        match = re.match(r"docs/audits/(AUD-\d+)-[\d-]+\.md$", name)
        if match and index.count(f"| {match.group(1)} |") != 1:
            problems.append({"file": name, "problem": "not exactly one index row"})
    for entry in problems + warnings:
        print(json.dumps(entry))
    print(json.dumps({"documents": len(documents), "citedCommits": cited,
                      "explainedByIndex": explained_cited, "inMultiChain": sibling_cited, "relativeLinks": links,
                      "problems": len(problems), "warnings": len(warnings)}))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
