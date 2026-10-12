"""Validate the new fix evidence and preserve the original report without skipping assertions."""

import copy
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-017-evidence"
CANONICAL = ROOT.parent / "multi-chain-wallet-tools"
BASE = "AUD-017-2026-10-12"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique(pairs):
    value = {}
    for key, item in pairs:
        assert key not in value, f"Duplicate JSON key: {key}"
        value[key] = item
    return value


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


if __name__ == "__main__":
    report = load(AUDITS / f"{BASE}.json")
    Draft202012Validator(load(CANONICAL / "docs/audit-report.schema.json")).validate(report)
    addendum = report["remediationAddendum"]
    initial = load(EVIDENCE / "initial-report-validation.json")
    original = copy.deepcopy(report)
    original.pop("remediationAddendum")
    for row in original["findings"]:
        row["status"] = "open"
        row.pop("remediationUpdate")
    assert hashlib.sha256((json.dumps(original, indent=2) + "\n").encode()).hexdigest() == initial["reportHashes"][f"{BASE}.json"]
    markdown = (AUDITS / f"{BASE}.md").read_text()
    baseline = markdown.split("\n## Remediation addendum (2026-10-12)")[0].rstrip() + "\n"
    baseline = re.sub(r"^(\| AUD-(?:016-API001|017-DOC001) \| (?:API|DOC) \| finding \| (?:medium|low) \| )fixed( \|)", r"\1open\2", baseline, flags=re.MULTILINE)
    assert hashlib.sha256(baseline.encode()).hexdigest() == initial["reportHashes"][f"{BASE}.md"]
    ids = {"AUD-016-API001", "AUD-017-DOC001"}
    assert {row["id"] for row in addendum["findings"]} == ids
    for row in report["findings"]:
        assert row["status"] == "fixed" and row["id"] in ids and row["id"] in markdown
        fix = row["remediationUpdate"]
        assert fix["status"] == "fixed" and fix["fixCommit"] is None and fix["verificationCommit"] is None
        assert fix["fixSourceFingerprint"] == addendum["fixSourceFingerprint"]
    final = load(EVIDENCE / "aud017-remediation-final-snapshot.json")
    assert final["files"] == addendum["fixManifest"]
    fingerprint = hashlib.sha256(json.dumps(final["files"], separators=(",", ":")).encode()).hexdigest()
    assert fingerprint == final["fingerprint"] == addendum["fixSourceFingerprint"]
    names = set(subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0"))
    current = [{"path": name, "sha256": digest(ROOT / name)} for name in sorted(names - {""})
               if not name.startswith("docs/audits/") and (ROOT / name).is_file()]
    assert current == final["files"], "Source changed after the final fix snapshot"
    for group, root in [("procedureHashes", CANONICAL), ("baselineReportHashes", AUDITS), ("harnessHashes", AUDITS)]:
        for name, value in original[group].items():
            assert digest(root / name) == value
    for name, value in addendum["newHarnessHashes"].items():
        assert digest(AUDITS / name) == value
    for name, value in addendum["artifactHashes"].items():
        assert digest(ROOT / name) == value
    handover = addendum["browserHandover"]
    assert digest(EVIDENCE / "remediation-handover-wallet-tools.json") == handover["evidenceSha256"]
    assert handover["sourceFingerprint"] == fingerprint and handover["result"]["isError"] is False
    for name, value in handover["fileHashes"].items():
        assert digest(ROOT / name) == value
    for row in original["checks"]:
        raw = load(EVIDENCE / f"{row['label']}.command.json")
        assert digest(EVIDENCE / f"{row['label']}.log") == row["logSha256"] == raw["logSha256"]
        assert raw["sourceBefore"] == raw["sourceAfter"] == original["snapshot"]["sourceFingerprint"]
        assert row["exitCode"] == raw["exitCode"]
    for row in addendum["checks"]:
        raw = load(EVIDENCE / f"{row['label']}.command.json")
        assert raw["sourceBefore"] == raw["sourceAfter"] == fingerprint and not raw["changedFiles"]
        assert raw["exitCode"] == row["exitCode"] == 0
        assert digest(EVIDENCE / f"{row['label']}.log") == row["logSha256"] == raw["logSha256"]
        assert row["startedAt"].endswith("+00:00") and row["endedAt"].endswith("+00:00")
    for label, tests in [("unit", 66), ("search", 25)]:
        assert re.search(rf"Tests\s+{tests} passed", (EVIDENCE / f"aud017-remediation-{label}.log").read_text())
    assert addendum["targetedTests"]["ordinaryPassed"] == 91
    checks = json.JSONDecoder().raw_decode((EVIDENCE / "aud017-remediation-probe.log").read_text())[0]["checks"]
    assert len(checks) == 20 and all(row["passed"] for row in checks)
    assert next(row for row in checks if row["name"] == "list cancellation refuses publication")["fingerprints"] == 1
    checksum = addendum["earlierChecksumList"]
    path = AUDITS / checksum["path"]
    assert digest(path) == checksum["sha256"]
    rows = path.read_text().splitlines()
    assert len(rows) == 25 and any("remediation/check.command.json" in row for row in rows)
    for row in rows:
        value, name = row.split("  ", 1)
        assert digest(AUDITS / checksum["basis"] / name) == value
    procedure_ids = re.findall(r"^### (CHECK-[A-Z]+-\d+) —", (CANONICAL / "docs/FULL_AUDIT_GUIDE.md").read_text(), re.MULTILINE)
    assert len(procedure_ids) == 32 and {row["checkId"] for row in original["coverageLedger"]} == set(procedure_ids)
    assert report["summary"]["releaseAccepted"] is False
    for path in [AUDITS / f"{BASE}.md", AUDITS / f"{BASE}.json", AUDITS / "AUD-017-harnesses/REMEDIATION.md"]:
        assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", path.read_text()), path.name
    assert "Remediation addendum:" in (AUDITS / "README.md").read_text()
    assert subprocess.check_output(["git", "check-ignore", str(EVIDENCE)], cwd=ROOT).decode().strip()
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode().splitlines()
    assert not any("AUD-017-evidence/" in name for name in staged)
    result = {"auditId": "AUD-017", "validatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "sourceFingerprint": fingerprint, "outcome": "passed", "originalReportPreserved": True,
              "reportHashes": {name: digest(AUDITS / name) for name in [f"{BASE}.md", f"{BASE}.json"]},
              "meaning": "Addendum, exact fix/test/evidence identities and privacy checked without disabling assertions; not release acceptance."}
    (EVIDENCE / "remediation-report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    (EVIDENCE / "SHA256SUMS-remediation").write_text("\n".join(
        f"{digest(path)}  {path.relative_to(EVIDENCE)}" for path in sorted(EVIDENCE.rglob("*"))
        if path.is_file() and not path.name.startswith("SHA256SUMS")) + "\n")
    print(json.dumps(result, indent=2))
