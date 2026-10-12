"""Publish AUD-015 from retained evidence; never rewrite AUD-014 or its remediation record."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import shlex

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-015-evidence"
DATE = "2026-10-12"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def private(value):
    """Published home paths are anonymous; original ignored evidence is not modified."""
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s\"']+", "/home/user", value)
    if isinstance(value, list):
        return [private(item) for item in value]
    if isinstance(value, dict):
        return {key: private(item) for key, item in value.items()}
    return value


baseline = json.loads((AUDITS / "AUD-014-2026-10-12.json").read_text())
start = read("review-remediation-start-snapshot.json")
end = read("aud015-completed-snapshot.json")
assert start["fingerprint"] == end["fingerprint"] == baseline["remediationAddendum"]["fixSourceFingerprint"]
source = {item["path"]: item["sha256"] for item in end["files"]}
commands = []
for path in sorted(EVIDENCE.glob("*.command.json")):
    row = json.loads(path.read_text())
    label = path.name.removesuffix(".command.json")
    assert row["sourceBefore"] == row["sourceAfter"] == end["fingerprint"]
    assert not row["changedFiles"]
    assert digest(EVIDENCE / f"{label}.log") == row["logSha256"]
    commands.append({"label": label, **row,
                     "evidence": {"localOnly": True, "log": f"AUD-015-evidence/{label}.log",
                                  "sha256": row["logSha256"]}})


def evidence(label):
    row = next(item for item in commands if item["label"] == label)
    return row["evidence"]


def finding(identifier, title, category, severity, files, label, reproduction, expected,
            observed, impact, fix, verification, related=None):
    return {"id": identifier, "category": category, "kind": "finding", "title": title,
            "severity": severity, "status": "open", "releaseBlocking": severity == "medium",
            "releaseBlockingReason": "Resolve supported asynchronous result ownership before release."
            if severity == "medium" else "Limited robustness/cleanup issue; no direct secret compromise demonstrated.",
            "affectedFiles": [{"path": name, "line": line, "sha256": source[name]}
                              for name, line in files],
            "evidence": evidence(label), "reproduction": reproduction, "expected": expected,
            "observed": observed, "impact": impact, "recommendedFix": fix,
            "requiredVerification": verification, "relatedFindings": related or []}


findings = [
    finding("AUD-015-API001", "The stronger no-late-publication claim misses the consuming continuation", "API", "low",
            [("src/core/date-search.ts", 534), ("src/core/wallet-check.ts", 53)],
            "review-remediation-core-edges",
            "One fixed date and the public zero-entropy phrase. The wallet callback schedules abort with two nested queueMicrotask calls and returns matched:true.",
            "Under the strengthened askWallet/addendum promise, reject with the signal reason and publish no late match.",
            "The run resolved with an aborted signal; onMatch ran once and observed that signal already aborted.",
            "A host can receive a late recovery after stopping. SearchRun retains its weaker next-turn contract, so this is a limited inconsistency in the strengthened remediation claim rather than a demonstrated breach of the original contract. The native checker was not shown to produce a wrong wallet or leak a secret.",
            "Check the signal in the caller immediately before result publication and final return, including after helper awaits. Keep the shared wallet-answer validator.",
            "Zero onMatch calls, rejection with the same abort reason, and normal matched true/false controls for every search path.") ,
    finding("AUD-015-API002", "A split returns shares and original text from different input revisions", "API", "medium",
            [("src/sskr/split.ts", 103)], "review-remediation-sskr-edges-corrected",
            "Gate createShares, start splitBackup for public phrase A in direct mode, change request.mnemonic to the valid public phrase B, then release the gate.",
            "Return the original normalized phrase captured for this split, or reject a stale request.",
            "held is phrase A and original is phrase B in the same successful BackupSplit. The real SSKR platform and split verification were used.",
            "A browser/library host that edits its request during asynchronous WASM readiness can pair an unrelated displayed original with the actual backup. Immutable native CLI input is not affected by the demonstrated schedule.",
            "Capture the normalized original and all operation inputs before awaiting, and build the result exclusively from that snapshot.",
            "A gated ordinary-object edit must never mix revisions; keep both direct and Seedshift behavior and entropy cleanup.", ["AUD-014-API004"]),
    finding("AUD-015-API003", "Saved QR sidecars bypass the staging-copy warning handler", "API", "low",
            [("src/cli/qr-export.ts", 16), ("src/cli/qr-export.ts", 23),
             ("src/cli/encode-command.ts", 174), ("src/cli/sskr-output.ts", 218)],
            "review-remediation-staging-probes",
            "Fail only removal of .mnemocode-export-* after QR publication. Rendering/QR encoding return public opaque bytes; publication is real. Exercise both QR helpers and the real runEncode card-qr route.",
            "The saved sidecar counts as saved, a warning identifies the remaining private staging copy, and the command completes without retrying the published result.",
            "Both document and sidecar were present and complete, but runEncode rejected with LeftStagingCopy. Both QR helpers also rejected, with zero cleanup warnings through terminalNotice. Two common-save controls passed; all three sidecar cases failed.",
            "The command reports an error after successful publication; a share-sidecar loop can stop before later files. The exception still names the private copy, so this is not a hidden-copy or file-content-loss claim.",
            "Route sidecar publication through writeSaved while retaining the selected path and the warning. Do not suppress ordinary save failures.",
            "Both sidecar helpers, Encode, and SSKR sidecar loops complete with exactly one warning per leftover; EEXIST and genuine failed writes still fail.") ,
    finding("AUD-015-UI001", "Unknown prototype-named options print inherited object values", "UI", "low",
            [("src/cli/option-copy.ts", 72), ("src/cli/arguments.ts", 182)],
            "review-remediation-labels",
            "Call optionLabel for __proto__, constructor and toString; run the actual built CLI table --word abandon --__proto__ with a public value.",
            "A string naming the typed unknown option, with the command refused.",
            "The helper returned an object or function. The real CLI refused correctly but printed '[object Object] setting'. Known and ordinary unknown labels were correct.",
            "Broken refusal text and a declared string-return contract. The parser fix is working; no prototype pollution or bypass of unknown-option refusal is demonstrated.",
            "Use Object.hasOwn for label lookup or a null-prototype map, then retain the existing fallback.",
            "Exact string labels and exact unknown/repeated/missing-value refusals for inherited names, with normal-label controls.", ["AUD-014-API010"]),
    finding("AUD-015-SEC001", "Transport readers abandon internal share-byte arrays without wiping", "SEC", "low",
            [("src/sskr/transport.ts", 163), ("src/sskr/transport.ts", 229),
             ("src/sskr/transport.ts", 382), ("src/sskr/transport.ts", 472)],
            "review-remediation-sskr-edges-corrected",
            "Retain references to Uint8Array.from allocations while reading one published deterministic share. Also repair CRC32 after setting a reserved metadata bit, then exercise the intended metadata refusal.",
            "Internal decoded arrays are wiped when their local job ends; a successfully returned caller-owned urToTransport array remains usable.",
            "Nonzero internal arrays remained after readShare (1), Share.read (2), bytewordsToUr (1), and an Invalid SSKR share metadata refusal (1). The caller-owned-result control passed.",
            "Best-effort cleanup is missing for transient typed arrays. No heap dump, secret theft, or guaranteed whole-memory-erasure claim; immutable share strings already have documented JavaScript limits.",
            "Add try/finally wiping for discarded transports and wipe allocations on rejection, without wiping a transport returned to its caller.",
            "Capture ended internal buffers on successful parsing and intended refusal, and preserve the caller-owned successful output."),
    finding("AUD-001-API001", "An exported share-format mirror still returns undefined for unknown forms", "API", "low",
            [("src/sskr/transport.ts", 313)], "review-remediation-sskr-edges-corrected",
            "Call shareFormatMirroring with typo, null and 5; compare all five supported encoded forms.",
            "Refuse an unsupported format before returning a ShareFormat.",
            "All three invalid inputs returned undefined; all five supported controls passed. Share.write's original reproduction is now fixed.",
            "Residual unchecked-format-discriminant scope under the original ID. A JavaScript host can get an unusable result rather than an actionable refusal; no alternate encoding or secret corruption demonstrated.",
            "Validate through the existing encoded-format owner before finding the mirrored share form.",
            "Wrong runtime types/discriminants refuse; all supported forms still map exactly.")
]

notes = [
    {"title": "Executable host getters are read again after validation", "relatedFindings": ["AUD-014-SEC001", "AUD-014-API001"],
     "evidence": evidence("review-remediation-core-edges"),
     "assessment": "Informational robustness scope: changing kind getters selected NoProtection and real MNCL bytes; changing matched getters counted one match after validating boolean false. These require executable host objects, cannot come from JSON or typed native CLI input, and are not a security claim against a dishonest host. Ordinary original reproductions remain fixed. Snapshot validated fields or explicitly document stable-input assumptions."},
    {"title": "Checked checksum resamples a getter-backed input", "evidence": evidence("review-remediation-core-edges"),
     "assessment": "An index getter returning 0 during validation and 1 later was read twice and produced false. This proves resampling, not invalid-index acceptance or incorrect checksum math. Copy once and validate/compute the same owned list, or state a stable-input precondition."},
    {"title": "The historical cleanup probe has a narrower oracle than the adjudicated contract",
     "evidence": evidence("review-remediation-old-export"),
     "assessment": "Its overwrite-after-preflight case passed. Its old expect(failure).toBeUndefined still fails on LeftStagingCopy, while the two stronger new controls verify complete publication plus a warning and a real retained copy. Preserve that historical failure; do not make it green by hiding the copy."},
    {"title": "aud-014-staging.test.ts is meaningful but covers only the common save path",
     "assessment": "All three tests passed. They assert a typed cleanup outcome, saved bytes, a warning, ordinary silent success, and EEXIST refusal. Two audit controls additionally assert the retained document, exact staging path, warning kind, returned path and one write. They do not cover QR sidecars or prove every save goes through writeSaved."},
    {"title": "Descriptor chunks and MACs have cleanup by source",
     "assessment": "readBoundedDescriptor registers each chunk before readSync and wipes in finally; digestFits wipes the owned MAC in finally. Existing new UTF-8 tests observe returned buffers, not all descriptor chunks. Partial-read-then-throw allocation-capture tests would improve coverage without large input."}
]
recommendations = [
    {"title": "Reuse the existing positive-safe-integer rule",
     "files": ["src/core/pieces.ts:9", "src/export/card-codes.ts:48", "src/core/typed-number.ts:25"],
     "change": "Delegate width/capacity predicates to inWholeRange with a positive safe range; retain contextual refusal messages."},
    {"title": "Delegate the split's common quorum checks",
     "files": ["src/sskr/split.ts:61", "src/sskr/share-layout.ts:101"],
     "change": "Use isRecordedQuorum plus the split-specific minimum of two. Threshold-one imported shares remain a distinct supported recovery policy."},
    {"title": "Define seconds per hour once",
     "files": ["src/core/search-turns.ts:19", "src/core/search-plan.ts:24"],
     "change": "Share the unit definition while keeping display-time and ask-before-search policies distinct."},
    {"title": "Optional encapsulation hardening for PivotBasis",
     "files": ["src/sskr/gf2.ts:51"],
     "change": "add returns its stored object. Its type is readonly and current callers do not mutate it. Freezing or returning a copy is optional runtime hardening, not a reproduced solver defect."}
]
hypotheses = [
    "repairCandidates may ignore skipped too-open readings when another reading resolves. No fixture proving missed valid alternatives or wrong uniqueness was constructed.",
    "renderCards spreads raw profile over settled details, while individual rendering uses settled details. Explicit undefined or whitespace could produce inconsistent identity inputs. No physical output discrepancy was tested.",
    "Material/font caches, streaming full document sets and wallet-target caching require bounded profiling before a speed claim. Earlier optional deferrals remain in force."
]

failed_checks = {"CHECK-SEC-005", "CHECK-API-001", "CHECK-API-002", "CHECK-API-003"}
not_run = {"CHECK-SEC-003", "CHECK-SEC-006", "CHECK-FUN-002", "CHECK-FUN-004", "CHECK-FUN-007",
           "CHECK-BLD-004", "CHECK-BLD-005", "CHECK-UI-001", "CHECK-UI-003", "CHECK-DOC-001"}
not_applicable = {"CHECK-FUN-003", "CHECK-FUN-005"}
ledger = []
for row in baseline["coverageLedger"]:
    identifier = row["checkId"]
    outcome = ("failed" if identifier in failed_checks else "not-run" if identifier in not_run
               else "not-applicable" if identifier in not_applicable else "passed")
    ledger.append({"checkId": identifier, "category": row["category"], "group": row["group"],
                   "outcome": outcome, "snapshot": end["fingerprint"],
                   "method": "Bounded remediation source review and applicable recorded checks; no full acceptance.",
                   "reason": "Protocol/transaction features are not implemented here." if identifier in not_applicable
                   else "Outside this targeted follow-up; no current runtime/full acceptance evidence claimed."
                   if identifier in not_run else "Scoped evidence in command ledger and findings; pass does not mean exhaustive coverage."})

limitations = [
    "Targeted remediation follow-up with new bounded edge probes, not another fully executed end-to-end audit or release acceptance.",
    "No PDF construction, full card generation, pixel comparison, full suites/vector replay, scrypt, canonical Docker/WASM rebuild, browser host or Windows/macOS executable run.",
    "Six PDF-parsing cases in aud-014-export.test.ts were deliberately skipped by name filtering. All 105 selected ordinary tests passed in ten distinct files; do not add diagnostic probe totals to that count.",
    "Protection, QR and export probes substitute only named expensive/failure seams and establish ownership/publication behavior, not actual image or PDF bytes.",
    "The first new SSKR edge run built the negative fixture with a duplicate UR prefix and rejected too early. Its corrected rerun reached Invalid SSKR share metadata; original failed evidence is preserved.",
    "The initial sandbox pnpm check failed with spawnSync git EPERM; the identical bounded host rerun passed. This environment block is not a code defect.",
    "No commit exists for these fixes; historical AUD-014 status remains fixed, not blanket verified. Exact dirty source bytes identify this review.",
    "Source unchanged throughout checks. No production/test/dependency/workflow/generated-WASM edits, commits, pushes, signing or release operations by this review.",
    "Model and reasoning effort are not exposed. Public fixtures only; raw ignored local evidence is retained without anonymization, while published reports anonymize home paths."
]
remediation = [{"id": item["id"], "status": "fixed", "fixCommit": None,
                "verificationCommit": None, "fixSourceFingerprint": end["fingerprint"],
                "evidence": "Original AUD-014 reproduction passes on this exact dirty tree; scoped new tests passed. Acceptance gaps remain."
                + (" Its separate mirror-helper scope remains open under the original ID." if item["id"] == "AUD-001-API001" else "")}
               for item in baseline["findings"]]
for row in remediation:
    if row["id"] == "AUD-001-API001":
        row["status"] = "open"
        row["scopeStatus"] = {"Share.write original reproduction": "fixed", "shareFormatMirroring extension": "open"}
procedures = {name: digest(ROOT.parent / "multi-chain-wallet-tools" / name)
              for name in ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
                           "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]}
artifacts = [{"path": str(path.relative_to(ROOT)), "sha256": digest(path)}
             for path in sorted((ROOT / "dist").rglob("*")) if path.is_file()]
(EVIDENCE / "artifacts.json").write_text(json.dumps(artifacts, indent=2) + "\n")
record = private({"schemaVersion": 1, "auditId": "AUD-015", "auditNumber": 15,
                  "date": DATE, "title": "AUD-014 remediation verification and residual edge review",
                  "reviewer": {"name": "Codex coordinator and three scoped source reviewers", "model": None, "reasoningEffort": None},
                  "snapshot": {"commit": end["commit"], "workingTree": start["workingTree"],
                               "sourceFingerprint": end["fingerprint"], "sourceFiles": len(end["files"]),
                               "capturedAt": start["capturedAt"], "completedAt": end["capturedAt"]},
                  "scope": "Verify AUD-014 remediation claims and staging tests; inspect related new bugs and residual semantic duplication. Targeted checks only.",
                  "procedureHashes": procedures, "checks": commands, "coverageLedger": ledger,
                  "environment": read("aud015-environment.log"),
                  "harnessHashes": {str(path.relative_to(ROOT)): digest(path)
                                    for path in sorted((AUDITS / "AUD-015-harnesses").iterdir())
                                    if path.is_file()},
                  "findings": findings, "observations": [], "informationalReview": notes,
                  "recommendations": recommendations, "unexecutedHypotheses": hypotheses,
                  "remediation": remediation, "limitations": limitations,
                  "artifactRelationship": {"freshBuild": "review-remediation-build", "manifest": "AUD-015-evidence/artifacts.json", "localOnly": True,
                                           "manifestSha256": digest(EVIDENCE / "artifacts.json")},
                  "baselineReportHashes": {name: digest(AUDITS / name) for name in ["AUD-014-2026-10-12.md", "AUD-014-2026-10-12.json"]},
                  "summary": {"medium": 1, "low": 5, "originalReproductionsPassing": 19,
                              "ordinaryTestsPassed": 105, "ordinaryTestFiles": 10, "pdfCasesSkipped": 6,
                              "ptyCasesPassed": 4, "remainingDuplicationGroups": 3},
                  "evidenceStorage": "AUD-014's frozen recorder produced initial review-remediation records. AUD-015/run.py retained exact unchanged bytes in AUD-015-evidence. Originals remain local; replay uses fresh labels.",
                  "recordValidation": "AUD-014 schema passed; all 20 referenced remediation log hashes matched. Historical report bytes preserved."})
target = AUDITS / f"AUD-015-{DATE}"
target.with_suffix(".json").write_text(json.dumps(record, indent=2) + "\n")

lines = ["# AUD-015 — AUD-014 remediation verification and residual edge review", "",
         "## Record metadata", "", "- **Audit number:** 15.", f"- **Completed (UTC):** {DATE}.",
         "- **Reviewer:** Codex coordinator and three scoped source reviewers (core/secret inputs, SSKR, CLI/export architecture). The coordinator reproduced and challenged candidate findings.",
         "- **Model and reasoning effort:** Unknown for every reviewer; null in JSON.",
         f"- **Reviewed commit:** `{end['commit']}` plus pre-existing uncommitted changes.",
         f"- **Source fingerprint:** `{end['fingerprint']}`; {len(end['files'])} non-audit files, unchanged during checks; matches the remediation claim.",
         "- **Environment:** Linux x64; Node.js v26.10.0; pnpm pin 12.8.1; installed TypeScript 7.0.2, Vitest 5.0.3 and Prettier 3.9.9. The recorded environment log identifies the actual Node executable (home path anonymized in JSON). Rust/Docker/browser versions were not inspected or used in this follow-up.",
         "- **Artifacts:** Fresh TypeScript build; local dist manifest hash `" + record['artifactRelationship']['manifestSha256'] + "`. No executable or canonical WASM rebuild.",
         "", "## Finding register", "", "One medium and five low records; five new IDs and one extension of an original ID. No critical/high finding or direct secret compromise demonstrated.",
         "", "| Finding ID | Category | Severity | Status | Release blocking | Title |", "| --- | --- | --- | --- | --- | --- |"]
for item in findings:
    lines.append(f"| {item['id']} | {item['category']} | {item['severity']} | open | {str(item['releaseBlocking']).lower()} | {item['title']} |")
lines += ["", "## Review evidence", "", "### Scope and methodology", "",
          "This is a targeted follow-up, not release verification. All 19 original AUD-014 reproduction cases now pass, and 105 selected ordinary tests in ten files plus four PTY cases pass. The new edge probes identify remaining issues. The original AUD-014 report and addendum were not rewritten.",
          "", "### Procedure identity", "", "| Procedure file | SHA-256 |", "| --- | --- |"]
for name, sha in procedures.items():
    lines.append(f"| {name} | `{sha}` |")
lines += ["", "### Coverage ledger", "", "Every passed row is restricted to this follow-up's source/tests; unexecuted acceptance remains explicit.",
          "", "| Check ID | Logical group | Outcome | Scope / gap |", "| --- | --- | --- | --- |"]
for row in ledger:
    lines.append(f"| {row['checkId']} | {row['group']} | {row['outcome']} | {row['reason']} |")
lines += ["", "### Checks", "", "Exact original commands, UTC timestamps, source fingerprints, memory samples, log hashes and exit codes are in JSON. Evidence files are local only. The minimum available memory across runs was "
          + f"{min(row['minimumAvailableBytes'] for row in commands) / 1024**3:.3f} GiB; the recorder enforced a 3 GiB reserve and a 768 MiB Node heap.",
          "", "| Local command record | Exact command | Exit | Interpretation | Log SHA-256 |", "| --- | --- | --- | --- | --- |"]
for row in commands:
    label = row['label']
    meaning = ("Sandbox spawnSync git EPERM; host rerun passed" if label == 'review-remediation-check'
               else "Known old cleanup oracle mismatch; collision refusal passed" if label == 'review-remediation-old-export'
               else "Initial negative-fixture prefix mistake retained; corrected rerun follows" if label == 'review-remediation-sskr-edges'
               else "New edge reproduction; getter/checksum cases are informational" if label == 'review-remediation-core-edges'
               else "Confirmed finding reproduction" if row['exitCode'] else "Passed bounded check")
    command = shlex.join(row['command']).replace('|', '\\|')
    if label == 'aud015-environment':
        command = "node --input-type=module -e '<read runtime and installed package versions>' (complete script in JSON)"
    lines.append(f"| {label} | `{command}` | {row['exitCode']} | {meaning} | `{row['logSha256']}` |")
lines += ["", "Ordinary tests: 85 in six AUD-014 files; 12 in the filtered export file (six PDF cases skipped); eight in three storage/cleanup files. These disjoint groups total 105. Diagnostic probes are not added to that total.",
          "", "### Findings", ""]
for item in findings:
    lines += [f"#### {item['id']} — {item['severity'].capitalize()} — {item['title']}", "",
              f"- **Category / status:** {item['category']} / open.",
              f"- **Release blocking:** {str(item['releaseBlocking']).lower()}; {item['releaseBlockingReason']}"]
    lines.append("- **Affected files:** " + "; ".join(f"{f['path']}:{f['line']} (SHA-256 `{f['sha256']}`)" for f in item['affectedFiles']) + ".")
    for key, label in [('reproduction', 'Reproduction'), ('expected', 'Expected'), ('observed', 'Observed'), ('impact', 'Impact and limits'), ('recommendedFix', 'Recommended fix'), ('requiredVerification', 'Required verification')]:
        lines.append(f"- **{label}:** {item[key]}")
    lines += [f"- **Evidence:** `{item['evidence']['log']}` (local only), SHA-256 `{item['evidence']['sha256']}`.", ""]
lines += ["### Remediation and follow-up", "", "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
for row in remediation:
    lines.append(f"| {row['id']} | {row['status']} | Not committed | Not committed | {row['evidence']} |")
lines += ["", "AUD-001-API001's original writer case is fixed; the mirror-helper extension remains open. No status in AUD-014 was changed. No finding is blanket verified or accepted for release here.",
          "", "### Informational observations and recommendations", ""]
for item in notes:
    lines += [f"**{item['title']}.** {item['assessment']}", ""]
lines += ["Three residual semantic-duplication groups remain. The mandatory lexical gate still reports zero copies of at least 50 tokens in 242 source/script files; that is not proof of zero repeated rules.",
          "", "| Scope | Shared-owner recommendation |", "| --- | --- |"]
for item in recommendations:
    lines.append("| " + "; ".join(item['files']) + " | " + item['change'] + " |")
lines += ["", "The GF(2) linearize/unitVectors, xorInto, format-option parser, template-family dispatch, checked random choice and question-turn mapper now have the claimed shared implementations. G1-001, S123 and S120 remain the owner's earlier decisions.",
          "", "### Unexecuted hypotheses and optional research", ""]
lines += ["- " + value for value in hypotheses]
lines += ["", "### Assessment and limitations", ""]
lines += ["- " + value for value in limitations]
lines += ["", "Only report/harness files were added, and the audit index was updated. Nothing was committed or pushed.", ""]
target.with_suffix(".md").write_text(private("\n".join(lines)))
index = AUDITS / "README.md"
text = index.read_text()
row = "| AUD-015 | 2026-10-12 | AUD-014 remediation follow-up and new bounded edge review | All 19 original reproductions pass; 105 ordinary tests and four PTY cases pass. One medium and five low residual records, three semantic-duplication groups; no PDF, full vectors or release acceptance. Source unchanged. | [Report](AUD-015-2026-10-12.md), [JSON](AUD-015-2026-10-12.json), [harness scripts](AUD-015-harnesses/) |"
if re.search(r"^\| AUD-015 \|", text, re.M):
    index.write_text(re.sub(r"^\| AUD-015 \|.*$", lambda match: row, text, flags=re.M))
else:
    line = next(line for line in text.splitlines() if line.startswith("| AUD-014 |"))
    index.write_text(text.replace(line, line + "\n" + row, 1))
print(json.dumps({"auditId": "AUD-015", "sourceFingerprint": end['fingerprint'],
                  "findings": len(findings), "medium": 1, "low": 5, "ordinaryTestsPassed": 105}))
