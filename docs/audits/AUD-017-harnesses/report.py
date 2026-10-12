"""Publish the targeted AUD-017 follow-up; never rewrite AUD-016."""

import hashlib
import json
from pathlib import Path
import re
import shlex

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-017-evidence"
CANONICAL = ROOT.parent / "multi-chain-wallet-tools"
BASE = "AUD-017-2026-10-12"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def private(value):
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s\"']+", "/home/user", value)
    if isinstance(value, list):
        return [private(item) for item in value]
    if isinstance(value, dict):
        return {key: private(item) for key, item in value.items()}
    return value


start = load(EVIDENCE / "aud017-start-snapshot.json")
end = load(EVIDENCE / "aud017-end-snapshot.json")
assert start["files"] == end["files"] and start["fingerprint"] == end["fingerprint"]
source = {row["path"]: row["sha256"] for row in end["files"]}
prior = load(AUDITS / "AUD-016-2026-10-12.json")
claimed = prior["remediationAddendum"]["fixSourceFingerprint"]
commands = []
for path in sorted(EVIDENCE.glob("*.command.json")):
    row = load(path)
    label = path.name.removesuffix(".command.json")
    assert row["sourceBefore"] == row["sourceAfter"] == end["fingerprint"] and not row["changedFiles"]
    assert digest(EVIDENCE / f"{label}.log") == row["logSha256"]
    commands.append({"label": label, **row,
                     "evidence": {"localOnly": True, "log": f"AUD-017-evidence/{label}.log", "sha256": row["logSha256"]}})


def evidence(label):
    return next(row["evidence"] for row in commands if row["label"] == f"aud017-{label}")


api = {"id": "AUD-016-API001", "category": "API", "kind": "finding", "severity": "medium", "status": "open",
       "title": "Wallet snapshots still break host getters that read private class fields",
       "releaseBlocking": True, "releaseBlockingReason": "Supported generic wallet results still become unusable; complete this public API remedy before release.",
       "affectedFiles": [{"path": "src/core/wallet-check.ts", "line": 58, "sha256": source["src/core/wallet-check.ts"]}],
       "evidence": evidence("edges-confirmed"),
       "reproduction": "Return a WalletMatch-compatible class with matched:true, path:'m', private #derived and public get derived() returning it. Read derived after askWallet, then repeat through the actual WordCandidateSearch result.",
       "expected": "The returned generic result retains readable supported host fields. Common checked fields remain one-read snapshots.",
       "observed": "Common getters and ordinary derived fields work. A private-field getter throws 'Cannot read private member #derived from an object whose class did not declare it' both directly and from the word-search result.",
       "impact": "Object.create(given, captured fields) changes the getter receiver to a new object without the original class's private-field brand. A legitimate library/browser host can receive an unusable successful result. Built-in plain-object CLI answers were not shown to fail; no wrong-wallet approval or secret disclosure is demonstrated.",
       "recommendedFix": "Preserve host result data with the original getter receiver, while retaining immutable one-read matched/path/warning values. Do not use a brandless prototype wrapper as if it were the original generic class instance.",
       "requiredVerification": "Private-field-backed derived getter through askWallet and actual word-search output; ordinary own fields, prototype/non-enumerable fields, changing getters and malformed matched controls. Keep cancellation and cleanup regressions.",
       "disposition": "The original prototype-getter cases are fixed; the same generic result ownership root cause remains partly fixed."}
doc = {"id": "AUD-017-DOC001", "category": "DOC", "kind": "finding", "severity": "low", "status": "open",
       "title": "General remediation check records do not identify the exercised source",
       "releaseBlocking": False, "releaseBlockingReason": "Retained log outcomes are intact and fresh targeted checks bind current code; this gap limits attribution of the earlier broader checks.",
       "affectedFiles": [{"path": "docs/audits/AUD-016-evidence/remediation/check.command.json", "localOnly": True,
                          "sha256": digest(AUDITS / "AUD-016-evidence/remediation/check.command.json")},
                         {"path": "docs/audits/AUD-016-2026-10-12.md", "section": "Remediation addendum", "sha256": digest(AUDITS / "AUD-016-2026-10-12.md")}],
       "evidence": evidence("evidence"),
       "reproduction": "Read the 12 general check records cited by the addendum, or run evidence-check.py. They contain command, UTC times, exit code and log hash, but no sourceBefore/sourceAfter, cwd/environment or retained wrapper identity.",
       "expected": "Checks attributed to a fix snapshot identify the exact source/artifact bytes and execution context they exercised, as required by the canonical audit procedure.",
       "observed": "All 13 cited logs match their hashes. The residual probe binds c430… explicitly; the other 12 checks lack that binding. A later snapshot does not independently establish which bytes those preceding tests ran against.",
       "impact": "The claimed broader passing outcomes are retained, but cannot all be independently assigned to the c430… fix snapshot. This is an evidence attribution limit, not proof that the tests failed or did not run.",
       "recommendedFix": "Use a recorder with per-command source identities, working directory, environment and wrapper hashes for future checks. Preserve earlier logs and their limitation; do not invent missing historic bindings or rerun full suites merely to rewrite history.",
       "requiredVerification": "Future necessary check records bind unchanged before/after source manifests and tested artifacts, with original logs and exact commands retained."}

procedures = ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md", "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]
groups = re.findall(r"^### (CHECK-[A-Z]+-\d+) — (.+)$", (CANONICAL / procedures[0]).read_text(), re.MULTILINE)
assert len(groups) == 32
coverage = {
    "CHECK-SEC-001": ("passed", "Public fixtures and scoped result/buffer ownership review."),
    "CHECK-SEC-005": ("passed", "Positive allocation counts and zeroed buffers for first/middle/last unknown tokens, CRC and metadata failures; caller-owned success preserved."),
    "CHECK-SEC-007": ("passed", "Bounded sequential commands with actual host-memory sampling; no heavy checks."),
    "CHECK-FUN-001": ("passed", "Existing startup tests include direct-12 fixture equivalence and exact transformation answers/refusals; no full vector replay."),
    "CHECK-FUN-003": ("not-applicable", "No BIP85/BIP38/message-signing/Silent Payments feature here."),
    "CHECK-FUN-005": ("not-applicable", "No transaction/PSBT inspection or signing feature here."),
    "CHECK-FUN-006": ("passed", "Scoped transport, split snapshot and startup SSKR known-answer tests; full repair/render matrix not repeated."),
    "CHECK-API-001": ("failed", "Generic host getter receiver changes and private-field access fails (AUD-016-API001)."),
    "CHECK-API-002": ("passed", "List abort refuses publication, one-read split and common wallet-field controls pass."),
    "CHECK-API-004": ("passed", "Public share round trip, malformed tokens, intended CRC/metadata guards and successful caller-owned output."),
    "CHECK-BLD-001": ("passed", "Source, test and strict-consumer typechecks plus fresh build; no new dependency/import of another workspace project in the changed runtime modules."),
    "CHECK-BLD-002": ("passed", "Linux Node startup and bounded ordinary tests only; browser/Windows/macOS not repeated."),
    "CHECK-BLD-003": ("passed", "Existing pin gate passes; no dependency update or fresh vulnerability scan."),
    "CHECK-ARC-001": ("failed", "Common data ownership improves, but prototype delegation does not preserve branded host result fields."),
    "CHECK-ARC-002": ("passed", "Copy detector finds zero copies of at least 50 tokens in 243 source/script files; no whole-tree semantic audit."),
    "CHECK-ARC-003": ("passed", "58 existing nearest regressions pass. Independent non-vacuous probes extend cleanup and expose the missing private-getter case."),
    "CHECK-DOC-001": ("passed", "MHFE remains linked; repository rule permits useful references while forbidding runtime/build dependencies."),
    "CHECK-DOC-002": ("passed", "Changed documentation/source formatting and the existing Markdown gate pass."),
    "CHECK-DOC-003": ("failed", "Historic report and logs preserved; general remediation check source attribution remains incomplete (AUD-017-DOC001)."),
}
ledger = [{"checkId": identifier, "category": identifier.split("-")[1], "group": title,
           "scope": "MnemoCode targeted remediation follow-up", "snapshot": end["fingerprint"],
           "method": "Scoped source inspection, retained evidence checks and bounded commands below.",
           "outcome": coverage.get(identifier, ("not-run", "Outside this targeted follow-up; no new coverage claimed."))[0],
           "reason": coverage.get(identifier, ("not-run", "Outside this targeted follow-up; no new coverage claimed."))[1]}
          for identifier, title in groups]
artifacts = ["dist/core/wallet-check.js", "dist/core/missing-codes-search.js", "dist/sskr/transport.js",
             "dist/sskr/split.js", "dist/core/representations-self-test.js", "sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"]
report = private({"schemaVersion": 1, "auditId": "AUD-017", "auditNumber": 17, "date": "2026-10-12",
    "title": "AUD-016 remediation follow-up: host result compatibility and evidence binding",
    "reviewer": {"name": "Codex coordinator and one scoped evidence reviewer", "model": None, "reasoningEffort": None},
    "snapshot": {"commit": end["commit"], "commitComplete": False, "workingTree": end["workingTree"],
                 "sourceFingerprint": end["fingerprint"], "files": end["files"], "claimedFixFingerprint": claimed,
                 "differenceFromClaimedFix": ["README.md"]},
    "scope": "Review of all three AUD-016 remedies, split getter observation, startup fixture consistency, MHFE rule, relocated evidence and remediation validation. Targeted execution, no production changes.",
    "procedureHashes": {name: digest(CANONICAL / name) for name in procedures},
    "baselineReportHashes": {name: digest(AUDITS / name) for name in ["AUD-016-2026-10-12.md", "AUD-016-2026-10-12.json"]},
    "harnessHashes": {f"AUD-017-harnesses/{path.name}": digest(path) for path in sorted((AUDITS / "AUD-017-harnesses").iterdir()) if path.is_file()},
    "sharedRecorderHash": {"path": "AUD-014-harnesses/audit.py", "sha256": digest(AUDITS / "AUD-014-harnesses/audit.py")},
    "checks": commands, "coverageLedger": ledger, "findings": [api, doc], "observations": [],
    "remediation": [{"id": api["id"], "status": "open", "fixCommit": None, "verificationCommit": None, "evidence": api["evidence"]},
                    {"id": "AUD-015-API001", "status": "fixed", "fixCommit": None, "verificationCommit": None, "evidence": evidence("edges-confirmed")},
                    {"id": "AUD-015-SEC001", "status": "fixed", "fixCommit": None, "verificationCommit": None, "evidence": evidence("edges-confirmed")},
                    {"id": doc["id"], "status": "open", "fixCommit": None, "verificationCommit": None, "evidence": doc["evidence"]}],
    "informationalReview": [
        "The old probe's two transport failures are instrumentation limits, not surviving decoded-buffer leaks. Constructor capture observes actual allocated arrays and all are wiped in the corrected new probe.",
        "allWiped([]) returns true in the ordinary helper; add a positive allocation-count assertion to keep future cleanup tests from passing vacuously. Current allocation/wipe behavior was independently confirmed.",
        "The retained historical validator does not validate the new addendum; successful modified validation and its skipped assertions were not recorded. Old source/status/artifact mismatches are expected historical identities, not a defect by themselves.",
        "The 51 checksum entries are valid relative to AUD-016-evidence/, not the remediation subfolder. Their verification cwd is undocumented and the 12 remediation pairs are omitted; no wrong parent-directory digest or lost log was found.",
        "Own host fields remain readable but become inherited; JSON/own-property enumeration drops derived. Recorded as a compatibility observation because no separate serialization contract was established.",
        "List publication stops correctly, though the aborting callback is followed by the remaining fingerprint callbacks (eight calls in this fixture). Earlier per-await checks could reduce unnecessary work; no additional publication failure was found."],
    "verificationSummary": {"ordinaryTests": 58, "ordinaryFiles": 3, "newProbeChecks": 20, "newProbePassed": 18, "newProbeFailed": 2,
        "meaning": "Ordinary regressions are distinct from diagnostic probe checks. No broad suite count from the remediation author is added.",
        "confirmedFixes": ["List publication cancellation", "UR/Bytewords partial-buffer cleanup", "Split getter read once", "direct-12 fixture equivalence"],
        "remaining": "AUD-016-API001 is partly fixed; private-field-backed generic host getters still fail. Earlier general-check source attribution is incomplete.",
        "retainedFailures": "edges-expanded initially constructed a double-prefixed metadata fixture and failed at the UR framing guard. The harness was corrected; its failed log is retained and not treated as a product defect. The final edges-confirmed run has only the two branded-getter failures."},
    "artifactRelationship": {"build": evidence("build"), "sourceFingerprint": end["fingerprint"],
        "hashes": {name: digest(ROOT / name) for name in artifacts}, "wasmChanged": False,
        "limits": "Fresh Node build and real protected table command only; no standalone, browser, Docker or release-artifact verification."},
    "limitations": ["No PDF/card/QR generation, image comparison, full vectors, full self-test or full ordinary/long suite replay.",
        "No browser, Windows/macOS, Docker/WASM regeneration, paid CI, dependency audit or release acceptance.",
        "No production, ordinary-test, dependency, workflow or earlier report/harness edits. No commit, push, tag, release or other-project edit.",
        "Memory cleanup is best effort: owned byte arrays were observed, not every string, VM copy or engine allocation.",
        "The author's broad passing logs match their hashes; missing per-command source metadata cannot be recreated retrospectively."],
    "summary": {"openMedium": 1, "openLow": 1, "releaseAccepted": False,
                "conclusion": "Two original runtime findings and the split observation pass targeted controls. Generic wallet-result compatibility remains partly fixed; one new evidence-attribution gap is recorded."}})
(AUDITS / f"{BASE}.json").write_text(json.dumps(report, indent=2) + "\n")
lines = [f"# AUD-017 — {report['title']}", "", "## Record metadata", "",
    "- **Audit number:** 17.", "- **Completed (UTC):** 2026-10-12.",
    "- **Reviewer:** Codex coordinator and one source/evidence reviewer; exact model/effort unknown (null).",
    f"- **Reviewed HEAD:** `{end['commit']}` plus the uncommitted working tree.",
    f"- **Reviewed source:** `{end['fingerprint']}`; stable throughout every check.",
    f"- **Claimed fix snapshot:** `{claimed}`; current code matches, only README differs.",
    "- **Artifacts:** Fresh Node build; retained SSKR WASM unchanged. No release verification.", "", "## Finding register", "",
    "| Finding / record ID | Category | Kind | Severity | Recorded status | Title |", "| --- | --- | --- | --- | --- | --- |"]
for row in report["findings"]:
    lines.append(f"| {row['id']} | {row['category']} | finding | {row['severity']} | open | {row['title']} |")
lines += ["", "## Review evidence", "", "### Scope and methodology", "", report["scope"], "",
    "The coordinator independently reproduced the runtime result and challenged the evidence reviewer's checksum interpretation. Digests are valid from the parent directory; a different cwd alone is not a broken digest. All 13 cited logs and 48 relocated files are intact. Restoring only the finding register statuses/remediation metadata reconstructs the original AUD-016 MD/JSON hashes exactly; original review content is preserved.", "",
    "| Procedure | SHA-256 |", "| --- | --- |"]
for name, value in report["procedureHashes"].items(): lines.append(f"| `{name}` | `{value}` |")
lines += ["", "### Coverage ledger", "", "| Check ID | Group | Outcome | Evidence / gap reason |", "| --- | --- | --- | --- |"]
for row in ledger: lines.append(f"| {row['checkId']} | {row['group']} | {row['outcome']} | {row['reason']} |")
lines += ["", "### Checks", "", "Commands were sequential with a 768 MiB Node heap, 4 GiB start threshold, 3 GiB stop reserve and 120-second timeout. Every run retained unchanged source identities and actual memory samples. The JSON companion retains exact arguments, UTC times, exit codes and source/log hashes.", "",
    "| Command / retained label | Result | Log SHA-256 |", "| --- | --- | --- |"]
for row in report["checks"]:
    command = shlex.join(row["command"]).replace("|", "&#124;").replace("`", "&#96;")
    lines.append(f"| {row['label']}: `{command}` | exit {row['exitCode']} | `{row['logSha256']}` |")
lines += ["", "**58 ordinary tests in three files pass**, as do source checks, formatting, a fresh build and the protected CLI table command. The final independent probe has 18 passing and two failing checks; both failures are the same private-getter root cause. The original probe still has two allocator-observation failures, exactly as the remediation author reported. No overlapping totals or the author's full/light suites are counted here.", "",
    report["verificationSummary"]["retainedFailures"], "", "### Findings", ""]
for row in report["findings"]:
    lines += [f"#### {row['id']} — {row['severity'].capitalize()} — {row['title']}", ""]
    for label, key in [("Category", "category"), ("Status", "status"), ("Reproduction", "reproduction"),
                       ("Expected behavior", "expected"), ("Observed behavior", "observed"), ("Impact", "impact"),
                       ("Recommended fix", "recommendedFix"), ("Required verification", "requiredVerification")]:
        lines.append(f"- **{label}:** {row[key]}")
    lines += [f"- **Release blocking:** {str(row['releaseBlocking']).lower()}; {row['releaseBlockingReason']}",
              "- **Affected files:** " + "; ".join(f"`{item['path']}` (SHA-256 `{item['sha256']}`)" for item in row["affectedFiles"]),
              f"- **Evidence:** `{row['evidence']['log']}`, SHA-256 `{row['evidence']['sha256']}` (local only).", ""]
lines += ["### Remediation and follow-up", "", "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
for row in report["remediation"]:
    lines.append(f"| {row['id']} | {row['status']} | Not committed | Not committed | `{row['evidence']['log']}` (local only) |")
lines += ["", "Fixed here means source-fixed with targeted controls. No blanket verified status, commit identity or PDF acceptance is claimed. The current follow-up leaves the partly fixed wallet-result finding open without rewriting AUD-016's historical register or addendum.", "",
    "### Informational observations and recommendations", ""]
lines += [f"- {text}" for text in report["informationalReview"]]
lines += ["", "### Source and artifact bindings", "",
    "Complete reviewed source SHA-256 manifest and compiled module hashes are in the JSON companion. The legacy memory recorder is reused from its frozen definitions, with evidence directed to AUD-017 before any command. Earlier source/status/artifact identities remain historical records. Their expected differences after fixes are not passed off as current runtime failures.", "",
    "| Historical report or shared recorder | SHA-256 |", "| --- | --- |"]
for name, value in {**report["baselineReportHashes"], report["sharedRecorderHash"]["path"]: report["sharedRecorderHash"]["sha256"]}.items():
    lines.append(f"| `{name}` | `{value}` |")
lines += ["", "### Assessment and limitations", "", report["summary"]["conclusion"], ""]
lines += [f"- {text}" for text in report["limitations"]]
lines += ["", "Raw logs, snapshots and checksums remain local and ignored in `AUD-017-evidence/`. Harness source is published separately; no raw evidence is staged.", ""]
(AUDITS / f"{BASE}.md").write_text(private("\n".join(lines)))
index = AUDITS / "README.md"
text = index.read_text()
row = "| AUD-017 | 2026-10-12 | AUD-016 remediation follow-up and independent allocation/result probes | Two runtime remedies and split getter pass targeted controls; wallet-result private getters remain broken (medium prior-ID extension). One low evidence-attribution gap. 58 ordinary tests pass; no PDF, full suites or release acceptance. | [Report](AUD-017-2026-10-12.md), [JSON](AUD-017-2026-10-12.json), [harness scripts](AUD-017-harnesses/) |"
if "| AUD-017 |" in text: text = re.sub(r"^\| AUD-017 \|.*$", row, text, flags=re.MULTILINE)
else:
    anchor = next(line for line in text.splitlines() if line.startswith("| AUD-016 |"))
    text = text.replace(anchor, anchor + "\n" + row, 1)
index.write_text(text)
print(json.dumps({"audit": "AUD-017", "source": end["fingerprint"], "findings": 2, "ordinaryTests": 58}))
