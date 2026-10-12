"""Inspect the retained AUD-016 remediation evidence without changing historical records."""

import copy
import hashlib
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-016-evidence"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


if __name__ == "__main__":
    report = load(AUDITS / "AUD-016-2026-10-12.json")
    schema = load(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    Draft202012Validator(schema).validate(report)
    addendum = report["remediationAddendum"]
    fixed = load(AUDITS / addendum["fixSnapshot"]["file"])
    assert fixed["fingerprint"] == addendum["fixSourceFingerprint"]
    assert hashlib.sha256(json.dumps(fixed["files"], separators=(",", ":")).encode()).hexdigest() == fixed["fingerprint"]
    current = load(AUDITS / "AUD-017-evidence/aud017-start-snapshot.json")
    old_files = {row["path"]: row["sha256"] for row in fixed["files"]}
    new_files = {row["path"]: row["sha256"] for row in current["files"]}
    changed = sorted(name for name in old_files.keys() | new_files.keys()
                     if old_files.get(name) != new_files.get(name))
    assert changed == ["README.md"], "Code changed since the claimed fix snapshot"
    references = [*addendum["checks"], addendum["reproduction"]]
    for row in references:
        assert digest(AUDITS / row["log"]) == row["logSha256"]
    no_source = []
    for row in addendum["checks"]:
        record = load(AUDITS / row["log"].replace(".log", ".command.json"))
        assert record["logSha256"] == row["logSha256"] and record["exitCode"] == row["exitCode"]
        if not record.get("sourceBefore") or not record.get("sourceAfter"):
            no_source.append(row["label"])
    validation = load(EVIDENCE / "remediation/report-validation.json")
    for name, value in validation["reportHashes"].items():
        assert digest(AUDITS / name) == value
    original = copy.deepcopy(report)
    original.pop("remediationAddendum")
    for row in original["findings"]:
        row["status"] = "open"
        row.pop("remediationUpdate", None)
    original_json = hashlib.sha256((json.dumps(original, indent=2) + "\n").encode()).hexdigest()
    assert original_json == "0e8539e2c96a9e065a5240fd37a2030d58957583c1d4df7cfd38f9dcb0edde34"
    markdown = (AUDITS / "AUD-016-2026-10-12.md").read_text().split("\n## Remediation addendum (2026-10-12)")[0].rstrip() + "\n"
    markdown = re.sub(r"^(\| AUD-(?:016-API001|015-API001|015-SEC001) \| (?:API|SEC) \| finding \| (?:medium|low) \| )fixed( \|)",
                      r"\1open\2", markdown, flags=re.MULTILINE)
    assert hashlib.sha256(markdown.encode()).hexdigest() == "cc506712fd4d4aac5da5e213c9a15e738b407fe5e1880de63f6b9ac9eb557f09"
    relocated = [path for folder in ["written-to-AUD-014-evidence", "written-to-AUD-015-evidence"]
                 for path in (EVIDENCE / folder).iterdir() if path.is_file()]
    assert len(relocated) == 48
    for path in relocated:
        retained = EVIDENCE / path.name
        if retained.exists():
            assert digest(path) == digest(retained)
        else:
            snapshot = load(path)
            assert hashlib.sha256(json.dumps(snapshot["files"], separators=(",", ":")).encode()).hexdigest() == snapshot["fingerprint"]
    checksums = (EVIDENCE / "remediation/SHA256SUMS").read_text().splitlines()
    for row in checksums:
        value, name = row.split("  ", 1)
        assert digest(EVIDENCE / name) == value
    print(json.dumps({"schema": "passed", "originalReportPreserved": True,
                      "changedSinceClaimedFix": changed, "matchedRemediationLogs": len(references),
                      "intactRelocatedFiles": len(relocated), "checksWithoutSourceIdentity": no_source,
                      "checksumEntries": len(checksums),
                      "checksumMeaning": "Names resolve from AUD-016-evidence; the manifest omits the remediation log/command pairs.",
                      "validationMeaning": "The retained validator result identifies the historical baseline; its script does not check the addendum."}, indent=2))
    raise SystemExit(1 if no_source else 0)
