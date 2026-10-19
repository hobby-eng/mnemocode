// Inventory and assign coverage before execution. Hashing is identity evidence, not body review.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const evidence = "docs/audits/AUD-035-evidence";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const save = (name, value) =>
  writeFileSync(`${evidence}/${name}`, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
mkdirSync(evidence, { recursive: true });
if (existsSync(`${evidence}/snapshot.json`)) throw new Error("The baseline is already frozen.");
const paths = [...new Set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))]
  .filter((path) => path && !path.startsWith("docs/audits/AUD-035"))
  .sort();
const files = paths.map((path) => {
  const bytes = readFileSync(path);
  return { path, sha256: sha(bytes), bytes: bytes.length, binary: bytes.subarray(0, 8192).includes(0) };
});
const source = files.filter((file) => !file.path.startsWith("docs/audits/"))
  .map(({ path, sha256 }) => ({ path, sha256 }));
const fingerprint = sha(JSON.stringify(source));
save("snapshot.json", {
  auditId: "AUD-035", capturedAtUtc: new Date().toISOString(),
  commit: git("rev-parse", "HEAD").trim(), branch: git("branch", "--show-current").trim(),
  remoteBaseline: git("rev-parse", "origin/main").trim(), workingTree: git("status", "--short"),
  sourceFingerprint: fingerprint, source, files,
  exclusion: "Own audit outputs; ignored dependencies/artifacts/private evidence are separately bound when examined.",
});
const procedure = [
  "docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
  "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json",
].map((path) => `../multi-chain-wallet-tools/${path}`);
const instructions = [
  "../AGENTS.md", "AGENTS.md", "../.github/agents/wallet-tools-maintainer.agent.md",
  ...["code-core", "code-typescript", "code-rust", "code-tooling", "code-browser", "docs", "ci", "audits"]
    .map((name) => `../.github/instructions/${name}.instructions.md`),
];
const hashes = (names) => names.map((path) => ({ path, sha256: sha(readFileSync(path)) }));
save("procedure-hashes.json", hashes(procedure));
save("instruction-hashes.json", hashes(instructions));
const guide = readFileSync(procedure[0], "utf8");
const plan = [...guide.matchAll(/^### (CHECK-([A-Z]+)-\d{3}) — (.+)$/gmu)]
  .map(([, checkId, category, title]) => ({
    checkId, category, title,
    primaryOwner: category === "FUN" || ["CHECK-SEC-001", "CHECK-SEC-004", "CHECK-SEC-005"].includes(checkId)
      ? "core-protocol-reviewer" : "coordinator",
    scope: "Current standalone MnemoCode; unsupported disciplines receive individual reasons.",
    expectedEvidence: category === "FUN" ? "Current body/caller challenge, exact admitted semantic review, public vectors and fresh default tests."
      : category === "SEC" ? "Current trust/ownership/isolation boundaries, safe refusals and exception/cancellation tests."
      : category === "API" ? "Actual public API/CLI inventory, dependency and caller contracts, deterministic boundary cases."
      : category === "BLD" ? "Fresh serial gates/build/tests/package/advisories, current artifact acceptance and explicitly retained canonical evidence."
      : category === "UI" ? "Actual Linux PTY, real PDF/PNG/QR and finite private views; external host/portable gaps remain distinct."
      : category === "ARC" ? "Every CORE/language rule disposition, file-depth ledger, current imports/consumers and test fidelity."
      : "Current docs/help/metadata/legal/CI claims and final report/evidence validation.",
    skepticalOwner: "final-evidence-reviewer", outcome: "not-run",
  }));
if (plan.length !== 32) throw new Error("Expected all32 canonical checks.");
save("check-plan.json", plan);
const rules = [];
for (const path of instructions.filter((path) => path.includes(".instructions.md"))) {
  const text = readFileSync(path, "utf8");
  for (const [, ruleId, title] of text.matchAll(/^### ([A-Z]+-\d{2}) · (.+)$/gmu))
    rules.push({ ruleId, title, source: path, outcome: "not-yet-assessed" });
}
if (rules.filter((row) => row.ruleId.startsWith("CORE-")).length !== 53)
  throw new Error("Expected all53 CORE rules.");
save("rule-plan.json", rules);
const old = read("docs/audits/AUD-032-evidence/coverage.json");
const oldFiles = new Map(old.fileLedger.map((row) => [row.path, row]));
save("file-coverage-plan.json", files.map((file) => ({
  ...file,
  owner: /^(src\/(?:core|sskr)\/|sskr-wasm\/|vectors\/)/u.test(file.path) ? "core-protocol-reviewer" : "coordinator",
  method: file.path.startsWith("docs/audits/") ? "Historical record/schema/final-disposition assessment; no historical execution replay."
    : file.binary ? "Identity, provenance and consumer/output sampling; not every pixel or glyph."
    : "Current source/gate/claim assessment with specifically admitted earlier semantic depth.",
  priorExactBodyRecord: oldFiles.get(file.path)?.sha256 === file.sha256
    ? { path: "docs/audits/AUD-032-evidence/coverage.json", sha256: sha(readFileSync("docs/audits/AUD-032-evidence/coverage.json")), depth: oldFiles.get(file.path).depth }
    : null,
  depth: "planned; changed files require exact remediation-review admission or current semantic assessment, never a mechanical-only pass",
})));
save("resource-plan.json", {
  reserveBytes: 3 * 1024 ** 3, processRssMiB: 1152, nodeHeapMiB: 256,
  testWorkers: 1, cargoJobs: 1, maxReviewers: 2, reviewerRssBudgetMiB: 256,
  heavyPolicy: "Exclusive parent-coordinated slot; one heavy command at a time. Fresh per-file test processes avoid retained renderer contexts.",
  monitoring: "Unchanged sampled AUD026 process-tree/host guard; no hard peak or external Docker RSS claim.",
});
save("prior-record-bindings.json", hashes([
  "docs/audits/AUD-033-evidence/remediation/REMEDIATION-2026-10-16.json",
  "docs/audits/AUD-033-evidence/arc002-2026-10-18/ARC002-CLOSURE-2026-10-18.json",
  "docs/audits/AUD-033-evidence/protocol-review.json",
  "docs/audits/AUD-033-evidence/interface-review.json",
  "docs/audits/AUD-033-evidence/core-rule-dispositions.json",
]));
console.log(JSON.stringify({ files: files.length, sourceFiles: source.length, fingerprint, checks: plan.length, rules: rules.length }));
