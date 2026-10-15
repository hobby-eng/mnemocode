// Publish source-bound follow-up evidence without changing the frozen baseline assessment.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCatalog } from "../../../src/core/error-catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const local = resolve(root, "docs/audits/AUD-031-evidence");
const older = resolve(root, "docs/audits/AUD-030-evidence");
const ERRORS = new ErrorCatalog("audits.aud031.remediation", {
  incomplete: () => "The remediation evidence is incomplete or not independently accepted.",
  drift: (path) => `The retained remediation input changed: ${path}.`,
  retained: () => "The follow-up already exists; preserve the published record.",
  commit: () => "The code commit must be a full hexadecimal commit identifier.",
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (path) => readFileSync(path);
const read = (path) => JSON.parse(bytes(path));
const input = (path) => ({ localOnly: true, path: path.replace(root, ""), sha256: sha(bytes(path)) });
const plan = read(resolve(local, "remediation-plan.json"));
const source = read(resolve(local, "r47-current-source.json"));
const publish = process.argv.includes("--publish");
const metadataReviewPath = resolve(local, "r50-remediation-review.json");
const FOLLOWUP_HARNESSES = ["remediation.mjs", "remediation-README.md", "remediation-probes.mjs"];
const commitAt = process.argv.indexOf("--code-commit");
const codeCommit = commitAt < 0 ? null : process.argv[commitAt + 1];
if (codeCommit !== null && !/^[0-9a-f]{40}$/u.test(codeCommit ?? ""))
  throw ERRORS.create("commit", []);

function sourceAdmission() {
  for (const row of source.files)
    if (sha(bytes(resolve(root, row.path))) !== row.sha256)
      throw ERRORS.create("drift", [row.path]);
  const artifacts = read(resolve(local, "r47-build-artifacts.json"));
  if (artifacts.sourceFingerprint !== source.sourceFingerprint)
    throw ERRORS.create("incomplete", []);
  for (const row of artifacts.files)
    if (sha(bytes(resolve(root, row.path))) !== row.sha256)
      throw ERRORS.create("drift", [row.path]);
  return artifacts;
}

function execution(label, current) {
  const path = resolve(older, label + ".command.json");
  const row = read(path);
  const log = resolve(older, label + ".log");
  if (sha(bytes(log)) !== row.logSha256 || row.exitCode !== 0 || row.stopReason ||
      row.sourceBefore !== row.sourceAfter || (current && row.sourceAfter !== source.sourceFingerprint))
    throw ERRORS.create("incomplete", []);
  return { ...row, record: input(path), log: input(log), attribution:
    "Coordinator execution through the retained AUD-030 guard; paths anonymized for publication. Original argv and logs remain local." };
}

function reviews() {
  return plan.reviews.map((name) => {
    const path = resolve(local, name);
    if (!existsSync(path)) {
      if (publish) throw ERRORS.create("incomplete", []);
      return { path: name, status: "pending" };
    }
    const row = read(path);
    if (publish && (!row.status?.startsWith("complete") ||
        !(row.acceptedSnapshot === true || row.acceptedArtifact === true || row.accepted === true)))
      throw ERRORS.create("incomplete", []);
    return { ...input(path), status: row.status, verdict: row.verdict,
      limits: row.limitations, confirmedFindings: row.confirmedFindings ?? [] };
  });
}

function admitMetadata() {
  if (!existsSync(metadataReviewPath)) throw ERRORS.create("incomplete", []);
  const review = read(metadataReviewPath);
  const required = FOLLOWUP_HARNESSES.map((name) =>
    "docs/audits/AUD-031-harnesses/" + name);
  required.push(...["remediation-plan.json", "r47-current-source.json", "r47-build-artifacts.json",
    "aud031-typescript-handoff.json", "remediation-preview.json", "remediation-preview.md",
    ...plan.reviews].map((name) => "docs/audits/AUD-031-evidence/" + name));
  required.push("docs/audits/AUD-031-2026-10-15.json", "docs/audits/AUD-031-2026-10-15.md");
  for (const label of [...plan.currentChecks, ...plan.retainedChecks.map((row) => row.label)])
    required.push(...[".command.json", ".log"].map((suffix) =>
      "docs/audits/AUD-030-evidence/" + label + suffix));
  const rows = review.reviewedInputs;
  if (!["complete", "complete-with-limitations"].includes(review.status) ||
      review.acceptedFinalInputs !== true || !Array.isArray(rows) ||
      new Set(rows.map((row) => row.path)).size !== rows.length ||
      required.some((path) => !rows.some((row) => row.path === path)))
    throw ERRORS.create("incomplete", []);
  for (const row of rows)
    if (sha(bytes(resolve(root, row.path))) !== row.sha256)
      throw ERRORS.create("drift", [row.path]);
  return { ...input(metadataReviewPath), status: review.status,
    acceptedFinalInputs: true, limits: review.limitations };
}

function addendum() {
  const capsulePath = resolve(local, "aud031-typescript-handoff.json");
  if (sha(bytes(capsulePath)) !== plan.handoffSha256) throw ERRORS.create("drift", ["handoff"]);
  const capsule = read(capsulePath);
  if (capsule.sourceFingerprint !== source.sourceFingerprint) throw ERRORS.create("incomplete", []);
  return { updatedAtUtc: new Date().toISOString(), scope: plan.scope,
    originalBaselineFindingCount: 7, additionalPostBaselineFindingCount: plan.additionalFindings.length,
    additionalPostBaselineFindings: plan.additionalFindings,
    sourceManifest: input(resolve(local, "r47-current-source.json")), sourceFingerprint: source.sourceFingerprint,
    sourceFiles: source.files, codeCommit, artifacts: sourceAdmission(),
    currentExecutions: plan.currentChecks.map((label) => execution(label, true)),
    qualifiedRetainedExecutions: plan.retainedChecks.map((row) => ({ ...execution(row.label, false), qualification: row.qualification })),
    independentReviews: reviews(), fixes: plan.fixes, diagnostics: plan.diagnostics,
    handoff: { ...input(capsulePath), portableFiles: capsule.portableClosure.length,
      addedPortablePaths: capsule.addedPortablePaths, changedPortable: capsule.portableChanges,
      hostAcceptance: plan.hostAcceptance },
    toolsAndSkills: plan.toolsAndSkills, limitations: plan.limitations,
    baselineAssessmentUnchanged: true, releaseAcceptance: false,
    harnesses: FOLLOWUP_HARNESSES.map((name) => ({
      path: "docs/audits/AUD-031-harnesses/" + name,
      sha256: sha(bytes(resolve(root, "docs/audits/AUD-031-harnesses", name))),
    })) };
}

function markdown(followup) {
  const lines = ["", "## Remediation follow-up (UTC: " + followup.updatedAtUtc + ")", "",
    "The original seven baseline finding objects, source snapshot, coverage and failed checks remain",
    "unchanged. The verified producer follow-up below concerns the separate source fingerprint",
    "`" + source.sourceFingerprint + "` (" + source.files.length + " non-audit files).", "",
    "| Finding | Producer disposition | Verification |", "| --- | --- | --- |",
    ...plan.fixes.map((row) => "| " + row.id + " | verified within the stated producer scope | " + row.evidence + " |"), "",
    "### Additional finding discovered during remediation", ""];
  for (const row of plan.additionalFindings) {
    lines.push("#### " + row.id + " — Low — " + row.title, "");
    for (const key of ["reproduction", "expected", "observed", "impact", "recommendedFix", "requiredVerification"])
      lines.push("- **" + key + ":** " + row[key]);
    lines.push("- **Status:** verified; this was introduced after the frozen baseline, then corrected.", "");
  }
  lines.push("### Current checks and limits", "",
    ...plan.currentChecks.map((label) => "- `" + label + "`: exit 0; anonymized argv, times and original command-record/log hashes are in the JSON companion; exact argv remain in local evidence."),
    ...plan.retainedChecks.map((row) => "- `" + row.label + "`: retained pass; " + row.qualification), "",
    "All corresponding source/command/log and review hashes are retained in the JSON. Counts from",
    "overlapping runs are not added. The six original built-module probes also passed individually;",
    "the latest built-card probe checks the final constructor. This is not a full release run.", "",
    "### Diagnostics preserved", "", ...plan.diagnostics.map((row) => "- " + row), "",
    "### Handoff and methods", "",
    "The immutable host capsule has " + followup.handoff.portableFiles + " portable files; its SHA-256 is",
    "`" + plan.handoffSha256 + "`. The new leaf is `src/export/card-values.ts`.",
    "Host acceptance: " + plan.hostAcceptance + ". No future Rust migration is requested by this capsule.", "",
    ...plan.toolsAndSkills.map((row) => "- " + row), "",
    ...plan.limitations.map((row) => "- " + row), "",
    "[Follow-up harness instructions](AUD-031-harnesses/remediation-README.md).", "");
  return lines.join("\n");
}

const stem = resolve(root, "docs/audits/AUD-031-2026-10-15");
const originalJson = bytes(stem + ".json");
const originalMarkdown = bytes(stem + ".md");
const record = JSON.parse(originalJson);
if (record.remediationAddendum) throw ERRORS.create("retained", []);
if (sha(originalJson) !== plan.baselineJsonSha256 || sha(originalMarkdown) !== plan.baselineMarkdownSha256)
  throw ERRORS.create("drift", ["baseline report"]);
const followup = addendum();
if (publish) followup.metadataAcceptance = admitMetadata();
record.remediationAddendum = { ...followup, priorReport: {
  jsonSha256: sha(originalJson), markdownSha256: sha(originalMarkdown),
  originalFindingObjectsSha256: sha(JSON.stringify(record.findings)),
} };
for (const finding of plan.additionalFindings) {
  if (record.findings.some((row) => row.id === finding.id)) throw ERRORS.create("incomplete", []);
  record.findings.push(finding);
}
record.remediation = plan.fixes.map((row) => ({ id: row.id, status: "verified",
  fixCommit: row.id === "AUD-031-DOC002" ? null : codeCommit,
  verificationCommit: row.id === "AUD-031-DOC002" ? null : codeCommit,
  evidence: row.evidence + "; source-bound producer verification only; external host/release limits are separate." }));
const owner = userInfo().username;
const sanitize = (value) => value.replaceAll("/home/" + owner + "/", "/home/user/");
const target = publish ? stem : resolve(local, "remediation-preview");
sourceAdmission();
writeFileSync(target + ".json", sanitize(JSON.stringify(record, null, 2)) + "\n");
writeFileSync(target + ".md", sanitize(originalMarkdown.toString("utf8") + markdown(followup)));
console.log(JSON.stringify({ publish, sourceFingerprint: source.sourceFingerprint,
  baselineFindings: 7, postBaselineFindings: plan.additionalFindings.length,
  jsonSha256: sha(bytes(target + ".json")), markdownSha256: sha(bytes(target + ".md")) }));
