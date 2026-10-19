// Check the final audit's schema, evidence identities, source preservation and publication privacy.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { auditTextProblems, ownerNames } from "../../../scripts/verify-audit-privacy.mjs";

const folder = "docs/audits/AUD-034-evidence";
const reportPath = "docs/audits/AUD-034-2026-10-18.json";
const markdownPath = reportPath.replace(/\.json$/u, ".md");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const report = read(reportPath);
const baseline = read(`${folder}/snapshot.json`);
const schemaCheck = `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
def unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("Duplicate JSON key: " + key)
        out[key] = value
    return out
try:
    json.loads('{"x":1,"x":2}', object_pairs_hook=unique)
except ValueError:
    pass
else:
    raise AssertionError("Duplicate-key negative control failed")
load = lambda path: json.loads(Path(path).read_text(), object_pairs_hook=unique)
schema = load(sys.argv[1])
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema).validate(load(sys.argv[2]))
print("Canonical schema and duplicate-key controls passed.")
`;
execFileSync("python3", ["-B", "-c", schemaCheck, "../multi-chain-wallet-tools/docs/audit-report.schema.json", reportPath], { stdio: "inherit" });
assert.equal(report.snapshot.sourceFingerprint, baseline.sourceFingerprint);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.commit);
const names = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0").filter((path) => path && !path.startsWith("docs/audits/")).sort();
assert.deepEqual([...new Set(names)], baseline.source.map((file) => file.path));
for (const file of baseline.source) assert.equal(sha(file.path), file.sha256, file.path);
for (const file of [...report.procedureHashes, ...report.instructionHashes])
  assert.equal(sha(file.path), file.sha256, file.path);
assert.equal(report.checks.length, 32);
assert.equal(new Set(report.checks.map((row) => row.checkId)).size, 32);
const rules = read(`${folder}/rule-coverage.json`);
assert.equal(rules.length, 104);
assert.equal(rules.filter((row) => row.ruleId.startsWith("CORE-")).length, 53);
const ledger = read(`${folder}/file-coverage.json`);
assert.deepEqual(ledger.files.map((row) => row.path).sort(), baseline.files.map((row) => row.path).sort());
for (const row of report.executions) {
  assert.equal(sha(row.evidence.receipt), row.evidence.receiptSha256);
  const receipt = read(row.evidence.receipt);
  assert.equal(receipt.sourceBefore, baseline.sourceFingerprint);
  assert.equal(receipt.sourceAfter, baseline.sourceFingerprint);
  assert.equal(receipt.exitCode, row.exitCode);
  assert.equal(sha(row.evidence.receipt.replace(/\.command\.json$/u, ".log")), row.evidence.logSha256);
  assert.ok(receipt.minimumAvailableBytes >= 3 * 1024 ** 3);
}
const suite = read(`${folder}/suite-summary.json`);
assert.equal(suite.completedFiles, suite.expectedFiles);
assert.deepEqual(suite.uniqueAssertionStatusCounts, report.fullDefaultSuite.assertionStatuses);
for (const execution of suite.executions) {
  assert.equal(sha(execution.receipt), execution.receiptSha256);
  assert.equal(sha(execution.result), execution.resultSha256);
}
const text = readFileSync(reportPath, "utf8");
const markdown = readFileSync(markdownPath, "utf8");
for (const [content, path] of [[text, reportPath], [markdown, markdownPath]])
  assert.deepEqual(auditTextProblems(content, path, ownerNames()), []);
for (const finding of report.findings) assert.ok(markdown.includes(finding.id));
assert.equal(sha(report.artifact.linux.path), report.artifact.linux.sha256);
for (const file of report.canonicalBuild.generated) assert.equal(sha(file.path), file.sha256);
assert.ok(!execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).includes("-evidence/"));
const validation = {
  outcome: "passed", validatedAtUtc: new Date().toISOString(),
  sourceFingerprint: baseline.sourceFingerprint, baselinePaths: baseline.files.length,
  sourceFiles: baseline.source.length, checks: 32, coreRules: 53, ruleIds: rules.length,
  defaultFiles: suite.completedFiles, assertionStatuses: suite.uniqueAssertionStatusCounts,
  findings: report.findings.length, evidenceStaged: false,
  reportSha256: sha(reportPath), markdownSha256: sha(markdownPath),
  finalIndependentReview: report.finalIndependentReview,
};
writeFileSync(`${folder}/report-validation.json`, JSON.stringify(validation, null, 2) + "\n");
console.log(JSON.stringify(validation));
