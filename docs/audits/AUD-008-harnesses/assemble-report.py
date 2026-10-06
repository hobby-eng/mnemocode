#!/usr/bin/env python3
"""Assemble AUD-008 from retained reviewer records, preserving their original evidence."""

import collections
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
REPORT = ROOT / "docs/audits/AUD-008-2026-10-06"


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def normalized(candidate, identifier):
    result = dict(candidate)
    result.update(id=identifier, kind="finding")
    result["expected"] = result.pop("expectedBehavior", result.get("expected", ""))
    result["observed"] = result.pop("observedBehavior", result.get("observed", ""))
    result["requiredVerification"] = result.pop("verification", result.get("requiredVerification", ""))
    result["status"] = "open"
    return result


def prose(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "; ".join(prose(item) for item in value)
    return json.dumps(value, ensure_ascii=False)


def cell(value):
    return prose(value).replace("|", "\\|").replace("\n", " ")


def main():
    snapshot = read("snapshot.json")
    reviews = {key: read(key + "-review.json") for key in
               ("security", "core", "sskr", "interface", "devops", "documentation-skeptic")}
    findings = []
    security = reviews["security"]["findingCandidates"][0]
    findings.append(normalized(security, "AUD-008-API001"))
    core = {item["candidateId"]: item for item in reviews["core"]["candidateFindings"]}
    core_ids = [
        ("core-invalid-key-evidence", "AUD-008-API002", "medium"),
        ("core-empty-word-place", "AUD-008-API003", "medium"),
        ("core-invalid-mode", "AUD-008-API004", "low"),
        ("core-passphrase-coercion", "AUD-008-API005", "low"),
    ]
    for name, identifier, severity in core_ids:
        item = normalized(core[name], identifier)
        item["severity"] = severity
        if severity != core[name]["severity"]:
            item["skepticDisposition"] = "Reduced to low: malformed runtime arguments are required; valid typed and CLI inputs pass."
        findings.append(item)
    for candidate, identifier in zip(reviews["sskr"]["candidates"],
                                     ("AUD-008-FUN001", "AUD-008-API006")):
        findings.append(normalized(candidate, identifier))
    findings.extend(reviews["interface"]["findings"])
    findings.append(normalized(reviews["devops"]["candidateFindings"][0], "AUD-008-BLD001"))
    findings.append(normalized(reviews["documentation-skeptic"]["candidateFindings"][0], "AUD-008-DOC001"))

    coverage = {}
    for name, key in [("security", "coverage"), ("core", "coverage"),
                      ("sskr", "checks"), ("interface", "checks"),
                      ("devops", "checks"), ("documentation-skeptic", "coverage")]:
        for item in reviews[name][key]:
            identifier = item.get("checkId", item.get("id"))
            if identifier in coverage:
                coverage[identifier].setdefault("supportingReview", []).append(item)
                continue
            entry = dict(item)
            entry["checkId"] = identifier
            entry["reviewerRole"] = name
            if entry["outcome"] == "passed-with-gaps":
                entry["outcome"] = "passed"
                entry["limitations"] = "Scoped source/test fidelity review; no whole-repository resolved import graph or exhaustive coverage claim. Runtime boundary regression gaps remain in API findings."
            coverage[identifier] = entry
    coverage["CHECK-UI-003"]["outcome"] = "failed"
    coverage["CHECK-UI-003"]["integrationNote"] = "Ordinary keyboard/QR/help probes pass; date-search Ctrl+C violates alternate-screen cleanup (API001)."
    plan = read("coverage-plan.json")
    assert set(coverage) == set(plan)
    coverage = [dict(coverage[key], logicalGroup=plan[key]["logicalGroup"])
                for key in plan]

    defect_labels = {"core-contracts-final", "core-contracts-unsandboxed",
                     "sskr-defects", "interface-contracts", "interface-narrow-terminal",
                     "devops-build-failure-corrected"}
    environment_labels = {"core-security-recovery-tests", "host-node-capture", "runner-capture",
                          "runner-capture-threads", "core-cli-evidence", "security-permissions",
                          "security-permissions-diagnostic", "security-cli-probe"}
    harness_labels = {"core-oracles", "core-contracts", "core-contracts-corrected", "devops-inventory",
                      "devops-build-failure", "skeptic-challenges"}
    checks = []
    for path in sorted(EVIDENCE.glob("*.command.json")):
        item = json.loads(path.read_text())
        label = path.name.removesuffix(".command.json")
        log = EVIDENCE / (label + ".log")
        assert log.is_file(), label
        assert hashlib.sha256(log.read_bytes()).hexdigest() == item["logSha256"], label
        item.update(label=label, localLog=f"docs/audits/AUD-008-evidence/{label}.log",
                    outcome="passed" if item["exitCode"] == 0 else "failed")
        if label in defect_labels:
            item["interpretation"] = "Retained expected baseline contract failure; this is finding evidence, not a passed regression."
        elif label in environment_labels and item["exitCode"] != 0:
            item["interpretation"] = "Tool sandbox/child-stream diagnostic failure; host control or scoped rerun retained separately."
        elif label in harness_labels and item["exitCode"] != 0:
            item["interpretation"] = "Initial audit-harness mistake, corrected in a separately retained run; not a product finding."
        checks.append(item)

    notes = [
        {"title": "Candidate and WASM memory hygiene", "detail": "Some caller-owned candidate buffers, temporary UTF-8 buffers and upstream/WASM copies are not overwritten on every path. Retained references demonstrate missing overwrites, not production GC retention or external memory access. Improve finally ownership without promising JavaScript string erasure.", "evidence": "security-cleanup-scoped.log; security-review.json; sskr-review.json"},
        {"title": "Intentional Node launch grants", "detail": "The normal launcher denies tested scopes; an already permission-enabled caller can intentionally grant network/workers. No transmission was performed. Treat stronger grant dropping as defense in depth, with DOC001 wording clarification."},
        {"title": "Recovery feedback", "detail": "Consider an immediate warning after date-masked decode that a valid checksum/fingerprint alone does not confirm the intended wallet. Existing README/heirs explain this correctly. The SSKR documentation's isolated hidden-prompt example should also say private visible input."},
        {"title": "Package archive documentation", "detail": "The private package files allowlist omits CANDIDATES.md and HEIRS.md. Repository distribution retains them; add them if package archives become a supported distribution."},
        {"title": "Short repair cancellation and build cleanup", "detail": "An already-aborted signal is checked only at a repair yield boundary; short searches may finish first. The SSKR verification script's direct process.exit bypasses finally on mismatch. These remain source-reviewed cleanup opportunities, not separately reproduced compromise claims."},
        {"title": "Tool sandbox", "detail": "Ordinary Node child capture also failed inside the tool sandbox, independent of MnemoCode hardening. The 14 initial selected-test failures and diagnostic/harness failures remain recorded; no application permission or assertion was relaxed."},
        {"title": "Harness formatting", "detail": "Pinned Prettier formatted some audit-only scripts after execution. Original review records preserve execution-time harness hashes; the final report hashes the formatted published scripts separately. No original command output or assertion was replaced."},
    ]
    limitations = [
        "Five delegated reviewers and the coordinator performed six roles. The sixth independent subagent was unavailable because the agent tool rejected both creation and historical-thread continuation with its thread limit. The coordinator performed documentation and skeptical review; this is less independent than requested.",
        "This is an AI-assisted source/integration audit, not an independent cryptography certification or proof that all defects are absent.",
        "Only selected 22 test files (440 distinct tests), scoped host reruns and bounded public-vector harnesses ran. No full-suite or pnpm verify claim is made.",
        "No Docker/canonical SSKR or executable rebuild, frozen dependency reinstall, npm pack, registry/RustSec advisory scan, new esbuild release graph or remote/paid GitHub Actions dispatch was run. BLD002 and BLD004 remain not-run for platform/canonical acceptance.",
        "Current Windows/macOS/other architectures, actual physical printing/cameras/color calibration, screen readers and exhaustive designs were not tested. One A6 PDF/PNG and five record/QR forms were checked; JPEG QR was not decoded independently.",
        "The existing Linux executable's checksum and interface were inspected; its exact source binding and provenance were not independently re-established.",
        "Large candidate/SSKR/date spaces, full upstream cryptography/dependency audits, invalid-child BIP32 exhaustion, panic/OOM/memory-forensic and power-loss campaigns were not performed.",
        "Local file links were checked in twelve documents. Remote URL reachability, every Markdown anchor and release-download availability were not verified.",
        "No production/test/vector/dependency/workflow/WASM edit, commit, push, tag or release. Reports/harnesses are new audit-only files and evidence stays ignored.",
    ]
    counts = dict(collections.Counter(item["severity"] for item in findings))
    report = {
        "schemaVersion": 1, "auditId": "AUD-008", "auditNumber": 8, "date": "2026-10-06",
        "title": "MnemoCode full-scope ordinary audit with six reviewer roles",
        "reviewer": {"name": "Codex coordinator and five delegated reviewers", "model": None, "reasoningEffort": None},
        "reviewerPhases": [{"role": name, "model": None, "reasoningEffort": None,
                            "delegated": name != "documentation-skeptic"}
                           for name in reviews],
        "snapshot": {**snapshot, "commitComplete": True, "trackedProductFiles": len(snapshot["files"]),
                     "productManifestExcludes": "docs/audits/ only", "sourceUnchangedAfterReview": True},
        "procedureHashes": read("procedure-hashes.json"),
        "scope": "CLI/library, all five BIP39 widths and representations, Seedshift/date/word recovery, local Bitcoin evidence, SSKR transports/thresholds/joint repair/WASM integration, candidate-list age export, private input/files, selected real PDF/QR outputs, architecture/docs/dependencies and static CI/release gates. Ordinary audit, not release approval.",
        "artifacts": {"distManifest": "Local docs/audits/AUD-008-evidence/dist-manifest.json", "freshBuild": "pnpm build at this snapshot; 211 compiled files", "card": reviews["interface"]["artifactEvidence"], "existingExecutableSourceRelationship": "Checksum/interface sampled only; no fresh build or source-provenance claim."},
        "coverage": coverage, "checks": checks, "findings": findings,
        "observations": [], "informationalNotes": notes,
        "findingCounts": counts,
        "selectedTests": {"distinctTests": 440, "files": 22, "initialPassed": 426,
                          "initialFailed": 14, "initialFailureCause": "Sandbox child-stream failure, independently controlled",
                          "affectedHostRerun": {"files": 5, "passed": 31, "failed": 0},
                          "negativeChildAssertionsHostRerun": {"files": 2, "passed": 23, "failed": 0},
                          "note": "Reruns overlap the original 440 tests; do not add their totals as new distinct tests."},
        "priorFindingDisposition": reviews["devops"]["priorFindings"],
        "remediation": [{"id": f["id"], "status": "open", "fixCommit": None,
                         "verificationCommit": None, "evidence": f["evidence"]} for f in findings],
        "limitations": limitations,
        "skepticDispositions": reviews["documentation-skeptic"]["dispositions"],
        "reviewRecordHashes": {name + "-review.json": hashlib.sha256((EVIDENCE / (name + "-review.json")).read_bytes()).hexdigest() for name in reviews},
        "harnessHashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted((ROOT / "docs/audits/AUD-008-harnesses").iterdir()) if path.is_file()},
    }
    REPORT.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")

    md = ["# AUD-008 — MnemoCode full-scope ordinary audit", "", "## Record metadata", "",
          "- **Audit number:** 8; completed (UTC): 2026-10-06.",
          "- **Reviewer:** Codex coordinator and five delegated reviewers, covering six roles. Exact model and reasoning effort were not retained; both are unknown/null.",
          f"- **Reviewed commit:** `{snapshot['commit']}` on `main`.",
          "- **Working tree:** clean initially; only audit records/harnesses/index and ignored evidence added. Product files and HEAD remained unchanged.",
          f"- **Source fingerprint:** `{snapshot['sourceFingerprint']}` across {len(snapshot['files'])} tracked product files, excluding `docs/audits/`.",
          "- **Artifacts:** fresh `pnpm build` outputs hashed locally; real PDF/PNG/QR checked. Existing executable only sampled, with no fresh-source/provenance claim.",
          "- **Coordination limit:** creation of a sixth delegated agent and reuse of a historical thread both hit the tool's thread cap. The coordinator took documentation and skeptic work; six independent subagents are not claimed.", "",
          "## Finding register", "",
          f"**{len(findings)} confirmed findings: {counts.get('medium', 0)} medium, {counts.get('low', 0)} low; no critical/high finding.** No automatic release approval is given. All findings remain open; no fixes were made.", "",
          "| Finding ID | Category | Kind | Severity | Status | Title |",
          "| --- | --- | --- | --- | --- | --- |"]
    for f in findings:
        md.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | open | {cell(f['title'])} |")
    md += ["", "## Review evidence", "", "### Scope and methodology", "", report["scope"], "",
           "The six roles were secret ownership/security, core mathematics and Bitcoin evidence, SSKR interoperability/recovery, terminal/cards/QR, build/dependencies/CI, and documentation with skeptical reconciliation. Five roles were delegated; the last was performed by the coordinator. Only public test vectors and invented fixtures were used.", "",
           "Independent checks include 45 Seedshift transforms, 450 representations, 1,757 ordered word candidates, 96 Bitcoin derivations/address checks anchored to literal vectors, 30 NFKD fingerprints, 30 official grouped SSKR quorums, 15 width-specific pairs, all 65,536 GF(256) products, and six SSKR representations with one-token repair. Valid production paths pass these checks; malformed-boundary findings are recorded separately.", "",
           "Node 26.10.0 and pnpm 12.8.1 were used on Linux x86_64. Exact argv, cwd, timestamps, exit status and selected environment variables are retained in local command ledgers. Heavy jobs were serialized. No paid or remote workflow was dispatched.", "",
           "All evidence filenames below denote **local ignored evidence** under `docs/audits/AUD-008-evidence/`, not published artifacts. The JSON record retains full command ledgers and reviewer-record hashes; the [harness README](AUD-008-harnesses/README.md) explains reproduction.", "",
           "### Procedure fingerprints", "", "| Procedure / instruction | SHA-256 |", "| --- | --- |"]
    for path, sha in report["procedureHashes"].items():
        md.append(f"| `{path}` | `{sha}` |")
    md += ["", "### Coverage ledger", "",
           "Outcomes refer to the stated source/runtime scope. Partial checks do not certify excluded platforms or releases.", "",
           "| Check ID | Logical group | Reviewer | Outcome | Evidence / scope limits |", "| --- | --- | --- | --- | --- |"]
    for c in coverage:
        detail = c.get("summary", c.get("result", c.get("evidence", c.get("reason", ""))))
        limits = c.get("limitations", c.get("limits", ""))
        if limits:
            detail = prose(detail) + "; limits: " + prose(limits)
        if "integrationNote" in c:
            detail = prose(detail) + "; " + c["integrationNote"]
        md.append(f"| {c['checkId']} | {cell(c['logicalGroup'])} | {c['reviewerRole']} | {c['outcome']} | {cell(detail)} |")
    md += ["", "### Checks", "",
           "Format, types and fresh build pass. The initial selected run was 426/440 with 14 sandbox child-stream failures; the five affected files pass 31/31 outside that sandbox, and two negative child-test files pass 23/23 there. Those reruns overlap the original selection. The ordinary terminal acceptance script passes, including paste, cursor editing, private-screen return and prompt cancellation; cancellation during the synchronous date search is a separate reproduced defect.", "",
           "Failed diagnostic or original harness runs are preserved, not counted as application defects. Deliberately failing baseline contract assertions remain failures. The corrected skeptic challenge confirms observations and is not a post-fix acceptance test.", "",
           "| Evidence label | Exact command | Exit | Log SHA-256 | Interpretation |", "| --- | --- | --- | --- | --- |"]
    for c in checks:
        md.append(f"| {c['label']} | `{cell(c['command'])}` | {c['exitCode']} | `{c['logSha256']}` | {cell(c.get('interpretation', 'Completed run; see scoped reviewer detail'))} |")
    md += ["", "### Findings", ""]
    for f in findings:
        md += [f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}", ""]
        for label, value in [
            ("Category / status", f["category"] + " / open"),
            ("Release blocking", "false; " + f.get("releaseBlockingReason", "No direct compromise or unsafe successful publication demonstrated.")),
            ("Affected files and builds", f.get("affectedFiles", f.get("locations", f.get("affected", f.get("files", "See source evidence"))))),
            ("Reproduction", f["reproduction"]), ("Expected behavior", f["expected"]),
            ("Observed behavior", f["observed"]), ("Impact", f["impact"]),
            ("Evidence", f["evidence"]), ("Recommended fix", f["recommendedFix"]),
            ("Required verification", f["requiredVerification"]),
        ]:
            md.append(f"- **{label}:** {prose(value)}")
        if "skepticDisposition" in f:
            md.append("- **Skeptic disposition:** " + f["skepticDisposition"])
        md.append("")
    md += ["### Remediation and follow-up", "", "No product remediation was authorized or performed. Finding identifiers remain stable for later fixes.", "",
           "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
    for f in findings:
        md.append(f"| {f['id']} | open | Not fixed | Not run | Original source and bounded reproduction above |")
    md += ["", "Historical findings are not reopened merely because their original records retain original statuses. AUD-005-BLD001 and BLD002 remain fixed with the previously recorded platform/GitHub verification gap. Current static gates and existing local notices conform; no current tag/platform execution was claimed. AUD-007's comment finding remains historically verified.", "",
           "### Informational observations and recommendations", ""]
    for note in notes:
        md.append(f"- **{note['title']}:** {note['detail']}")
    md += ["", "### Assessment and limitations", "",
           "Prioritize cancellation and recovery-set validation before a substantial release. The tested ordinary transforms, Bitcoin derivations, transport vectors and QR payloads remain correct. API findings do not establish a password/threshold bypass, silent loss of a correctly recovered valid quorum, or private-material exfiltration.", ""]
    md += ["- " + item for item in limitations]
    REPORT.with_suffix(".md").write_text("\n".join(md) + "\n")
    print(json.dumps({"findings": len(findings), "severities": counts, "coverage": len(coverage), "commandRecords": len(checks)}))


if __name__ == "__main__":
    main()
