// Assemble retained review evidence; this command never runs or repairs the product.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCatalog } from "../../../src/core/error-catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const local = resolve(root, "docs/audits/AUD-031-evidence");
const ERRORS = new ErrorCatalog("audits.aud031.report", {
  incomplete: () => "The audit evidence has unresolved coverage or independent review.",
  drift: (path) => `The retained audit input changed: ${path}.`,
  retained: () => "The report already exists; preserve it and record remediation separately.",
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (path) => readFileSync(path);
const read = (name) => JSON.parse(bytes(resolve(local, name)).toString("utf8"));
const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (head, rows) => ["| " + head.join(" | ") + " |",
  "| " + head.map(() => "---").join(" | ") + " |",
  ...rows.map((row) => "| " + row.map(cell).join(" | ") + " |"), ""];

function input(name) {
  return { localOnly: true, path: name, sha256: sha(bytes(resolve(local, name))) };
}

const PRIMARY_NAMES = ["protocol-review.json", "interface-review.json", "coordinator-review.json", "history-review.json"];
const HARNESS_NAMES = ["inventory.mjs", "inventory-probes.mjs", "runtime-probes.mjs",
  "restore-owner-probes.mjs", "terminal-owner-probes.mjs", "card-owner-probes.mjs",
  "artwork-owner-probes.mjs", "font-refusal-probes.mjs", "report.mjs", "README.md"];
const ASSESSMENT_NAMES = [...PRIMARY_NAMES, "interface-context-admission.json", "coverage.json",
  "coordinator-findings.json", "guarantees.json", "skill-usage.json", "check-plan.json",
  "public-contracts.json", "snapshot.json", "procedure-hashes.json", "build-artifacts.json"];
const requiredInputs = () => [
  ...ASSESSMENT_NAMES.map((name) => "docs/audits/AUD-031-evidence/" + name),
  ...HARNESS_NAMES.map((name) => "docs/audits/AUD-031-harnesses/" + name),
];
const declarationKey = (row) => JSON.stringify([row.path, row.line, row.kind, row.name]);
const memberKey = (parent, row) => declarationKey(parent) + JSON.stringify([row.line, row.kind, row.name]);
const matches = (actual, expected) => actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  actual.toSorted().join("\n") === expected.toSorted().join("\n");

function verifyIndependent(review) {
  if (!["complete", "complete-with-limitations"].includes(review.status) ||
      review.acceptedFinalInputs !== true || !Array.isArray(review.reviewedInputs) ||
      requiredInputs().some((path) => !review.reviewedInputs.some((row) => row.path === path)))
    throw ERRORS.create("incomplete", []);
  for (const row of review.reviewedInputs)
    if (sha(bytes(resolve(root, row.path))) !== row.sha256)
      throw ERRORS.create("drift", [row.path]);
}

function verifyInputs(snapshot, reviews, coverage, independent, context, publish) {
  for (const file of snapshot.files)
    if (sha(bytes(resolve(root, file.path))) !== file.sha256)
      throw ERRORS.create("drift", [file.path]);
  const files = reviews.flatMap((review) => review.files);
  const mapping = new Map(files.map((file) => [file.path, file.sha256]));
  if (files.length !== mapping.size || mapping.size !== snapshot.files.length ||
      snapshot.files.some((file) => mapping.get(file.path) !== file.sha256))
    throw ERRORS.create("incomplete", []);
  const plan = read("check-plan.json");
  if (!matches(coverage.checks.map((row) => row.checkId), plan.checks.map((row) => row.checkId)) ||
      !matches(coverage.coreRules.map((row) => row.rule), plan.coreRules.map((row) => row.id)))
    throw ERRORS.create("incomplete", []);
  const inventory = read("public-contracts.json").contracts;
  const reviewed = reviews.flatMap((review) => review.contracts ?? []);
  if (!matches(reviewed.map(declarationKey), inventory.map(declarationKey)) ||
      !matches(reviewed.flatMap((row) => (row.members ?? []).map((member) => memberKey(row, member))),
        inventory.flatMap((row) => (row.members ?? []).map((member) => memberKey(row, member)))) ||
      reviewed.some((row) => !row.disposition || (row.members ?? []).some((member) => !member.disposition)))
    throw ERRORS.create("incomplete", []);
  if (publish) {
    if (reviews[0].status !== "complete" || reviews[1].scopeCompletion?.assignedLedgerFinished !== true ||
        reviews.slice(2).some((review) => review.status !== "complete-with-limitations") ||
        context.authority?.primarySha256 !== sha(bytes(resolve(local, PRIMARY_NAMES[1]))) ||
        context.coverage?.affectedPathsDispositioned !== 138 ||
        context.coverage?.unresolvedAffectedPaths?.length !== 0 ||
        context.validation?.missingPathCount !== 0 || context.validation?.extraPathCount !== 0 ||
        context.validation?.hashMismatches?.length !== 0)
      throw ERRORS.create("incomplete", []);
    independent.forEach(verifyIndependent);
  }
  return files;
}

function reviewedContract(row) {
  const { review: inventoryMarker, members, ...assessment } = row;
  return { ...assessment, inventoryMarker, members: (members ?? []).map((member) => {
    const { review: rawMarker, ...disposition } = member;
    return { ...disposition, inventoryMarker: rawMarker };
  }) };
}

function render(record) {
  const lines = ["# AUD-031 — Full current-tree and CORE audit", "", "## Record metadata", "",
    `Completed (UTC): ${record.date}. Exact service model and reasoning effort are unknown.`, "",
    `Reviewed signed base: \`${record.snapshot.commit}\`; the working tree was dirty.`,
    `Non-audit source: \`${record.snapshot.sourceFingerprint}\` (${record.scope.nonAuditFiles} files).`,
    `Frozen baseline inputs: \`${record.snapshot.allFilesFingerprint}\` (${record.scope.files} files).`,
    "This audit's own harnesses and assessment dossiers are separately hashed; they are excluded",
    "from the frozen baseline inventory by design.", "",
    "## Finding register", "",
    ...table(["Finding ID", "Category", "Severity", "Baseline status", "Title"],
      record.findings.map((row) => [row.id, row.category, row.severity, row.status, row.title])),
    "## Review evidence", "", "### Scope and methodology", "",
    "All tracked or trackable inputs were inventoried. Current implementation and caller/test paths",
    "were assessed with the exact per-file methods and context admissions in the JSON companion.",
    "Historical records and generated/data files have explicitly different review depths. Byte",
    "equality alone does not pass a semantic review. No implementation changed during baseline.", "",
    "The JSON publishes public declarations/members, explicit supplements, all 53 CORE dispositions,",
    "32 procedure tasks, guarantees and independent completeness evidence. Declaration and member",
    "counts are inventory kinds, not a count of independently executed operations.", "",
    "### Coverage ledger", "",
    ...table(["Check ID", "Outcome", "Evidence and limits"],
      record.checks.coverageLedger.map((row) => [row.checkId, row.outcome, row.evidence])),
    "### Checks", "",
    ...table(["Command or retained group", "Result", "Qualification"], record.checks.summary),
    "### Findings", ""];
  for (const row of record.findings) {
    lines.push(`#### ${row.id} — ${row.severity[0].toUpperCase() + row.severity.slice(1)} — ${row.title}`, "");
    for (const [label, value] of Object.entries({ Category: row.category, Status: row.status,
      "Release blocking": `${row.releaseBlocking}; ${row.releaseBlockingReason}`,
      "Affected files": row.files.join(", "), Reproduction: row.reproduction,
      "Expected behavior": row.expected, "Observed behavior": row.observed,
      Impact: row.impact, Evidence: row.evidence.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("; "),
      "Recommended fix": row.recommendedFix, "Required verification": row.requiredVerification }))
      lines.push(`- **${label}:** ${value}`);
    lines.push("");
  }
  lines.push("### Remediation and follow-up", "",
    "This is the frozen baseline. Later authorized fixes and source-bound verification belong in",
    "a dated addendum. Prior corrected owner/native variants retain their original evidence; the",
    "remaining owner variants use AUD-029-SEC001 rather than duplicate security finding IDs.", "",
    "### Tools and skills", "",
    "The 30 Trail of Bits methods and three local adapters installed before AUD-030 remain available.",
    "No toolchain or dependency version was installed for AUD-031. Each method's hash, actual use,",
    "inapplicability or unavailable execution is distinguished in the JSON. Method installation is",
    "not scanner execution. Existing Node, pnpm, TS7, Vitest, Rust, Docker and Python results are",
    "individually attributed; the inventory uses the existing TS5.9 parser. New audit-only VM and",
    "public-loader, restore, terminal, card, artwork and font probes supplement the existing guard.",
    "Local evidence is not published.", "",
    "### Assessment and limitations", "", ...record.limitations.map((text) => "- " + text), "");
  return lines.join("\n");
}

const snapshot = read("snapshot.json");
const names = PRIMARY_NAMES;
const reviews = names.map(read);
const coverage = read("coverage.json");
const publish = process.argv.includes("--publish");
const completeness = existsSync(resolve(local, "completeness-review.json"))
  ? read("completeness-review.json") : { status: "pending" };
const skeptic = existsSync(resolve(local, "skeptic-review.json"))
  ? read("skeptic-review.json") : { status: "pending" };
const context = existsSync(resolve(local, "interface-context-admission.json"))
  ? read("interface-context-admission.json") : { status: "pending" };
const files = verifyInputs(snapshot, reviews, coverage, [skeptic, completeness], context, publish);
const findings = read("coordinator-findings.json").findings.map((finding) => ({ ...finding,
  kind: "finding", releaseBlockingReason: finding.releaseBlockingReason ??
    "Bounded conformance or diagnostic defect; no demonstrated spending compromise. Gates must pass before acceptance.",
  evidenceQualification: "Evidence paths without a public URL name retained local files or source locations; local logs/reviews are not downloadable package assets." }));
if (new Set(findings.map((finding) => finding.id)).size !== findings.length)
  throw ERRORS.create("incomplete", []);
const record = { schemaVersion: 1, auditId: "AUD-031", auditNumber: 31,
  date: new Date().toISOString().slice(0, 10), title: "Full current-tree and CORE audit",
  reviewer: { name: "Codex coordinator and independent scoped reviewers", model: null, reasoningEffort: null },
  snapshot: { ...snapshot, files: undefined }, procedureHashes: read("procedure-hashes.json"),
  scope: { files: files.length, nonAuditFiles: snapshot.files.filter((file) => !file.path.startsWith("docs/audits/")).length,
    fileLedger: files, publicInventory: read("public-contracts.json"),
    reviewedContracts: reviews.flatMap((review) => review.contracts ?? []).map(reviewedContract),
    primaryCompletion: reviews.map((review, index) => ({ path: names[index], status: review.status ??
      "assigned ledger finished with retained limitations", scopeCompletion: review.scopeCompletion })),
    interfaceContextAdmission: context,
    supplements: reviews.map((review) => review.supplements ?? []), guarantees: read("guarantees.json"),
    coreRuleLedger: coverage.coreRules, independentCompleteness: completeness, independentSkeptic: skeptic },
  checks: { coverageLedger: coverage.checks, summary: coverage.summary, executions: coverage.executions,
    retainedResults: coverage.retainedResults, hostReportedOnly: coverage.hostReportedOnly },
  findings, observations: [], informationalObservations: coverage.observations,
  remediation: findings.map((finding) => ({ id: finding.id, status: "open", fixCommit: null,
    verificationCommit: null, evidence: "Baseline; no remediation execution counted as an original pass." })),
  toolsAndSkills: read("skill-usage.json"), artifacts: read("build-artifacts.json"),
  independentReviewInputs: ASSESSMENT_NAMES.filter((name) => existsSync(resolve(local, name))).map(input),
  ownHarnessInputs: HARNESS_NAMES.map((name) => ({ path: "docs/audits/AUD-031-harnesses/" + name,
    sha256: sha(bytes(resolve(root, "docs/audits/AUD-031-harnesses", name))) })),
  limitations: coverage.limitations,
};
const stem = publish ? resolve(root, `docs/audits/AUD-031-${record.date}`) : resolve(local, "report-preview");
if (publish && [".json", ".md"].some((suffix) => existsSync(stem + suffix)))
  throw ERRORS.create("retained", []);
const owner = userInfo().username;
const sanitize = (text) => text.replaceAll(`/home/${owner}/`, "/home/user/")
  .replaceAll(new RegExp(`\\b${owner.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "gu"), "user");
writeFileSync(stem + ".json", sanitize(JSON.stringify(record, null, 2)) + "\n");
writeFileSync(stem + ".md", sanitize(render(record)));
console.log(JSON.stringify({ publish, findings: findings.length, files: files.length,
  sourceFingerprint: snapshot.sourceFingerprint }));
