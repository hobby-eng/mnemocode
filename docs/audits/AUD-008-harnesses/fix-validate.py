#!/usr/bin/env python3
"""Validate the four-fix addendum while preserving the audit and first verification."""

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


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON key: {key}"
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_pairs)


def main():
    report = load(REPORT.with_suffix(".json"))
    original = load(EVIDENCE / "recheck-original-report.json")
    prior = load(EVIDENCE / "fix-prior-report.json")
    schema = load(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    Draft202012Validator(schema).validate(report)
    phase = report["fixVerification"]
    assert report["snapshot"] == original["snapshot"]
    assert report["checks"] == original["checks"]
    assert report["procedureHashes"] == original["procedureHashes"]
    assert report["remediationVerification"] == prior["remediationVerification"]
    assert report["historicalEvidence"]["remediationBeforeAuthorizedFixes"] == prior["remediation"]
    assert phase["snapshot"] == load(EVIDENCE / "fix-snapshot.json")
    verified = load(EVIDENCE / "fix-snapshot-verification.json")
    assert verified["unchanged"] and not verified["changedFiles"]
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip() == phase["snapshot"]["commit"]
    for name, sha in phase["snapshot"]["files"].items():
        assert digest(ROOT / name) == sha, name
    for name, sha in load(EVIDENCE / "fix-dist-manifest.json").items():
        assert digest(ROOT / name) == sha, name
    for name, sha in phase["procedureHashes"].items():
        assert digest(Path(name)) == sha, name
    for name, sha in phase["harnessHashes"].items():
        assert digest(ROOT / name) == sha, name
    for name, sha in phase["reviewRecordHashes"].items():
        assert digest(EVIDENCE / name) == sha, name
    for current, before in zip(report["findings"], original["findings"], strict=True):
        assert current["originalStatus"] == before["status"]
        retained = {key: value for key, value in current.items() if key not in ["status", "originalStatus"]}
        assert retained == {key: value for key, value in before.items() if key != "status"}, current["id"]
    dispositions = {item["id"]: item for item in report["remediation"]}
    assert len(dispositions) == len(report["findings"]) == 11
    for finding in report["findings"]:
        assert finding["status"] == dispositions[finding["id"]]["status"] == "verified"
        assert dispositions[finding["id"]]["fixCommit"] is None
        assert dispositions[finding["id"]]["verificationCommit"] is None
    assert phase["statusCounts"] == {"verified": 11, "open": 0}
    for item in prior["remediation"]:
        if item["status"] == "verified":
            assert dispositions[item["id"]] == item, item["id"]
    for command in [*report["checks"], *report["remediationVerification"]["commands"], *phase["commands"]]:
        assert command["exitCode"] is not None
        assert digest(ROOT / command["localLog"]) == command["logSha256"], command["localLog"]
    assert all(command["exitCode"] == 0 for command in phase["commands"])
    markdown = REPORT.with_suffix(".md").read_text()
    assert re.findall(r"^#### (AUD-008-[A-Z]+[0-9]+) —", markdown, re.M) == [item["id"] for item in report["findings"]]
    for finding in report["findings"]:
        row = next(line for line in markdown.splitlines() if line.startswith("| " + finding["id"]) and "finding" in line)
        assert row.split("|")[5].strip() == "verified", finding["id"]
    assert subprocess.run(["git", "check-ignore", "-q", str(EVIDENCE / "fix-snapshot.json")], cwd=ROOT).returncode == 0
    assert not subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).strip()
    result = {"schema": "passed", "originalAndPriorEvidencePreserved": True, "productFilesBound": len(phase["snapshot"]["files"]), "statuses": phase["statusCounts"], "distinctSelectedTests": phase["distinctSelectedTests"], "buildFaultCases": phase["buildFaultCases"], "resizedPtyCases": phase["resizedPtyCases"], "evidenceIgnored": True, "stagedChanges": False}
    (EVIDENCE / "fix-report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
