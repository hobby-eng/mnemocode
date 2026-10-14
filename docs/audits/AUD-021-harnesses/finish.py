"""Build the paired audit records from retained local evidence, then validate them."""

from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import shlex

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-021-evidence"
AUDITS = ROOT / "docs/audits"
GUIDE = ROOT.parent / "multi-chain-wallet-tools/docs"


def clean(value):
    # Published documents contain no machine-owner home path or local time offset.
    return re.sub(r"/home/[^/\s\"']+", "/home/user", value)


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


SCOPES = [
    ("SEC", "Security reviewer", [
        ("Threat model and secret ownership", "reviewed-with-findings", "Age diagnostic redaction: SEC003; explicit secret getters and immutable strings remain host responsibilities."),
        ("Process sandbox and transport", "reviewed", "Node permissions, OS hardening/refusals and startup reporting traced; enforcement evidence is limited to executed Linux checks."),
        ("Network egress", "reviewed", "No first-party runtime network request path found; library consumers must supply isolation. Platform gaps remain explicit."),
        ("Randomness, encryption and authentication", "reviewed-with-findings", "CSPRNG/age authentication and fixed scrypt admission traced; SEC003 diagnostic failure reproduced."),
        ("Lifecycle and exceptional paths", "reviewed", "Wiping scopes, raw input, staging and search publication reviewed. Inner PDF buffers, immutable strings and dependency erasure remain hardening limits."),
        ("Browser and sensitive APIs", "incomplete", "Host-neutral library reviewed. DOM/storage/CSP are outside this checkout; the consuming browser host has the BLD001 parity gate."),
        ("Availability bounds", "reviewed-with-findings", "Small actual PNG-decoder probes confirm SEC001/SEC002; search/share/input admission reviewed without exhaustion workloads."),
    ]),
    ("FUN", "Recovery reviewer", [
        ("BIP39, representations and masking", "reviewed-with-findings", "All lengths/forms/modes reviewed; FUN001 reproduced. Independent-oracle execution is recorded separately."),
        ("HD derivation and coins", "reviewed", "Supported coin/network/path/address/fingerprint checks and known answers reviewed; test execution is recorded below."),
        ("BIP85/BIP38/messages/Silent Payments", "not-applicable", "MnemoCode implements none of these protocols."),
        ("Scripts and descriptors", "reviewed", "Supported wallet-evidence admission reviewed; transaction construction, Miniscript and multisig coordinators are not implemented."),
        ("Transactions and PSBT", "not-applicable", "MnemoCode constructs or signs no transaction and has no PSBT parser."),
        ("Recovery and backup formats", "reviewed-with-findings", "MNC1/MNCL, SSKR topology, transport, repair and cancellation reviewed; FUN002, API001/API002 reproduced."),
        ("Discovery/providers/accounting", "not-applicable", "The offline program does not query providers or discover funds; its candidate-list handover is covered under API checks."),
    ]),
    ("API", "Interface reviewer", [
        ("Dependency and host contracts", "reviewed-with-findings", "Actual installed dependency paths reviewed; byte-array and confirmation ownership defects API001/API002 reproduced."),
        ("Async state and cancellation", "reviewed-with-findings", "API002 reproduced; late progress remains a bounded cooperative-cancellation observation, not secret publication."),
        ("Export schemas", "reviewed-with-findings", "Records, candidate lists, metadata and filenames reviewed; real dispatcher confirms per-destination decoy defect FUN003."),
        ("Encoding interoperability", "reviewed-with-findings", "Unicode, colors, Bytewords/UR and QR transport reviewed; damaged-prefix defects FUN001/FUN002 reproduced."),
    ]),
    ("BLD", "Coordinator", [
        ("Manifest and composition", "reviewed-with-findings", "Type/build/format/copy gates pass; browser composition remains incomplete under BLD001."),
        ("Platform runtime matrix", "incomplete", "Executed Linux checks are listed below. No current-source Windows/macOS acceptance or browser matrix exists."),
        ("Dependencies, provenance and licenses", "reviewed-with-findings", "Installed exact top-level pins and all seven SSKR manifest entries match. Advisory scan is clear; BLD002 confirms omitted package link targets. No clean reinstall is claimed."),
        ("Canonical WASM/Docker bytes", "incomplete", "Committed integrity matches; no fresh uncached Docker comparison was executed. Hash identity is not reproducibility proof."),
        ("Artifacts, CI and releases", "incomplete", "Local artifact checks are listed below. Both HEAD workflows failed Windows PTY, and dirty-source CI is absent. No signing/tag/publication was performed."),
    ]),
    ("UI", "Interface reviewer", [
        ("Real exports and rendering", "reviewed-with-findings", "Five real pages pass PDF/PNG/QR and visual checks. Original 60-second timeout passes a scoped rerun without changes; two complete-gallery cases remain explicitly excluded. FUN003 remains open."),
        ("Navigation and private input", "incomplete", "Linux terminal checks and tests are listed below. Windows CI failure remains unattributed; no browser interaction acceptance."),
        ("Visibility, help and QR", "reviewed-with-findings", "Private-screen/warnings/help reviewed; SEC001/SEC002 and DOC001 cover confirmed image/guidance defects."),
    ]),
    ("ARC", "Quality/documentation reviewer", [
        ("Module ownership", "reviewed", "Library/front-end/host boundaries and public composition inspected. No monolithic-rule defect established."),
        ("Duplication and unused code", "reviewed-with-findings", "Lexical gate reports zero copies of at least 50 tokens; semantic review found ARC001. RGB maxima are an optional consolidation opportunity."),
        ("Test and production-path fidelity", "reviewed", "Known-answer negative controls and startup composition traced. Export regression misses the production loop; required new tests are specified per finding."),
    ]),
    ("DOC", "Quality/documentation reviewer", [
        ("Capabilities and safety claims", "reviewed-with-findings", "README/help/heir/security/format claims compared with code; DOC001 reproduced."),
        ("Commands, links and legal materials", "reviewed-with-findings", "UTC recipe DOC002 confirmed; pack manifest result recorded separately. Complete external-link/license certification is not claimed."),
        ("Historical audit consistency", "reviewed", "AUD-014 through AUD-020 dispositions and selected log hashes inspected; retained historical results are not counted as new runs."),
    ]),
]


def main():
    start, end = read("initial-snapshot.json"), read("final-snapshot.json")
    if start["fingerprint"] != end["fingerprint"]:
        raise ValueError("Non-audit source changed during review")
    findings = read("findings-source.json")
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda item: severity_order[item["severity"]])
    original_hashes = {item["path"]: item["sha256"] for item in start["files"]}
    bindings = {}
    for finding in findings:
        for location in finding["evidence"]["locations"]:
            path = location.split(":", 1)[0]
            if path in original_hashes:
                bindings[path] = original_hashes[path]
    checks = []
    for path in sorted(EVIDENCE.glob("*.command.json")):
        item = json.loads(path.read_text())
        log = path.with_name(path.name.replace(".command.json", ".log"))
        if digest(log) != item["logSha256"]:
            raise ValueError(f"Evidence log mismatch: {log.name}")
        text = log.read_text(errors="replace")
        summary = re.findall(r"^\s*(?:Test Files|Tests|Duration)\s+.*$", text, re.M)
        checks.append({
            "label": path.name.removesuffix(".command.json"),
            "command": item["command"], "startedAt": item["startedAt"],
            "endedAt": item["endedAt"], "exitCode": item["exitCode"],
            "stopReason": item["stopReason"], "logSha256": item["logSha256"],
            "localEvidence": log.name, "summary": summary,
            "minimumAvailableGiB": round(item["minimumAvailableBytes"] / (1024 ** 3), 3),
            "sourceBefore": item["sourceBefore"], "sourceAfter": item["sourceAfter"],
            "changedFiles": item["changedFiles"],
        })
        if not summary:
            checks[-1]["resultExcerpt"] = [line for line in text.splitlines()
                                           if line.strip() and "Start at" not in line][-8:]
    checks.sort(key=lambda x: x["startedAt"])
    ledger = []
    for category, owner, items in SCOPES:
        for number, (title, status, evidence) in enumerate(items, 1):
            ledger.append({"id": f"CHECK-{category}-{number:03}", "owner": owner,
                           "title": title, "outcome": status, "evidence": evidence})
    assert len(ledger) == 32
    stamp = datetime.now(timezone.utc).isoformat()
    report = {
        "schemaVersion": 1, "auditId": "AUD-021", "auditNumber": 21,
        "date": stamp[:10], "completedAt": stamp,
        "title": "MnemoCode 0.1.0 full pre-release baseline audit",
        "reviewer": {"name": "Codex coordinator and five independent reviewers", "model": None, "reasoningEffort": None},
        "reviewerPhases": ["Security and recovery; independent skeptical challenge; interface and architecture/documentation; final combined skeptical challenge"],
        "snapshot": {"commit": start["commit"], "commitComplete": False,
                     "workingTree": start["workingTree"], "sourceFingerprint": start["fingerprint"],
                     "fileCount": len(start["files"]), "snapshotSha256": digest(EVIDENCE / "initial-snapshot.json"),
                     "sourceUnchanged": True},
        "scope": "Entire current MnemoCode checkout, including dirty/untracked source, core representations/masking/recovery, coin evidence, SSKR Rust/WASM, CLI, cards/QR, tests/startup checks, packaging, workflows and documentation. No sibling repository mutation or browser execution.",
        "verdict": "FAIL", "executionComplete": False,
        "procedureHashes": read("procedure-hashes.json"), "coverageLedger": ledger,
        "evidenceFacts": read("evidence-facts.json"),
        "affectedSourceSha256": bindings,
        "checks": checks, "findings": findings, "observations": [],
        "remediation": [{"id": x["id"], "status": x["status"], "fixCommit": None,
                         "verificationCommit": None, "evidence": "No production remediation was performed during this baseline."} for x in findings],
        "recommendations": [
            "Add bounded negative tests specified for every confirmed finding; place hostile-input admission tests in unit/CLI regressions, not slow startup checks.",
            "Startup already composes exact known answers with refusal/fault-injection controls. Keep it fast; startup cannot replace hostile-input regression tests or release-level vectors/rendering.",
            "Optional hardening: reject operations on disposed candidate lists, release passphrase references, wipe intermediate PDF buffers and clarify dependency/WASM erasure limits.",
            "Cooperative cancellation may emit one final progress callback after an unmatched wallet answer; no match or successful result is published. An earlier guard is an optional UI improvement.",
            "Threshold-one imported SSKR is intentionally supported; a checked result does not add cryptographic authentication. Improve wording rather than inventing a threshold prohibition.",
            "Consolidate repeated RGB maxima if it simplifies ownership; clarify roadmap bullets for features already present in TypeScript; pin the upstream SSKR vector to a full revision/hash.",
            "Preserve the owner's deferred G1-001 and S123/S120 decisions. No risk acceptance is inferred.",
        ],
        "limitations": [
            "Open release-blocking findings establish FAIL independently of incomplete execution gates. No critical/high finding or direct secret compromise was demonstrated.",
            "Two complete-gallery tests excluded by the owner; no full-gallery script run. Original full-suite and batch timeouts and the initial failed export harness attempt remain in the evidence.",
            "Current dirty-source Windows/macOS and real browser acceptance are absent. HEAD Windows PTY failed both remote workflows; those traces do not establish the cause or behavior of the dirty source.",
            "No fresh uncached canonical Docker/WASM comparison, clean dependency reinstall or signed release provenance was performed. The native pre-tag procedure defers verify:sskr to the tag workflow; installed-pin/integrity matches are narrower evidence.",
            "The guard requires 4 GiB available before starting, stops below 3 GiB, caps the Node heap at 768 MiB and runs files one at a time. Deadlines apply only to command execution; test assertions/timeouts and cryptographic parameters were not relaxed.",
            "Linux system self-test reporting is not proof that every OS mitigation held. Core-limit readback, other platforms, dependency erasure and host storage/DOM controls remain limited evidence.",
            "Auditing is not independent certification, proof of defect absence or publication. No production/test/fixture/dependency/workflow changes, commit, push, tag, release upload, signing or paid CI dispatch occurred.",
        ],
    }
    artifacts = EVIDENCE / "artifact-manifest.json"
    if artifacts.exists():
        report["artifacts"] = json.loads(artifacts.read_text())
    report = json.loads(clean(json.dumps(report)))
    base = AUDITS / f"AUD-021-{report['date']}"
    base.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"# AUD-021 — {report['title']}", "", "## Record metadata", "",
             f"- **Completed (UTC):** {stamp}.", "- **Reviewer:** Codex coordinator and five independent reviewers.",
             "- **Model and reasoning effort:** unknown for every phase; no settings inferred from earlier audits.",
             f"- **Reviewed commit:** `{start['commit']}` plus the pre-existing dirty working tree; artifacts are not commit-only builds.",
             f"- **Source fingerprint:** `{start['fingerprint']}` over {len(start['files'])} existing non-audit files, unchanged after execution.",
             f"- **Initial snapshot SHA-256:** `{digest(EVIDENCE / 'initial-snapshot.json')}`.",
             "- **Verdict:** **FAIL**. Confirmed open blockers remain; execution also has explicit gaps.", "",
             "## Finding register", "", "| ID | Category | Kind | Severity | Status | Release blocking | Title |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for f in findings:
        lines.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | {f['status']} | {str(f['releaseBlocking']).lower()} | {f['title']} |")
    lines += ["", "## Review evidence", "", "### Scope and methodology", "", report["scope"], "",
              "All 32 canonical checks were assigned before review in [plan.md](AUD-021-harnesses/plan.md). Independent reviewers were source-only; the coordinator owned the single runtime queue. An independent skeptic challenged the security/recovery wave and the combined conclusions. No remediation wave was performed.", "",
              "The canonical workspace [execution guide](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/FULL_AUDIT_GUIDE.md), [standard](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/audits/AUDIT_STANDARD.md), [template](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/audits/AUDIT_TEMPLATE.md) and [schema](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/audit-report.schema.json) were read locally and hash-bound:", "", "```json",
              json.dumps(report["procedureHashes"], indent=2), "```", "",
              "### Source-bound verification facts", "", "```json",
              json.dumps(report["evidenceFacts"], indent=2), "```", "",
              "Affected non-audit files are additionally bound to their initial SHA-256 values:", "", "```json",
              json.dumps(bindings, indent=2), "```", "",
              "Remote HEAD evidence: [executable workflow](https://github.com/hobby-eng/mnemocode/actions/runs/38387222400) and [CI](https://github.com/hobby-eng/mnemocode/actions/runs/38387222298) both failed Windows PTY. Linux/macOS jobs passed on HEAD; these are not current dirty-source CI results. No remote workflow was dispatched by this audit.", "",
              "### Coverage ledger", "", "| Check | Owner | Outcome | Evidence / gap |", "| --- | --- | --- | --- |"]
    for row in ledger:
        lines.append(f"| {row['id']} | {row['owner']} | {row['outcome']} | {row['evidence']} |")
    lines += ["", "### Checks", "", "The exact executed commands, UTC times, exit codes, source identity and log hashes follow. Evidence filenames below are **local only**, in ignored `docs/audits/AUD-021-evidence/`; they are not committed links. Overlapping probes/reruns and incomplete timeout attempts are never added to ordinary test totals.", ""]
    for row in checks:
        lines += [f"#### {row['label']}", "", "```bash", clean(shlex.join(row["command"])), "```",
                  f"- **UTC:** {row['startedAt']} to {row['endedAt']}.",
                  f"- **Exit / stop:** {row['exitCode']} / {row['stopReason'] or 'none'}.",
                  f"- **Minimum host availability:** {row['minimumAvailableGiB']} GiB.",
                  f"- **Local evidence:** `{row['localEvidence']}`, SHA-256 `{row['logSha256']}`."]
        if row["summary"]:
            lines.append("- **Recorded summary:** " + "; ".join(x.strip() for x in row["summary"] if "Start at" not in x))
        elif row.get("resultExcerpt"):
            lines += ["- **Recorded output excerpt:**", "", "```text",
                      clean("\n".join(row["resultExcerpt"])), "```"]
        lines.append("")
    if "artifacts" in report:
        lines += ["### Artifacts and visual acceptance", "", "Generated outputs are ignored local evidence, not release uploads. Digests establish these exact output bytes; they do not constitute signed provenance or a reproducibility proof.", "", "```json",
                  json.dumps(report["artifacts"], indent=2), "```", ""]
    lines += ["### Findings", ""]
    for f in findings:
        lines += [f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}", "",
                  f"- **Category/status:** {f['category']} / {f['status']}.",
                  f"- **Release blocking:** {str(f['releaseBlocking']).lower()}. " + ("Mandatory supported recovery/API/redaction/resource or browser-parity contract is unmet." if f['releaseBlocking'] else "Bounded presentation, export, documentation or maintenance impact; no independent release blocker established."),
                  "- **Affected locations:** " + "; ".join(f"`{p}`" for p in f['evidence']['locations']) + "."]
        for key, title in [("reproduction", "Reproduction"), ("expected", "Expected"), ("observed", "Observed"), ("impact", "Impact and counterevidence"), ("recommendedFix", "Recommended fix"), ("requiredVerification", "Required verification")]:
            lines.append(f"- **{title}:** {f[key]}")
        lines += ["- **Local-only evidence:** " + ", ".join(f"`{p}`" for p in f['evidence']['localEvidence']) + ".", ""]
    lines += ["### Remediation and follow-up", "", "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
    for f in findings:
        lines.append(f"| {f['id']} | open | Not fixed | Not run | Original source-bound reproduction |")
    lines += ["", "### Informational observations and recommendations", ""] + [f"- {x}" for x in report["recommendations"]]
    lines += ["", "### Assessment and limitations", ""] + [f"- {x}" for x in report["limitations"]]
    counts = Counter(f["severity"] for f in findings)
    lines += ["", f"Confirmed findings: {dict(counts)}; {sum(f['releaseBlocking'] for f in findings)} release blockers. Every finding remains open. The report describes inspected source and recorded experiments, not a security certificate.", ""]
    base.with_suffix(".md").write_text(clean("\n".join(lines)))
    schema = json.loads((GUIDE / "audit-report.schema.json").read_text())
    decoded = json.loads(base.with_suffix(".json").read_text(), object_pairs_hook=unique)
    jsonschema.Draft202012Validator(schema).validate(decoded)
    assert len({x['id'] for x in findings}) == len(findings)
    markdown = base.with_suffix(".md").read_text()
    for f in findings:
        assert f"#### {f['id']} — {f['severity'].capitalize()}" in markdown
    for text in [markdown, base.with_suffix(".json").read_text(), (ROOT / "docs/audits/AUD-021-harnesses/README.md").read_text()]:
        assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", text)
        assert not re.search(r"[\u0400-\u04ff]", text)
    validation = {"schema": "passed", "duplicateKeys": "passed", "pairedFindings": "passed",
                  "privacyEnglishUTC": "passed", "sourceUnchanged": True,
                  "reports": {p.name: digest(p) for p in [base.with_suffix('.md'), base.with_suffix('.json')]},
                  "validatedAt": datetime.now(timezone.utc).isoformat()}
    (EVIDENCE / "report-validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    paths = [p for p in EVIDENCE.iterdir() if p.is_file() and p.name != "SHA256SUMS"]
    (EVIDENCE / "SHA256SUMS").write_text("".join(f"{digest(p)}  {p.name}\n" for p in sorted(paths)))
    print(json.dumps({"report": base.name, "findings": len(findings), "verdict": "FAIL", "validation": "passed"}))


if __name__ == "__main__":
    main()
