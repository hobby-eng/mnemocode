// Reconcile every default test file and original command receipt without overlapping totals.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const folder = "docs/audits/AUD-035-evidence";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const universe = read(`${folder}/test-universe.json`).map(({ file }) => file);
const inputHashes = read(`${folder}/test-input-hashes.json`);
assert.equal(new Set(universe).size, universe.length);
const covered = new Set();
const counts = {};
const failures = [];
const skipped = [];
const executions = [];
const failedExecutions = [];
for (let index = 0; index < universe.length; index += 1) {
  const label = `suite-${String(index + 1).padStart(3, "0")}`;
  const output = `${folder}/${label}.vitest.json`;
  const receiptPath = `${folder}/${label}.command.json`;
  const receipt = read(receiptPath);
  assert.equal(receipt.stopReason, null, `${label} was resource-stopped, not completed.`);
  assert.equal(receipt.sourceBefore, receipt.sourceAfter);
  assert.equal(sha(`${folder}/${label}.log`), receipt.logSha256);
  const result = read(output);
  assert.equal(result.testResults.length, 1);
  const test = result.testResults[0];
  if(receipt.exitCode!==0 || result.success===false || result.numFailedTestSuites>0) failedExecutions.push({label,exitCode:receipt.exitCode,message:test.message??null});
  assert.equal(test.name, universe[index]);
  assert.ok(!covered.has(test.name));
  covered.add(test.name);
  for (const item of test.assertionResults) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (item.status === "failed") failures.push({ file: test.name, name: item.fullName, messages: item.failureMessages });
    if (item.status === "skipped") skipped.push({ file: test.name, name: item.fullName });
  }
  executions.push({
    file: test.name, receipt: receiptPath, receiptSha256: sha(receiptPath),
    result: output, resultSha256: sha(output), exitCode: receipt.exitCode,
    sourceFingerprint: receipt.sourceBefore,
    minimumAvailableBytes: receipt.minimumAvailableBytes, peakProcessRssBytes: receipt.peakProcessRssBytes,
  });
}
for (const item of inputHashes) assert.equal(sha(item.path), item.sha256);
const source = read(`${folder}/snapshot.json`);
assert.ok(executions.every((item) => item.sourceFingerprint === source.sourceFingerprint));
const result = {
  auditId: "AUD-035", sourceFingerprint: source.sourceFingerprint,
  completedFiles: covered.size, expectedFiles: universe.length, uniqueAssertionStatusCounts: counts,
  failures, skipped, executions, failedExecutions, overlappingTotals: false,
  originalReceipts: readdirSync(folder).filter((name) => name.endsWith(".command.json")).length,
};
writeFileSync(`${folder}/suite-summary.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ files: covered.size, counts, failures: failures.length }));
process.exitCode = failures.length || failedExecutions.length ? 1 : 0;
