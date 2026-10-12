"""Validate AUD-013 without rerunning production checks or changing prior reports."""

import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-013-evidence"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON key: {key}"
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_pairs)


report_path = AUDITS / "AUD-013-2026-10-08.json"
markdown_path = report_path.with_suffix(".md")
report = read(report_path)
markdown = markdown_path.read_text()
schema_path = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"
jsonschema.Draft202012Validator(read(schema_path)).validate(report)
assert report["auditId"] == "AUD-013" and report["auditNumber"] == 13
assert report["date"] == "2026-10-08"
assert report["snapshot"]["commit"] in markdown
assert report["snapshot"]["sourceFingerprint"] in markdown

original = read(AUDITS / "AUD-012-2026-10-08.json")
older = read(AUDITS / "AUD-011-2026-10-08.json")
original_rows = {row["id"]: row for row in original["findings"] + older["findings"]}
expected_ids = {row["id"] for row in original["findings"]} | {
    row["id"] for row in original["remediation"] if row["disposition"] == "partly-fixed"
}
rows = report["remediation"]
assert len(rows) == 45 and {row["id"] for row in rows} == expected_ids
counts = collections.Counter(row["disposition"] for row in rows)
assert counts == {"source-fixed": 34, "partly-fixed": 8, "unfixed": 3}
for row in rows:
    assert row["fixCommit"] is None and row["verificationCommit"] is None
    assert row["originalSeverity"] == original_rows[row["id"]]["severity"]
    assert row["originalReleaseBlocking"] == original_rows[row["id"]]["releaseBlocking"]
    assert row["status"] == ("fixed" if row["disposition"] == "source-fixed" else "open")
    assert f"#### {row['id']} — {row['disposition']}" in markdown
    assert f"| {row['id']} | {row['status']} | {row['disposition']} | None | None |" in markdown
    assert digest(ROOT / row["evidence"]["reviewerRecord"]) == row["evidence"]["reviewerRecordSha256"]

assert len(report["findings"]) == 1
headings = re.findall(r"^#### (AUD-013-[A-Z]+\d+) — (\w+) — (.+)$", markdown, re.M)
for finding in report["findings"]:
    assert (finding["id"], finding["severity"].capitalize(), finding["title"]) in headings
    assert finding["id"] == "AUD-013-BLD001" and finding["status"] == "open"
    assert finding["releaseBlocking"] is True
    assert all(finding[key] for key in ["expected", "observed", "impact", "recommendedFix", "requiredVerification"])
assert len(report["coverageLedger"]) == 32
assert len({row["id"] for row in report["coverageLedger"]}) == 32
for row in report["coverageLedger"]:
    assert f"| {row['id']} | {row['outcome']} |" in markdown

final = read(EVIDENCE / "checked-final-snapshot.json")
assert final["sourceFingerprint"] == report["snapshot"]["sourceFingerprint"]
assert final["source"] == report["sourceIdentity"]["finalManifest"]
for name in report["sourceIdentity"]["stableAcceptanceSnapshots"]:
    assert read(EVIDENCE / name)["source"] == final["source"]
initial = read(EVIDENCE / "snapshot.json")
assert initial["sourceFingerprint"] == report["sourceIdentity"]["initialSnapshot"]
initial_files = dict(initial["source"])
final_files = dict(final["source"])
changed = sorted(path for path in initial_files.keys() | final_files.keys()
                 if initial_files.get(path) != final_files.get(path))
assert changed == report["sourceIdentity"]["changedAfterResume"]
# A report binds reviewed bytes, not later concurrent edits. Preserve the captured final
# manifest, disclose later drift, and check every citation against that reviewed identity.
later = read(EVIDENCE / "post-review-snapshot.json")
assert later["source"] == report["postReviewChanges"]["manifest"]
later_files = dict(later["source"])
later_changes = sorted(path for path in final_files.keys() | later_files.keys()
                       if final_files.get(path) != later_files.get(path))
assert later_changes == [item["path"] for item in report["postReviewChanges"]["changedFiles"]]
for item in report["postReviewChanges"]["changedFiles"]:
    assert item["reviewedSha256"] == final_files.get(item["path"])
    assert item["laterSha256"] == later_files.get(item["path"])
    assert f"| `{item['path']}` | `{item['reviewedSha256']}` | `{item['laterSha256']}` |" in markdown
live_drift = []
for path, expected in final["source"]:
    file = ROOT / path
    actual = digest(file) if file.exists() else "deleted"
    if actual != expected:
        live_drift.append({"path": path, "reviewedSha256": expected, "liveSha256": actual})
assert report["postReviewChanges"]["assessment"].startswith("Not re-reviewed")
for path, expected in report["procedure"]["sha256"].items():
    assert digest(ROOT.parent / "multi-chain-wallet-tools" / path) == expected, path
    assert expected in markdown
for path, expected in report["historicalEvidence"]["preservedReports"].items():
    assert digest(ROOT / path) == expected, path
assert report["historicalEvidence"]["preservedReports"] == {
    "docs/audits/AUD-012-2026-10-08.md": "122b2ec9bd6805d39124b028665ad1678f0596f4cb90b45814be535dd3587936",
    "docs/audits/AUD-012-2026-10-08.json": "85290283964fc07357e98b0a3d3de62bf8a77df65e3a7d382749e0ab455e022a",
}

for command in report["checks"]:
    record = AUDITS / command["recordPath"]
    log = AUDITS / command["logPath"]
    assert digest(record) == command["recordSha256"], record
    assert digest(log) == command["logSha256"], log
    actual = read(record)
    assert actual["command"] == command["command"]
    assert actual["exitCode"] == command["exitCode"]
    assert command["logSha256"] in markdown
    if "minimumAvailableBytes" in actual:
        assert actual["minimumAvailableBytes"] == min(sample["available"] for sample in actual["memorySamples"])
        assert actual["stopReason"] is None
    if command["label"] in {"current-critical", "current-source-check"}:
        assert command["sourceFingerprint"] == final["sourceFingerprint"]


def validate_citations(value):
    if isinstance(value, dict):
        if "path" in value and "sha256" in value:
            path = ROOT / value["path"]
            expected = final_files.get(value["path"], digest(path) if path.exists() else "deleted")
            assert expected == value["sha256"], value
            if "line" in value:
                assert value["line"] >= 1, value
                if path.exists() and digest(path) == expected:
                    assert value["line"] <= len(path.read_text().splitlines()), value
        for item in value.values():
            validate_citations(item)
    elif isinstance(value, list):
        for item in value:
            validate_citations(item)


validate_citations(report["findings"])
validate_citations(report["remediation"])
for link in re.findall(r"\]\(([^)]+)\)", markdown):
    target = link.split("#", 1)[0]
    if target and not re.match(r"https?://", target):
        assert (AUDITS / target).exists(), target
index = (AUDITS / "README.md").read_text()
assert "AUD-013-2026-10-08.md" in index and "AUD-013-2026-10-08.json" in index
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode()
assert not any(re.search(r"docs/audits/AUD-\d+-evidence/", path) for path in staged.splitlines())
assert subprocess.run(["git", "check-ignore", "--quiet", "docs/audits/AUD-013-evidence/snapshot.json"], cwd=ROOT).returncode == 0

result = {"status": "passed", "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "newFindings": 1, "originalDispositions": len(rows), "counts": dict(counts),
          "coverageChecks": 32, "sourceFingerprint": final["sourceFingerprint"],
          "latestSnapshotUnchanged": not live_drift, "liveChangesNotVerified": live_drift,
          "reportSha256": digest(report_path),
          "markdownSha256": digest(markdown_path)}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
files = sorted(path for path in EVIDENCE.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
(EVIDENCE / "SHA256SUMS").write_text("".join(f"{digest(path)}  {path.relative_to(EVIDENCE)}\n" for path in files))
print(json.dumps(result, indent=2))
