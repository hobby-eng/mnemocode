#!/usr/bin/env python3
"""Validate the dated remediation addendum without replacing original audit evidence."""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
REPORT = ROOT / "docs/audits/AUD-008-2026-10-06"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def main():
    report = load(REPORT.with_suffix(".json"))
    original = load(EVIDENCE / "recheck-original-report.json")
    schema = load(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    Draft202012Validator(schema).validate(report)
    follow = report["remediationVerification"]
    assert report["snapshot"] == original["snapshot"]
    # The original report adds descriptive fields to the raw snapshot; every raw field remains bound.
    for key, value in load(EVIDENCE / "snapshot.json").items():
        assert report["snapshot"][key] == value, key
    assert report["checks"] == original["checks"], "Original execution evidence was changed"
    assert report["procedureHashes"] == original["procedureHashes"]
    assert report["historicalEvidence"]["originalRemediationBeforeThisFollowUp"] == original["remediation"]
    assert follow["snapshot"] == load(EVIDENCE / "recheck-snapshot.json")
    verified_snapshot = load(EVIDENCE / "recheck-snapshot-verification.json")
    assert verified_snapshot["unchanged"] and not verified_snapshot["changedFiles"]
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip() == follow["snapshot"]["commit"]
    for name, sha in follow["snapshot"]["files"].items():
        assert digest(ROOT / name) == sha, name
    for name, sha in load(EVIDENCE / "recheck-dist-manifest.json").items():
        assert digest(ROOT / name) == sha, name
    for name, sha in follow["procedureHashes"].items():
        assert digest(Path(name)) == sha, name
    for name, sha in follow["harnessHashes"].items():
        assert digest(ROOT / name) == sha, name
    for name, sha in follow["reviewRecordHashes"].items():
        assert digest(EVIDENCE / name) == sha, name
    for current, prior in zip(report["findings"], original["findings"], strict=True):
        assert current["originalStatus"] == prior["status"]
        retained = {key: value for key, value in current.items() if key not in ["status", "originalStatus"]}
        assert retained == {key: value for key, value in prior.items() if key != "status"}, current["id"]
    dispositions = {item["id"]: item for item in report["remediation"]}
    assert len(dispositions) == len(report["findings"]) == 11
    for item in report["findings"]:
        assert item["status"] == dispositions[item["id"]]["status"]
        assert dispositions[item["id"]]["fixCommit"] is None
        assert dispositions[item["id"]]["verificationCommit"] is None
    statuses = {status: sum(item["status"] == status for item in report["findings"]) for status in ["verified", "open"]}
    assert statuses == follow["statusCounts"] == {"verified": 7, "open": 4}
    for command in [*report["checks"], *follow["commands"]]:
        assert command["exitCode"] is not None
        assert digest(ROOT / command["localLog"]) == command["logSha256"], command["localLog"]
    markdown = REPORT.with_suffix(".md").read_text()
    identifiers = [item["id"] for item in report["findings"]]
    assert re.findall(r"^#### (AUD-008-[A-Z]+[0-9]+) —", markdown, re.M) == identifiers
    for item in report["findings"]:
        row = next(line for line in markdown.splitlines() if line.startswith("| " + item["id"]) and "finding" in line)
        assert row.split("|")[5].strip() == item["status"], item["id"]
    assert subprocess.run(["git", "check-ignore", "-q", str(EVIDENCE / "recheck-snapshot.json")], cwd=ROOT).returncode == 0
    assert not subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).strip()
    result = {"schema": "passed", "baselineEvidencePreserved": True, "productFilesUnchangedDuringFollowUp": len(follow["snapshot"]["files"]), "statuses": statuses, "followUpCommands": len(follow["commands"]), "evidenceIgnored": True, "stagedChanges": False}
    (EVIDENCE / "recheck-report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
