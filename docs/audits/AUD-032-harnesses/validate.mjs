// Validate audit identity/claims and the actual independent final-pair acceptance.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTextProblems, ownerNames } from "../../../scripts/verify-audit-privacy.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspace = resolve(root, "..");
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const reportPath = "docs/audits/AUD-032-2026-10-16.json";
const markdownPath = reportPath.replace(/\.json$/u, ".md");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const actualHash = (path) => sha(readFileSync(resolve(root, path)));

function schemaValidation() {
  const schema = resolve(workspace, "multi-chain-wallet-tools/docs/audit-report.schema.json");
  const script = `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result
try:
    json.loads('{"x":{"y":1,"y":2}}', object_pairs_hook=unique)
except ValueError:
    pass
else:
    raise ValueError("Duplicate-key negative control failed")
assert json.loads('{"x":{"y":1},"z":{"y":2}}', object_pairs_hook=unique)["z"]["y"] == 2
schema = json.loads(Path(sys.argv[1]).read_text(), object_pairs_hook=unique)
record = json.loads(Path(sys.argv[2]).read_text(), object_pairs_hook=unique)
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema).validate(record)
print("Canonical draft-2020-12 schema and duplicate-key controls passed.")
`;
  execFileSync("python3", ["-B", "-c", script, schema, resolve(root, reportPath)], { cwd: root, stdio: "inherit" });
}

function validateSource(snapshot, report) {
  assert.equal(git("rev-parse", "HEAD").trim(), snapshot.commit);
  const names = [...new Set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))]
    .filter((path) => path && !path.startsWith("docs/audits/")).sort();
  const source = names.map((path) => ({ path, sha256: actualHash(path) }));
  assert.equal(source.length, 607);
  assert.equal(sha(JSON.stringify(source)), snapshot.sourceFingerprint);
  assert.equal(report.snapshot.sourceFingerprint, snapshot.sourceFingerprint);
  for (const file of snapshot.files.filter((file) => file.path.startsWith("docs/audits/"))) {
    if (file.path !== "docs/audits/README.md") {
      assert.equal(actualHash(file.path), file.sha256, file.path);
      continue;
    }
    const index = readFileSync(resolve(root, file.path), "utf8");
    const rows = index.split("\n").filter((line) => /^\| AUD-032 \|/u.test(line));
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes("AUD-032-2026-10-16.md"));
    const old = index.split("\n").filter((line) => !/^\| AUD-032 \|/u.test(line)).join("\n");
    assert.equal(sha(old), file.sha256, "Unexpected historical index change");
  }
  for (const name of ["procedure-hashes.json", "instruction-hashes.json"])
    for (const input of read(`docs/audits/AUD-032-evidence/${name}`))
      assert.equal(sha(readFileSync(resolve(workspace, input.path))), input.sha256, input.path);
}

function validateCoverage(snapshot, report, markdown) {
  const guide = readFileSync(resolve(workspace, "multi-chain-wallet-tools/docs/FULL_AUDIT_GUIDE.md"), "utf8");
  const ids = [...guide.matchAll(/^### (CHECK-[A-Z]+-\d{3}) — /gmu)].map((match) => match[1]).sort();
  assert.equal(ids.length, 32);
  assert.deepEqual(report.checks.map((check) => check.checkId).sort(), ids);
  const files = report.scope.fileLedger;
  assert.equal(files.length, snapshot.files.length);
  assert.equal(new Set(files.map((file) => file.path)).size, 1038);
  for (const file of files) {
    assert.ok(file.method && file.depth, file.path);
    assert.ok(snapshot.files.some((input) => input.path === file.path && input.sha256 === file.sha256), file.path);
  }
  const rules = report.scope.ruleLedger;
  assert.equal(rules.length, 104);
  assert.equal(new Set(rules.map((rule) => rule.ruleId)).size, 104);
  for (let number = 1; number <= 53; number++)
    assert.ok(rules.some((rule) => rule.ruleId === `CORE-${String(number).padStart(2, "0")}`));
  const findingIds = report.findings.map((finding) => finding.id);
  assert.equal(new Set(findingIds).size, findingIds.length);
  assert.deepEqual(findingIds, ["AUD-032-BLD001", "AUD-032-BLD002", "AUD-032-DOC001"]);
  for (const finding of report.findings) {
    assert.equal(finding.category, finding.id.split("-")[2].slice(0, 3));
    assert.ok(markdown.includes(`#### ${finding.id} — `));
    assert.ok(markdown.includes(`- **Severity:** ${finding.severity}.`));
    assert.ok(markdown.includes(`- **Status:** ${finding.status}.`));
    assert.equal(finding.sourceFingerprint, snapshot.sourceFingerprint);
  }
  for (const check of report.checks) {
    assert.equal(check.primaryOwner, "coordinator");
    assert.ok(["passed", "failed", "blocked", "skipped", "not-run", "not-applicable"].includes(check.outcome));
    if (check.outcome === "failed") assert.ok(check.relatedFindings.length > 0);
    for (const id of check.relatedFindings) assert.ok(findingIds.includes(id), id);
  }
  const suite = read("docs/audits/AUD-032-evidence/suite-summary.json");
  assert.deepEqual(suite.counts, { total: 2790, passed: 2784, failed: 2, pending: 4, todo: 0 });
  assert.equal(suite.files, 184);
  assert.equal(suite.inventoriedFiles, 185);
  assert.equal(new Set(suite.results.map((row) => row.path)).size, 184);
  assert.deepEqual(suite.failedCommands, ["suite-123", "suite-143"]);
  assert.equal(suite.excluded.length, 1);
  assert.equal(suite.excluded[0].path, "test/self-test-integrity.test.ts");
  assert.equal(report.releaseVerification.releaseAccepted, false);
  assert.equal(report.releaseVerification.verdict, "FAIL");
}

function verifyBindings(inputs, context) {
  assert.ok(Array.isArray(inputs) && inputs.length > 0, context);
  for (const input of inputs) {
    assert.ok(typeof input.path === "string" && typeof input.sha256 === "string", context);
    assert.equal(actualHash(input.path), input.sha256, `${context}: ${input.path}`);
  }
}

function validateReceipts(report, requireFinalAcceptance) {
  for (const row of report.executions) {
    assert.equal(actualHash(row.evidence.command), row.commandRecordSha256, row.label);
    assert.equal(actualHash(row.evidence.log), row.logSha256, row.label);
    const original = read(row.evidence.command);
    assert.equal(original.exitCode, row.exitCode, row.label);
    assert.equal(original.sourceBefore, report.snapshot.sourceFingerprint, row.label);
    assert.equal(original.sourceAfter, report.snapshot.sourceFingerprint, row.label);
    assert.ok(original.minimumAvailableBytes >= 3 * 1024 ** 3, row.label);
    assert.ok(original.peakProcessRssBytes <= original.rssBudgetBytes, row.label);
  }
  verifyBindings(report.reviewInputs, "Primary assessment inputs");
  verifyBindings(report.ownHarnessInputs, "Published harness inputs");
  const current = readdirSync(resolve(root, "docs/audits/AUD-032-harnesses")).sort();
  assert.deepEqual(report.ownHarnessInputs.map((row) => row.path.split("/").at(-1)).sort(), current);
  const protocol = read("docs/audits/AUD-032-evidence/protocol-skeptic.json");
  const contract = read("docs/audits/AUD-032-evidence/contract-skeptic.json");
  const release = read("docs/audits/AUD-032-evidence/contract-skeptic-wave3.json");
  verifyBindings(protocol.reviewedInputs, "Protocol skeptic");
  verifyBindings(contract.reviewedInputs, "Contract skeptic");
  verifyBindings(release.reviewedInputs, "Release evidence skeptic");
  if (!requireFinalAcceptance) return { status: "pending independent exact-pair review" };
  const finalPath = "docs/audits/AUD-032-evidence/final-completeness-review.json";
  const final = read(finalPath);
  assert.equal(final.auditRecordAccepted, true, "Independent final audit-record acceptance");
  verifyBindings(final.reviewedInputs, "Final independent completeness");
  for (const required of [reportPath, markdownPath,
    "docs/audits/AUD-032-evidence/coverage.json", "docs/audits/AUD-032-evidence/findings.json",
    "docs/audits/AUD-032-harnesses/report.mjs", "docs/audits/AUD-032-harnesses/validate.mjs"])
    assert.ok(final.reviewedInputs.some((row) => row.path === required), `Missing final input ${required}`);
  return { path: finalPath, sha256: actualHash(finalPath), verdict: final.verdict ?? null };
}

function validatePrivacyAndLinks(reportText, markdown) {
  for (const [text, path] of [[reportText, reportPath], [markdown, markdownPath]])
    assert.deepEqual(auditTextProblems(text, path, ownerNames()), [], path);
  assert.ok(!/\/home\/(?!user(?:\/|["'\s]))[^/\s"']+/u.test(reportText + markdown));
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (target.includes("://") || target.startsWith("#")) continue;
    assert.ok(existsSync(resolve(root, dirname(markdownPath), target.split("#")[0])), target);
    if (target.includes("-evidence/")) assert.ok(markdown.includes("local-only"));
  }
  const staged = git("diff", "--cached", "--name-only");
  assert.ok(!staged.split("\n").some((path) => /AUD-\d+-evidence/u.test(path)));
  execFileSync("git", ["check-ignore", "--quiet", "docs/audits/AUD-032-evidence/snapshot.json"], { cwd: root });
}

async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(resolve(root, path))) digest.update(bytes);
  return digest.digest("hex");
}

async function seal() {
  const files = readdirSync(evidence, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS")
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)));
  files.push(reportPath, markdownPath, ...readdirSync(resolve(root, "docs/audits/AUD-032-harnesses"))
    .map((name) => `docs/audits/AUD-032-harnesses/${name}`));
  const lines = [];
  for (const path of files.sort()) lines.push(`${await hashFile(path)}  ${path}`);
  writeFileSync(resolve(evidence, "SHA256SUMS"), lines.join("\n") + "\n");
  console.log(JSON.stringify({ sealedFiles: lines.length,
    manifest: "docs/audits/AUD-032-evidence/SHA256SUMS" }));
}

async function validateArtifacts(report) {
  const data = report.artifacts;
  const media = read("docs/audits/AUD-032-evidence/media-summary.json");
  const files = [...data.dist.files, ...data.linux.first, ...data.linux.second,
    ...data.oldRelease.files, ...media.artifacts];
  for (const file of files) {
    assert.equal(statSync(resolve(root, file.path)).size, file.bytes, file.path);
    assert.equal(await hashFile(file.path), file.sha256, file.path);
  }
  return files.length;
}

if (process.argv.includes("--seal")) {
  assert.ok(existsSync(resolve(evidence, "report-validation.json")), "Validate before sealing.");
  await seal();
} else {
  schemaValidation();
  const reportText = readFileSync(resolve(root, reportPath), "utf8");
  const report = JSON.parse(reportText);
  const markdown = readFileSync(resolve(root, markdownPath), "utf8");
  const snapshot = read("docs/audits/AUD-032-evidence/snapshot.json");
  validateSource(snapshot, report);
  validateCoverage(snapshot, report, markdown);
  validatePrivacyAndLinks(reportText, markdown);
  const preflight = process.argv.includes("--preflight");
  const acceptance = validateReceipts(report, !preflight);
  const packagePath = "docs/audits/AUD-032-evidence/final-package-review.json";
  const packed = read(packagePath);
  assert.equal(packed.noEvidenceOrExportsPacked, true);
  assert.equal(packed.missingAuditFiles.length, 0);
  assert.equal(actualHash("docs/audits/AUD-032-evidence/final-package-review-listing.json"),
    packed.listingSha256);
  assert.ok(packed.files.some((file) => file.path === reportPath));
  assert.ok(packed.files.some((file) => file.path === markdownPath));
  const checkedArtifacts = await validateArtifacts(report);
  const result = {
    auditId: "AUD-032", validatedAtUtc: new Date().toISOString(),
    report: { path: reportPath, sha256: sha(reportText) },
    markdown: { path: markdownPath, sha256: sha(markdown) },
    sourceFingerprint: snapshot.sourceFingerprint, unchangedNonAuditFiles: 607,
    fileCoverage: 1038, rules: 104, canonicalChecks: 32, findings: 3,
    executedSourceBindings: true, logBindings: true, independentInputBindings: true,
    schemaAndDuplicateKeys: true, privacyAndUtc: true, pairedIdsAndCoverage: true,
    ignoredUnstagedEvidence: true, historicalChange: "Audit index row only",
    independentFinalAcceptance: acceptance,
    artifactFilesVerified: checkedArtifacts,
    finalPackageReview: { path: packagePath, sha256: actualHash(packagePath),
      files: packed.fileCount, auditFiles: packed.auditFiles },
    releaseAccepted: false, releaseVerdict: "FAIL", executionCompleteness: "INCOMPLETE",
    checksumPolicy: "After this validation command has ended, run validate.mjs --seal as checksum maintenance, not a new product execution. It includes this validation receipt/log and excludes only SHA256SUMS itself.",
  };
  writeFileSync(resolve(evidence, preflight ? "preflight-validation.json" : "report-validation.json"),
    JSON.stringify({ ...result, independentFinalAcceptancePending: preflight }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result));
}
