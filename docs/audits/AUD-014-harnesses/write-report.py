"""Assemble AUD-014 from retained current-source evidence; never change original evidence."""

import datetime
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT / "docs/audits"
E = HERE / "AUD-014-evidence"


def read(name):
    return json.loads((E / name).read_text())


def private(value):
    # Only published text is anonymized. Raw command evidence remains unchanged.
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s\"'<>]+", "/home/user", value)
    if isinstance(value, list):
        return [private(item) for item in value]
    if isinstance(value, dict):
        return {key: private(item) for key, item in value.items()}
    return value


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


reviews = {name: read(f"resumed-review-{name}.json") for name in ["core", "sskr", "exports", "architecture"]}
baseline = read("resumed-snapshot.json")
final = read("final-snapshot.json")
if baseline["fingerprint"] != final["fingerprint"]:
    raise SystemExit("Implementation drift must be adjudicated before generating the report")
findings = []


def finding(identifier, category, severity, candidate, observed, label, blocking=False):
    reproduction = candidate.get("reproductionProposal", candidate.get("productionEntryReproductionProposal", {}))
    locations = []
    for place in candidate.get("locations", []):
        path = place["path"]
        locations.append({"path": path, "line": place.get("startLine", place.get("line", 1)),
                          "sha256": digest(ROOT / path)})
    item = {
        "id": identifier, "category": category, "kind": "finding",
        "title": candidate["title"], "severity": severity, "status": "open",
        "releaseBlocking": blocking,
        "releaseBlockingReason": "Fix before publishing the affected supported operation" if blocking else
            "Bounded edge/interface or exceptional-host case; not independently a release blocker",
        "evidence": {"localOnly": True, "command": label, "log": f"AUD-014-evidence/{label}.log",
                     "logSha256": digest(E / f"{label}.log"), "sourceLocations": locations},
        "reproduction": {"entry": reproduction.get("productionEntry", reproduction.get("entryPoint", reproduction.get("entryPoints", "See the retained production-entry harness"))),
                         "stepsAndObservedResult": observed, "executed": True,
                         "fixture": "Public BIP39/SSKR vectors or tiny synthetic data only",
                         "command": read(f"{label}.command.json")["command"]},
        "expected": candidate.get("supportedContract", reproduction.get("expected", "Supported contract remains enforced")),
        "observed": observed,
        "impact": candidate.get("impactAndLimits", candidate.get("impact", candidate.get("impactLimits", "Limited to the described public entry point and prerequisites"))),
        "recommendedFix": candidate.get("minimalRecommendation", candidate.get("recommendedFix", "Use the existing domain validator at the affected boundary")),
        "requiredVerification": candidate.get("requiredVerification", "Add the exact public reproduction and well-formed controls to the affected production-path tests; preserve messages and ownership"),
        "relatedFindings": candidate.get("relatedPriorIds", candidate.get("priorReferences", [])),
        "reviewSnapshot": baseline["fingerprint"],
    }
    findings.append(item)
    return item


def local(title, locations, contract, impact, fix):
    return {"title": title, "locations": [{"path": path, "line": line} for path, line in locations],
            "supportedContract": contract, "impact": impact, "minimalRecommendation": fix}


C = reviews["core"]
S = reviews["sskr"]
X = reviews["exports"]
A = reviews["architecture"]
finding("AUD-014-SEC001", "SEC", "medium", C["runtimeHypotheses"][0],
        "kind=passpharse, unknown or undefined returned NoProtection and actual plaintext MNCL bytes (encrypted=false). Valid CLI choices were not shown to leak.", "resumed-runtime-probes", True)
finding("AUD-014-SEC002", "SEC", "low", local(
    "Unavailable swap enumeration suppresses the promised uncertainty warning",
    [("src/cli/swap-check.ts", 65), ("src/cli/command-line.ts", 115), ("SECURITY.md", 44)],
    "README and SECURITY promise a warning on Linux when swap encryption cannot be determined.",
    "A restricted but otherwise functioning Node permission-model launch gives no swap advisory. No actual secret disclosure is demonstrated.",
    "Represent enumeration failure as unknown and let the common warning owner distinguish unknown from verified absence of swap."),
    "The synthetic missing /proc/swaps returned []; the real CLI with reads limited to the package exited 0 and printed no swap warning.", "resumed-cli-probes-v2")
finding("AUD-014-FUN001", "FUN", "medium", S["runtimeHypotheses"][0],
        "The canonical public quorum restored correctly. Its accepted nonminimal short CBOR variant paired with the second member was refused by the real engine: These shares do not restore a secret. Existing repair tests explicitly call this layout supported.", "resumed-sskr-probes", True)
finding("AUD-014-FUN002", "FUN", "medium", S["runtimeHypotheses"][1],
        "A public third share with one code-point mark and one complete-color mark, alongside two intact quorum members, produced no-fit. The correct mixed width model is never enumerated. No large search ran.", "resumed-sskr-probes", True)
finding("AUD-014-FUN003", "FUN", "medium", X["runtimeHypotheses"][0],
        "After real CLI path preflight, a synthetic file appeared at that path; the actual exportCards publication adapter replaced it (refused=false, preserved=false). Only rendering was stubbed with opaque public bytes; no PDF was generated.", "resumed-export-probes-opt-in", True)
finding("AUD-014-API001", "API", "medium", C["runtimeHypotheses"][2],
        "A configured callback returning undefined or {matched:'false'} yielded matchCount=1. Boolean false and true controls yielded 0 and 1. This is faulty-host return validation, not protection against a dishonest checker.", "resumed-runtime-probes", True)
finding("AUD-014-API002", "API", "medium", A["runtimeHypotheses"][0],
        "A tiny passphrase file ending in byte FF and LF was accepted with U+FFFD replacing FF. No KDF or wallet derivation was needed. Intentionally valid UTF-8 U+FFFD must remain allowed.", "resumed-runtime-probes", True)
finding("AUD-014-API003", "API", "medium", X["runtimeHypotheses"][1],
        "Otherwise complete stock-template objects with capacities -1, Infinity or NaN returned zero cards; 0 and 0.5 reached the rendering callback before refusal. A sentinel stopped immediately before rendering. Capacity 1 was the valid control. No infinite loop or PDF was executed.", "resumed-template-facts-probes", True)
finding("AUD-014-API004", "API", "medium", S["runtimeHypotheses"][3],
        "The real async restore captured members at places [1,2,3]. Public input edits during a gated combine caused its completed old set to be paired with current places [2,3,4]. A host revision guard can discard stale results, but this library result is internally inconsistent.", "resumed-sskr-probes", True)
finding("AUD-014-API005", "API", "low", C["runtimeHypotheses"][3],
        "Masking.of('direct').encode(phrase,[date]) returned zero dates; direct EncodedBackup.decode([date]) returned the unmasked phrase. Valid CLI encoding already refuses this combination.", "resumed-runtime-probes")
finding("AUD-014-API006", "API", "low", C["runtimeHypotheses"][4],
        "MissingCodes.read(publicMarkedPhrase,'english','unknown') returned an object whose mode is unknown. Later mode-dependent operations refuse by source trace; no alternative algorithm or wrong recovered phrase was demonstrated.", "resumed-runtime-probes")
finding("AUD-014-API007", "API", "low", C["sourceConfirmedDesignDuplication"][4],
        "With the same deliberately stale redundant fields as the raw-format regression, JSON contained one word (zoo) and Unicode 0000 while raw English from the canonical indexes had 12 words. Healthy production-created results were not shown to diverge.", "resumed-runtime-probes")
finding("AUD-014-API008", "API", "low", S["runtimeHypotheses"][2],
        "The raw bridge rejected encoding 2 but accepted 256, 257 and NaN, selecting UR or Bytewords after ABI narrowing. This concerns the raw generated JS boundary; ordinary ShareSplit validates its options. No generated glue was edited.", "resumed-sskr-probes")
finding("AUD-014-API009", "API", "low", S["runtimeHypotheses"][5],
        "ShareRestore.read(new ShareInput(...)) threw Cannot read properties of undefined (reading '0'), before restoration, instead of returning its structured trouble outcome. Empty native prompts already refuse earlier.", "resumed-sskr-probes")
finding("AUD-014-API010", "API", "low", local(
    "A valued unknown __proto__ option disappears before CLI validation",
    [("src/cli/arguments.ts", 9), ("src/cli/arguments.ts", 54)],
    "Unknown named options are refused by assertAllowedArguments; special object names must remain ordinary parsed keys.",
    "A string argv value is silently lost. No prototype pollution, recovery change or secret compromise is demonstrated.",
    "Use a null-prototype parsed record or explicit own property definition, retaining unknown-option refusal and repeat handling."),
    "parseArguments(['--__proto__','synthetic-value']) had no keys; table --word abandon --__proto__ synthetic-value exited 0. Constructor/toString/hasOwnProperty controls were refused.", "resumed-cli-probes-v2")
finding("AUD-014-API011", "API", "low", A["runtimeHypotheses"][1],
        "On POSIX a taken basename public-record followed by a literal backslash was numbered public-record-1 instead of preserving the backslash. This is a different owner/fix from corrected AUD-012-API003 containment, so it has a new ID.", "resumed-runtime-probes")
finding("AUD-014-API012", "API", "low", X["runtimeHypotheses"][2],
        "The actual production heir route accepted threshold=4/count=3 and printed Any 4 of the 3 Shamir shares; an unknown encoded format printed The backup: undefined. Valid 2-of-3 was the control. No sheet was rendered.", "resumed-template-facts-probes")
for candidate, observation in zip(S["residualPriorFindingExtensions"], [
    "Share.read(publicShare).write('typo') returned undefined instead of refusing the unsupported representation.",
    "Injected host-HMAC failure after planning left both captured ReadingSpace arrays nonzero after ShareRestore.read rejected. The harness wiped them finally. No heap dump or secret extraction was performed.",
]):
    finding(candidate["canonicalId"], candidate["category"], "low", candidate, observation, "resumed-sskr-probes")

# Source-review hypotheses had not yet run; final finding wording reflects the coordinator probes.
impact_updates = {
    "AUD-014-FUN003": "The controlled late-collision reproduction replaced an unrelated public fixture through the real publication adapter. Rendering was stubbed; no actual PDF, wallet backup loss or hostile-host exploit was demonstrated. Normally existing names are renumbered, so the failure needs a later collision.",
    "AUD-014-API002": "Malformed or misencoded passphrase files are accepted as changed Unicode text. The probe established replacement decoding, not an actual wrong wallet or encryption run. Valid UTF-8 remains supported; a malformed file has no uniquely inferable intended Unicode password.",
    "AUD-014-API003": "Malformed custom capacities produced an empty collection or reached the callback without early refusal. A sentinel prevented rendering and unbounded iteration. All other template/drawing fields came from production objects; no stock capacity failure or actual backup corruption was shown.",
    "AUD-014-API011": "A taken POSIX filename was assigned a different basename than the promised numbered copy. Exclusive creation still protects existing files. The corrected containment rule in AUD-012-API003 has a different owner/fix and is related history, not this defect's duplicate.",
    "AUD-014-API012": "Malformed backup facts produced impossible or undefined instructions through the production route. Normal CLI facts are validated upstream. This probe generated text only; no physical sheet, invalid valid-share set or actual loss was demonstrated.",
}
for item in findings:
    if item["id"] in impact_updates:
        item["impact"] = impact_updates[item["id"]]

recommendations = []
for name, review in reviews.items():
    copies = review.get("sourceConfirmedDesignDuplication", review.get("sourceConfirmedDesignDuplications", []))
    for item in copies:
        if item.get("reference") == "core-dup-json-cache":
            continue  # Actual serializer consequence is tracked above, not counted twice.
        recommendations.append({"group": "Residual duplicated behavior", "scope": name,
            "title": item["title"], "sourceReasoning": item.get("observedSourceReasoning"),
            "recommendation": item.get("minimalRecommendation", item.get("recommendedFix")),
            "locations": [{"path": p["path"], "line": p.get("startLine", p.get("line", 1)),
                           "sha256": digest(ROOT / p["path"])} for p in item.get("locations", [])],
            "priorReferences": item.get("priorReferences", item.get("relatedPriorIds", [])),
            "verification": "Preserve public messages, ordering, random-call order, secret ownership and exact outputs; consolidate only the shared operation"})
    for item in review.get("optionalImprovements", review.get("optionalImprovementsAndDiagnosticAssessments", [])):
        recommendations.append({"group": "Optional improvement", "scope": name,
            "title": item.get("title", item.get("recommendation", item.get("recommendedFix", "Scoped optional improvement"))),
            "recommendation": item.get("minimalRecommendation", item.get("recommendedFix", item.get("recommendation"))),
            "sourceReasoning": item.get("observedSourceReasoning"),
            "verification": "No speed claim: measure a bounded sample before accepting a performance tradeoff"})

adjudication = [
    {"title": "Late async abort is a stronger-contract opportunity",
     "observed": "One final wallet callback aborted its signal; DateSearch still published one match.",
     "decision": "Not a confirmed contract breach: SearchRun expressly stops at the next turns check, and no further check remained. Strengthen completion guards deliberately and preserve host revision gates."},
    {"title": "Unchecked checksum kernel has an ambiguous public precondition",
     "observed": "checksumValid reported true with an out-of-range index 2048 while validated WordCandidate routes reject such indexes.",
     "decision": "Keep outside confirmed findings: the kernel compares checksum bits on CandidateWords. Make the unchecked precondition explicit or expose a checked facade, preserving the internal fast path."},
    {"title": "Cleanup can fail after file publication",
     "observed": "A controlled rm failure left the complete published file and rejected the helper promise with EACCES.",
     "decision": "Operational status improvement, not an atomic-visibility violation: the destination was complete. Distinguish committed output and residual staging cleanup in the caller; do not hide a private staging-copy warning."},
    {"title": "Short-copy diagnostic includes declarations and adapter wiring",
     "observed": "The 35-token scan emitted seven pairs; askOrCancel overloads are declarations, not duplicate behavior. Joint unchecked metadata projection is not duplicated entropy cleanup.",
     "decision": "Do not lower the mandatory gate or merge secret lifetimes simply to remove these matches."},
    {"title": "Owner decisions remain in force",
     "observed": "G1-001 is deferred; S123 rereads after questions to shorten secret lifetime; S120 retains its export-specific refusal wording.",
     "decision": "None was reopened as an architectural defect. Recovery normalization failures are independent of the deferred large transport refactor."},
    {"title": "Release verification hardening remains optional",
     "observed": "sign-release still verifies same-repository attestations without a signer-workflow/source-ref constraint, as already noted in AUD-009/AUD-010.",
     "decision": "Preserve the historical recommendation; no signing, publication or live release verification was performed."},
    {"title": "Remaining unexecuted interface hypotheses",
     "observed": "Compact artwork buffer aliasing, wide glass share labels, and prelaunch Ctrl+C classification were source hypotheses only.",
     "decision": "No new confirmed findings without a supported ownership/visibility contract and bounded production reproduction; do not imply their absence was proved."},
    {"title": "Python maintenance scripts need a separate copy review",
     "observed": "The normal copy gate deliberately excludes Python. Morphology steps in trace-material-outlines.py have similar loops with different boundary/operator semantics.",
     "decision": "Optional shared stencil helper only if it preserves both crop-border policies; no outline generation or image regeneration was run."},
]

commands = []
for path in sorted(E.glob("resumed-*.command.json")):
    record = read(path.name)
    label = path.name.removesuffix(".command.json")
    commands.append({"name": label, "command": record["command"], "outcome": "passed" if record["exitCode"] == 0 else "failed",
        "exitCode": record["exitCode"], "startedAt": record["startedAt"], "endedAt": record["endedAt"],
        "sourceBefore": record["sourceBefore"], "sourceAfter": record["sourceAfter"],
        "changedFiles": record["changedFiles"], "minimumAvailableGiB": round(record["minimumAvailableBytes"] / 1024**3, 3),
        "evidence": {"localOnly": True, "log": f"AUD-014-evidence/{label}.log", "sha256": record["logSha256"]},
        "interpretation": "Diagnostic failure records a finding/candidate, not a failure of the ordinary suite" if record["exitCode"] else "Completed on the resumed implementation snapshot"})

plan = read("resumed-coverage-plan.json")
fail_ids = {"CHECK-SEC-004", "CHECK-SEC-005", "CHECK-FUN-006", "CHECK-API-001", "CHECK-API-002", "CHECK-API-003", "CHECK-API-004", "CHECK-ARC-002"}
gaps = {
    "CHECK-BLD-002": "Portable module/strict consumer tests passed on Linux; actual Windows/macOS and browser matrix not executed",
    "CHECK-BLD-003": "Exact installed pins, hashes and notices inspected; no fresh advisory scan, full transitive license audit or archive availability check",
    "CHECK-BLD-004": "All seven manifest hashes agree and canonical build definition inspected; no fresh Docker/WASM reproducibility build",
    "CHECK-BLD-005": "Current workflows/source read; no SEA rebuild, tag, CI dispatch, provenance verification or release operation",
    "CHECK-UI-001": "Real CLI PTY subset passed; browser visual acceptance and exhaustive viewports not executed",
}
for task in plan:
    task["snapshot"] = baseline["fingerprint"]
    task["evidence"] = "Coordinator command ledger plus four scoped source reviews; method limits apply"
    task["method"] = "Source review and applicable bounded Node/PTY tests; not exhaustive acceptance"
    task["outcome"] = "failed" if task["checkId"] in fail_ids else "passed"
    if task["checkId"] in {"CHECK-FUN-003", "CHECK-FUN-005"}:
        task["outcome"] = "not-applicable"
        task["method"] = "No BIP85/BIP38/message signing/Silent Payments, transaction or PSBT feature exists in MnemoCode"
    if task["checkId"] in gaps:
        task["outcome"] = "skipped"
        task["method"] = gaps[task["checkId"]]
    if task["checkId"] == "CHECK-FUN-004":
        task["method"] = "Coin address-script classification only; descriptor, Miniscript, multisig and policy compilers are not applicable"
    if task["checkId"] == "CHECK-FUN-007":
        task["method"] = "Local bounded address comparison source/self-test; live providers, accounting and Discovery application are not applicable"
    if task["checkId"] == "CHECK-ARC-003":
        task["outcome"] = "failed"
        task["method"] = "Existing tests pass, but reproductions expose missing runtime/refusal coverage and a JSON raw-form regression exclusion"

artifact_files = [{"path": str(p.relative_to(ROOT)), "sha256": digest(p)}
                  for p in sorted((ROOT / "dist").rglob("*")) if p.is_file()]
(E / "final-artifacts.json").write_text(json.dumps(artifact_files, indent=2) + "\n")
completed = datetime.datetime.now(datetime.timezone.utc).isoformat()
date = completed[:10]
counts = {severity: sum(f["severity"] == severity for f in findings) for severity in ["critical", "high", "medium", "low"]}
limitations = [
    "Full-scope audit with incomplete execution; not release acceptance or independent cryptographic certification.",
    "No full test suite, full vector replay, complete card generation, pixel-golden replay, Docker reproducibility or SEA rebuild was run.",
    "One selected protection test unexpectedly invokes the full CLI self-test with a small PDF sample; it finished within the 12.85-second eight-file run. This was disclosed and PDF-producing tests were excluded afterwards.",
    "No Windows/macOS executable or browser application was executed; the host-neutral module source/contracts were examined on Linux.",
    "Upstream cryptographic primitives and every transitive dependency were not exhaustively audited; no fresh vulnerability-advisory scan was requested/run.",
    "Controlled publication probes stub only rendering and one cleanup failure; they establish publication policy, not actual PDF visual output.",
    "No direct secret theft, unauthorized spending or wrong address for a well-formed input was demonstrated. Several findings require malformed host data or deliberate async edits.",
    "Dist was freshly compiled before probes and hashed at completion, not individually hashed before every historical probe. Existing release executables and prior goldens were not attributed to this snapshot.",
    "Initial AUD-014 logs from the interrupted earlier snapshot are retained but not counted as passing evidence for this implementation.",
    "The published report anonymizes home paths; raw ignored local evidence remains unchanged. Model and reasoning-effort metadata are unknown.",
]
record = private({"schemaVersion": 1, "auditId": "AUD-014", "auditNumber": 14, "date": date,
    "title": "Latest MnemoCode refactor: correctness, residual duplication and module ownership",
    "reviewer": {"name": "Codex coordinator with four subsystem reviewers and one skeptical reviewer", "model": None, "reasoningEffort": None},
    "snapshot": {"commit": baseline["commit"], "commitComplete": True, "workingTree": "Pre-existing dirty checkout; 416 non-audit files hash-bound; no implementation changes by this audit",
                 "sourceFingerprint": baseline["fingerprint"], "capturedAt": baseline["capturedAt"], "completedAt": completed,
                 "finalFingerprint": final["fingerprint"], "sourceDrift": []},
    "scope": "MnemoCode only: core, recovery, coins, SSKR, CLI, exports, architecture, tests, documentation, build and release definitions; execution bounded by owner constraints",
    "checks": commands, "coverageLedger": plan, "findings": findings, "observations": [],
    "recommendations": recommendations, "adjudication": adjudication,
    "remediation": [{"id": "AUD-013-BLD001", "status": "verified", "fixCommit": None,
                     "verificationCommit": None, "verificationSnapshot": baseline["fingerprint"],
                     "evidence": "resumed-light-tests: the complete current date-search-core test file passed; no historical report changed"}],
    "limitations": limitations, "summary": {"counts": counts, "newFindings": sum(f["id"].startswith("AUD-014-") for f in findings),
        "priorFindingExtensions": ["AUD-001-API001", "AUD-012-SEC004"], "existingTests": {"passed": 217, "files": 11},
        "ptyCases": 4, "residualDuplicationGroups": 15, "mandatoryCopyGate": "0 exact copies >=50 tokens across 241 files",
        "diagnosticCopyGate": "7 pairs >=35 tokens; declarations/incidental wiring are not counted as seven defects"},
    "procedureHashes": read("resumed-procedure-hashes.json"), "environment": read("resumed-environment.json"),
    "reviewEvidenceHashes": {path.name: digest(path) for path in sorted(E.glob("resumed-review-*.json"))} |
        {path.name: digest(path) for path in sorted(E.glob("resumed-skeptic*.json"))},
    "artifactRelationship": {"dist": "Fresh coordinator pnpm build; final-artifacts.json is local only",
        "wasm": "Existing canonical-container output, all seven source/output manifest entries agree; not freshly reproduced",
        "wasmSha256": "3b8fb85d16d6e9911b7a7a69a8f713f3aa1ee9385449f42f0216eed78c5a3e1d"},
    "reviewPhases": [{"role": role, "model": None, "reasoningEffort": None} for role in
                    ["coordinator", "core", "SSKR", "exports", "CLI architecture", "skeptic"]]})
target = HERE / f"AUD-014-{date}"
target.with_suffix(".json").write_text(json.dumps(record, indent=2) + "\n")
md = ["# AUD-014 — Latest MnemoCode refactor audit", "", "## Record metadata", "",
    f"- **Completed (UTC):** {date}; {completed}.",
    "- **Reviewer:** Codex coordinator, four subsystem reviewers, one skeptical reviewer. Exact model and reasoning effort unknown for every phase.",
    f"- **Reviewed commit:** `{baseline['commit']}`; dirty authoritative checkout.",
    f"- **Source fingerprint:** `{baseline['fingerprint']}`; 416 non-audit files, unchanged throughout recorded checks.",
    "- **Scope:** Full-scope audit with incomplete execution. No remediation, commit, push, history rewrite or release.",
    "- **Artifacts:** Fresh TypeScript build; existing SSKR 0.1.6 output hash-bound locally, not freshly reproduced; existing executables/goldens not verified.", "",
    "## Finding register", "",
    f"Confirmed: {counts['medium']} medium, {counts['low']} low; none critical or high. Two rows extend original finding IDs. Architectural recommendations are separate from runtime findings.", "",
    "| Finding ID | Category | Kind | Severity | Status | Title |",
    "| --- | --- | --- | --- | --- | --- |"]
for f in findings:
    md.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | open | {f['title']} |")
md += ["", "## Review evidence", "", "### Scope and methodology", "",
    "The current files, including uncommitted refactoring, are authoritative. The October 9 interrupted attempt only reserved the audit and ran source checks; its old evidence is not counted here. The resumed baseline was captured before these checks. Source reviews searched for new semantic duplication and malformed/negative/async paths beyond the prior scan. The coordinator challenged candidates with public production-entry probes; the skeptical reviewer challenged contracts, severity and false positives. No unrelated checkout was edited.", "",
    "Node 26.10.0, pnpm 12.8.1, TypeScript 7.0.2 and Vitest 5.0.3 were used on Linux x86-64. Every captured process ran sequentially with a 768 MiB Node heap cap, 120-second timeout and 3 GiB host-memory reserve; at least 4 GiB was required to start. Recorded checks kept more than 4 GiB available. This is a host-memory observation, not process RSS measurement.", "",
    "The ordinary copy gate passed at 50 tokens over 241 files. A separate 35-token diagnostic reported seven candidates. A declaration overload was rejected as copied behavior; different secret lifetimes and mere metadata projection were not merged. Fifteen residual repeated operations were source-bound, including cases the lexical gate cannot detect. These are small local extractions, not grounds to rebuild the library as a monolith.", "",
    "The 208-test batch unexpectedly included one protection case invoking the full CLI self-test with small PDF samples; it finished in 12.85 seconds and was disclosed. No complete card generation or golden replay ran. Subsequent probes did not generate PDFs; the publication probes use opaque public bytes and rendering stubs.", "",
    "The report is not a release approval. In particular, supported recovery compatibility, unsafe fallback, verification-result and no-overwrite findings should be corrected before publishing those operations. The owner-reported 1,779-test/full-golden results are prior claims, not new executions by this audit.", "",
    "### Procedure identity", "", "| Procedure | SHA-256 |", "| --- | --- |"]
for name, sha in record["procedureHashes"].items():
    md.append(f"| `{name}` | `{sha}` |")
md += ["", "### Coverage ledger", "", "| Check ID | Area | Outcome | Method / remaining gap |", "| --- | --- | --- | --- |"]
for task in plan:
    md.append(f"| {task['checkId']} | {task['group']} | {task['outcome']} | {task['method']} |")
md += ["", "### Checks", "", "The following are captured command results, with UTC times and raw logs retained locally in ignored `AUD-014-evidence/`. Diagnostic failures are preserved; overlapping reruns are never added to suite totals.", "",
    "| Command record | Exit | Minimum available GiB | Exact command |", "| --- | --- | --- | --- |"]
for cmd in commands:
    md.append(f"| {cmd['name']} | {cmd['exitCode']} | {cmd['minimumAvailableGiB']} | `{ ' '.join(cmd['command']) }` |")
md += ["", "The ordinary test batches passed 208 tests in eight files and nine in three disjoint files (217 total). Four real PTY cases passed. Metadata checks confirmed seven SSKR pins, every declared package entry target, and relative file links in 12 current documents. Private vulnerability reporting was enabled in a read-only GitHub API inspection.", "",
    "The original export probe temporarily used a `.test.ts` filename. It was moved to an opt-in `.ts` probe/config and rerun with the same two failures, so normal tests cannot collect intentionally failing audit probes. No ordinary test or assertion was modified.", "",
    "The first report-schema validation failed because the remediation row used findingId instead of the schema's required id. This was an audit-envelope error, corrected only in this report generator. The original failure is retained locally as report-validation-initial.log and is not a production finding.", "", "### Findings", ""]
for f in record["findings"]:
    md += [f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}", "",
        f"- **Status:** open; release blocking: {str(f['releaseBlocking']).lower()}. {f['releaseBlockingReason']}.",
        f"- **Expected:** {f['expected']}", f"- **Observed / reproduction:** {f['observed']}",
        f"- **Impact and limits:** {f['impact']}", f"- **Recommended fix:** {f['recommendedFix']}",
        f"- **Required verification:** {f['requiredVerification']}",
        f"- **Evidence (local only):** `{f['evidence']['command']}.log`, SHA-256 `{f['evidence']['logSha256']}`; command in the ledger and rerun steps in [the harness README](AUD-014-harnesses/README.md)."]
    for place in f["evidence"]["sourceLocations"]:
        md.append(f"- **Source:** [{place['path']}:{place['line']}](../../{place['path']}#L{place['line']}), SHA-256 `{place['sha256']}`.")
    md.append("")
md += ["### Remediation and follow-up", "", "| Finding ID | Current status | Fix commit | Verification snapshot | Evidence |", "| --- | --- | --- | --- | --- |",
    f"| AUD-013-BLD001 | verified on this dirty tree | Not recorded | `{baseline['fingerprint']}` | Current complete date-search-core file passed in the 208-test batch |",
    "| AUD-001-API001 | open scope extension | Not fixed here | Current dirty snapshot | Share.write typo still returns undefined |",
    "| AUD-012-SEC004 | open scope extension | Not fixed here | Current dirty snapshot | Unpublished marked plan survives host report/HMAC failure without explicit wipe |", "",
    "Historical records and their findings were not rewritten. Prior architectural references below describe remaining source ownership, not a claim that every historical finding has been fully replayed or closed.", "",
    "### Residual duplication and shared-module recommendations", "", "| Area | Repeated behavior | Minimal consolidation |", "| --- | --- | --- |"]
for item in record["recommendations"]:
    if item["group"] == "Residual duplicated behavior":
        md.append(f"| {item['scope']} | {item['title']} | {item['recommendation']} |")
md += ["", "Exact file ranges, SHA-256 bindings and source reasoning for each row are in the JSON companion. The existing domain modules should own the shared operations: BIP39 sizes/indexes, numeric counts, Bech32 size math, question-state projection, thrown-value reporting, catalog dispatch, random-choice bounds, drawing operand projection and GF(2)/XOR/date-work primitives. Preserve protocol-specific wrappers and error wording.", "",
    "### Optional optimizations", "",
    "Highest-value candidates are to prepare immutable wallet comparisons once per search, cache immutable DatesAnswer counts, retain only the date detail needed for a unique code result, avoid resolving the same input paths per output, and give one owner to the image-folder preflight. These have not been benchmarked. Cache no seed or derived private key; keep secret cleanup local. Streaming candidate/document APIs and renderer/font/material caches require explicit ownership and exact-output checks before adoption.", ""]
for item in record["recommendations"]:
    if item["group"] == "Optional improvement":
        md.append(f"- {item['title']}")
md += ["", "### Rejected alarms, contract questions and retained owner decisions", ""]
for item in adjudication:
    md += [f"**{item['title']}.** {item['observed']} {item['decision']}", ""]
md += ["### Assessment and limitations", ""]
md += [f"- {item}" for item in limitations]
target.with_suffix(".md").write_text(private("\n".join(md)) + "\n")
index = HERE / "README.md"
text = index.read_text()
row = f"| AUD-014 | {date} | Latest refactor audit: correctness, residual semantic duplication, module ownership | Full scope with incomplete execution; {counts['medium']} medium and {counts['low']} low current findings, including two prior-ID extensions; 217 existing tests and four PTY cases passed. No remediation or release approval. | [Report](AUD-014-{date}.md), [JSON](AUD-014-{date}.json), [harness scripts](AUD-014-harnesses/) |"
if re.search(r"^\| AUD-014 \|", text, re.M):
    text = re.sub(r"^\| AUD-014 \|.*$", row, text, flags=re.M)
else:
    lines = text.splitlines()
    at = max(i for i, line in enumerate(lines) if line.startswith("| AUD-")) + 1
    lines.insert(at, row)
    text = "\n".join(lines) + "\n"
index.write_text(text)
print(json.dumps({"report": str(target.with_suffix('.md').relative_to(ROOT)), "counts": counts,
                  "findings": len(findings), "residualDuplicationGroups": 15}))
