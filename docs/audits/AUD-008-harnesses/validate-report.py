#!/usr/bin/env python3
"""Validate the AUD-008 record and retained evidence without changing production files."""

import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
HARNESS = ROOT / "docs/audits/AUD-008-harnesses"
REPORT = ROOT / "docs/audits/AUD-008-2026-10-06"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON key: {key}"
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def main():
    report = load(REPORT.with_suffix(".json"))
    schema = load(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    Draft202012Validator(schema).validate(report)
    snapshot = load(EVIDENCE / "snapshot.json")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    assert head == snapshot["commit"] == report["snapshot"]["commit"]
    for name, sha in snapshot["files"].items():
        assert digest(ROOT / name) == sha, f"Changed product file: {name}"
    assert report["snapshot"]["sourceFingerprint"] == snapshot["sourceFingerprint"]
    for name, sha in report["procedureHashes"].items():
        assert digest(Path(name)) == sha, f"Changed procedure: {name}"
    for name, sha in load(EVIDENCE / "dist-manifest.json").items():
        assert digest(ROOT / name) == sha, f"Changed dist artifact: {name}"
    for name, sha in report["reviewRecordHashes"].items():
        assert digest(EVIDENCE / name) == sha, f"Changed reviewer record: {name}"
    for name, sha in report["harnessHashes"].items():
        assert digest(ROOT / name) == sha, f"Changed harness: {name}"
    plan = load(EVIDENCE / "coverage-plan.json")
    checks = [item["checkId"] for item in report["coverage"]]
    assert len(checks) == len(set(checks)) == 32 and set(checks) == set(plan)
    findings = report["findings"]
    identifiers = [item["id"] for item in findings]
    assert len(identifiers) == len(set(identifiers)) == 11
    assert set(item["id"] for item in report["remediation"]) == set(identifiers)
    markdown = REPORT.with_suffix(".md").read_text()
    headings = re.findall(r"^#### (AUD-008-[A-Z]+[0-9]+) —", markdown, re.M)
    assert headings == identifiers
    for item in findings:
        assert item["id"].split("-")[2].startswith(item["category"])
        for field in ["evidence", "reproduction", "expected", "observed", "impact", "recommendedFix", "requiredVerification"]:
            assert item[field], (item["id"], field)
    for command in report["checks"]:
        path = ROOT / command["localLog"]
        assert digest(path) == command["logSha256"]
        assert command["exitCode"] is not None
    ignored = subprocess.run(["git", "check-ignore", "-q", str(EVIDENCE / "snapshot.json")], cwd=ROOT)
    assert ignored.returncode == 0, "Local evidence must remain ignored"
    assert not subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).strip(), "Audit must not stage changes"
    for name in ["README.md", "sskr-README.md", "security-README.md"]:
        assert (HARNESS / name).is_file(), name
    result = {
        "schema": "passed", "coverageIds": len(checks), "findings": len(findings),
        "commandLogHashes": len(report["checks"]), "productFilesUnchanged": len(snapshot["files"]),
        "headUnchanged": True, "procedureHashesUnchanged": len(report["procedureHashes"]),
        "distFilesUnchanged": len(load(EVIDENCE / "dist-manifest.json")),
        "reviewRecords": len(report["reviewRecordHashes"]), "harnessHashes": len(report["harnessHashes"]),
        "evidenceIgnored": True, "stagedChanges": False,
    }
    (EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    files = sorted(path for path in EVIDENCE.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
    sums = [f"{digest(path)}  {path.relative_to(EVIDENCE)}" for path in files]
    (EVIDENCE / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
