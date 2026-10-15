"""Assemble the canonical audit from retained reviews; never execute or fix the product."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
EVIDENCE = ROOT / "docs/audits/AUD-030-evidence"
DATE = "2026-10-15"
STEM = "AUD-030-" + DATE


def load(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private_paths(value):
    if isinstance(value, str):
        value = value.replace(str(Path.home()), "/home/user")
        return re.sub(r"\b" + re.escape(Path.home().name) + r"\b", "user", value)
    if isinstance(value, list):
        return [private_paths(item) for item in value]
    if isinstance(value, dict):
        return {private_paths(key): private_paths(item) for key, item in value.items()}
    return value


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def table(headers, rows):
    return ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |",
            *("| " + " | ".join(cell(item) for item in row) + " |" for row in rows), ""]


def evidence_reference(label):
    if label.endswith(".json"):
        path = EVIDENCE / label
        return {"localOnly": True, "path": label, "sha256": digest(path)}
    path = EVIDENCE / (label + ".command.json")
    item = load(path)
    return {"localOnly": True, "record": path.name, "recordSha256": digest(path),
            "log": label + ".log", "logSha256": item["logSha256"], "exitCode": item["exitCode"]}


snapshot = load(EVIDENCE / "snapshot.json")
data = load(HERE / "report-data.json")
coverage_data = load(HERE / "coverage-data.json")
protocol = load(EVIDENCE / "protocol-review.json")
interface = load(EVIDENCE / "interface-review.json")
history = load(EVIDENCE / "history-review.json")
coordinator = load(EVIDENCE / "coordinator-review-progress.json")
skills = load(EVIDENCE / "skill-usage-plan.json")
completeness_path = EVIDENCE / "completeness-review.json"
completeness = load(completeness_path) if completeness_path.exists() else {"status": "pending"}
publish = "--publish" in sys.argv[1:]
if publish and completeness.get("status") not in {"complete", "complete-with-limitations"}:
    raise ValueError("Independent completeness/skeptic review is not final.")
if publish and not interface["completeness"]["allTestBodiesComplete"]:
    raise ValueError("Interface test-body review is not final.")
drift = [row["path"] for row in snapshot["files"] if digest(ROOT / row["path"]) != row["sha256"]]
if drift:
    raise ValueError("Frozen baseline changed: " + ", ".join(drift))

reviews = {"protocol": protocol, "interface": interface, "history": history, "coordinator": coordinator}
review_files = {role: {row["path"]: row for row in review["fileLedger"]}
                for role, review in reviews.items()}
file_ledger = []
for row in snapshot["files"]:
    reviewed = review_files[row["owner"]][row["path"]]
    context = reviewed.get("review", reviewed)
    file_ledger.append({"path": row["path"], "sha256": row["sha256"], "size": row["size"],
                        "owner": row["owner"], "method": context.get("method"),
                        "depth": context.get("depth", context.get("reviewDepth", "stated method")),
                        "gaps": context.get("unresolvedGaps", context.get("limitations", []))})
    if "boundedBodyReview" in reviewed:
        file_ledger[-1]["historicalBodyReview"] = reviewed["boundedBodyReview"]
    else:
        file_ledger[-1]["reviewRanges"] = context.get("ranges", reviewed.get("implementationRange"))

check_plan = load(EVIDENCE / "check-plan.json")
for row in check_plan:
    row["outcome"], row["evidence"] = coverage_data["checks"][row["checkId"]]
    row["method"] = "All-file static review plus individually attributed retained/new execution where stated"
    row["logicalGroup"] = "MnemoCode offline library, CLI, native/WASM and export surface as applicable"

executions = []
for path in sorted(EVIDENCE.glob("*.command.json")):
    item = load(path)
    executions.append({key: value for key, value in item.items() if key != "memorySamples"} |
                      {"label": path.stem.removesuffix(".command"), "kind": "new-execution",
                       "recordSha256": digest(path), "localEvidence": path.name})
findings = []
for finding in data["findings"]:
    findings.append(finding | {"kind": "finding", "status": "open", "releaseBlocking": False,
                               "evidence": [evidence_reference(label) for label in finding["evidenceLabels"]]})

operations = load(EVIDENCE / "public-operations.json")
for operation in operations["operations"]:
    operation["coverage"] = "Containing-file source/contract review at the file ledger's stated depth"
constructors = load(EVIDENCE / "public-constructor-supplement.json")
rule_ledger = []
for row in protocol["coreRuleCoverage"]:
    rule = row["rule"]
    related = [f["id"] for f in findings if rule in f["relatedRules"]]
    rule_ledger.append(row | {"interfaceReview": interface["ruleLedger"].get(rule),
                              "relatedFindings": related,
                              "conclusion": "open finding affects this rule" if related else
                              "Reviewed within stated scope; no universal conformance proof"})

tools = [
    ["Node.js / pnpm", "26.10.0 / 12.8.1", "Actual commands and source-bound gates/build; existing install"],
    ["TypeScript gate / inventory parser", "7.0.2 / 5.9.3", "Gate is native TS7; existing scratch TS5 parser inventories declarations; not the same tool"],
    ["Vitest", "5.0.3", "New targeted 24/4 and 182/8 groups; retained 133/7 date group, never summed across overlap"],
    ["oxlint / oxlint-tsgolint / Prettier", "1.88.0 / 7.0.2004 / 3.9.9", "Installed package identities and retained exact-source gates; new format check"],
    ["Rust / Cargo", "1.99.0 crate; root probe 1.98.1", "Crate pin used for seven native tests; root shell result is not silently substituted"],
    ["Docker", "29.9.1", "Version observed; no canonical rebuild/reproduction executed"],
    ["Python / jsonschema", "3.14.4 / 4.19.2", "Independent public SSKR oracle, real PTY checks, record schema/pairing and pure-path probes"],
    ["cargo-mutants", "27.1.0", "Newly available tool; correct cargo mutants invocation: preview45, encoding-only2, compiled/executed0"],
    ["pnpm audit / cargo audit", "12.8.1 / 0.22.2", "No returned npm advisories; no RustSec known vulnerabilities, unmaintained paste1.0.15 observation"],
    ["GitHub CLI / OS", "2.46.0 / Linux7.0.0-38-generic x86_64", "Read-only reporting endpoint; environment identification, no CI dispatch or remote changes"],
    ["Semgrep / CodeQL / uv", "Absent (ENOENT)", "No scanner/rules/database/SARIF/collector execution; other audit scopes continued"],
    ["fast-check", "Not a project dependency", "No installation or generated-property/scheduler campaign; method applied to existing tests"],
    ["Static skill methods", "33 exact SKILL hashes recorded below", "Read resources and applicability are evidence; installation is not a test run"],
]
observations = [
    {"title": "Unmaintained transitive build dependency", "detail": "RustSec RUSTSEC-2024-0436 flags paste1.0.15 as unmaintained. No vulnerability returned. Its proc-macro dependency path is reviewed; no unreviewed replacement is proposed as an automatic fix.",
     "databaseCommit": "edb58f5974b83eb8302332821cb6d389777aa351", "databaseUpdatedUtc": "2026-10-14T20:18:32Z"},
    {"title": "No new mutation score", "detail": "45 broad preview edits include sensitive paths and are not approved execution targets; two encoding-only preview edits exclude RNG/protection/wiping. Zero were applied, compiled or executed."},
    {"title": "Below-quorum cryptographic theory", "detail": "The static SSKR/digest observation is not a newly executed attack or quantified entropy-loss result. The documentation finding relies only on actual visible metadata and recovery refusal."},
    *history["observations"],
]
refuted = [*protocol["refutedCandidates"], *interface["refutedCandidates"], *history["refutedCandidates"]]
refuted.append({"candidate": "A missing input file proves the combined SSKR export options fail",
                "disposition": "refuted: corrected actual public-vector invocation exited0 and exported3PDFs/sidecars; original missing-file diagnostic exit1 retained"})
record = {
    "schemaVersion": 1, "auditId": "AUD-030", "auditNumber": 30, "date": DATE, "title": data["title"],
    "reviewer": {"name": "Codex coordinator and independent scoped reviewers", "model": None, "reasoningEffort": None},
    "snapshot": {"commit": snapshot["commit"], "commitComplete": True, "workingTree": snapshot["workingTree"],
                 "sourceFingerprint": snapshot["sourceFingerprint"], "allFilesFingerprint": snapshot["allFilesFingerprint"],
                 "remoteBaseline": snapshot["remote"], "capturedAtUtc": snapshot["capturedAtUtc"]},
    "procedureHashes": load(EVIDENCE / "procedure-hashes.json"),
    "scope": {"files": len(file_ledger), "nonAuditFiles": 555, "historicalAuditFiles": 403,
              "fileLedger": file_ledger, "publicInventory": operations, "constructorSupplement": constructors,
              "nativeOperationSupplement": protocol.get("nativeOperationSupplement"),
              "nativeTypeSupplement": protocol.get("nativeTypeSupplement"),
              "interfaceSupplement": protocol.get("interfaceSupplement"),
              "guarantees": coverage_data["guarantees"], "coreRuleLedger": rule_ledger,
              "historicalDepth": history["completeness"], "historicalLimits": history["limitations"],
              "exclusions": snapshot["excluded"], "independentCompleteness": completeness},
    "artifacts": {key: value for key, value in load(EVIDENCE / "build-artifacts.json").items() if key != "files"},
    "tools": tools, "newSkills": skills, "checks": {"coverageLedger": check_plan, "newExecutions": executions,
              "retainedExactSource": load(EVIDENCE / "reused-results.json"),
              "hostReportedOnly": load(EVIDENCE / "host-integration.json")},
    "findings": findings, "observations": [], "informationalObservations": observations,
    "schemaEnvironmentPrerequisites": load(EVIDENCE / "python-requirements-provenance.json"),
    "finalHarnessIdentities": [{"path": str(path.relative_to(ROOT)), "sha256": digest(path),
                               "binding": "Final retained bytes; retrospective, not a contemporaneous execution pin"}
                              for path in sorted(HERE.iterdir()) if path.is_file()],
    "commandProvenanceLimit": "Records bind source, log and inherited guard hash, not every contemporaneous new harness byte or full inherited environment. The guard's fixed heap/reserve/time and NODE_OPTIONS/TZ/GOMEMLIMIT overrides are source-readable. Final new-harness identities are retrospective; original command records are not rewritten.",
    "refutedCandidates": refuted,
    "remediation": [{"id": f["id"], "status": "open", "fixCommit": None, "verificationCommit": None,
                     "evidence": "Frozen baseline only; no remediation applied in AUD-030"} for f in findings],
    "limitations": data["limitations"], "assessment": {"releaseAcceptance": False,
                  "fullCoreCompliance": False, "allDefectsFoundClaim": False,
                  "newFindingCount": sum(f["id"].startswith("AUD-030-") for f in findings),
                  "originalFindingCount": sum(not f["id"].startswith("AUD-030-") for f in findings)},
}
record = private_paths(record)
lines = ["# AUD-030 — " + data["title"], "", "## Record metadata", "",
         "- **Audit number / UTC completion date:** 30 / " + DATE + ".",
         "- **Reviewer:** Codex coordinator; protocol and interface/history reviewers; separate completeness/skeptic reviewer.",
         "- **Model / reasoning effort:** unknown / unknown for every phase; no exact client setting retained.",
         "- **Reviewed signed HEAD:** `" + snapshot["commit"] + "` on `main`.",
         "- **Working tree:** pre-existing uncommitted implementation/test/document changes, including the reviewed date-owner fix; HEAD alone does not identify this baseline. No commit/push/tag/release made.",
         "- **Remote baseline:** `" + snapshot["remote"] + "`.",
         "- **555-file non-audit source fingerprint:** `" + snapshot["sourceFingerprint"] + "`.",
         "- **958-file complete baseline fingerprint:** `" + snapshot["allFilesFingerprint"] + "`.",
         "- **Artifacts:** retained exact-source build of 549 dist files; aggregate `70cb6856e3850636131a9afe57ded13b95dad9c5187ab0bd04718f1b29b61a13`. No executable, browser bundle or canonical engine rebuild.", "",
         "The review covers every tracked/trackable baseline file, including unchanged files. Production, project tests, dependencies, workflows and canonical outputs were frozen. Only this audit's report/harnesses and ignored outputs/evidence were added. The audit index is appended after baseline validation.", "",
         "## Finding register", ""]
lines += table(["Finding ID", "Category", "Kind", "Severity", "Status", "Title"],
               [[f["id"], f["category"], "finding", f["severity"], "open", f["title"]] for f in findings])
lines += ["Nine new findings and two continuing/recurrent original IDs are recorded. All are Low, with releaseBlocking=false on demonstrated impact; that does not close the owner's CORE conformance requirement or approve a release.", "",
          "## Review evidence", "", "### Scope and methodology", "",
          "Primary scopes were protocol/library/native/WASM/vectors (223 files), CLI/export and tests (239), coordinator docs/config/tooling/assets (93), and historical reports/harnesses (403). Two reviewers ran concurrently at most; a separate reviewer then challenged findings and coverage. The main session owns implementation; none was performed during baseline.", "",
          "Ordinary assigned test bodies and self-test assertions were read, with literal/independent expectation origins and refusal/cleanup paths. Generated/literal tables and binary assets received explicitly recorded structural/provenance review. This is not a claim of universal semantic proof or every glyph/pixel inspected.", "",
          "Historical depth is separately bounded: 308 executable harnesses received control/body review, 178 with complete direct body ranges and 130 with bounded ranges and explicitly listed unread algorithm/data ranges. The 28 canonical JSON records and 67 Markdown files received structural/status/provenance and selected substantive-claim review. Every historical path has a method; this does not mean every old sentence or inherited algorithm body was semantically rereviewed. The paired JSON publishes these exact ranges and limits.", "",
          "The public inventory contains 1,941 top-level declarations, 663 class members and 58 explicit constructors, supplemented by interfaces and Rust exports/types. Types, re-exports and constructors are distinguished from executable operations. The JSON companion publishes every baseline path/hash/method/depth and the public-contract inventory.", "",
          "Checks used a sequential guard with a 3GiB machine reserve, normally 1GiB process-tree RSS / 256MiB Node heap; the native test allowance was 1.5GiB. Static reviewers had 512MiB each. Sampled per-command RSS peaks and available-memory minima, UTC times and log hashes are retained locally. No heavy concurrent jobs, reduced crypto parameters or extra checkouts were used.", "",
          "### Procedure and instruction identity", ""]
lines += table(["Workspace-relative resource", "SHA-256"], record["procedureHashes"].items())
lines += ["### New tools and installed audit skills", "",
          "The shared update added 30 Trail of Bits methods and three adapted methods. They are instruction/resource bundles, not tests installed into this project. No new runtime dependency was installed by this audit; local CORE/RUST contracts override imported guidance.", ""]
lines += table(["Tool / method", "Version / identity", "Actual use or limitation"], tools)
lines += table(["Imported source", "Revision", "License"],
               [[s["name"], s["commit"], s["license"]] for s in skills["sources"]])
lines += ["The JSON companion retains upstream URLs/import times, bundle metadata hashes, each SKILL hash and the reviewers' actually read resource paths/hashes. 'Applied method' means the specified static reasoning was used; native scanners or campaigns are counted only by their command records.", ""]
lines += table(["New skill", "Disposition", "Actual scope / reason", "SKILL SHA-256"],
               [[s["name"], s["status"], s["application"], s["sha256"]] for s in record["newSkills"]["skills"]])
lines += ["Existing wallet-full-audit, wallet-security-review and wallet-derivation-validation methods were also used. wallet-public-data-validation was read and is inapplicable to this offline product. wallet-release-verification was not triggered: this is not separately authorized release verification.", "",
          "### Coverage ledger", "",
          "Passed means the stated scope/method found no failing requirement; it never means every possible execution passed. Runtime gaps are explicit even when source review completed.", ""]
lines += table(["Check ID", "Area", "Outcome", "Evidence / limitation"],
               [[c["checkId"], c["title"], c["outcome"], c["evidence"]] for c in check_plan])
lines += ["### Claimed guarantees and CORE review", ""]
lines += table(["Guarantee / contract", "Source surface", "Review / remaining limit"], coverage_data["guarantees"])
lines += ["The JSON companion has one ledger entry for every CORE-01..53 rule, combining protocol and interface assessments. Retained compiler/lint/copies/code-rules gates support mechanical rules; semantic design/lifetime/security rules require source judgment. A missing class alone is not a defect; retained secret ownership and direct cancellation findings remain actual open requirements.", "",
          "### Checks: newly executed", "",
          "Every row has exact sanitized argv, UTC start/end, original exit, source-before/after, guard/log/record hashes and resource limits in the JSON companion. Full inherited environments and contemporaneous new-harness bytes were not captured per run. Guard defaults/overrides are source-readable; final published harness hashes are retrospective and do not rewrite original records. Logs and command records are local-only in `AUD-030-evidence/`. Diagnostic exit0 means the probe ran, not that its observed contract passed.", ""]
for_table = []
for c in executions:
    cmd = " ".join(c["command"])
    if " -e " in cmd or " -c " in cmd:
        cmd = c["label"] + " (inline diagnostic; exact argv in JSON)"
    for_table.append([c["label"], private_paths(cmd), str(c["exitCode"]), c["logSha256"]])
lines += table(["Local evidence label", "Command / probe", "Exit", "Log SHA-256"], for_table)
lines += ["New scoped Vitest groups passed: 24 tests / 4 files (tooling/release/privacy), and 182 / 8 (boundaries/secret files/integrity/portable closure). Seven native Rust tests passed; the independent Python SSKR oracle and full existing Linux real-PTY script passed. These are separate scopes, not an aggregate full-suite count.", "",
          "`boundary-probes.mjs` intentionally exits 1 at this baseline: 7 failed assertions among 19, representing six runtime root causes/variants, not seven independent defects. `record-probes.py` exits 1: 3 failures among 7 assertions, representing two historical metadata defects. No assertion was relaxed and no production fix was applied.", "",
          "Initial diagnostic mistakes remain visible: direct cargo-mutants --version used the wrong subcommand convention; later cargo mutants --version identified27.1.0. A first card CLI probe failed only because its input file was missing; corrected public input passed. A pre-baseline startup probe imported the wrong entry; its corrected exact-source run passed. None is called a product defect.", "",
          "### Retained exact-source and external evidence", "",
          "Five pre-baseline AUD-029 records were admitted after matching source45a2, runner, record and log hashes: 133 tests/7 files; pnpm check; pnpm build; four focused PTY cases; and startup366.016615ms. These are retained executions, not new AUD-030 runs, and are not added to overlapping new test counts.", "",
          "The wallet-tools session reports normal sync/admission of all192 producer pins, 36 owner/UI tests, 10 closure tests, 67 nearby date/search/share tests, its gates and focused main/Dash builds. Its build fingerprint is `b0b87dbcc24afd519359caca1e1662a8efdfeb5c234b2ac37c2fa6850de42ea2`; static follow-up snapshot `a3d06c34d7c2b7202923c48d61361935214c269f84ddd14b1e085eecf4f890d8`. These scopes overlap and were not independently executed here; no actual browser/full-vector claim follows.", "",
          "### Findings", ""]
for f in findings:
    lines += ["#### " + f["id"] + " — " + f["severity"].capitalize() + " — " + f["title"], "",
              "- **Category / kind / status:** " + f["category"] + " / finding / open.",
              "- **Release blocking:** false; " + f["releaseBlockingReason"],
              "- **Affected files and builds:** " + "; ".join("`" + x + "`" for x in f["affectedFiles"]) + ".",
              "- **Applicable rules:** " + ", ".join(f["relatedRules"]) + "."]
    for key, title in [("reproduction", "Reproduction"), ("expected", "Expected behavior"),
                       ("observed", "Observed behavior"), ("impact", "Impact and limits"),
                       ("recommendedFix", "Recommended fix"), ("requiredVerification", "Required verification")]:
        value = f[key]
        if isinstance(value, list):
            value = " ".join(value)
        lines.append("- **" + title + ":** " + value)
    lines.append("- **Evidence (local only):** " + "; ".join(
        e.get("log", e.get("path", "")) + " SHA-256 `" + e.get("logSha256", e.get("sha256", "")) + "`"
        for e in f["evidence"]) + ".")
    if "classificationNote" in f:
        lines.append("- **Finding identity:** " + f["classificationNote"])
    lines.append("")
lines += ["### Remediation and follow-up", ""]
lines += table(["Finding ID", "Status", "Fix commit", "Verification commit", "Evidence"],
               [[f["id"], "open", "None", "None", "Original baseline/static or failing acceptance evidence above"] for f in findings])
lines += ["Earlier reviewed date-owner and seven ARC checkpoint fixes remain credited by their own source identities. New findings do not erase those results. Further CORE migration and corrections belong to a separate post-report phase, with independent review after each cohesive fix and API handover to wallet-tools.", "",
          "### Informational observations and refuted candidates", ""]
for observation in observations:
    lines.append("- " + observation.get("title", observation.get("key", "Observation")) + ": " +
                 observation.get("detail", observation.get("meaning", "See paired JSON")))
lines += ["", "Refuted candidates and their source/control evidence are retained in the JSON: combined A6 SSKR PDF/cards-dir output, supported whole-share QR compatibility, blanket classless-module violations, general-purpose PDF parsing assumptions, AUD-023's explicitly abandoned report, old source/API links and historical phase/hash differences. A changed historical hash alone is not new runtime failure. The 403-file review found427 direct path-hash bindings:409 current matches and18 explained historical differences; original phase artifacts were not all reconstructed.", "",
          "### Independent completeness and skepticism", "",
          "See the paired JSON scope.independentCompleteness for the separate review's exact accepted/rejected/limited findings, coverage gaps, snapshot and limitations. Reviewers' conclusions were challenged against source and parent runtime controls; a ledger is not a substitute for implementation reading.", "",
          "### Assessment and limitations", ""]
lines += ["- " + value for value in data["limitations"]]
lines += ["", "Confirmed baseline remarks remain open. No release acceptance, clean bill, perfect erasure, constant-time proof or complete CORE conformance is asserted.", ""]
markdown = private_paths("\n".join(lines))
destination = ROOT / "docs/audits" if publish else EVIDENCE
name = STEM if publish else "report-preview"
(destination / (name + ".json")).write_text(json.dumps(record, indent=2, ensure_ascii=True) + "\n")
(destination / (name + ".md")).write_text(markdown)
print(json.dumps({"destination": str(destination.relative_to(ROOT)), "record": name,
                  "findings": len(findings), "files": len(file_ledger), "skills": len(skills["skills"]),
                  "checks": len(check_plan), "baselineDrift": drift}))
