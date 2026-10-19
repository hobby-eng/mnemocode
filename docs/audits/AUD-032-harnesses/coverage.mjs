// Assemble explicit methods and retained depth; enumeration never upgrades review coverage.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const read = (name) => JSON.parse(readFileSync(resolve(evidence, name), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const snapshot = read("snapshot.json");
const admitted = new Map(read("retained-context-admission.json").fileRows.map((row) => [row.path, row]));
const history = new Map(read("history-review.json").files.map((row) => [row.path, row]));
const suite = read("suite-summary.json");
const tests = new Map(suite.results.map((row) => [row.path, row]));
const coordinator = read("coordinator-review.json");
const groupsFor = (path) => coordinator.freshTraceGroups.filter((group) => group.paths.includes(path));
const fileLedger = snapshot.files.map((file) => {
  if (history.has(file.path)) return { ...history.get(file.path),
    currentClaimTrace: groupsFor(file.path).map((group) => group.name) };
  const previous = admitted.get(file.path);
  if (!previous) throw new Error(`No file method: ${file.path}`);
  const current = groupsFor(file.path);
  return { ...file,
    method: current.length ? "Current targeted seam/claim review plus admitted previous body/contract assessment"
      : previous.method,
    depth: current.length ? "Only named current trace groups are fresh; other bodies retain the prior stated depth"
      : previous.depth,
    freshTraceGroups: current.map((group) => ({ name: group.name, limits: group.limits })),
    retainedAssessment: {
      priorReport: previous.admission.priorRecord,
      priorMethod: previous.admission.priorMethod,
      priorDepth: previous.admission.priorDepth,
      decision: previous.admission.decision,
      finalRemediationReviews: previous.admission.finalExactReviews,
      sourceContext: previous.admission.source, dependencyContext: previous.admission.dependency,
      callerContext: previous.admission.caller, procedureContext: previous.admission.procedure,
    },
    dependencyBindings: previous.admission.dependencyBindings,
    callerBindings: previous.admission.callers,
    currentExecution: tests.get(file.path) ?? suite.excluded.find((row) => row.path === file.path) ?? null,
    binaryQualification: file.binary
      ? "Binary identity/provenance/consumer and current output sampling; not every glyph, pixel or upstream instruction"
      : null,
  };
});
const previousReport = JSON.parse(readFileSync(resolve(root, "docs/audits/AUD-031-2026-10-15.json"), "utf8"));
const oldRules = new Map(previousReport.scope.coreRuleLedger.map((row) => [row.rule, row]));
const nonApplicable = {
  "TS-13": "No handwritten mhfe browser JavaScript package exists in this repository; generated SSKR glue has its separate ABI/integrity review.",
  "RUST-09": "The Rust code is a library/WASM crate, not a native CLI process with main; the actual Node CLI protections are assessed separately.",
  "RUST-10": "No Rust secret-handling process or network front end exists here; Node CLI least-authority and host library rights are separate.",
  "RUST-11": "The library-only Rust crate sets no OS process protection to read back; Node/Linux/macOS/Windows protection paths remain applicable under CORE.",
  "RUST-14": "No full Rust program port is part of this TypeScript repository audit; the separate Rust implementation is outside scope.",
  "RUST-15": "No new full Rust port is implemented or modified in this baseline; the existing SSKR library binding is reviewed under CORE and native rules.",
  "WEB-01": "No first-party HTML/DOM sink exists; host-neutral drawing steps are data. The consuming browser application's DOM is outside this checkout.",
  "WEB-02": "No first-party page/panel installer exists; external host acceptance is a separate prerequisite, not a passed local page review.",
  "WEB-03": "No first-party browser worker copy exists; the standalone CLI forbids workers by its normal permission model.",
  "WEB-04": "No first-party browser secret field or browser storage exists; CLI byte lifetimes apply and external host/browser lifetimes remain unverified.",
  "WEB-05": "No first-party HTML page exists. README/help/CLI explanations are assessed under DOC; the external page is not audited here.",
};
const failures = {
  "CORE-26": ["AUD-032-BLD001", "AUD-032-BLD002"],
  "CORE-32": ["AUD-032-BLD001", "AUD-032-BLD002"],
  "CORE-33": ["AUD-032-BLD001", "AUD-032-BLD002"],
  "CORE-43": ["AUD-032-BLD001", "AUD-032-BLD002"],
  "DOC-06": ["AUD-032-DOC001"],
};
const ruleLedger = [];
for (const name of ["code-core", "code-typescript", "code-rust", "code-tooling", "code-browser", "docs", "ci"]) {
  const path = resolve(root, `../.github/instructions/${name}.instructions.md`);
  const text = readFileSync(path, "utf8");
  const matches = [...text.matchAll(/^### ((?:CORE|TS|RUST|TOOL|WEB|DOC|CI)-\d{2}) · (.+)$/gmu)];
  for (const [index, match] of matches.entries()) {
    const rule = match[1];
    const body = text.slice(match.index, matches[index + 1]?.index ?? text.length);
    ruleLedger.push({
      ruleId: rule, title: match[2], guide: name, guideSha256: sha(text),
      applicability: Object.hasOwn(nonApplicable, rule) ? "not-applicable" : "applicable",
      outcome: Object.hasOwn(nonApplicable, rule) ? "not-applicable"
        : failures[rule] ? "failed within the identified finding scope" : "assessed-with-explicit-limits",
      reason: nonApplicable[rule] ?? "Actual source/caller and retained assessment depth, current applicable gates and tests; no universal conformance proof.",
      mechanism: body.match(/^Check: (.+)$/mu)?.[1] ?? "review",
      priorCoreAssessment: oldRules.get(rule) ?? null,
      currentEvidence: ["coordinator-review.json", "retained-context-admission.json",
        "check.command.json", "suite-summary.json", "protocol-skeptic.json"],
      relatedFindings: failures[rule] ?? [],
      limits: rule === "CORE-36" ? "Plain self-test script presentation differs from colored terminal style; retained as a non-blocking presentation observation, not a security defect."
        : rule === "CORE-53" ? "No product fix was performed. Independent exact-input wave challenges and final report challenge are distinct from remediation verification."
        : rule.startsWith("RUST-") ? "Native tests/canonical output comparison do not prove optimized erasure, timing properties or every upstream crate body."
        : "Enumerated rules/gates are not a claim that every dynamic input or every function body was freshly reviewed.",
    });
  }
}
const core = ruleLedger.filter((row) => row.ruleId.startsWith("CORE-"));
if (core.length !== 53 || new Set(core.map((row) => row.ruleId)).size !== 53)
  throw new Error("CORE rule reconciliation failed.");
if (fileLedger.length !== 1038 || new Set(fileLedger.map((row) => row.path)).size !== 1038)
  throw new Error("File coverage reconciliation failed.");
const result = {
  auditId: "AUD-032", assembledAtUtc: new Date().toISOString(),
  sourceFingerprint: snapshot.sourceFingerprint,
  files: fileLedger.length, nonAuditFiles: admitted.size, historicalFiles: history.size,
  freshTargetedFileCount: fileLedger.filter((row) => row.freshTraceGroups?.length).length,
  fileLedger, ruleLedger,
  qualifications: [
    "Every frozen path has a documented method and honest depth; this is not 1,038 fresh body reviews.",
    "All 607 final producer paths match prior source, dependencies, callers and procedures. Retained evidence stays attributed and is not new execution credit.",
    "All 53 CORE rules and every applicable language/area rule have individual dispositions; no blanket full-CORE acceptance is asserted.",
    "Dynamic operation coverage is sampled by actual suites/vectors and is not a 100-percent line/branch/function coverage claim.",
  ],
};
writeFileSync(resolve(evidence, "coverage.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ files: result.files, nonAuditFiles: result.nonAuditFiles,
  historicalFiles: result.historicalFiles, freshTargetedFiles: result.freshTargetedFileCount,
  coreRules: core.length, totalRules: ruleLedger.length }));
