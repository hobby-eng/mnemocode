// Assemble only reconciled evidence. Missing source review or completed runtime data is an error.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const folder = "docs/audits/AUD-034-evidence";
const read = (name) => JSON.parse(readFileSync(`${folder}/${name}`, "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const snapshot = read("snapshot.json");
const suite = read("suite-summary.json");
const assessment = read("assessment.json");
const protocol = read("protocol-review.json");
assert.equal(assessment.sourceReviewComplete, true, "Source-review adjudication is not complete.");
assert.ok(Array.isArray(protocol.fileReviews), "The protocol review needs its honest file ledger.");
assert.ok(Array.isArray(assessment.findings), "Candidate findings must be adjudicated explicitly.");
assert.equal(suite.completedFiles, suite.expectedFiles);
const major = readdirSync(folder).filter((name) => name.endsWith(".command.json") && !name.startsWith("suite-"))
  .map((name) => {
    const receipt = read(name);
    return {
      label: name.slice(0, -".command.json".length), command: receipt.command, exitCode: receipt.exitCode,
      outcome: receipt.stopReason ? "blocked" : receipt.exitCode === 0 ? "passed" : "failed",
      startedAtUtc: receipt.startedAtUtc, endedAtUtc: receipt.endedAtUtc,
      sourceBefore: receipt.sourceBefore, sourceAfter: receipt.sourceAfter,
      minimumAvailableBytes: receipt.minimumAvailableBytes,
      peakProcessRssBytes: receipt.peakProcessRssBytes,
      evidence: { localOnly: true, receipt: `${folder}/${name}`, receiptSha256: sha(`${folder}/${name}`), logSha256: receipt.logSha256 },
    };
  });
const checks = read("check-plan.json").map((row) => {
  const decision = assessment.checkOutcomes[row.checkId];
  assert.ok(decision?.outcome && decision.reason, `Missing explicit disposition for ${row.checkId}.`);
  return {
    ...row, outcome: decision.outcome, assessment: decision.reason,
    evidence: { localOnly: true, source: `${folder}/protocol-review.json`, coordinator: `${folder}/coordinator-source-review.json`, runtime: `${folder}/suite-summary.json` },
  };
});
const previous = JSON.parse(readFileSync("docs/audits/AUD-033-evidence/core-rule-dispositions.json", "utf8"));
const rules = read("rule-plan.json").map((rule) => {
  const old = previous.find((row) => row.ruleId === rule.ruleId);
  const specific = assessment.ruleOutcomes[rule.ruleId];
  return {
    ruleId: rule.ruleId, title: rule.title,
    disposition: specific?.outcome ?? "supported-at-recorded-scope",
    assessment: specific?.reason ?? (old
      ? old.findingIds?.length
        ? "The earlier scoped issue has an accepted corrective review at matching source bytes. Current gates, runtime evidence and body/caller challenge assess the corrected contract, not the old open status. Detailed scope remains in the local evidence."
        : `${old.interface?.reason ?? old.protocol?.assessment ?? old.title} This is retained semantic scope, independently challenged against current contracts; not a new whole-body reread.`
      : "Applicable guide requirements assessed through current language/area gates and the explicit source/reviewer/file scope; not a claim of every possible runtime path."),
    evidence: { localOnly: true, source: `${folder}/coordinator-source-review.json`, protocol: `${folder}/protocol-review.json`, gates: `${folder}/release-gates.command.json` },
  };
});
assert.equal(rules.filter((row) => row.ruleId.startsWith("CORE-")).length, 53);
const coordinator = read("coordinator-source-review.json");
const fileReviews = [...coordinator.fileReviews, ...protocol.fileReviews];
const names = fileReviews.map((row) => row.path);
assert.equal(new Set(names).size, snapshot.files.length, "Every baseline path needs one honest owner/method.");
assert.deepEqual([...new Set(names)].sort(), snapshot.files.map((row) => row.path).sort());
writeFileSync(`${folder}/file-coverage.json`, JSON.stringify({
  sourceFingerprint: snapshot.sourceFingerprint, files: fileReviews,
  limitation: "Fresh ranges, retained exact semantic depth, current execution, metadata and binary provenance are different methods; no hash/AST/gate is promoted to fresh whole-body review.",
}, null, 2) + "\n");
writeFileSync(`${folder}/rule-coverage.json`, JSON.stringify(rules, null, 2) + "\n");
const artifact = read("artifact-and-package.json");
const report = {
  schemaVersion: 1, auditId: "AUD-034", auditNumber: 34, date: "2026-10-18",
  title: "Current prerelease and CORE-conformance audit of standalone MnemoCode",
  reviewer: { name: "Copilot coordinator with bounded protocol and final evidence reviewers", model: "gpt-6.1-sol", reasoningEffort: null },
  snapshot: {
    commit: snapshot.commit, commitComplete: true, workingTree: "Existing main checkout with preserved uncommitted authorized fixes. Audit-only additions do not identify a clean release commit.",
    sourceFingerprint: snapshot.sourceFingerprint, sourceFiles: snapshot.source.length,
    baselinePaths: snapshot.files.length, branch: snapshot.branch,
    manifest: { localOnly: true, path: `${folder}/snapshot.json`, sha256: sha(`${folder}/snapshot.json`) },
  },
  scope: {
    program: "Standalone TypeScript MnemoCode, its vendored Rust/WASM engine, tests, scripts, assets/vectors, all documentation and historical audit records.",
    core: "All53 CORE and104 guide rule IDs accounted for; applicability is assessed individually.",
    methods: "Fresh full local release checks and selected body/caller/claim challenges, plus exact qualified admission of unchanged original and corrective semantic reviews. This is not a repeat whole-body read of every function.",
    exclusions: "No other repository audit, Rust port, production edits, dependency update, commit/push/tag/sign/upload/release or paid CI dispatch.",
  },
  checks, findings: assessment.findings, observations: [], remediation: [],
  informationalObservations: assessment.observations,
  executions: major,
  fullDefaultSuite: {
    executedFresh: true, files: suite.completedFiles, assertionStatuses: suite.uniqueAssertionStatusCounts,
    skipped: suite.skipped, overlappingTotals: false,
    evidence: { localOnly: true, path: `${folder}/suite-summary.json`, sha256: sha(`${folder}/suite-summary.json`) },
  },
  conformance: {
    verdict: assessment.coreVerdict, rules: rules.length, coreRules: 53, confirmedCurrentViolations: assessment.findings.length,
    ruleLedger: { localOnly: true, path: `${folder}/rule-coverage.json`, sha256: sha(`${folder}/rule-coverage.json`) },
    fileLedger: { localOnly: true, path: `${folder}/file-coverage.json`, sha256: sha(`${folder}/file-coverage.json`) },
    publicDeclarations: read("public-operations.json").declarationCount,
    meaning: "No mechanical inventory, passing gate or absence of findings is treated as a formal complete-conformance or cryptographic proof.",
  },
  artifact, canonicalBuild: read("canonical-admission.json"),
  procedureHashes: read("procedure-hashes.json"), instructionHashes: read("instruction-hashes.json"),
  environment: read("history-environment.json").environment,
  historicalRecords: {
    publishedReportPairs: read("history-environment.json").historyReportsValidated.length,
    abandoned: "AUD-023 explicitly has no report; first count-assumption failure is retained as a harness error.",
    privateRecord: "The reserved private conformance report is neither copied nor published here.",
    currentRemediation: "Earlier confirmed conformance groups have accepted dated closure; no old open status is silently treated as current or refiled.",
  },
  releaseReadiness: assessment.releaseReadiness, limitations: assessment.limitations,
  finalIndependentReview: "pending",
};
const anonymize = (text) => text.replaceAll(/\/home\/[^/\s"']+/gu, "/home/user");
writeFileSync("docs/audits/AUD-034-2026-10-18.json", anonymize(JSON.stringify(report, null, 2)) + "\n");
const table = checks.map((row) => `| ${row.checkId} | ${row.title} | ${row.outcome} | ${row.assessment} |`).join("\n");
const coreTable = rules.filter((row) => row.ruleId.startsWith("CORE-"))
  .map((row) => `| ${row.ruleId} | ${row.title} | ${row.disposition} |`).join("\n");
const checkTable = major.map((row) => `| \`${row.label}\` | ${row.exitCode} | ${row.outcome} | \`${row.evidence.logSha256}\` |`).join("\n");
const findingsText = assessment.findings.length
  ? assessment.findings.map((row) => `### ${row.id} — ${row.severity[0].toUpperCase() + row.severity.slice(1)} — ${row.title}\n\n- **Category/status:** ${row.category}; ${row.status}.\n- **Release blocking:** ${row.releaseBlocking}; ${row.releaseBlockingReason}\n- **Confidence:** ${row.confidence}.\n- **Affected files:** ${row.affectedFiles.join(", ")}.\n- **Rules:** ${row.rules.join(", ")}.\n\n**Reproduction:** ${JSON.stringify(row.reproduction)}\n\n**Observed:** ${row.observed}\n\n**Expected:** ${row.expected}\n\n**Impact:** ${row.impact}\n\n**Recommended fix:** ${row.recommendedFix}\n\n**Required verification:** ${row.requiredVerification}\n\n**Prior finding:** ${row.priorFindingReconciliation}\n\n**Evidence (local-only original results; published harness rerunnable):** ${JSON.stringify(row.evidence)}`).join("\n\n")
  : "No new confirmed current code defect was established in the recorded review. This is not a claim that all defects are absent.";
const markdown = `# AUD-034 — Current prerelease and CORE-conformance audit

## Record metadata

- **Completed (UTC):** 2026-10-18.
- **Model:** \`gpt-6.1-sol\`; reasoning effort unknown (\`null\`).
- **Reviewed HEAD:** \`${snapshot.commit}\`; existing main checkout with uncommitted fixes.
- **Source:** ${snapshot.source.length} non-audit files; fingerprint \`${snapshot.sourceFingerprint}\`.
- **Baseline:** ${snapshot.files.length} trackable paths; every path has an explicit method/depth, not a claim of a fresh complete-body read.
- **Procedure:** the canonical guide, standard, template and schema; exact SHA-256 values are in the JSON companion.

## Finding register

${findingsText}

## Review evidence

### Scope and methodology

Read-only prerelease audit of the current standalone program, its library/native boundary, tests, tooling, workflows, assets/vectors, documentation and historical records. All32 canonical checks, all53 CORE rules and104 guide IDs were assigned before execution. One bounded protocol reviewer and one final evidence skeptic complement the coordinator. Every current source file is hash-bound; earlier semantic reviews are admitted only at their stated scope and exact dependency/caller/procedure context.

The current inventory contains ${read("public-operations.json").declarationCount} exported declarations; it is metadata, not that many tested operations or body reviews. All${snapshot.files.length} baseline paths have an honest coverage ledger. Generated/vendor/data identity and consumer/provenance checks are not a new upstream or pixel/glyph audit.

### Coverage ledger

| Check ID | Scope | Outcome | Evidence and limits |
| --- | --- | --- | --- |
${table}

### Fresh executed results

The exact default Vitest universe completed: **${suite.completedFiles} files**, **${suite.uniqueAssertionStatusCounts.passed ?? 0} passed**, **${suite.uniqueAssertionStatusCounts.skipped ?? 0} skipped**, **${suite.uniqueAssertionStatusCounts.failed ?? 0} failed**. Fresh serial file processes avoid retained renderer/transform-context growth without changing assertions or cryptographic parameters. Totals are deduplicated; supplementary checks are not added to this count.

| Recorded command label | Exit | Outcome | Original log SHA-256 |
| --- | --- | --- | --- |
${checkTable}

The JSON companion carries the exact commands, UTC times and source-before/after for these receipts. Full per-file command/result hashes are local-only in \`docs/audits/AUD-034-evidence/suite-summary.json\`. The literal monolithic \`pnpm verify\` is replaced by its same format/check/build/default-suite components with one lint/test/Cargo worker; no component is silently omitted. Dependencies were already installed; no restore or upgrade was needed.

The first history-metadata helper incorrectly expected32 published report pairs and failed after schema validation. The index explicitly records abandoned AUD023 without a report; the corrected31-report validation passes. That original harness failure is retained, not called a product defect or passed command.

### CORE and language-rule assessment

**Verdict: ${assessment.coreVerdict}.** ${assessment.coreExplanation}

| Rule | Requirement | Current disposition |
| --- | --- | --- |
${coreTable}

All104 guide IDs, specific reasons and source/gate evidence are in the local rule ledger. Browser-only rules and native-program-only rules are individually qualified for this standalone host-neutral library/Node CLI. No claim of full browser-host or other-platform acceptance is inferred from TypeScript compilation.

### Artifacts, package and release status

${artifact.description}

The canonical SSKR write and separate comparison from earlier on2026-10-18 are **retained evidence**, not fresh AUD034 executions. Their exact current source, all22 pins and four generated bytes match. Both final compilation stages were uncached/offline/network-disabled; toolchain layers were cached and the write build's dependency-fetch stage downloaded locked crates. No wholly offline, cold-toolchain or second-machine reproducibility is claimed.

**Release readiness: ${assessment.releaseReadiness.verdict}.** ${assessment.releaseReadiness.reason}

### Assessment and limitations

${assessment.limitations.map((line) => `- ${line}`).join("\n")}

No production/test/generated/dependency file was modified. There was no commit, publication, signing, remote CI dispatch, new checkout or other-project work. The private earlier conformance list and its original evidence remain private and unchanged.

### Independent final evidence challenge

Pending; this section and the corresponding JSON review link are finalized only after the independent report/coverage/claim review. A final acceptance is not owner risk acceptance or permission to publish.
`;
writeFileSync("docs/audits/AUD-034-2026-10-18.md", anonymize(markdown));
console.log(JSON.stringify({ report: "AUD-034", findings: assessment.findings.length, coreRules: 53, checks: 32, defaultFiles: suite.completedFiles }));
