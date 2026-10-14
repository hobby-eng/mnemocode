"""Check the exported record and its original evidence without hiding later source drift."""

import hashlib
import json
from pathlib import Path
import re

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-020-evidence"
STEM = "AUD-020-2026-10-13"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def main():
    record = read(AUDITS / (STEM + ".json"))
    markdown = (AUDITS / (STEM + ".md")).read_text()
    schema = read(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    jsonschema.Draft202012Validator(schema).validate(record)
    assert record["auditId"] == "AUD-020" and record["auditNumber"] == 20
    assert len(record["findings"]) == 1 and record["findings"][0]["status"] == "open"
    assert record["findings"][0]["id"] == record["remediation"][0]["id"] == "AUD-020-SEC001"
    assert "AUD-020-SEC001" in markdown
    assert record["checks"]["uniqueTestsPassed"] == 189
    assert record["checks"]["focusedPtyRecipesPassed"] == 2
    expected_ids = {f"CHECK-{group}-{n:03}" for group, count in
                    {"SEC": 7, "FUN": 7, "API": 4, "BLD": 5, "UI": 3, "ARC": 3, "DOC": 3}.items()
                    for n in range(1, count + 1)}
    ledger = record["checks"]["ledger"]
    assert len(ledger) == 32 and {x["id"] for x in ledger} == expected_ids
    initial = read(EVIDENCE / "snapshot-initial.json")
    final = read(EVIDENCE / "final-evidence.json")
    fingerprint = hashlib.sha256(json.dumps(initial["files"], separators=(",", ":")).encode()).hexdigest()
    assert fingerprint == initial["sourceFingerprint"] == final["sourceFingerprint"]
    assert fingerprint == record["snapshot"]["sourceFingerprint"]
    assert final["changedSinceBaseline"] == []
    assert len(record["snapshot"]["changedFiles"]) == 43
    assert len(record["snapshot"]["changedFileHashes"]) == 43
    for check in record["checks"]["commands"]:
        label = check["label"]
        original = read(EVIDENCE / (label + ".command.json"))
        assert digest(EVIDENCE / (label + ".log")) == original["logSha256"] == check["logSha256"]
        assert original["sourceBefore"] == original["sourceAfter"] == fingerprint
        assert original["exitCode"] == check["exitCode"]
    assert len(record["checks"]["commands"]) == 8
    for field in ["startupFollowup", "portableProbeReplay"]:
        if field in record:
            followup = record[field]
            original = read(EVIDENCE / (followup["label"] + ".command.json"))
            assert original["exitCode"] == followup["exitCode"] == 0
            assert original["sourceBefore"] == followup["sourceBefore"]
            assert original["sourceAfter"] == followup["sourceAfter"]
            assert digest(EVIDENCE / (followup["label"] + ".log")) == followup["logSha256"]
    for procedure in record["scope"]["procedureFiles"]:
        assert digest(ROOT.parent / procedure["path"]) == procedure["sha256"]
    for item in record["codexSecurity"]["artifacts"]:
        if item["path"] in {"findings.json", "coverage.json"}:
            assert digest(EVIDENCE / ("codex-" + item["path"])) == item["sha256"]
    manifest = read(EVIDENCE / "codex-scan-manifest.json")
    assert manifest["scan"]["status"] == "completed"
    assert manifest["scan"]["id"] == record["codexSecurity"]["scanId"]
    assert len(read(EVIDENCE / "codex-coverage.json")["surfaces"]) == 48
    canonical = read(EVIDENCE / "codex-findings.json")["findings"][0]
    assert canonical["findingId"] == record["codexSecurity"]["findingId"]
    assert canonical["severity"]["level"] == record["findings"][0]["severity"] == "low"
    assert canonical["title"] == record["findings"][0]["title"]
    for path in [AUDITS / (STEM + ".md"), AUDITS / (STEM + ".json"),
                 AUDITS / "AUD-020-harnesses/README.md"]:
        text = path.read_text()
        assert all(name == "user" for name in re.findall(r"/home/([^/\s]+)", text)), path
        assert not re.search(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?\+(?!00:00)\d{2}:\d{2}", text), path
    changed = [entry["path"] for entry in initial["files"]
               if not (ROOT / entry["path"]).is_file()
               or digest(ROOT / entry["path"]) != entry["sha256"]]
    print(json.dumps({"valid": True, "findingCount": 1, "sourceFingerprint": fingerprint,
                      "liveTreeMatchesReviewedSnapshot": not changed,
                      "laterChangedPaths": changed}))


if __name__ == "__main__":
    main()
