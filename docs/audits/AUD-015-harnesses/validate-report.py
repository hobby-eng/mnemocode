"""Validate AUD-015 record consistency; a valid record does not make failing probes pass."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-015-evidence"
REPORT = AUDITS / "AUD-015-2026-10-12"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON key: {key}"
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


record = load(REPORT.with_suffix(".json"))
markdown = REPORT.with_suffix(".md").read_text()
schema = load(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
jsonschema.validate(record, schema)
assert record["auditId"] == "AUD-015"
assert len(record["findings"]) == 6
assert sum(item["severity"] == "medium" for item in record["findings"]) == 1
assert sum(item["severity"] == "low" for item in record["findings"]) == 5
assert len({item["id"] for item in record["findings"]}) == len(record["findings"])
for item in record["findings"]:
    assert f"#### {item['id']} — {item['severity'].capitalize()} — {item['title']}" in markdown
    assert f"| {item['id']} | {item['category']} | {item['severity']} | {item['status']} |" in markdown
    for file in item["affectedFiles"]:
        path = ROOT / file["path"]
        assert digest(path) == file["sha256"]
        assert 1 <= file["line"] <= len(path.read_text().splitlines())
for row in record["checks"]:
    raw = load(EVIDENCE / f"{row['label']}.command.json")
    assert raw["exitCode"] == row["exitCode"]
    assert raw["sourceBefore"] == raw["sourceAfter"] == record["snapshot"]["sourceFingerprint"]
    assert raw["changedFiles"] == []
    assert digest(EVIDENCE / f"{row['label']}.log") == row["evidence"]["sha256"]
    assert row["evidence"]["localOnly"] is True
for name, expected in record["baselineReportHashes"].items():
    assert digest(AUDITS / name) == expected, "Historical AUD-014 report was modified"
for name, expected in record["procedureHashes"].items():
    assert digest(ROOT.parent / "multi-chain-wallet-tools" / name) == expected
for name, expected in record["harnessHashes"].items():
    assert digest(ROOT / name) == expected
assert len(record["coverageLedger"]) == 32
assert len({row["checkId"] for row in record["coverageLedger"]}) == 32
assert record["summary"]["ordinaryTestsPassed"] == 105
assert len(record["remediation"]) == 19
for row in record["remediation"]:
    assert f"| {row['id']} | {row['status']} | Not committed | Not committed |" in markdown

# Reports and README are published; ignored raw evidence intentionally retains actual diagnostics.
published = [REPORT.with_suffix(".md"), REPORT.with_suffix(".json"),
             AUDITS / "AUD-015-harnesses/README.md"]
for path in published:
    text = path.read_text()
    assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", text), "Nonanonymous home path"
    assert not re.search(r"[\u0400-\u04ff]", text), "Published audit text must be English"
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        if "://" in target or target.startswith("#"):
            continue
        assert (path.parent / target.split("#", 1)[0]).exists(), target
index = (AUDITS / "README.md").read_text()
assert index.count("| AUD-015 |") == 1
assert "One medium and five low" in index
for path in EVIDENCE.iterdir():
    if path.is_file():
        subprocess.run(["git", "check-ignore", "--quiet", str(path.relative_to(ROOT))],
                       cwd=ROOT, check=True)
staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT).decode()
assert "AUD-015-evidence/" not in staged
assert not list((AUDITS / "AUD-015-harnesses").glob("*.test.*"))
result = {"auditId": "AUD-015", "validatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "outcome": "passed", "meaning": "Record consistency only; findings remain open.",
          "markdownSha256": digest(REPORT.with_suffix(".md")),
          "jsonSha256": digest(REPORT.with_suffix(".json")),
          "sourceFingerprint": record["snapshot"]["sourceFingerprint"],
          "checksValidated": len(record["checks"])}
(EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n")
checksums = [f"{digest(path)}  {path.relative_to(EVIDENCE)}"
             for path in sorted(EVIDENCE.rglob("*")) if path.is_file() and path.name != "SHA256SUMS"]
(EVIDENCE / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
print(json.dumps(result))
