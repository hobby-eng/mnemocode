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
    binding = phase.get("commitBinding")
    verification_name = "fix-snapshot-verification.json" if binding is None else "commit-binding-snapshot-verification.json"
    verified = load(EVIDENCE / verification_name)
    assert verified["unchanged"] and not verified["changedFiles"]
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    if binding is None:
        assert head == phase["snapshot"]["commit"]
    else:
        committed = binding["commit"]
        assert binding["sourceFingerprint"] == phase["snapshot"]["sourceFingerprint"]
        assert subprocess.run(["git", "merge-base", "--is-ancestor", phase["snapshot"]["commit"], committed], cwd=ROOT).returncode == 0
        assert subprocess.run(["git", "merge-base", "--is-ancestor", committed, head], cwd=ROOT).returncode == 0
        headers = subprocess.check_output(["git", "cat-file", "-p", committed], cwd=ROOT).split(b"\n\n", 1)[0]
        assert b"\ngpgsig " in b"\n" + headers, "Remediation commit has no signature header"
        # Comparing the committed product tree keeps unrelated HEAD movement from passing as a fix.
        assert subprocess.run(["git", "diff", "--quiet", committed, "--", ".", ":(exclude)docs/audits/**"], cwd=ROOT).returncode == 0
    for name, sha in phase["snapshot"]["files"].items():
        assert digest(ROOT / name) == sha, name
    for name, sha in load(EVIDENCE / "fix-dist-manifest.json").items():
        assert digest(ROOT / name) == sha, name
    for name, sha in phase["procedureHashes"].items():
        assert digest(Path(name)) == sha, name
    for name, sha in phase["harnessHashes"].items():
        replacement = binding["harnessHashes"].get(name) if binding is not None else None
        if replacement is None:
            assert digest(ROOT / name) == sha, name
        else:
            # Keep execution-time hashes: the commit-binding update is a later harness revision.
            before = subprocess.check_output(["git", "show", binding["commit"] + ":" + name], cwd=ROOT)
            assert hashlib.sha256(before).hexdigest() == sha, name
            assert digest(ROOT / name) == replacement, name
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
        expected_commit = binding["commit"] if binding is not None and finding["id"] in phase["newlyVerified"] else None
        assert dispositions[finding["id"]]["fixCommit"] == expected_commit
        assert dispositions[finding["id"]]["verificationCommit"] == expected_commit
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
    validation_name = "fix-report-validation.json" if binding is None else "commit-binding-report-validation.json"
    (EVIDENCE / validation_name).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
