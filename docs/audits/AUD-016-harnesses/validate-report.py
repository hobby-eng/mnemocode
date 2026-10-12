"""Validate AUD-016's retained identities and canonical report envelope, without rerunning tests."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-016-evidence"
CANONICAL = ROOT.parent / "multi-chain-wallet-tools"
BASE = "AUD-016-2026-10-12"


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
    schema = load(CANONICAL / "docs/audit-report.schema.json")
    Draft202012Validator(schema).validate(report)
    markdown = (AUDITS / f"{BASE}.md").read_text()
    assert report["auditId"] == "AUD-016" and report["auditNumber"] == 16
    expected_ids = {"AUD-016-API001", "AUD-015-API001", "AUD-015-SEC001"}
    assert {row["id"] for row in report["findings"]} == expected_ids
    assert len(report["findings"]) == 3 and not report["observations"]
    assert {row["id"] for row in report["remediation"]} == expected_ids
    for row in report["findings"]:
        assert row["id"] in markdown and row["title"] in markdown
        assert row["status"] == "open"
        for file in row["affectedFiles"]:
            assert digest(ROOT / file["path"]) == file["sha256"]
    for row in report["remediation"]:
        assert row["status"] == "open" and row["fixCommit"] is None and row["verificationCommit"] is None
    for name, value in report["procedureHashes"].items():
        assert digest(CANONICAL / name) == value
    for name, value in report["baselineReportHashes"].items():
        assert digest(AUDITS / name) == value
    for name, value in report["harnessHashes"].items():
        assert digest(AUDITS / name) == value
    procedure = (CANONICAL / "docs/FULL_AUDIT_GUIDE.md").read_text()
    ids = re.findall(r"^### (CHECK-[A-Z]+-\d+) —", procedure, re.MULTILINE)
    assert len(ids) == 32 and {row["checkId"] for row in report["coverageLedger"]} == set(ids)

    start = load(EVIDENCE / "aud016-start-snapshot.json")
    end = load(EVIDENCE / "aud016-final-snapshot.json")
    for snapshot, name in [(start, "baselineManifest"), (end, "finalManifest")]:
        assert snapshot["files"] == report["snapshot"][name]
        fingerprint = hashlib.sha256(json.dumps(snapshot["files"], separators=(",", ":")).encode()).hexdigest()
        assert snapshot["fingerprint"] == fingerprint
    assert report["snapshot"]["sourceFingerprint"] == start["fingerprint"]
    assert report["snapshot"]["finalSourceFingerprint"] == end["fingerprint"]
    # Match the frozen recorder's current-source recipe; audit documents are outside the source manifest.
    names = set(subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0"))
    current = [{"path": name, "sha256": digest(ROOT / name)} for name in sorted(names - {""})
               if not name.startswith("docs/audits/") and (ROOT / name).is_file()]
    assert current == end["files"], "Source changed after the final snapshot"
    for row in report["checks"]:
        original = load(EVIDENCE / f"{row['label']}.command.json")
        assert row["sourceBefore"] == original["sourceBefore"] == original["sourceAfter"]
        assert not original["changedFiles"]
        assert row["exitCode"] == original["exitCode"] and row["logSha256"] == original["logSha256"]
        assert digest(EVIDENCE / f"{row['label']}.log") == row["evidence"]["sha256"] == original["logSha256"]
        assert row["startedAt"].endswith("+00:00") and row["endedAt"].endswith("+00:00")
    for name, value in report["artifactRelationship"]["hashes"].items():
        assert digest(ROOT / name) == value
    assert digest(EVIDENCE / "handover-wallet-tools.json") == report["browserHandover"]["evidenceSha256"]
    counts = report["enhancements"]["ordinaryCounts"]
    assert sum(row["tests"] for row in counts) == 198 and sum(row["files"] for row in counts) == 8
    for row in counts:
        command = load(EVIDENCE / f"aud016-{row['label']}.command.json")
        assert command["exitCode"] == 0
        log = (EVIDENCE / f"aud016-{row['label']}.log").read_text()
        assert re.search(rf"Tests\s+{row['tests']} passed", log), f"Wrong count in {row['label']}"
    assert report["summary"]["releaseAccepted"] is False
    published = [AUDITS / f"{BASE}.json", AUDITS / f"{BASE}.md", AUDITS / "AUD-016-harnesses/README.md"]
    for path in published:
        text = path.read_text()
        assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", text), f"Non-anonymous home in {path.name}"
    assert f"| AUD-016 |" in (AUDITS / "README.md").read_text()
    ignored = subprocess.check_output(["git", "check-ignore", str(EVIDENCE)], cwd=ROOT).decode().strip()
    assert ignored
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode().splitlines()
    assert not any("AUD-016-evidence/" in name for name in staged)
    result = {"auditId": "AUD-016", "validatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "outcome": "passed", "sourceFingerprint": end["fingerprint"],
              "reportHashes": {path.name: digest(path) for path in published[:2]},
              "meaning": "Record/schema/hash/privacy validation only; no new runtime or release acceptance."}
    (EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    # The checksum list excludes itself, avoiding a recursive digest.
    checksums = [f"{digest(path)}  {path.name}" for path in sorted(EVIDENCE.iterdir())
                 if path.is_file() and path.name != "SHA256SUMS"]
    (EVIDENCE / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
    print(json.dumps(result, indent=2))
