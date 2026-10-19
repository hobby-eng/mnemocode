"""Validate the final report and its exact local evidence, without product edits."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
from jsonschema import Draft202012Validator

E = Path("docs/audits/AUD-035-evidence")


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def read(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=unique)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check(condition, message):
    if not condition:
        raise AssertionError(message)


try:
    json.loads('{"negative":1,"negative":2}', object_pairs_hook=unique)
    raise AssertionError("Duplicate-key negative control did not fail")
except ValueError:
    pass

paths = read(E / "report-paths.json")
report = read(paths["json"])
markdown = Path(paths["markdown"]).read_text()
schema = read("../multi-chain-wallet-tools/docs/audit-report.schema.json")
Draft202012Validator(schema).validate(report)
snapshot = read(E / "snapshot.json")
fp = snapshot["sourceFingerprint"]
check(report["snapshot"]["sourceFingerprint"] == fp, "Report source identity")
check(subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == snapshot["commit"], "HEAD changed")
current = sorted(p for p in subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "-z"], text=True).split("\0") if p and not p.startswith("docs/audits/"))
check(current == [r["path"] for r in snapshot["source"]], "Non-audit membership changed")
for row in snapshot["source"]:
    check(sha(row["path"]) == row["sha256"], "Product input changed: " + row["path"])
for row in snapshot["files"]:
    if row["path"] != "docs/audits/README.md":
        check(sha(row["path"]) == row["sha256"], "Pre-existing audit file changed: " + row["path"])
for name in ["procedure-hashes", "instruction-hashes"]:
    for row in read(E / (name + ".json")):
        check(sha(row["path"]) == row["sha256"], "Procedure changed: " + row["path"])
check({x["checkId"] for x in report["checks"]} == {x["checkId"] for x in read(E / "check-plan.json")}, "CHECK coverage")
check(len(report["checks"]) == 32 and all(x["ledgerState"] == "final-local-checks-closed" for x in report["checks"]), "Incomplete local ledger")
check({x["ruleId"] for x in report["rules"]} == {x["ruleId"] for x in read(E / "rule-plan.json")}, "Rule coverage")
check(len(report["rules"]) == 104 and sum(x["ruleId"].startswith("CORE-") for x in report["rules"]) == 53, "Rule counts")
files = read(E / "file-coverage.json")["files"]
check({x["path"] for x in files} == {x["path"] for x in snapshot["files"]} and len(files) == 1094, "File ledger")
ops = read(E / "operation-coverage.json")
check(ops["counts"] == {"packageEntries": 78, "commands": 11, "nativeFunctions": 4}, "Operation ledger")
for row in report["coverage"]["evidence"]:
    check(sha(row["path"]) == row["sha256"], "Coverage evidence changed: " + row["path"])
suite = read(E / "suite-summary.json")
check((suite["completedFiles"], suite["expectedFiles"], suite["uniqueAssertionStatusCounts"], suite["failures"], suite["skipped"]) == (204, 204, {"passed": 2956}, [], []), "Suite totals")
for row in suite["executions"]:
    check(sha(row["receipt"]) == row["receiptSha256"] and sha(row["result"]) == row["resultSha256"], "Suite artifact changed")
    receipt = read(row["receipt"])
    result = read(row["result"])
    check(receipt["exitCode"] == 0 and result["success"] is True, "Suite failed")
    check(receipt["sourceBefore"] == fp == receipt["sourceAfter"], "Suite source drift")
    check(receipt["minimumAvailableBytes"] >= 3 * 1024**3, "Suite reserve breached")
for row in report["runtime"]["executions"]:
    for key in ["receipt", "log"]:
        check(sha(row[key]["path"]) == row[key]["sha256"], "Execution artifact changed")
    check(row["sourceBefore"] == fp == row["sourceAfter"], "Check source drift")
    check(row["minimumAvailableBytes"] >= 3 * 1024**3, "Check reserve breached")
normalizations = {r["path"]: r for r in read(E / "harness-publication-normalization.json")["rows"]}
for path in E.glob("*bound.artifact-context.json"):
    context = read(path)
    check(context["exitCode"] == 0 and context["beforeAfterIdentical"], "Incomplete probe")
    for row in context["sourceDistHarnessNativeInputs"]:
        if sha(row["path"]) == row["sha256"]:
            continue
        saved = normalizations.get(row["path"])
        check(saved and saved["executionSha256"] == row["sha256"] and sha(saved["retainedSource"]) == row["sha256"] and sha(row["path"]) == saved["publishedSha256"], "Unreconciled probe input: " + row["path"])
ids = [x["id"] for x in report["findings"]]
check(len(ids) == len(set(ids)) == 5, "Finding IDs")
check(sum(x["variantCount"] for x in report["findings"]) == 8, "Variant count")
for row in report["findings"]:
    check(row["severity"] == "low" and row["status"] == "open" and row["releaseBlocking"] is False, "Finding disposition")
    check(f'#### {row["id"]} — Low — {row["title"]}' in markdown, "MD/JSON finding mismatch")
    check(row["id"] in [r["id"] for r in report["remediation"]], "Remediation ID mismatch")
for path in [paths["markdown"], paths["json"]]:
    text = Path(path).read_text()
    check("UTC" in text and report["date"] in text, "Missing UTC/date")
    check(not any("\u0400" <= char <= "\u04ff" for char in text), "Non-English report text")
check(paths["markdown"].split("/")[-1] in Path("docs/audits/README.md").read_text(), "Missing index")
artifact = report["artifacts"]["linux"]
check(sha(artifact["path"]) == artifact["sha256"] == sha(artifact["repeatedSameMachineBuild"]["priorPath"]), "Linux artifact changed")
check(sha(artifact["licenses"]["path"]) == artifact["licenses"]["sha256"], "Notices changed")
canonical = read(E / "canonical-admission.json")
for row in canonical["producer"]:
    check(sha(row["path"]) == row["sha256"], "Native producer changed")
check(sha(canonical["record"]) == canonical["sha256"], "Native admission changed")
result = {
    "auditId": "AUD-035", "sourceFingerprint": fp, "sourceFiles": 631, "baselinePaths": 1094,
    "checks": 32, "rules": 104, "coreRules": 53, "defaultTests": 2956, "failed": 0, "skipped": 0,
    "findings": 5, "concreteVariants": 8, "duplicateKeyNegativeControl": "passed",
    "report": {path: sha(path) for path in [paths["markdown"], paths["json"]]},
    "executionContext": "Current bytes or explicitly retained original drivers/README with the publication-normalization mapping",
    "validation": "passed; independent final acceptance is separately recorded, not inferred by this script",
}
destination = E / (sys.argv[1] if len(sys.argv) > 1 else "report-validation.json")
destination.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
