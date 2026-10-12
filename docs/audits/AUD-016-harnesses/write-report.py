"""Publish AUD-016 from bounded evidence, preserving all earlier reports."""

import hashlib
import json
from pathlib import Path
import re
import shlex

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-016-evidence"
CANONICAL = ROOT.parent / "multi-chain-wallet-tools"
DATE = "2026-10-12"
TITLE = "AUD-015 follow-up and fast representation/SSKR self-tests"
PROCEDURES = ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
              "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]
HISTORICAL = {"AUD-015-2026-10-12.json": "dce315b5f8df6acec0581d4281f06544e4dff6c5e5a62c60e30ea292c9f1ae5e",
              "AUD-015-2026-10-12.md": "60140082f42e3636caff3d7f82ac3ebedd458e3480de336cba376b536bd2c024"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def private(value):
    """Anonymize published home paths; leave original local evidence unchanged."""
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s\"']+", "/home/user", value)
    if isinstance(value, list):
        return [private(item) for item in value]
    if isinstance(value, dict):
        return {key: private(item) for key, item in value.items()}
    return value


start = load(EVIDENCE / "aud016-start-snapshot.json")
end = load(EVIDENCE / "aud016-final-snapshot.json")
assert start["fingerprint"] == "c3da06153358ded064fdaff0d65bebaa6170274a2fe39eda30a19af4a5edd8ef"
before = {row["path"]: row["sha256"] for row in start["files"]}
after = {row["path"]: row["sha256"] for row in end["files"]}
for name, expected in HISTORICAL.items():
    assert digest(AUDITS / name) == expected, f"Historical report changed: {name}"
previous = load(AUDITS / "AUD-015-2026-10-12.json")
HISTORICAL.update(previous["baselineReportHashes"])
for name, expected in HISTORICAL.items():
    assert digest(AUDITS / name) == expected, f"Historical report changed: {name}"

commands = []
for path in sorted(EVIDENCE.glob("*.command.json")):
    row = load(path)
    label = path.name.removesuffix(".command.json")
    assert row["sourceBefore"] == row["sourceAfter"] and not row["changedFiles"]
    assert digest(EVIDENCE / f"{label}.log") == row["logSha256"]
    commands.append({"label": label, **row,
                     "evidence": {"localOnly": True, "log": f"AUD-016-evidence/{label}.log",
                                  "sha256": row["logSha256"]}})


def evidence(label):
    return next(row["evidence"] for row in commands if row["label"] == f"aud016-{label}")


def finding(identifier, category, severity, title, files, reproduction, expected,
            observed, impact, fix, verification):
    # These kernels were not changed by the self-test additions, so the baseline probe also
    # describes the final source. Other command phases keep their own fingerprints below.
    assert all(before[name] == after[name] for name, _ in files)
    return {"id": identifier, "category": category, "kind": "finding", "severity": severity,
            "title": title, "status": "open", "releaseBlocking": severity == "medium",
            "releaseBlockingReason": "Resolve the regression in the supported public WalletMatch contract before release."
            if severity == "medium" else "Limited cancellation or best-effort cleanup gap; no direct secret compromise shown.",
            "affectedFiles": [{"path": name, "line": line, "sha256": after[name]}
                              for name, line in files],
            "evidence": evidence("residuals"), "reproduction": reproduction,
            "expected": expected, "observed": observed, "impact": impact,
            "recommendedFix": fix, "requiredVerification": verification}


findings = [
    finding("AUD-016-API001", "API", "medium", "Wallet answer snapshots discard valid prototype getters",
            [("src/core/wallet-check.ts", 54)],
            "Call askWallet with a class whose prototype getters return matched:true and path:'m'. Also use an own matched:true field with path provided by a prototype getter.",
            "Accept both structurally valid WalletMatch objects and retain their declared result fields, reading each once.",
            "The class is refused as malformed; the second answer is accepted with its path silently omitted. Two independent probe cases fail.",
            "Supported library hosts can lose a successful wallet match or its evidence after the remediation's object-spread snapshot. Native CLI answers are ordinary own-property objects and were not shown to fail. No forged wallet or secret disclosure is demonstrated.",
            "Snapshot the declared WalletMatch fields by reading each once; preserve generic host result fields according to their contract. Do not assume supported fields are enumerable own properties.",
            "Class/prototype and non-enumerable result fields must work; keep changing-getter snapshot controls and rejection of malformed matched values."),
    finding("AUD-015-API001", "API", "low", "Listed-code results still return after cancellation during fingerprinting",
            [("src/core/missing-codes-search.ts", 472)],
            "Read '2027 10 2? 2027 10 24 2027 10 24 2027 10 377' as indexes/Seedshift and list candidates for 23-09-2026. Its fingerprint callback aborts the signal with Error('public list stop') and returns '00000000'.",
            "Under the strengthened no-late-publication promise, reject with the same abort reason before returning the list.",
            "ListWay.run returns kind:'list' while the signal is already aborted. The shared guard runs inside searched, before the later fingerprint awaits.",
            "A stopped library/browser recovery can publish a late candidate list. The original wallet-based AUD-015 reproductions now pass; this is another continuation of the same cancellation root cause. No wrong wallet or native secret leak is shown.",
            "Call the existing shared assertStillRunning after the awaited fingerprint and before list publication/final return; do not add a separate cancellation policy.",
            "Abort inside an asynchronous fingerprint must reject with its reason, while ordinary list and wallet searches continue to work."),
    finding("AUD-015-SEC001", "SEC", "low", "Throwing transport mappers leave partially populated arrays unwiped",
            [("src/sskr/transport.ts", 165), ("src/sskr/transport.ts", 234)],
            "Replace the last minimal Bytewords pair of a published UR share with 'zz', or its last full Byteword with 'zzzz'. Capture allocations by applying the original Uint8Array.from with a capturing Uint8Array subclass as its constructor.",
            "Refuse the unknown token and wipe internally owned decoded bytes, including partial allocations created before a mapper throws.",
            "Both readers refuse correctly, but each captured partial allocation still contains nonzero decoded share bytes. The mapper throws before from returns an array to the caller's cleanup wrapper.",
            "The ordinary successful-read and invalid-metadata buffers are now wiped; malformed-token failures retain an internal decoded prefix. This is a best-effort secret-lifecycle gap, not proof of heap-wide erasure failure or attacker access to process memory. Caller-owned valid output must stay usable.",
            "Use an owned allocation with explicit decoding and a finally cleanup on failure, or validate all tokens before allocating; retain the common reader rules and successful-output ownership.",
            "Unknown first/middle/last UR pairs and full Bytewords must refuse with captured arrays zeroed. Keep CRC/metadata failures, known-answer success and caller-owned-output controls."),
]

groups = [(match.group(1), match.group(2)) for match in re.finditer(
    r"^### (CHECK-[A-Z]+-\d+) — (.+)$", (CANONICAL / PROCEDURES[0]).read_text(), re.MULTILINE)]
assert len(groups) == 32
coverage = {
    "CHECK-SEC-001": ("passed", "Scoped ownership/source review and public fixtures; no person's secret used."),
    "CHECK-SEC-004": ("passed", "Exact deterministic SSKR creation uses public test-only randomness; production randomness unchanged. Candidate encryption was not retested."),
    "CHECK-SEC-005": ("failed", "Ordinary cleanup regressions pass, but partial transport allocations remain (AUD-015-SEC001)."),
    "CHECK-SEC-007": ("passed", "Malformed SSKR policies and entropy-width boundaries tested; all commands memory-bounded, sequential."),
    "CHECK-FUN-001": ("passed", "Fixed 12/24-word forward/reverse representation answers, checksum and range refusals; independent color oracle."),
    "CHECK-FUN-003": ("not-applicable", "No BIP85/BIP38/message-signing/Silent Payments feature in this repository."),
    "CHECK-FUN-005": ("not-applicable", "No transaction or PSBT inspection/signing feature in this repository."),
    "CHECK-FUN-006": ("passed", "Official grouped SSKR recovery, exact creation, invalid quorum/digest and transport controls; full repair/PDF matrix not run."),
    "CHECK-API-001": ("failed", "A supported getter-based WalletMatch is refused or loses its path (AUD-016-API001)."),
    "CHECK-API-002": ("failed", "Original async ownership/cancellation probes pass; fingerprint cancellation in listed codes still fails (AUD-015-API001)."),
    "CHECK-API-003": ("passed", "Original QR staging-save probes and targeted tests pass with opaque public renderer bytes; no actual PDF generation."),
    "CHECK-API-004": ("passed", "Exact representation and share transport answers, CRC/metadata refusals, supported/unsupported entropy widths."),
    "CHECK-BLD-001": ("passed", "Quick core composition cannot invoke mocked renderer services; portable import tests and strict consumer typechecks pass."),
    "CHECK-BLD-002": ("passed", "Targeted Linux Node source/build sampling only; real browser, Windows and macOS not run."),
    "CHECK-BLD-003": ("passed", "Existing toolchain/manifest pin gate passes; no dependency update or new vulnerability scan."),
    "CHECK-UI-002": ("passed", "Original prototype-named option refusals pass; full menu/PTY interaction not repeated."),
    "CHECK-ARC-001": ("passed", "New checks stay host-neutral and compose with startup/full self-tests; handover delivered, consumer sync not verified."),
    "CHECK-ARC-002": ("passed", "Shared independent test CRC extracted; copy detector reports zero copies of at least 50 tokens in 243 files. No whole-tree semantic proof."),
    "CHECK-ARC-003": ("passed", "Exact-oracle mutation tests, negative engine controls, failed-gate retries, stronger successful-read cleanup assertions."),
    "CHECK-DOC-001": ("passed", "Self-test descriptions updated; requested MHFE sentence checked against its current local README and canonical repository remote."),
    "CHECK-DOC-002": ("passed", "Changed README formatting, existing documentation/pin gates and final public CLI table command pass; legal materials unchanged."),
    "CHECK-DOC-003": ("passed", "Paired schema/record/hash/privacy validation; AUD-014 and AUD-015 preserved, each command retains its actual snapshot."),
}
ledger = [{"checkId": identifier, "category": identifier.split("-")[1], "group": title,
           "outcome": coverage.get(identifier, ("not-run", "Outside this targeted follow-up; no new runtime coverage claimed."))[0],
           "reason": coverage.get(identifier, ("not-run", "Outside this targeted follow-up; no new runtime coverage claimed."))[1],
           "method": "Scoped source review and the command evidence below; not full acceptance."}
          for identifier, title in groups]

environment = json.JSONDecoder().raw_decode((EVIDENCE / "aud016-final-environment.log").read_text())[0]
profile = json.JSONDecoder().raw_decode((EVIDENCE / "aud016-startup-profile.log").read_text())[0]
handover = load(EVIDENCE / "handover-wallet-tools.json")
changes = [{"path": path, "beforeSha256": before.get(path), "afterSha256": after.get(path)}
           for path in sorted(before.keys() | after.keys()) if before.get(path) != after.get(path)]
assert len(changes) == 10
report = {
    "schemaVersion": 1, "auditId": "AUD-016", "auditNumber": 16, "date": DATE, "title": TITLE,
    "reviewer": {"name": "Codex coordinator and two scoped source reviewers", "model": None, "reasoningEffort": None},
    "reviewerPhases": [
        {"role": "Coordinator", "scope": "Snapshot/procedure verification, independent probes, targeted checks, startup tests, synthesis.", "model": None, "reasoningEffort": None},
        {"role": "Source reviewer 1", "scope": "AUD-015 fixes and related async/ownership edge cases; no edits or commands.", "model": None, "reasoningEffort": None},
        {"role": "Source reviewer 2", "scope": "Representation/SSKR self-test coverage and short boundary suggestions; no edits or commands.", "model": None, "reasoningEffort": None}],
    "snapshot": {"commit": end["commit"], "commitComplete": False, "workingTree": end["workingTree"],
                 "sourceFingerprint": start["fingerprint"], "finalSourceFingerprint": end["fingerprint"],
                 "baselineManifest": start["files"], "finalManifest": end["files"],
                 "meaning": "HEAD does not contain the pre-existing large remediation tree or this review's ten source/test/README changes. Audit records are excluded from fingerprints."},
    "scope": "Targeted AUD-015 remediation review with fresh related probes and owner-authorized quick startup/boundary checks. No release-level execution.",
    "procedureHashes": {name: digest(CANONICAL / name) for name in PROCEDURES},
    "baselineReportHashes": HISTORICAL,
    "harnessHashes": {f"AUD-016-harnesses/{path.name}": digest(path)
                      for path in sorted((AUDITS / "AUD-016-harnesses").iterdir()) if path.is_file()},
    "checks": commands, "coverageLedger": ledger, "environment": environment,
    "findings": findings, "observations": [],
    "remediation": [{"id": row["id"], "status": "open", "fixCommit": None,
                     "verificationCommit": None, "evidence": row["evidence"]} for row in findings],
    "informationalReview": [
        {"title": "Executable mnemonic getters can still disagree in splitBackup", "file": "src/sskr/split.ts",
         "evidence": evidence("residuals"), "observed": "A mnemonic getter read twice returns public phrase A then B; original and held differ. Ordinary async ordinary-object mutation from AUD-015 is fixed.",
         "recommendation": "Derive held from the captured normalized original. This requires executable host code and is recorded as robustness advice rather than a passive-input attack."}],
    "priorRemediationReview": {"claimedSourceFingerprint": start["fingerprint"],
        "result": "The claimed source matches. All four original reproduction commands pass; six original findings have source fixes for their demonstrated cases. Two root causes have additional residual cases above. No blanket verified status or commit identity is claimed.",
        "evidence": [evidence(name) for name in ["baseline-core", "baseline-sskr", "baseline-labels", "baseline-staging"]]},
    "enhancements": {"changes": changes, "newOrdinaryTests": 58,
        "newTestFiles": ["test/startup-edges.test.ts", "test/sskr-boundaries.test.ts", "test/sskr-startup-gate.test.ts"],
        "checks": ["Exact encoders and decoders for all five forms at 12 and 24 words, plus numbering/length/checksum/Color Unicode/format refusals.",
                   "No-engine startup checks: published Bytewords, grouped quorum, incomplete/duplicate/mixed shares, corrupt transport checksum.",
                   "Before first SSKR operation/full self-test: official recovery, exact deterministic creation, incomplete quorum and bad digest with a valid CRC.",
                   "Supported and unsupported entropy sizes; malformed raw-engine policies; successful and failed known-answer cleanup and gate retries.",
                   "Successful reader assertions now prove the expected share is returned before testing cleanup; shared independent CRC helper removes a test-code copy."],
        "readme": "Requested MHFE link added after the introductory provenance paragraph, plus accurate quick/lazy self-test descriptions.",
        "ordinaryPassingTests": 198, "ordinaryPassingFiles": 8,
        "ordinaryCounts": [{"label": "new-tests-accepted", "tests": 58, "files": 3, "skipped": 0},
                           {"label": "regression-tests", "tests": 134, "files": 3, "skipped": 0},
                           {"label": "crc-regressions", "tests": 3, "files": 1, "skipped": 14},
                           {"label": "quick-composition", "tests": 3, "files": 1, "skipped": 4}],
        "countMeaning": "Disjoint ordinary passing tests across recorded development phases, each bound to its own source fingerprint. Original audit probes, timing calls, CLI smoke, skipped tests and the owner's earlier full/light suites are not counted.",
        "timing": profile,
        "timingMeaning": "Observed quick checks after imports: current samples 115.984–137.618 ms; lazy SSKR including engine initialization 12.910 ms. No launch-time, speedup or portable upper-bound claim.",
        "failedChecks": "Initial tests expected the wrong numbering text, wrongly required direct decoding to reject a bad checksum, and used a spread-sensitive Vitest array row. Those test assumptions were corrected without changing production validation; all failed logs retained. One attempted run was prevented at below 4 GiB available memory (exit 125).",
        "notFixes": "The three open findings are reproduced in the audit-only harness, not silently fixed by adding self-tests."},
    "artifactRelationship": {"baseline": "Built from the recorded c3da0615 snapshot before original/residual probes and timing; no alternate checkout created.",
        "final": "pnpm build at the final source fingerprint; artifact hashes recorded in final-environment and a real table command exercises the quick startup gate.",
        "hashes": environment["artifacts"], "wasmChanged": False,
        "limits": "No canonical Docker rebuild, executable build or release-artifact verification; retained WASM 0.1.6 is unchanged."},
    "browserHandover": {**handover, "evidenceSha256": digest(EVIDENCE / "handover-wallet-tools.json")},
    "limitations": ["PDF tests, rendering comparisons, full card generation and all full vector replays were not run at the owner's request.",
        "No full ordinary suite, long repair suites, full self-test command, dependency audit, Docker/WASM rebuild or paid CI was launched.",
        "No real browser integration or Windows/macOS/standalone executable run; host-neutral self-test changes require synchronization by the Wallet tools session.",
        "No commit, push, release, tag, history rewrite or edit to another project. Original AUD-014/AUD-015 records were not changed.",
        "No whole-tree proof that semantic repetition or every defect is absent. Zero detected lexical copies does not establish that.",
        "Memory erasure is best effort in JavaScript; probes observe owned typed arrays, not all strings/copies or inaccessible engine allocations.",
        "Reported 198 tests span explicit source phases; final changed comments/README/self-test detail text are not a new full test replay."],
    "summary": {"openMedium": 1, "openLow": 2, "newRootCauses": 1, "priorIdExtensions": 2,
        "releaseAccepted": False, "sourceChangesAuthorized": True,
        "conclusion": "Original remediation cases pass and startup coverage is stronger; three related edge defects remain open."},
    "evidenceStorage": "Raw logs, command records and snapshots remain local and ignored under AUD-016-evidence/. Published reports carry source and log hashes; harnesses are committed source candidates, not evidence."}
report = private(report)
(AUDITS / f"AUD-016-{DATE}.json").write_text(json.dumps(report, indent=2) + "\n")

lines = [f"# AUD-016 — {TITLE}", "", "## Record metadata", "",
         "- **Audit number:** 16.", f"- **Completed (UTC):** {DATE}.",
         "- **Reviewer:** Codex coordinator and two scoped source reviewers; exact model and effort not retained (null).",
         f"- **Reviewed HEAD:** `{end['commit']}`; large pre-existing uncommitted remediation tree.",
         f"- **Reviewed source:** `{start['fingerprint']}` (the claimed AUD-015 fix snapshot).",
         f"- **Final source:** `{end['fingerprint']}` after ten authorized source/test/README changes; no commit.",
         "- **Artifacts:** Fresh Linux Node build at the final source; retained SSKR WASM unchanged. No release verification.",
         "", "## Finding register", "",
         "| Finding / record ID | Category | Kind | Severity | Recorded status | Title |",
         "| --- | --- | --- | --- | --- | --- |"]
for row in findings:
    lines.append(f"| {row['id']} | {row['category']} | finding | {row['severity']} | open | {row['title']} |")
lines += ["", "## Review evidence", "", "### Scope and methodology", "",
          report["scope"], "", report["priorRemediationReview"]["result"], "",
          "The coordinator independently reproduced the reviewers' three findings on a fresh baseline build. The self-test additions are a separate authorized phase; they do not remedy those runtime findings. The 32 canonical check IDs below describe targeted evidence and gaps, not a full release audit.", "",
          "| Procedure file | SHA-256 |", "| --- | --- |"]
for name, value in report["procedureHashes"].items():
    lines.append(f"| `{name}` | `{value}` |")
lines += ["", "### Coverage ledger", "", "| Check ID | Category / logical group | Outcome | Evidence / gap reason |", "| --- | --- | --- | --- |"]
for row in ledger:
    lines.append(f"| {row['checkId']} | {row['category']} / {row['group']} | {row['outcome']} | {row['reason']} |")
lines += ["", "### Checks", "",
          "Commands run sequentially with a 768 MiB Node heap, a 4 GiB start threshold, a 3 GiB stop threshold and a 120-second command timeout. Every command records unchanged before/after source fingerprints. The JSON companion retains exact arguments, UTC times, memory samples, individual fingerprints and log hashes.", "",
          "| Recorded label and command | Outcome | Log SHA-256 |", "| --- | --- | --- |"]
for row in report["checks"]:
    command = shlex.join(row["command"]).replace("|", "&#124;").replace("`", "&#96;")
    lines.append(f"| {row['label']}: `{command}` | exit {row['exitCode']}; {row['stopReason'] or 'completed'} | `{row['logSha256']}` |")
lines += ["", "The disjoint ordinary tests total **198 passed in eight files**: 58 new tests, 134 nearest regressions, three filtered CRC/metadata cases (14 skipped) and three quick-composition cases (four skipped). The four baseline audit reproduction commands pass; these audit probes are counted separately. The residual harness deliberately exits 1 with five failed checks across three findings and a sixth changing-getter observation.", "",
          report["enhancements"]["failedChecks"], "", "### Findings", ""]
for row in findings:
    lines += [f"#### {row['id']} — {row['severity'].capitalize()} — {row['title']}", ""]
    fields = [("Category", row["category"]), ("Status", row["status"]),
              ("Release blocking", str(row["releaseBlocking"]).lower() + "; " + row["releaseBlockingReason"]),
              ("Affected files", "; ".join(f"`{r['path']}:{r['line']}` (`{r['sha256']}`)" for r in row["affectedFiles"])),
              ("Reproduction", row["reproduction"]), ("Expected behavior", row["expected"]),
              ("Observed behavior", row["observed"]), ("Impact", row["impact"]),
              ("Evidence", f"`{row['evidence']['log']}`, SHA-256 `{row['evidence']['sha256']}` (local only)."),
              ("Recommended fix", row["recommendedFix"]), ("Required verification", row["requiredVerification"])]
    lines += [f"- **{label}:** {value}" for label, value in fields] + [""]
lines += ["### Remediation and follow-up", "", "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
for row in findings:
    lines.append(f"| {row['id']} | open | Not fixed | Not run | residual-probes.mjs |")
lines += ["", "The earlier reports retain their historical statuses. All original AUD-015 reproduction cases now pass at the claimed snapshot; the two prior-ID extensions above record the remaining cancellation and exceptional-cleanup variants. The new medium public API regression is independent. This report does not change earlier records to verified.", "",
          "### Informational observations and recommendations", "",
          "An executable `mnemonic` getter can still return different phrases on two reads inside `splitBackup`. Deriving the held phrase from the captured normalized original would make this robust. The ordinary asynchronous request-edit case is fixed; this observation requires executable host code, not a passive JSON request.", "",
          "### Authorized self-test and test improvements", ""]
lines += [f"- {value}" for value in report["enhancements"]["checks"]]
lines += ["", "The new checks run in the shared host-neutral library. Engine-free checks compose into both quick and full self-tests; engine-dependent known answers run before first SSKR use or during the full self-test. The deterministic seed is public test data and is never production randomness. The existing guard that blocks secret processing after a self-test failure remains enforced.", "",
          "`representation-oracle.py` first reproduces the retained 12-word colors and Private Use Area codes, then independently derives the fixed 24-word answers. Normal tests deliberately corrupt encoder/decoder output and accept forbidden engine results to prove the self-tests can fail. Cleanup and retry assertions cover failed lazy gates as well as success.", "",
          report["enhancements"]["timingMeaning"], "", report["enhancements"]["readme"], "",
          "The self-test files, exact source fingerprint, test evidence and three open findings were sent to the Wallet tools session for synchronization. Delivery succeeded; consumer browser integration remains unverified.", "",
          "### Source, artifact and record bindings", "",
          "The JSON companion includes complete initial/final non-audit source SHA-256 manifests and the ten-file delta. Each intermediate command retains its own source fingerprint; the timing and 198-test totals must not be read as one full run on the final tree. Final changes after regression checks were the requested README wording, self-test descriptions and comments. The final build and CLI table command pass on the final fingerprint.", "",
          "| Artifact or historical record | SHA-256 |", "| --- | --- |"]
for name, value in {**report["artifactRelationship"]["hashes"], **HISTORICAL}.items():
    lines.append(f"| `{name}` | `{value}` |")
lines += ["", "### Assessment and limitations", "", report["summary"]["conclusion"], ""]
lines += [f"- {value}" for value in report["limitations"]]
lines += ["", report["evidenceStorage"], ""]
(AUDITS / f"AUD-016-{DATE}.md").write_text(private("\n".join(lines)))
index = AUDITS / "README.md"
text = index.read_text()
row = "| AUD-016 | 2026-10-12 | AUD-015 follow-up and fast representation/SSKR self-tests | Four original reproductions pass; one medium new API regression and two low prior-ID extensions remain open. 58 new tests; 198 targeted ordinary tests pass across recorded phases. No PDF, full vectors, commits or release acceptance. | [Report](AUD-016-2026-10-12.md), [JSON](AUD-016-2026-10-12.json), [harness scripts](AUD-016-harnesses/) |"
if "| AUD-016 |" in text:
    text = re.sub(r"^\| AUD-016 \|.*$", row, text, flags=re.MULTILINE)
else:
    anchor = next(line for line in text.splitlines() if line.startswith("| AUD-015 |"))
    text = text.replace(anchor, anchor + "\n" + row, 1)
index.write_text(text)
print(json.dumps({"audit": "AUD-016", "source": end["fingerprint"],
                  "findings": len(findings), "ordinaryTests": 198}))
