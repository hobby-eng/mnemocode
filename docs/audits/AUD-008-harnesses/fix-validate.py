#!/usr/bin/env python3
"""Validate the four-fix addendum and its commit bindings, preserving the audit and first verification."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
REPORT = ROOT / "docs/audits/AUD-008-2026-10-06"
PRODUCT_EXCLUDED = "docs/audits/"


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


def committed_digest(commit, name):
    """SHA-256 of a file as stored in a commit, or None when the commit has no such file."""
    shown = subprocess.run(["git", "show", f"{commit}:{name}"], cwd=ROOT, capture_output=True)
    return hashlib.sha256(shown.stdout).hexdigest() if shown.returncode == 0 else None


def without(record, keys):
    return {key: value for key, value in record.items() if key not in keys}


def named_files(finding):
    """Files a finding names; the audit recorded them under three different keys."""
    places = [*finding.get("affectedFiles", []), *finding.get("locations", []), *finding.get("affected", [])]
    return {place["path"] if "path" in place else place["file"] for place in places}


def check_record_updates(report, phase, binding, head):
    """Check later bookkeeping updates; return the findings they bind and the current harness hashes."""
    harness_hashes = dict(binding["harnessHashes"]) if binding is not None else {}
    bound_later = set()
    original_files = report["snapshot"]["files"]
    first_files = report["remediationVerification"]["snapshot"]["files"]
    final_files = phase["snapshot"]["files"]
    findings = {item["id"]: item for item in report["findings"]}
    for update in phase.get("recordUpdates", []):
        assert binding is not None and update["commit"] == binding["commit"]
        previous = update["previousRecordCommit"]
        assert subprocess.run(["git", "merge-base", "--is-ancestor", previous, head], cwd=ROOT).returncode == 0
        assert subprocess.run(["git", "diff", "--quiet", binding["commit"], previous, "--", ".", ":(exclude)docs/audits/**"], cwd=ROOT).returncode == 0
        assert update["firstPhaseSourceFingerprint"] == report["remediationVerification"]["snapshot"]["sourceFingerprint"]
        assert update["firstPhaseProductFiles"] == len(first_files)
        # The commit does not hold the whole first-phase tree: it may differ only where the four-fix
        # phase changed files again, and never in a file that a newly bound finding names.
        changed = sorted(name for name, sha in first_files.items() if committed_digest(update["commit"], name) != sha)
        assert changed == update["changedByFourFixPhase"]
        assert changed == sorted(name for name, sha in first_files.items() if final_files.get(name) != sha)
        assert len(first_files) - len(changed) == update["identicalInCommit"]
        assert sorted(set(final_files) - set(first_files)) == update["addedByFourFixPhase"]
        first_phase_changes = {name for name, sha in first_files.items() if original_files.get(name) != sha}
        assert sorted(first_phase_changes & set(changed)) == update["firstPhaseChangesChangedAgain"]
        assert sorted(first_phase_changes - set(changed)) == update["firstPhaseChangesIdenticalInCommit"]
        for finding in update["findings"]:
            named = named_files(findings[finding])
            assert named and not named & set(changed), finding
        for name, sha in update["harnessHashes"].items():
            # A superseded hash must still describe the file in the commit that recorded it.
            assert committed_digest(previous, name) == harness_hashes.get(name), name
            harness_hashes[name] = sha
        # The update names the validator version it was checked with, which must be the one it records.
        harness = update["validation"]["harness"]
        assert update["harnessHashes"][harness["path"]] == harness["sha256"], harness["path"]
        bound_later.update(update["findings"])
    assert not bound_later & set(phase["newlyVerified"])
    return bound_later, harness_hashes


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-commit",
        action="store_true",
        help="read the product files from the recorded signed commit instead of the working tree and "
        "list dist/ and procedure files that differ as drift instead of failing (see README.md)",
    )
    return parser.parse_args()


def check_commit_tree(commit, files, fingerprint):
    """The commit holds exactly the snapshot's product files, byte for byte, as fix-snapshot.py hashes them."""
    names = subprocess.check_output(["git", "ls-tree", "-r", "-z", "--name-only", commit], cwd=ROOT).decode().split("\0")
    assert sorted(name for name in names if name and not name.startswith(PRODUCT_EXCLUDED)) == sorted(files)
    for name, sha in files.items():
        assert committed_digest(commit, name) == sha, name
    # Same fingerprint formula as fix-snapshot.py.
    assert hashlib.sha256("".join(name + "\0" + files[name] + "\n" for name in sorted(files)).encode()).hexdigest() == fingerprint


def validation_name(binding, phase, from_commit):
    """Each record state and mode writes its own result, so a later run never replaces an earlier one."""
    if binding is None:
        return "fix-report-validation.json"
    if not phase.get("recordUpdates"):
        return "commit-binding-from-commit-validation.json" if from_commit else "commit-binding-report-validation.json"
    return "record-update-from-commit-validation.json" if from_commit else "record-update-report-validation.json"


def main():
    from_commit = parse_arguments().from_commit
    # With --from-commit, files that are environment state rather than record are listed, not asserted.
    drift = {"dist": [], "procedures": {}}
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
        assert not from_commit, "--from-commit needs the recorded commit binding"
        assert head == phase["snapshot"]["commit"]
    else:
        committed = binding["commit"]
        assert binding["sourceFingerprint"] == phase["snapshot"]["sourceFingerprint"]
        assert subprocess.run(["git", "merge-base", "--is-ancestor", phase["snapshot"]["commit"], committed], cwd=ROOT).returncode == 0
        assert subprocess.run(["git", "merge-base", "--is-ancestor", committed, head], cwd=ROOT).returncode == 0
        headers = subprocess.check_output(["git", "cat-file", "-p", committed], cwd=ROOT).split(b"\n\n", 1)[0]
        assert b"\ngpgsig " in b"\n" + headers, "Remediation commit has no signature header"
        if from_commit:
            # The record is about the commit, so later work in HEAD or the working tree is not checked.
            check_commit_tree(committed, phase["snapshot"]["files"], phase["snapshot"]["sourceFingerprint"])
        else:
            # Comparing the committed product tree keeps unrelated HEAD movement from passing as a fix.
            assert subprocess.run(["git", "diff", "--quiet", committed, "--", ".", ":(exclude)docs/audits/**"], cwd=ROOT).returncode == 0
    bound_later, harness_hashes = check_record_updates(report, phase, binding, head)
    if not from_commit:
        for name, sha in phase["snapshot"]["files"].items():
            assert digest(ROOT / name) == sha, name
    for name, sha in load(EVIDENCE / "fix-dist-manifest.json").items():
        if not from_commit:
            assert digest(ROOT / name) == sha, name
        elif not (ROOT / name).is_file() or digest(ROOT / name) != sha:
            drift["dist"].append(name)
    for name, sha in phase["procedureHashes"].items():
        if not from_commit:
            assert digest(Path(name)) == sha, name
        elif digest(Path(name)) != sha:
            drift["procedures"][name] = digest(Path(name))
    for name, sha in phase["harnessHashes"].items():
        replacement = harness_hashes.get(name)
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
        bound = binding is not None and (finding["id"] in phase["newlyVerified"] or finding["id"] in bound_later)
        expected_commit = binding["commit"] if bound else None
        assert dispositions[finding["id"]]["fixCommit"] == expected_commit
        assert dispositions[finding["id"]]["verificationCommit"] == expected_commit
    assert phase["statusCounts"] == {"verified": 11, "open": 0}
    later_fields = ["fixCommit", "verificationCommit", "commitBindingNote"]
    for item in prior["remediation"]:
        if item["status"] == "verified":
            current = dispositions[item["id"]]
            if item["id"] in bound_later:
                # Only the commit fields and their dated note were added; first-phase values stay.
                assert current.get("commitBindingNote"), item["id"]
                assert without(current, later_fields) == without(item, later_fields), item["id"]
            else:
                assert current == item, item["id"]
    for command in [*report["checks"], *report["remediationVerification"]["commands"], *phase["commands"]]:
        assert command["exitCode"] is not None
        assert digest(ROOT / command["localLog"]) == command["logSha256"], command["localLog"]
    assert all(command["exitCode"] == 0 for command in phase["commands"])
    markdown = REPORT.with_suffix(".md").read_text()
    assert re.findall(r"^#### (AUD-008-[A-Z]+[0-9]+) —", markdown, re.M) == [item["id"] for item in report["findings"]]
    for finding in report["findings"]:
        row = next(line for line in markdown.splitlines() if line.startswith("| " + finding["id"]) and "finding" in line)
        assert row.split("|")[5].strip() == "verified", finding["id"]
    # The register rows have six cells; the remediation table has the standard five.
    remediation_rows = {}
    for line in markdown.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if line.startswith("| AUD-008-") and len(cells) == 5:
            remediation_rows[cells[0]] = cells
    assert sorted(remediation_rows) == sorted(dispositions)
    for name, disposition in dispositions.items():
        status, fix, verification = remediation_rows[name][1:4]
        assert status == disposition["status"], name
        for cell, commit in [(fix, disposition["fixCommit"]), (verification, disposition["verificationCommit"])]:
            if commit is not None:
                assert cell == f"`{commit[:7]}`", name
    assert subprocess.run(["git", "check-ignore", "-q", str(EVIDENCE / "fix-snapshot.json")], cwd=ROOT).returncode == 0
    assert not subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).strip()
    result = {"schema": "passed", "originalAndPriorEvidencePreserved": True, "productFilesBound": len(phase["snapshot"]["files"]), "statuses": phase["statusCounts"], "distinctSelectedTests": phase["distinctSelectedTests"], "buildFaultCases": phase["buildFaultCases"], "resizedPtyCases": phase["resizedPtyCases"], "evidenceIgnored": True, "stagedChanges": False}
    if from_commit:
        result["productFilesReadFrom"] = binding["commit"]
        result["environmentDrift"] = drift
    (EVIDENCE / validation_name(binding, phase, from_commit)).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
