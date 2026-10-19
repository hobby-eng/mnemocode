// Assemble an audit record from actual immutable inputs; assembly creates no execution credit.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerNames } from "../../../scripts/verify-audit-privacy.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspace = resolve(root, "..");
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const read = (name) => JSON.parse(readFileSync(resolve(evidence, name), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const binding = (path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) });
const clean = (value) => {
  if (typeof value === "string") {
    let text = value.replace(/\/home\/[^/\s"'`]+/gu, "/home/user");
    for (const name of ownerNames())
      text = text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "giu"), "user");
    return text;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)]));
  return value;
};
const snapshot = read("snapshot.json");
const coverage = read("coverage.json");
const operations = read("operation-coverage.json");
const suite = read("suite-summary.json");
const findings = read("findings.json");
const artifact = read("artifacts.json");
const date = new Date().toISOString().slice(0, 10);
if (date !== "2026-10-16") throw new Error("Reconcile the UTC publication date and index before assembly.");
const currentNames = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }).split("\0"))]
  .filter((path) => path && !path.startsWith("docs/audits/")).sort();
const source = currentNames.map((path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
if (sha(JSON.stringify(source)) !== snapshot.sourceFingerprint) throw new Error("Non-audit source drift.");
const executions = readdirSync(evidence).filter((name) => name.endsWith(".command.json")).sort().map((name) => {
  const bytes = readFileSync(resolve(evidence, name));
  const record = JSON.parse(bytes);
  const label = name.replace(/\.command\.json$/u, "");
  if (sha(readFileSync(resolve(evidence, `${label}.log`))) !== record.logSha256)
    throw new Error(`Changed log: ${label}`);
  if (record.sourceBefore !== snapshot.sourceFingerprint || record.sourceAfter !== snapshot.sourceFingerprint)
    throw new Error(`Wrong source binding: ${label}`);
  const { memorySamples, ...summary } = record;
  return { label, ...summary, commandRecordSha256: sha(bytes),
    evidence: { localOnly: true, command: `docs/audits/AUD-032-evidence/${name}`,
      log: `docs/audits/AUD-032-evidence/${label}.log` },
    classification: ["suite-123", "suite-143", "confirmed-regressions"].includes(label)
      ? "confirmed mandatory regression failure"
      : label === "independent-oracles" ? "two completed oracle stages followed by an audit invocation error"
      : record.exitCode === 0 ? "executed" : "failed or blocked; inspect original receipt",
  };
});
const statuses = {
  "CHECK-SEC-001": ["failed", "Current ownership/lifetime controls pass, but the mandatory redaction-owner inventory fails (BLD001). Retained source depth remains explicit; no secret disclosure is demonstrated."],
  "CHECK-SEC-002": ["passed", "Actual Linux protected source/executable startup and PTY; kernel socket/child refusal, FFI retirement and Node permissions traced. No first-party iframe/CSP; external host rights remain separate."],
  "CHECK-SEC-003": ["passed", "Standalone production input/result paths have no network feature; Node/OS denial and offline generated loader examined. Audit/build registry calls are separate. A malicious host/dependency is not proven contained."],
  "CHECK-SEC-004": ["passed", "Production CSPRNG adapter, share seed/entropy distinction and cleanup; current crypto/age/SSKR tests and full self-test. No new primitive, entropy-quality or timing proof."],
  "CHECK-SEC-005": ["passed", "Current exceptional-owner, terminal/replay, late-result, document and native cleanup controls; exact producer remediations retained. Immutable prior views/strings, GC/OS/dependency copies are not guaranteed erased."],
  "CHECK-SEC-006": ["passed", "CLI errors/files/filenames/QR/control-character and private-output seams apply and are checked. No first-party browser DOM/storage; external DOM/worker acceptance not executed."],
  "CHECK-SEC-007": ["passed", "Actual text/PNG/search/count bounds, refusals, stopped outcomes, PTY cancellation and cleanup. Bounded tests only, not uncontrolled exhaustion or an exhaustive malformed-input campaign."],
  "CHECK-FUN-001": ["passed", "All five BIP39 lengths/representations/modes in current suites/self-test; 24 seed vectors, seven published vectors, 6,000 Python comparisons and corrected five-length legacy-valid oracle. Counts are not added."],
  "CHECK-FUN-002": ["passed", "All twelve coin families and supported Bitcoin profiles in actual current wallet/coin suites and self-test, with retained body/caller contracts. No live wallet, hardware or every possible path comparison."],
  "CHECK-FUN-003": ["not-applicable", "No BIP85, BIP38, message-signing/verification or Silent Payments operation is implemented in standalone MnemoCode."],
  "CHECK-FUN-004": ["not-applicable", "No descriptor, Miniscript or multisig compiler/import workflow; single-key address derivation remains under FUN002."],
  "CHECK-FUN-005": ["not-applicable", "No transaction or PSBT parse/construct/sign operation; recovery evidence is not transaction processing."],
  "CHECK-FUN-006": ["passed", "Current MnemoCode/MNC1/legacy and SSKR transport/threshold/group/repair tests, official independent quorums, five entropy-width sets, actual PDF/QR recovery and fresh canonical comparison. Larger-policy every-quorum and four configured slow skips remain qualified."],
  "CHECK-FUN-007": ["not-applicable", "No connected discovery, provider/proof/history or balance accounting; bounded local address evidence is not online discovery."],
  "CHECK-API-001": ["passed", "Strict source/test/cards compilation, real dependency/caller tests, loader retry and 78 package entries. 1,955 declarations/1,598 explicit members plus 286 supplements describe contracts, not exhaustive runtime domains."],
  "CHECK-API-002": ["passed", "Current cancellation, late publication, callback refusal, retained-plan and borrowed-owner tests plus source/real PTY tracing. Arbitrary host revisions/workers/browser state are not covered."],
  "CHECK-API-003": ["passed", "Actual MNC1, candidate/share files, separate card names, PDF metadata, PNG/JPEG and QR exports checked. No CSV/XLSX/monetary export exists. BLD002 prevents one old test reaching its QR assertions, covered by a separate real-media control."],
  "CHECK-API-004": ["passed", "Literal/independent BIP39, Unicode/leading-zero, Bytewords/UR/CBOR/legacy, candidate-format and actual PNG-QR interoperability. The card PDF reader is intentionally not an arbitrary PDF reader."],
  "CHECK-BLD-001": ["passed", "Pinned manifest/options, actual CLI registry, strict builds and portable/selective-coin tests; no standalone edition/feature CLI matrix exists. Every host composition is not executed."],
  "CHECK-BLD-002": ["blocked", "Fresh Linux standalone source/executable/PTY acceptance passes. Existing current-HEAD Windows/macOS CI is fast push only; full native release builds/suites and external browser matrix were not executed."],
  "CHECK-BLD-003": ["passed", "Exact direct pins/installed versions, locks, notices and native provenance inspected. npm scan has zero advisories over 217 total dependencies. Local Rust DB scan of 137 lock entries has zero reported vulnerabilities and an unmaintained paste warning; DB freshness/dirty-state limits are explicit."],
  "CHECK-BLD-004": ["passed", "Unchanged canonical --check with --no-cache-filter built freshly compiled Rust/wasm-bindgen offline; four outputs and integrity pins match. Toolchain/dependency layers were reused; no entirely cold or independent-machine reproduction."],
  "CHECK-BLD-005": ["failed", "Two mandatory regressions fail twice. Fresh Linux SEA and same-host duplicate bytes pass, package/legal/audit paths are inspected separately. Static tag job requires full verify+SSKR+three builds; no tag/release/signing/upload/attestation was performed."],
  "CHECK-UI-001": ["passed", "Adapted standalone surface: real finite 80x24/32x12 PTY and actual card renders; two current raster samples inspected visually. No first-party browser page; physical print/every-pixel/all-device/browser acceptance not established."],
  "CHECK-UI-002": ["passed", "Complete real Linux menu/private-input/retry/re-encode/result paging and state-preservation script passes for source and fresh executable. No fresh full Windows/macOS release UI matrix."],
  "CHECK-UI-003": ["passed", "Private visibility, alternate-screen clearing, keyboard/paging/cancellation/help and actual PDF/QR export/recovery checked. Touch/DOM popovers do not exist here; compromised terminals and physical scan quality remain outside guarantees."],
  "CHECK-ARC-001": ["passed", "Retained exact-context module/caller/ownership assessment plus current targeted planning/cache/borrowed-result traces, strict imports and portable composition tests. No universal API/inheritance completeness proof."],
  "CHECK-ARC-002": ["passed", "Current copies/lint/code-rules gates and actual consumer/entry context, retaining explicit compatibility facades. Deferred TypeScript/Rust transport ownership is separately documented, not silently refactored."],
  "CHECK-ARC-003": ["failed", "Actual complete admitted test-file run exposes stale owner-inventory and success-message assertions. One installation-copy file is blocked and four configured slow cases skip; tests were not relaxed or fixed."],
  "CHECK-DOC-001": ["failed", "Capabilities/safety/format/ownership/release claims compared with source and current outputs. DOC001 is the one confirmed low RNG API-name mismatch, not weak randomness. Release preparation remains unreleased."],
  "CHECK-DOC-002": ["passed", "Current help/options, local document/legal/package paths, release signing separation and enabled private reporting endpoint inspected. Not every external link/upstream license implementation was freshly reviewed."],
  "CHECK-DOC-003": ["passed", "All 30 historical pairs validate with duplicate rejection; final dated producer dispositions retained. All paths/rules/checks have honest methods; original failures and interruptions remain. Final exact-pair independent acceptance/validation is separately hash-bound."],
};
const checks = read("check-plan.json").map((row) => ({
  ...row, primaryOwner: "coordinator",
  outcome: statuses[row.checkId][0], result: statuses[row.checkId][1],
  relatedFindings: row.checkId === "CHECK-SEC-001" ? ["AUD-032-BLD001"]
    : ["CHECK-BLD-005", "CHECK-ARC-003"].includes(row.checkId) ? ["AUD-032-BLD001", "AUD-032-BLD002"]
    : row.checkId === "CHECK-DOC-001" ? ["AUD-032-DOC001"] : [],
  sourceFingerprint: snapshot.sourceFingerprint,
}));
const primaryInputs = ["snapshot.json", "check-plan.json", "check-owner-amendment.json",
  "procedure-hashes.json", "instruction-hashes.json", "resource-plan.json",
  "retained-context-admission.json", "coordinator-review.json", "coverage.json",
  "operation-coverage.json", "history-review.json", "suite-summary.json",
  "suite-selected-out.json", "findings.json", "artifacts.json", "media-summary.json",
  "protocol-skeptic.json"];
const contract = existsSync(resolve(evidence, "contract-skeptic.json"))
  ? read("contract-skeptic.json") : null;
if (contract !== null) primaryInputs.push("contract-skeptic.json");
const releaseChallenge = existsSync(resolve(evidence, "contract-skeptic-wave3.json"))
  ? read("contract-skeptic-wave3.json") : null;
if (releaseChallenge !== null) primaryInputs.push("contract-skeptic-wave3.json");
const ownHarnessInputs = readdirSync(resolve(root, "docs/audits/AUD-032-harnesses"))
  .map((name) => binding(`docs/audits/AUD-032-harnesses/${name}`));
const optionalPackage = existsSync(resolve(evidence, "package-review.json")) ? read("package-review.json") : null;
if (optionalPackage) primaryInputs.push("package-review.json");
const methods = [
  "../.github/scripts/verify-action-pins.mjs",
  "../.github/skills/microsoft-rust-guidelines/SKILL.md",
  "../.github/skills/rust-review/SKILL.md",
  "../.github/skills/property-based-testing/references/reviewing.md",
];
const main = {
  schemaVersion: 1, auditId: "AUD-032", auditNumber: 32, date,
  title: "Expanded standalone pre-release audit",
  localEvidencePolicy: "Every AUD-NNN-evidence path in this record is local-only, ignored and not a published download. Raw logs are retained unchanged; published metadata is anonymized.",
  startedAtUtc: snapshot.capturedAtUtc, completedAtUtc: new Date().toISOString(),
  reviewer: { name: "GitHub Copilot audit coordinator", model: "gpt-6.1-sol", reasoningEffort: null },
  snapshot: { ...snapshot, files: undefined, commitComplete: true,
    workingTree: { initialProductState: "Clean main at first inspection; audit harnesses were then added.",
      atCapture: snapshot.workingTree,
      finalExpectedChanges: "Only AUD-032 records/harnesses and the audit index. All 607 non-audit inputs unchanged." } },
  scope: {
    repository: "https://github.com/hobby-eng/mnemocode",
    version: "0.1.0 (unreleased)", executionDepth: "Expanded full-scope audit with incomplete execution",
    sourceReviewDepth: "100 current targeted source/claim traces plus explicitly attributed retained body/contract assessment; not a fresh read of every body.",
    files: coverage.files, nonAuditFiles: coverage.nonAuditFiles, historicalFiles: coverage.historicalFiles,
    fileLedger: coverage.fileLedger, ruleLedger: coverage.ruleLedger,
    operationCoverage: operations,
    exclusions: ["Other workspace products, including the separate Rust port",
      "Actual wallet-tools browser/worker integration and cached-plan borrower acceptance",
      "Fresh Windows/macOS full native release execution",
      "Installation-copy integrity file under the explicit no-copy constraint",
      "Four configured slow date-recovery skips; no hidden skip or weakened assertion",
      "All-transitive dependency body audit, fuzz/mutation/timing/sanitizer/optimized-erasure campaigns"],
  },
  procedureHashes: read("procedure-hashes.json"),
  instructionHashes: read("instruction-hashes.json"),
  supplementalMethodHashes: methods.map((path) => ({ path: relative(workspace, resolve(root, path)),
    sha256: sha(readFileSync(resolve(root, path))) })),
  environment: {
    os: "Linux 7.0.0-38-generic x86_64", node: "26.10.0", pnpm: "12.8.1",
    typescriptAcceptance: "7.0.2", inventoryParser: "5.9.3", vitest: "5.0.3",
    oxlint: "1.88.0", python: "3.14.4", docker: "29.9.1",
    poppler: "26.01.0", npm: "11.19.1", githubCli: "2.102.0",
    rustAndCargoInCrate: "1.99.0",
    rustNote: "The neutral shell default is 1.98.1; every crate gate/test uses its installed rust-toolchain.toml 1.99.0.",
    browsers: null, playwright: null,
    installedDependencies: "No package/toolchain installation or lockfile regeneration",
    originalEnvironment: { localOnly: true, path: "docs/audits/AUD-032-evidence/environment.log" },
  },
  checks, executions, findings, observations: [], remediation: [],
  testResults: { ...suite, results: undefined,
    configuredSkips: read("suite-selected-out.json").pending,
    focusedRerun: "Two failures, 46 selected out; not added to disjoint totals",
    monolithicPnpmVerify: "Not invoked; format/check/build components and bounded per-file suite executed. Mandatory regressions are red." },
  artifacts: { localOnly: true, ...artifact },
  packageReview: optionalPackage === null ? { status: "Final path listing is a publication-validation prerequisite" }
    : { fileCount: optionalPackage.fileCount, auditFiles: optionalPackage.auditFiles,
      listingSha256: optionalPackage.listingSha256,
      qualification: "Pre-publication complete file-list review before this canonical pair was written. The two new report paths are additionally checked in the final-package-review record; no final published archive hash is claimed.",
      finalListing: { localOnly: true, path: "docs/audits/AUD-032-evidence/final-package-review.json" } },
  releaseVerification: {
    verdict: "FAIL", executionCompleteness: "INCOMPLETE", releaseAccepted: false,
    reasons: ["AUD-032-BLD001", "AUD-032-BLD002"],
    missingEvidence: ["Full Windows/macOS native release matrix",
      "External host cached-plan/borrower and actual browser acceptance",
      "Installation-copy integrity suite under current authorization", "Four configured slow cases"],
    preparationTasks: ["Correct confirmed defects only after separate authorization",
      "Set the actual release date and prepare the final signed UTC candidate when authorized",
      "Complete required external host/platform acceptance and normal tagged release gates",
      "Verify resulting published checksums/provenance/signature when actual release assets exist"],
    actionsNotPerformed: ["Product/test fixes", "Dependency/workflow/vendor/generated changes",
      "Commit, push, tag, release creation/publication, artifact upload, signing or paid CI dispatch",
      "New checkout, repository copy, worktree or wallet-tools integration"],
  },
  independentReview: {
    protocol: { localOnly: true, ...binding("docs/audits/AUD-032-evidence/protocol-skeptic.json") },
    protocolVerdict: "Accepted only at explicitly retained/targeted depth; no new protocol defect confirmed in inspected seams",
    contract: contract === null ? null : { localOnly: true, ...binding("docs/audits/AUD-032-evidence/contract-skeptic.json") },
    releaseEvidence: releaseChallenge === null ? null
      : { localOnly: true, ...binding("docs/audits/AUD-032-evidence/contract-skeptic-wave3.json") },
    lostPrimaryCredit: "None; interrupted primary task had no retained dossier",
    finalCompleteness: {
      localOnly: true, path: "docs/audits/AUD-032-evidence/final-completeness-review.json",
      policy: "Handoff requires an actual accepted independent assessment of the exact final Markdown/JSON pair and its input bindings. The separate final validation binds both pair and acceptance without a self-referential hash cycle.",
    },
  },
  reviewInputs: primaryInputs.map((name) => ({ localOnly: true,
    ...binding(`docs/audits/AUD-032-evidence/${name}`) })),
  ownHarnessInputs,
  informationalObservations: [
    "The local Rust advisory database is not freshly fetched, reports no commit timestamp in cargo-audit JSON and has one untracked unrelated advisory file; paste 1.0.15 is flagged unmaintained, not as a demonstrated vulnerability.",
    "Plain self-test script presentation differs from the colored terminal result style; retained as optional presentation advice, not another security finding.",
    "G1-001 TypeScript/Rust Bytewords/UR ownership remains the documented future-port work, not authorized remediation in this audit.",
    "All 131 commits reachable from audited HEAD have signature headers and UTC author/committer offsets. This is not independent cryptographic signature verification; unrelated app/session refs are not release ancestry.",
    "Successful current-HEAD CI is a fast push run, with full verification/self-test/card/oracle/advisory steps explicitly skipped; it does not replace release acceptance.",
  ],
  limitations: [
    ...coverage.qualifications,
    "This first-party AI audit is not independent cryptography-specialist certification, proof of constant time, perfect erasure or absence of all vulnerabilities.",
    "The four generated SSKR outputs match a freshly compiled canonical final stage, not an entirely cold toolchain build or independent machine.",
    "Same-host executable equality does not verify publisher approval, GitHub attestations, OpenPGP signatures or other platform bytes.",
    "Current full self-test, actual media/QR and two visual samples do not establish every physical print, browser, layout/pixel or device outcome.",
    "The failed independent-oracles command preserves its missing-argument error; completed preceding SSKR/6,000 comparison stages and corrected legacy execution are credited separately.",
    "One interrupted empty suite log has no outcome credit; first 60 original file receipts are retained, later files resumed with a new label.",
    "The pre-existing release/ artifact remains unchanged and is not accepted as a current candidate.",
    "No blanket whole-project CORE conformance or passing release conclusion is made.",
  ],
};
const report = clean(main);
const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const command = (args) => args.map((argument) => /^[\w./:=@+-]+$/u.test(argument)
  ? argument : JSON.stringify(argument)).join(" ");
function findingText(finding) {
  return [
    `#### ${finding.id} — ${finding.severity[0].toUpperCase() + finding.severity.slice(1)} — ${finding.title}`,
    "", `- **Category:** ${finding.category}.`, `- **Severity:** ${finding.severity}.`,
    `- **Status:** ${finding.status}.`, `- **Release blocking:** ${finding.releaseBlocking}; ${finding.releaseBlockingReason}`,
    `- **Confidence:** ${finding.confidence}.`,
    `- **Affected files:** ${finding.affectedFiles.map((file) => `\`${file.path}:${file.lines}\``).join(", ")}.`,
    ...["reproduction", "expected", "observed", "impact", "prerequisites", "recommendedFix", "requiredVerification"]
      .map((key) => `- **${({ recommendedFix: "Recommended fix", requiredVerification: "Required verification" })[key] ?? key[0].toUpperCase() + key.slice(1)}:** ${finding[key]}`),
    `- **Evidence:** ${finding.evidence.join("; ")}.`,
    `- **Rules:** ${finding.ruleIds.join(", ")}.`, "",
  ].join("\n");
}
const selected = report.executions.filter((row) => !row.label.startsWith("suite-"));
const markdown = [
  "# AUD-032 — Expanded standalone pre-release audit", "", "## Record metadata", "",
  `- **Audit number:** 32.`, `- **Completed (UTC):** ${date}.`,
  "- **Reviewer:** GitHub Copilot audit coordinator; independent scoped skeptics.",
  "- **Model:** `gpt-6.1-sol` for the coordinator; independent reviewer model identifiers are unknown/null.",
  "- **Reasoning effort:** Unknown/null; no setting inferred from audit depth.",
  `- **Reviewed commit:** \`${snapshot.commit}\`, branch \`main\`.`,
  "- **Working tree:** Product clean at initial inspection; own audit harnesses then added. Only this audit and its index are changed; no product/test remediation.",
  `- **Non-audit inputs:** 607; SHA-256 \`${snapshot.sourceFingerprint}\`.`,
  `- **Frozen baseline:** 1,038 paths, including 431 historical paths; SHA-256 \`${snapshot.allFilesFingerprint}\`.`,
  `- **Version:** 0.1.0, unreleased. **Release verdict: FAIL; execution coverage remains INCOMPLETE.**`, "",
  "## Finding register", "",
  "| Finding / record ID | Category | Kind | Severity | Recorded status | Release blocking | Title |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...report.findings.map((finding) => `| ${finding.id} | ${finding.category} | finding | ${finding.severity} | open | ${finding.releaseBlocking} | ${cell(finding.title)} |`),
  "", "## Review evidence", "", "### Scope and methodology", "",
  "Full repository scope is accounted for, but not represented as 1,038 freshly reviewed bodies. The current source is exactly the prior final 607-file producer snapshot. Source, dependencies, first-party callers and procedure identities were explicitly admitted before retaining prior body/contract depth. This audit adds 100 targeted current source/claim traces, current serial execution, public-operation supplements, and independent scoped skepticism. Hash equality, inventory and passing gates alone are not semantic review.",
  "",
  "The complete per-file method/depth and 104-rule ledger are in the JSON companion: 53 CORE rules and 51 language/area rules, each individually applicable or not applicable with a reason. The public inventory contains 1,955 declarations and 1,598 explicit members, supplemented by 286 callable/inherited/native/type records, 78 package entries and 11 actual CLI command registries. Types and re-exports are not callable-operation counts. Arbitrary inherited/runtime closure and all input domains are not proven exhaustive.",
  "",
  "Waves cover protocol/security, implementation/API/ownership, and documentation/UI/build/release evidence. The interrupted initial protocol task produced no dossier and receives zero credit. A separate protocol skeptic accepted only the attributed retained/targeted depth; the caller/release skeptic independently challenges the other waves. Final exact-pair completeness acceptance is retained locally and hash-bound by report-validation.json without a circular digest embedded in this pair.",
  "",
  "Only the existing standalone TypeScript checkout is audited. The neighboring checkout supplies the read-only canonical procedure; the separate Rust port and external wallet-tools integration are not audited or changed. External cached-plan/borrower adaptation and browser acceptance remain release prerequisites, not silently assumed passes.",
  "", "### Procedure and environment", "",
  "| Canonical procedure input | SHA-256 |", "| --- | --- |",
  ...report.procedureHashes.map((row) => `| \`${row.path}\` | \`${row.sha256}\` |`),
  "",
  "Instruction/skill/gate hashes are separately retained in the JSON. Node 26.10.0; Corepack pnpm 12.8.1; TypeScript 7.0.2 acceptance/5.9.3 inventory; Vitest 5.0.3; oxlint 1.88.0; Python 3.14.4; Docker 29.9.1; Poppler 26.01.0; npm 11.19.1; GitHub CLI 2.102.0; Linux 7.0.0-38-generic x86_64. The crate actually uses installed Rust/Cargo 1.99.0; the neutral shell default 1.98.1 is not its gate toolchain. No dependency or toolchain was installed.",
  "",
  "Heavy checks were serial, with one Vitest/Cargo worker, at most a 768 MiB Node heap and 1,536 MiB sampled descendant RSS, preserving at least 3 GiB MemAvailable. The guard is sampled rather than a kernel cap; Docker daemon/compiler work is outside the client process tree. Exact observed extrema, budgets and per-command UTC times are in the JSON/original local receipts.",
  "", "### Coverage ledger", "",
  "| Check ID | Outcome | Evidence and scope limits |", "| --- | --- | --- |",
  ...report.checks.map((row) => `| ${row.checkId} | ${row.outcome} | ${cell(row.result)} |`),
  "", "### Checks", "",
  `The disjoint admitted suite executed **184 of 185 files: 2,784 passed, 2 failed, 4 configured skips** (2,790 cases). Both failures reproduced separately: two failures and 46 selected-out cases, not additional unique tests. The installation-copy integrity file was not executed under the explicit no-copy constraint. Four slow legacy-valid multi-pattern cases are configured skips; the JSON names every one. No assertion or fixture was relaxed.`,
  "",
  "Format, check and build components ran separately; monolithic pnpm verify was not invoked. Its mandatory regression layer is red. The full CLI self-test passes (seven public vectors, 75 representation round trips), both real Linux PTY targets pass, 14 native Rust tests pass, and actual PDF/PNG/JPEG/QR recovery passes. Independent counts overlap those checks and are not added.",
  "",
  "Every command below has an original local-only log/receipt under AUD-032-evidence/, including source-before/after identity. Individual file commands and result/log hashes are enumerated in the JSON rather than hidden in one aggregate.",
  "",
  "| Evidence label | Exit | Exact command | Original log SHA-256 |",
  "| --- | --- | --- | --- |",
  ...selected.map((row) => `| \`${row.label}\` | ${row.exitCode} | \`${cell(command(row.command))}\` | \`${row.logSha256}\` |`),
  "",
  "The independent-oracles receipt exits 1 because the third Python script was invoked without its required word-list argument, after successful SSKR and 6,000 Seedshift comparisons. That audit invocation error is not a product defect or a passing whole command. The corrected five-length legacy oracle passes separately. An interrupted empty suite-061 log has no pass/fail credit; suite-061-retry-1 is the actual completed result.",
  "", "### Artifacts, provenance and package", "",
  `Current dist contains 567 files, inventory SHA-256 \`${artifact.dist.fingerprint}\`.`,
  "",
  "The fresh local Linux executable is 157,928,573 bytes, SHA-256 `9b4fd843fda76768359856c24cb3a8af5aa9712a3744b3b45e67c343c32d52a3`; its license file is `8200c500c4673cb7fe5edfd1cc02e25b08e618cee06514dcb1cca75c3cb7bdb8` and includes 23 bundled npm notices plus Node/native/asset notices. Two same-host builds match byte for byte. Source and standalone empty-folder acceptance plus full real PTY passed. This is not cross-platform provenance, a publisher signature or release acceptance. The pre-existing release/ set is unchanged and rejected as a current candidate.",
  "",
  "The canonical final SSKR compilation stage was uncached, with network disabled and one Cargo job. All four generated files and integrity pins matched; WASM SHA-256 `38006748a315d90cb7207a6f6e04874b8dd54129447ba39412202c6b59d3b20f`. Toolchain/dependency layers were cached. No canonical generated byte was replaced; an entirely cold or independent-machine rebuild was not claimed.",
  "",
  "Real output checks include all 13 designs, 17 named QR/no-QR cases, two additional default-A6 renders and three combined share pages. A separate 1,748 × 1,240 PNG page restored its exact QR payload, and three share QR images restored the public phrase from members 1 and 3. PDF Info metadata and private file modes were checked. Two raster samples were visually inspected; this is not every-pixel, browser or physical-print acceptance.",
  "",
  optionalPackage
    ? `Before this canonical pair was written, the complete ${optionalPackage.fileCount}-path package dry-run listing included ${optionalPackage.auditFiles} then-present audit files and required release/legal inputs, without private evidence or exports. Its recorded listing hash is in JSON. Final validation separately retains final-package-review.json, including both new report paths; no final archive hash is inferred from the earlier listing. No archive was created or published.`
    : "Final package path/file-list review is a publication-validation prerequisite; the validator refuses to close the report without its retained result. No archive is created or published.",
  "",
  "npm advisories report zero vulnerabilities over 217 total dependencies. The explicit local Rust DB scan covers 137 lock entries with zero reported vulnerabilities and the unmaintained paste 1.0.15 warning (RUSTSEC-2024-0436). Its database is not freshly fetched, has an unrelated untracked advisory and omits commit/time in the scanner JSON; this is not a current authoritative clean-DB or upstream-implementation assurance claim.",
  "",
  "Read-only remote metadata shows no release or tag. [Current CI](https://github.com/hobby-eng/mnemocode/actions/runs/38791616213) is successful fast push CI at the exact HEAD, not full release CI. All 131 HEAD ancestors have signature headers and UTC author/committer offsets; independent cryptographic verification was not performed. Release signing, attestations and all three final platform assets still require their authorized normal process.",
  "", "### Findings", "",
  ...report.findings.map(findingText),
  "### Remediation and follow-up", "",
  "| Finding ID | Status | Fix commit | Verification commit | Evidence |",
  "| --- | --- | --- | --- | --- |",
  ...report.findings.map((finding) => `| ${finding.id} | open | Not fixed | Not run | Current baseline reproduction; no remediation authorized |`),
  "",
  "Earlier producer cleanup/loader/artwork/metadata dispositions remain verified only within the final dated AUD-031 scope at d4776f76ed5030c295604192608e8b250067975f and the identical 607-file source. Initial historical open tables are not current statuses. The new stale-test findings do not falsely reopen the previously verified secret-cleanup root finding or turn historical checks into fresh executions.",
  "", "### Informational observations and recommendations", "",
  ...report.informationalObservations.map((text) => `- ${text}`),
  "", "### Assessment and limitations", "",
  "**Do not publish this snapshot as a passing release candidate.** Two mandatory test contracts fail; one low documentation mismatch remains. Release verification is FAIL with incomplete execution, even though the current public cryptographic/recovery, native comparison, source/executable PTY and real-media controls passed.",
  "",
  ...report.limitations.map((text) => `- ${text}`),
  "- Full Windows/macOS native release execution, external cached-plan/borrower acceptance and actual browser verification were not performed. Fast platform CI is not substituted for them.",
  "- No product/test fix, dependency/workflow/vendor change, commit, push, tag, signing, upload, release operation, paid CI dispatch, second checkout or wallet-tools integration was performed.",
  "",
  "Record validation, exact reviewer input bindings and SHA256SUMS are local-only in AUD-032-evidence/. Published reproducible inputs and limitations are in this report/JSON and the [harness README](AUD-032-harnesses/README.md).",
  "",
].join("\n");
const prefix = `AUD-032-${date}`;
const publish = process.argv.includes("--publish");
if (publish && (contract === null || releaseChallenge === null))
  throw new Error("Actual independent caller and release-evidence challenges are required.");
const destination = publish ? resolve(root, "docs/audits") : evidence;
const stem = publish ? prefix : "report-preview";
for (const [extension, content] of [["md", markdown], ["json", JSON.stringify(report, null, 2) + "\n"]])
  writeFileSync(resolve(destination, `${stem}.${extension}`), content, { flag: "wx" });
console.log(JSON.stringify({ published: publish, auditId: report.auditId,
  sourceFingerprint: snapshot.sourceFingerprint, files: coverage.files, rules: coverage.ruleLedger.length,
  checks: checks.length, findings: findings.length, executions: executions.length }));
