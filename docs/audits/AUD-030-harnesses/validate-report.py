"""Validate paired report, baseline identity and publication boundaries without product execution."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import subprocess
import sys

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-030-evidence"


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect():
    preview = "--preview" in sys.argv[1:]
    stem = EVIDENCE / "report-preview" if preview else ROOT / "docs/audits/AUD-030-2026-10-15"
    report = read(stem.with_suffix(".json"))
    text = stem.with_suffix(".md").read_text()
    schema_path = ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json"
    jsonschema.Draft202012Validator(read(schema_path)).validate(report)
    expected_schema = report["procedureHashes"]["multi-chain-wallet-tools/docs/audit-report.schema.json"]
    assert sha(schema_path) == expected_schema, "Schema changed after baseline"
    for relative, expected in report["procedureHashes"].items():
        assert sha(ROOT.parent / relative) == expected, "Procedure drift: " + relative
    ids = [finding["id"] for finding in report["findings"]]
    assert len(set(ids)) == len(ids), "Duplicate finding ID"
    for finding in report["findings"]:
        heading = "#### " + finding["id"] + " — " + finding["severity"].capitalize() + " — "
        assert heading + finding["title"] in text, "Paired finding metadata differs"
        assert finding["status"] == "open" and finding["releaseBlocking"] is False
        for label in finding["evidence"]:
            if "record" in label:
                assert sha(EVIDENCE / label["record"]) == label["recordSha256"]
                assert sha(EVIDENCE / label["log"]) == label["logSha256"]
            else:
                assert sha(EVIDENCE / label["path"]) == label["sha256"]
    snapshot = read(EVIDENCE / "snapshot.json")
    for key, rows in (
        ("allFilesFingerprint", snapshot["files"]),
        ("sourceFingerprint", [row for row in snapshot["files"] if not row["path"].startswith("docs/audits/")]),
    ):
        identities = [{"path": row["path"], "sha256": row["sha256"]} for row in rows]
        encoded = json.dumps(identities, ensure_ascii=False, separators=(",", ":")).encode()
        assert hashlib.sha256(encoded).hexdigest() == snapshot[key], "Snapshot fingerprint does not match its rows"
    expected_rows = {row["path"]: row["sha256"] for row in snapshot["files"]}
    actual_rows = report["scope"]["fileLedger"]
    assert len({row["path"] for row in actual_rows}) == len(actual_rows), "Duplicate report ledger path"
    assert {row["path"]: row["sha256"] for row in actual_rows} == expected_rows, "Report path/hash mapping differs"
    for key in ("commit", "sourceFingerprint", "allFilesFingerprint"):
        assert report["snapshot"][key] == snapshot[key], "Report snapshot identity differs: " + key
    assert {row["id"] for row in report["remediation"]} == set(ids), "Remediation ID mismatch"
    expected_checks = {row["checkId"] for row in read(EVIDENCE / "check-plan.json")}
    assert {row["checkId"] for row in report["checks"]["coverageLedger"]} == expected_checks, "CHECK ID set differs"
    assert {row["rule"] for row in report["scope"]["coreRuleLedger"]} == {
        "CORE-" + str(number).zfill(2) for number in range(1, 54)
    }, "CORE ID set differs"
    for row in report["finalHarnessIdentities"]:
        assert sha(ROOT / row["path"]) == row["sha256"], "Final harness binding changed"
    changes = []
    for row in snapshot["files"]:
        if sha(ROOT / row["path"]) == row["sha256"]:
            continue
        if not preview and row["path"] == "docs/audits/README.md":
            lines = (ROOT / row["path"]).read_text().splitlines(keepends=True)
            added = [line for line in lines if re.match(r"^\| AUD-030 \|", line)]
            assert len(added) == 1, "Expected one AUD-030 index row"
            original = "".join(line for line in lines if line not in added)
            assert hashlib.sha256(original.encode()).hexdigest() == row["sha256"], "Index changes exceed the new row"
            changes.append(row["path"])
        else:
            raise AssertionError("Baseline drift: " + row["path"])
    assert len(report["scope"]["fileLedger"]) == 958
    assert len(report["checks"]["coverageLedger"]) == 32
    assert len({r["rule"] for r in report["scope"]["coreRuleLedger"]}) == 53
    assert len(report["newSkills"]["skills"]) == 33
    expected_skills = {row["name"] for row in read(EVIDENCE / "installed-skill-catalog.json")["skills"]}
    assert {row["name"] for row in report["newSkills"]["skills"]} == expected_skills, "Skill set differs"
    for skill in report["newSkills"]["skills"]:
        path = ROOT.parent / ".github/skills" / skill["name"] / "SKILL.md"
        assert sha(path) == skill["sha256"], "Installed skill changed: " + skill["name"]
    assert all("pending" not in s["status"] for s in report["newSkills"]["skills"])
    for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", text):
        link = match.group(1).split("#")[0]
        if link and not re.match(r"^[a-z]+:", link):
            assert (stem.parent / link).exists(), "Missing report link: " + link
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=ROOT, text=True)
    assert not any("-evidence/" in p for p in staged.splitlines()), "Evidence is staged"
    output = {"auditId": "AUD-030", "preview": preview, "jsonschemaVersion": importlib.metadata.version("jsonschema"),
              "schemaSha256": sha(schema_path), "reportJsonSha256": sha(stem.with_suffix(".json")),
              "reportMarkdownSha256": sha(stem.with_suffix(".md")), "findingCount": len(ids),
              "baselineFilesChecked": 958, "publicationOnlyChangedFiles": changes,
              "sourceFingerprint": report["snapshot"]["sourceFingerprint"], "evidenceStaged": False,
              "result": "passed", "limits": "Record/identity/publication validation only, not new product acceptance."}
    if not preview:
        (EVIDENCE / "report-validation.json").write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    inspect()
