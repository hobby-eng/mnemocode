"""Check a retained npm dry-run manifest without running npm or creating an archive."""

import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-021-evidence"


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: remediation-package.py NPM-COMMAND-LABEL")
    label = sys.argv[1]
    command = json.loads((EVIDENCE / f"{label}.command.json").read_text())
    assert command["exitCode"] == 0
    assert command["command"] == ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"]
    log = EVIDENCE / f"{label}.log"
    assert hashlib.sha256(log.read_bytes()).hexdigest() == command["logSha256"]
    packages, _ = json.JSONDecoder().raw_decode(log.read_text())
    assert len(packages) == 1
    paths = {row["path"] for row in packages[0]["files"]}
    expected = {
        str(path.relative_to(ROOT))
        for path in (ROOT / "docs/audits").rglob("*")
        if path.is_file() and "-evidence/" not in str(path) and "__pycache__/" not in str(path)
        and ("-harnesses/" in str(path) or path.suffix in {".md", ".json"})
    }
    assert not expected - paths, sorted(expected - paths)
    assert not any("-evidence/" in path or "__pycache__/" in path or path.startswith(("output/", "test-results/")) for path in paths)
    report = {
        "commandLabel": label,
        "logSha256": command["logSha256"],
        "sourceFingerprint": command["sourceAfter"],
        "entryCount": packages[0]["entryCount"],
        "publicAuditEntries": len(expected),
        "allPublishedReportsAndHarnessesIncluded": True,
        "privateEvidenceAndCachesExcluded": True,
        "archiveCreated": False,
        "packManifestSizeBytes": packages[0]["size"],
    }
    (EVIDENCE / "remediation-package-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
