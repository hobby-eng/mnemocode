"""Check the scoped report against its retained source, checks and package receipts."""
from pathlib import Path
import datetime
import hashlib
import importlib.metadata
import json
import re
import subprocess
from jsonschema import Draft202012Validator

if not __debug__:
    raise RuntimeError("Audit validation requires Python without -O or PYTHONOPTIMIZE.")

E = Path("docs/audits/AUD-036-evidence")
REPORT = Path("docs/audits/AUD-036-2026-10-19.json")


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique)


def sha(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def fingerprint(snapshot):
    encoded = json.dumps(snapshot["source"], ensure_ascii=False, separators=(",", ":")).encode()
    actual = hashlib.sha256(encoded).hexdigest()
    assert actual == snapshot["sourceFingerprint"], "Fingerprint does not match source rows"
    return actual


def references(value):
    if isinstance(value, dict):
        if value.get("localOnly") is True and "sha256" in value:
            assert sha(value["path"]) == value["sha256"], value["path"]
        for child in value.values():
            references(child)
    elif isinstance(value, list):
        for child in value:
            references(child)


try:
    json.loads('{"a":{"x":1,"x":2}}', object_pairs_hook=unique)
    raise AssertionError("Duplicate-key control must refuse")
except ValueError:
    pass

report = read(REPORT)
markdown = REPORT.with_suffix(".md").read_text(encoding="utf-8")
schema_path = Path("../multi-chain-wallet-tools/docs/audit-report.schema.json")
Draft202012Validator(read(schema_path)).validate(report)
pins = Path("docs/audits/AUD-030-harnesses/requirements.md")
assert sha(pins) == "25982610c624a17fe3f944925c0c5fce12a2cfddea36fee88efca1c4c29672b7"
for name, version in re.findall(r"^([\w-]+)==([^\s]+)", pins.read_text(encoding="utf-8"), re.MULTILINE):
    assert importlib.metadata.version(name) == version, "Use the hash-pinned audit environment"
references(report)
source = read(E / "final-suite-source.json")
docs = read(E / "final-documentation-source.json")
fingerprint(source)
fingerprint(docs)
assert report["snapshot"]["sourceFingerprint"] == source["sourceFingerprint"]
assert len(source["source"]) == len(docs["source"]) == 649
assert [x["path"] for x in source["source"]] == [x["path"] for x in docs["source"]]
changed = [x["path"] for x, y in zip(source["source"], docs["source"]) if x != y]
assert set(changed) == {"CHANGELOG.md", "docs/REMEDIATION.md", "docs/releases/v0.1.0.md"}
names = set(subprocess.check_output(
    ["git", "ls-files", "-co", "--exclude-standard", "-z"], text=True,
).rstrip("\0").split("\0"))
assert sorted(x for x in names if not x.startswith("docs/audits/")) == [x["path"] for x in docs["source"]]
for row in docs["source"]:
    assert sha(row["path"]) == row["sha256"], row["path"]
suite = read(E / "final/suite-summary.json")
assert suite["status"] == "passed" and suite["completedFiles"] == 211
assert suite["sourceFingerprint"] == source["sourceFingerprint"]
assert suite["counts"] == dict(numTotalTests=2989, numPassedTests=2989,
                              numFailedTests=0, numPendingTests=0, numTodoTests=0)
assert suite["versionableCi"]["files"] == 210
assert suite["versionableCi"]["counts"]["numPassedTests"] == 2988
assert report["runtime"]["fullDefaultSuite"] == suite
assert len(report["checks"]) == len({x["checkId"] for x in report["checks"]}) == 32
ids = {x["id"] for x in report["findings"]}
assert ids == {"AUD-036-DOC001", "AUD-036-UI001",
               "AUD-036-BLD001", "AUD-036-BLD002", "AUD-036-BLD003"}
assert ids == {x["id"] for x in report["remediation"]}
assert all(x["status"] == "verified" for x in report["remediation"])
assert all(x["status"] == "open" and x["severity"] == "low" for x in report["findings"])
for identifier in ids:
    assert identifier in markdown
for execution in report["executions"]:
    receipt = read(execution["receipt"]["path"])
    for field in ("exitCode", "stopReason", "sourceBefore", "sourceAfter",
                  "peakProcessRssBytes", "minimumAvailableBytes"):
        assert execution[field] == receipt[field], "Contradictory execution: " + field
    command = [x.replace(str(Path.home()), "/home/user") for x in receipt["command"]]
    assert execution["command"] == command, "Contradictory command"
    assert execution["log"]["sha256"] == receipt["logSha256"], "Contradictory log identity"
    assert execution["exitCode"] == 0 and execution["stopReason"] is None
    assert execution["sourceBefore"] == execution["sourceAfter"]
artifact = report["artifacts"]["linux"]
assert sha(artifact["path"]) == artifact["sha256"]
assert sha(artifact["licenses"]["path"]) == artifact["licenses"]["sha256"]
for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", markdown):
    if "://" not in target and not target.startswith("#"):
        assert (REPORT.parent / target.split("#")[0]).exists(), target
assert REPORT.name in Path("docs/audits/README.md").read_text(encoding="utf-8")
assert "UTC" in markdown and report["reviewer"]["model"] is None
assert not any("\u0400" <= x <= "\u04ff" for x in markdown + REPORT.read_text(encoding="utf-8"))
assert "-evidence/" not in subprocess.check_output(
    ["git", "diff", "--cached", "--name-only"], text=True,
)
result = {
    "auditId": "AUD-036", "atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "validation": "passed", "schemaSha256": sha(schema_path),
    "reportSha256": sha(REPORT), "markdownSha256": sha(REPORT.with_suffix(".md")),
    "runtimeSourceFingerprint": source["sourceFingerprint"],
    "documentationSourceFingerprint": docs["sourceFingerprint"],
    "documentationOnlyDelta": changed, "rawTests": 2989, "projectTests": 2988,
    "failed": 0, "skipped": 0, "checks": 32, "findings": 5,
    "qualification": "Scoped evidence/schema consistency, not independent runtime or external acceptance.",
    "pythonPinsSha256": sha(pins),
}
(E / "report-validation.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
