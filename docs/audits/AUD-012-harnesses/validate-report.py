"""Validate the paired AUD-012 records and locally retained source/command evidence."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-012-evidence"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        assert key not in value, f"Duplicate JSON key: {key}"
        value[key] = item
    return value


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_pairs)


report_path = AUDITS / "AUD-012-2026-10-08.json"
report = read(report_path)
markdown_path = report_path.with_suffix(".md")
markdown = markdown_path.read_text()
schema_path = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"
jsonschema.Draft202012Validator(read(schema_path)).validate(report)
assert report["auditId"] == "AUD-012" and report["auditNumber"] == 12
assert report["date"] == "2026-10-08"
assert report["snapshot"]["commit"] in markdown
assert report["snapshot"]["sourceFingerprint"] in markdown

ids = [item["id"] for item in report["findings"]]
assert len(ids) == len(set(ids))
headings = re.findall(r"^#### (AUD-012-[A-Z]+\d+) — (\w+) — (.+)$", markdown, re.M)
assert len(headings) == len(ids)
for item in report["findings"]:
    assert item["id"].split("-")[-1].startswith(item["category"])
    assert (item["id"], item["severity"].capitalize(), item["title"]) in headings
    assert f"| {item['id']} | {item['category']} | finding | {item['severity']} | open |" in markdown
    assert all(item[key] for key in ["expected", "observed", "impact", "recommendedFix", "requiredVerification"])

historical = read(AUDITS / "AUD-011-2026-10-08.json")
original = {item["id"] for item in historical["findings"]}
rows = report["remediation"]
assert len(rows) == 89 and {item["id"] for item in rows} == original
assert sum(item["disposition"] == "source-fixed" for item in rows) == 79
assert sum(item["disposition"] == "partly-fixed" for item in rows) == 10
assert all(item["fixCommit"] is None and item["verificationCommit"] is None for item in rows)
assert all(f"#### {item['id']} — {item['disposition']}" in markdown for item in rows)
assert len(report["coverageLedger"]) == 32
assert len({item["id"] for item in report["coverageLedger"]}) == 32
for item in report["coverageLedger"]:
    assert f"| {item['id']} | {item['outcome']} |" in markdown

baseline = read(EVIDENCE / "snapshot.json")
end = read(EVIDENCE / "review-end-snapshot.json")
assert baseline["sourceFingerprint"] == report["snapshot"]["sourceFingerprint"]
assert report["implementationManifest"] == baseline["source"]
latest = report["concurrentAddendum"]
assert latest["latestSourceFingerprint"] == end["sourceFingerprint"]
assert latest["latestManifest"] == end["source"]
initial_manifest = dict(baseline["source"])
latest_manifest = dict(end["source"])
expected_changes = {item["path"] for item in latest["changedFiles"]}
assert {path for path in initial_manifest if initial_manifest[path] != latest_manifest.get(path)} == expected_changes
for path, expected in end["source"]:
    file = ROOT / path
    assert (sha(file) if file.exists() else "deleted") == expected, path
for path, expected in report["procedure"]["sha256"].items():
    assert sha(ROOT.parent / "multi-chain-wallet-tools" / path) == expected, path
    assert expected in markdown

for command in report["checks"]:
    record = AUDITS / command["recordPath"]
    log = AUDITS / command["logPath"]
    assert sha(record) == command["recordSha256"], record
    assert sha(log) == command["logSha256"], log
    actual = read(record)
    assert actual["command"] == command["command"] and actual["exitCode"] == command["exitCode"]
    assert command["logSha256"] in markdown

# Only current citations are checked; historical hashes remain in their original report.
def citations(value):
    if isinstance(value, dict):
        if "path" in value and "sha256" in value:
            path = ROOT / value["path"]
            assert path.exists(), value["path"]
            if value["path"] in expected_changes:
                assert value["sha256"] in {initial_manifest[value["path"]], latest_manifest[value["path"]]}, value
                assert sha(path) == latest_manifest[value["path"]], value
            else:
                assert sha(path) == value["sha256"], value["path"]
            if "line" in value:
                assert 1 <= value["line"] <= len(path.read_text().splitlines()), value
        for item in value.values():
            citations(item)
    elif isinstance(value, list):
        for item in value:
            citations(item)

citations(report["findings"])
citations(report["remediation"])
for link in re.findall(r"\]\(([^)]+)\)", markdown):
    target = link.split("#", 1)[0]
    if target and not re.match(r"https?://", target):
        assert (AUDITS / target).exists(), target
index = (AUDITS / "README.md").read_text()
assert "AUD-012-2026-10-08.md" in index and "AUD-012-2026-10-08.json" in index
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode()
assert not any(re.search(r"docs/audits/AUD-\d+-evidence/", path) for path in staged.splitlines())
assert subprocess.run(["git", "check-ignore", "--quiet", "docs/audits/AUD-012-evidence/snapshot.json"], cwd=ROOT).returncode == 0

result = {"status": "passed", "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "findings": len(ids), "originalDispositions": len(rows), "coverageChecks": 32,
          "sourceFingerprint": baseline["sourceFingerprint"], "latestSourceFingerprint": end["sourceFingerprint"],
          "concurrentChanges": sorted(expected_changes), "latestSnapshotUnchanged": True,
          "reportSha256": sha(report_path), "markdownSha256": sha(markdown_path)}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
files = sorted(path for path in EVIDENCE.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
(EVIDENCE / "SHA256SUMS").write_text("".join(f"{sha(path)}  {path.relative_to(EVIDENCE)}\n" for path in files))
print(json.dumps(result, indent=2))
