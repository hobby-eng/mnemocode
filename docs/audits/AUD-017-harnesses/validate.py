"""Validate AUD-017 records, without weakening or rewriting any previous audit."""

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
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON key: {key}"
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


if __name__ == "__main__":
    report = load(AUDITS / f"{BASE}.json")
    Draft202012Validator(load(CANONICAL / "docs/audit-report.schema.json")).validate(report)
    markdown = (AUDITS / f"{BASE}.md").read_text()
    ids = {"AUD-016-API001", "AUD-017-DOC001"}
    assert {row["id"] for row in report["findings"]} == ids and len(report["findings"]) == 2
    for row in report["findings"]:
        assert row["status"] == "open" and row["id"] in markdown and row["title"] in markdown
        for item in row["affectedFiles"]:
            assert digest(ROOT / item["path"]) == item["sha256"]
    for group, root in [("procedureHashes", CANONICAL), ("harnessHashes", AUDITS), ("baselineReportHashes", AUDITS)]:
        for name, value in report[group].items():
            assert digest(root / name) == value
    shared = report["sharedRecorderHash"]
    assert digest(AUDITS / shared["path"]) == shared["sha256"]
    start = load(EVIDENCE / "aud017-start-snapshot.json")
    end = load(EVIDENCE / "aud017-end-snapshot.json")
    assert start["files"] == end["files"] == report["snapshot"]["files"]
    fingerprint = hashlib.sha256(json.dumps(end["files"], separators=(",", ":")).encode()).hexdigest()
    assert fingerprint == start["fingerprint"] == end["fingerprint"] == report["snapshot"]["sourceFingerprint"]
    paths = set(subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0"))
    current = [{"path": name, "sha256": digest(ROOT / name)} for name in sorted(paths - {""})
               if not name.startswith("docs/audits/") and (ROOT / name).is_file()]
    assert current == end["files"], "Source changed since the review"
    for row in report["checks"]:
        raw = load(EVIDENCE / f"{row['label']}.command.json")
        assert raw["sourceBefore"] == raw["sourceAfter"] == fingerprint and not raw["changedFiles"]
        assert raw["exitCode"] == row["exitCode"] and digest(EVIDENCE / f"{row['label']}.log") == row["logSha256"] == raw["logSha256"]
        assert row["startedAt"].endswith("+00:00") and row["endedAt"].endswith("+00:00")
    checks = re.findall(r"^### (CHECK-[A-Z]+-\d+) —", (CANONICAL / "docs/FULL_AUDIT_GUIDE.md").read_text(), re.MULTILINE)
    assert len(checks) == 32 and {row["checkId"] for row in report["coverageLedger"]} == set(checks)
    for name, value in report["artifactRelationship"]["hashes"].items():
        assert digest(ROOT / name) == value
    ordinary = (EVIDENCE / "aud017-regressions.log").read_text()
    assert re.search(r"Tests\s+58 passed", ordinary) and report["verificationSummary"]["ordinaryTests"] == 58
    probe = json.JSONDecoder().raw_decode((EVIDENCE / "aud017-edges-confirmed.log").read_text())[0]["checks"]
    assert len(probe) == 20 and sum(row["passed"] for row in probe) == 18
    assert {row["name"] for row in probe if not row["passed"]} == {
        "branded host getter survives askWallet", "actual word search preserves the branded derived field"}
    assert report["summary"]["releaseAccepted"] is False
    for path in [AUDITS / f"{BASE}.md", AUDITS / f"{BASE}.json", AUDITS / "AUD-017-harnesses/README.md"]:
        assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", path.read_text()), path.name
    assert "| AUD-017 |" in (AUDITS / "README.md").read_text()
    assert subprocess.check_output(["git", "check-ignore", str(EVIDENCE)], cwd=ROOT).decode().strip()
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode().splitlines()
    assert not any("AUD-017-evidence/" in name for name in staged)
    result = {"auditId": "AUD-017", "validatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "outcome": "passed", "sourceFingerprint": fingerprint,
              "reportHashes": {name: digest(AUDITS / name) for name in [f"{BASE}.md", f"{BASE}.json"]},
              "meaning": "Schema, identity, evidence and privacy validation; the recorded runtime finding remains open."}
    (EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    rows = [f"{digest(path)}  {path.relative_to(EVIDENCE)}" for path in sorted(EVIDENCE.rglob("*"))
            if path.is_file() and path.name != "SHA256SUMS"]
    (EVIDENCE / "SHA256SUMS").write_text("\n".join(rows) + "\n")
    print(json.dumps(result, indent=2))
