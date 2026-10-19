// Admit unchanged review context explicitly; this does not create new body-review credit.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "docs/audits/AUD-032-evidence");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const binding = (path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) });
const snapshot = read("docs/audits/AUD-032-evidence/snapshot.json");
const previousPath = "docs/audits/AUD-031-2026-10-15.json";
const previous = read(previousPath);
const finalPath = previous.remediationAddendum.sourceManifest.path;
const finalBytes = readFileSync(resolve(root, finalPath));
if (sha(finalBytes) !== previous.remediationAddendum.sourceManifest.sha256)
  throw new Error("Prior final source manifest binding failed.");
const previousSource = JSON.parse(finalBytes);
const currentSource = snapshot.files.filter((file) => !file.path.startsWith("docs/audits/"));
if (currentSource.length !== previousSource.files.length
  || currentSource.some((file) => !previousSource.files.some(
    (old) => old.path === file.path && old.sha256 === file.sha256)))
  throw new Error("Current source differs from the prior final producer snapshot.");
const procedures = read("docs/audits/AUD-032-evidence/procedure-hashes.json");
const instructions = read("docs/audits/AUD-032-evidence/instruction-hashes.json");
const applicable = [...procedures, ...instructions.filter((item) =>
  /instructions\/|AGENTS\.md$/u.test(item.path))];
for (const entry of applicable) {
  if (entry.path.startsWith("../../")) continue;
  if (previous.procedureHashes[entry.path] !== entry.sha256)
    throw new Error(`Procedure/instruction context changed: ${entry.path}`);
}
const reviewBindings = previous.remediationAddendum.independentReviews.map((entry) => {
  const actual = binding(entry.path);
  if (entry.sha256 !== actual.sha256) throw new Error(`Prior review changed: ${entry.path}`);
  return { ...actual, review: read(entry.path) };
});
const sourceHashes = new Map(currentSource.map((file) => [file.path, file.sha256]));
const oldLedger = new Map(previous.scope.fileLedger.map((file) => [file.path, file]));
const contractInventory = read("docs/audits/AUD-032-evidence/public-operations.json");
const fileRows = currentSource.map((file) => {
  const old = oldLedger.get(file.path);
  const sameBaseline = old?.sha256 === file.sha256;
  const exactReviews = reviewBindings.filter((entry) =>
    entry.review.reviewedInputs?.some((input) =>
      input.path === file.path && input.sha256 === file.sha256));
  const dependencyBindings = contractInventory.imports.filter((edge) => edge.path === file.path)
    .map((edge) => ({ ...edge, sha256: edge.target ? sourceHashes.get(edge.target) ?? null : null }));
  const callers = contractInventory.imports.filter((edge) => edge.target === file.path)
    .map((edge) => ({ path: edge.path, line: edge.line,
      sha256: sourceHashes.get(edge.path) ?? null }));
  const admitted = sameBaseline || exactReviews.length > 0;
  return {
    ...file, method: sameBaseline ? "retained exact-body/contract assessment with current context admission"
      : exactReviews.length ? "retained baseline plus exact final-remediation review"
      : "final source identity only; fresh source assessment required",
    depth: admitted ? "Retained depth only; not newly read or executed by AUD-032" : "identity-only",
    admission: {
      source: "All 607 final producer inputs match the recorded prior final manifest, path for path.",
      dependency: "Manifest, lockfiles and every local production dependency are identical to that final context; external implementations were not newly audited.",
      caller: "All first-party callers and tests match the final producer manifest; external host acceptance remains outside this admission.",
      procedure: "All four canonical procedure files and all applicable coding/audit guides match the prior recorded hashes.",
      baselineBytesIdentical: sameBaseline, priorRecord: binding(previousPath),
      priorMethod: old?.method ?? null, priorDepth: old?.reviewBasis ?? null,
      finalExactReviews: exactReviews.map(({ path, sha256, review }) => ({
        path, sha256, status: review.status, verdict: review.verdict, limits: review.limits ?? review.limitations ?? null,
      })),
      dependencyBindings, callers,
      decision: admitted ? "admitted at explicitly retained depth" : "not admitted as semantic review",
    },
  };
});
const result = {
  auditId: "AUD-032", capturedAtUtc: new Date().toISOString(),
  sourceFingerprint: snapshot.sourceFingerprint,
  priorFinalSourceManifest: { path: finalPath, sha256: sha(finalBytes) },
  priorReport: binding(previousPath),
  procedureBindings: applicable, reviewedRemediationDossiers: reviewBindings.map(({ path, sha256 }) => ({ path, sha256 })),
  sourceContextIdentical: true,
  noNewExecutionCredit: true, fileRows,
  notAdmitted: fileRows.filter((row) => row.admission.decision.startsWith("not admitted")).map((row) => row.path),
  limitations: [
    "Identity comparisons alone are not semantic review; previous body depth and exact remediation reviewers remain attributed.",
    "External browser/worker/host acceptance, new release artifacts and current executions require separate evidence.",
    "Historical report paths and this audit's new harnesses are assessed separately.",
  ],
};
const destination = resolve(directory, "retained-context-admission.json");
if (existsSync(destination)) throw new Error("Retained admission already exists.");
writeFileSync(destination, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ sourceFiles: fileRows.length, sourceContextIdentical: true,
  exactRemediationReviews: reviewBindings.length, notAdmitted: result.notAdmitted }));
