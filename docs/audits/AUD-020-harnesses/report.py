"""Export the sealed review and original local evidence into the workspace audit format."""

import datetime
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
AUDIT = "AUD-020"
STEM = AUDIT + "-2026-10-13"
EVIDENCE = AUDITS / (AUDIT + "-evidence")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publish(value):
    """Anonymize published metadata; leave original local evidence untouched."""
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s]+", "/home/user", value)
    if isinstance(value, list):
        return [publish(item) for item in value]
    if isinstance(value, dict):
        return {key: publish(item) for key, item in value.items()}
    return value


def write_json(path, value):
    with path.open("x") as out:
        out.write(json.dumps(value, indent=2) + "\n")


def coverage():
    """Apply every canonical procedure ID without extending targeted runtime coverage."""
    groups = {
        "SEC": [
            ("reviewed", "Independent threat model and phrase/date/share ownership trace."),
            ("reviewed", "Node and OS permission dispatch inspected; kernel guarantees not exercised."),
            ("reviewed", "Offline command boundaries inspected; no network or provider execution."),
            ("reviewed", "Changed adapters delegate to existing randomness/SSKR; full vectors excluded."),
            ("reviewed", "Input snapshots, redaction and buffer lifetimes traced; V8 string erasure unproved."),
            ("not-applicable", "This repository has no browser page; external host is outside this diff."),
            ("reviewed", "Bounded reads and search controls inspected; maximum-load cases not run."),
        ],
        "FUN": [
            ("passed", "Re-encoding tests cover checksum refusal, wrong dates and legacy last words."),
            ("reviewed", "Fingerprint and first-address routes exercised; every coin/profile not replayed."),
            ("not-applicable", "No BIP85/BIP38/message/Silent Payments change in the reviewed patch."),
            ("not-applicable", "No script/descriptor/Miniscript/multisig change in this patch."),
            ("not-applicable", "No transaction or PSBT feature in MnemoCode."),
            ("passed", "Re-encoding, record import/export and SSKR split covered by selected tests."),
            ("not-applicable", "MnemoCode has no connected discovery/provider/accounting service."),
        ],
        "API": [
            ("reviewed", "WalletCheck and host contracts inspected; warning loss is SEC001."),
            ("reviewed", "Confirmation and awaited host state inspected; no full cancellation suite replay."),
            ("reviewed", "Re-encoding export surface inspected; monetary fidelity is not applicable."),
            ("passed", "Selected record/format/SSKR cases and strict consumer composition passed."),
        ],
        "BLD": [
            ("passed", "pnpm check, fresh build and portable module tests passed."),
            ("not-run", "Only selected Linux Node tests and two PTY recipes; full matrix excluded."),
            ("reviewed", "No dependency or SSKR source update in the reviewed patch; no advisory scan."),
            ("not-run", "Canonical WASM/Docker byte replay is a release-level check and was excluded."),
            ("reviewed", "Changed executable/terminal scripts inspected; no executable or paid CI run."),
        ],
        "UI": [
            ("not-run", "No PDF/card/QR rendering or full gallery; owner resource constraint."),
            ("passed", "172 input/menu/help/composition tests and two focused PTY recipes passed."),
            ("failed", "Fingerprint warning omitted by re-encode (SEC001); private-screen PTY passed."),
        ],
        "ARC": [
            ("reviewed", "Core/front-end seams, ownership and browser-neutral imports inspected."),
            ("passed", "Existing copy gate found zero copies of at least 50 tokens in 260 source files."),
            ("reviewed", "Changed tests/comments traced; no independent full cryptographic oracle run."),
        ],
        "DOC": [
            ("reviewed", "Five changed documents and SECURITY.md checked against actual runtime limits."),
            ("reviewed", "Changed help/release/command descriptions inspected; no release acceptance."),
            ("passed", "Sealed artifacts and workspace report bindings checked; historical audits untouched."),
        ],
    }
    return [{"id": f"CHECK-{category}-{i:03}", "category": category,
             "outcome": outcome, "evidence": evidence}
            for category, items in groups.items()
            for i, (outcome, evidence) in enumerate(items, 1)]


def main(payload_path):
    md_path, json_path = AUDITS / (STEM + ".md"), AUDITS / (STEM + ".json")
    if md_path.exists() or json_path.exists():
        raise SystemExit("An existing audit report is never overwritten")
    payload = json.loads(payload_path.read_text())
    temporary, sealed = Path(payload["tempDir"]), Path(payload["scanDir"])
    snapshot = json.loads((temporary / "snapshot-initial.json").read_text())
    final = json.loads((temporary / "final-evidence.json").read_text())
    source = payload["source"]
    assert snapshot["sourceFingerprint"] == final["sourceFingerprint"] == source["sourceFingerprint"]
    assert final["changedSinceBaseline"] == []
    for item in payload["completedScan"]["artifacts"]:
        assert digest(sealed / item["path"]) == item["sha256"], item["path"]
    EVIDENCE.mkdir(exist_ok=True)
    for name in ["snapshot-initial.json", "final-evidence.json", "citation-validation.json", "tracked.patch"]:
        shutil.copyfile(temporary / name, EVIDENCE / name)
    checks = []
    for path in sorted((temporary / "artifacts").glob("*.command.json")):
        label = path.name.removesuffix(".command.json")
        record = json.loads(path.read_text())
        log = path.with_name(label + ".log")
        assert digest(log) == record["logSha256"]
        assert record["sourceBefore"] == record["sourceAfter"] == source["sourceFingerprint"]
        shutil.copyfile(path, EVIDENCE / path.name)
        shutil.copyfile(log, EVIDENCE / log.name)
        checks.append({"label": label, "command": record["command"],
                       "exitCode": record["exitCode"], "logSha256": record["logSha256"],
                       "minimumAvailableGiB": round(record["minimumAvailableBytes"] / 1024**3, 3),
                       "startedAt": record["startedAt"], "endedAt": record["endedAt"]})
    shutil.copyfile(payload_path, EVIDENCE / "payload.json")
    for name in ["scan-manifest.json", "findings.json", "coverage.json", "report.md", "threatmodel.md"]:
        shutil.copyfile(sealed / name, EVIDENCE / ("codex-" + name))
    files = snapshot["files"]
    live_drift = [entry["path"] for entry in files
                  if not (ROOT / entry["path"]).is_file()
                  or digest(ROOT / entry["path"]) != entry["sha256"]]
    drift = {"recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "changedSinceReviewedSnapshot": live_drift,
             "assessment": "Later concurrent edits are excluded; checks remain bound to the original snapshot."}
    write_json(EVIDENCE / "post-review-drift.json", drift)
    finding = {
        "id": AUDIT + "-SEC001", "category": "SEC", "kind": "finding",
        "title": "Re-encode drops the fingerprint filter warning", "severity": "low",
        "status": "open", "releaseBlocking": False,
        "evidence": {"locations": payload["finding"]["locations"],
                     "codeEvidence": payload["finding"]["codeEvidence"],
                     "log": "AUD-020-evidence/warning-probe.log",
                     "logSha256": next(x["logSha256"] for x in checks if x["label"] == "warning-probe")},
        "reproduction": "With the public BIP39 abandon x11 + about fixture and empty passphrase, run the warning.mjs harness against the fresh reviewed dist. The master fingerprint is 73c5da0a.",
        "expected": "Retain the library's FINGERPRINT_WARNING when presenting fingerprint-only confirmation.",
        "observed": "Library returns the warning; CLI exits 0, says the seed phrase is confirmed and omits the warning.",
        "impact": "Misleading recovery assurance. No fingerprint collision, substituted backup, theft or secret disclosure was demonstrated.",
        "recommendedFix": payload["finding"]["remediation"],
        "requiredVerification": payload["finding"]["remediationTests"],
        "taxonomy": payload["finding"]["taxonomy"],
        "confidence": payload["finding"]["confidence"],
        "counterEvidence": payload["finding"]["validation"]["counterEvidence"],
        "attackPath": payload["finding"]["attackPath"],
    }
    findings = json.loads((sealed / "findings.json").read_text())["findings"]
    manifest = json.loads((sealed / "scan-manifest.json").read_text())
    record = {
        "schemaVersion": 1, "auditId": AUDIT, "auditNumber": 20, "date": "2026-10-13",
        "title": "Security diff review of menu, input and re-encoding changes",
        "reviewer": {"name": "Codex coordinator with four independent scoped reviewers",
                     "model": payload["model"], "reasoningEffort": payload["reasoningEffort"],
                     "workerModel": None, "workerReasoningEffort": None},
        "snapshot": {"commit": snapshot["commit"], "commitComplete": False,
                     "workingTree": snapshot["workingTree"], "sourceFingerprint": source["sourceFingerprint"],
                     "capturedAt": snapshot["capturedAt"], "changedFiles": source["changedFiles"],
                     "changedFileHashes": [x for x in files if x["path"] in source["changedFiles"]],
                     "fingerprintMethod": "SHA-256 of compact JSON sorted path/SHA-256 entries for Git tracked and untracked non-ignored files, excluding docs/audits/; absent files excluded.",
                     "postReviewDrift": drift},
        "scope": {"mode": "working-tree security diff", "changedFileCount": 43,
                  "inventoryEntries": 28, "changedDocuments": 5, "changedTests": 10,
                  "productionEditsByReviewer": False,
                  "method": "Independent architecture/source review, candidate discovery, validation and attack-path calibration; targeted sequential runtime controls.",
                  "procedureFiles": source["procedures"]},
        "checks": {"ledger": coverage(), "commands": checks, "uniqueTestsPassed": 189,
                   "focusedPtyRecipesPassed": 2, "artifacts": final["artifacts"],
                   "memory": {"nodeHeapMiB": 768, "startReserveGiB": 4, "stopReserveGiB": 3,
                              "deadlineSeconds": 120, "minimumAvailableGiB": 3.846}},
        "findings": [finding], "observations": [],
        "remediation": [{"id": finding["id"], "status": "open", "fixCommit": None,
                         "verificationCommit": None, "evidence": "Original public fixture reproduces warning loss; no production fix in this review."}],
        "limitations": payload["limitations"] + [drift["assessment"]],
        "informationalRecommendations": [
            "Interactive re-encode retains write/process capabilities while output is unknown and later narrows Node permissions. Qualify this mode in protection claims; no input-to-execution bypass was demonstrated.",
            "Host callbacks and exposed result objects are trusted presentation APIs, not isolation boundaries. Immutable confirmation results may be considered separately; no cross-authority exploit established.",
            "Linux raster temporary-memory claims remain conditional on /dev/shm availability; fallback uses tmpdir(). This unchanged export path was not rendered here.",
            "Local remediation is preferred for this isolated warning defect. No architectural rewrite is justified by the validated finding alone.",
            "Startup follow-up: direct representations have 12/24-word exact answers and refusals, while intermediate 15/18/21-word Seedshift answers currently live in the full suite. Fixed published intermediate answers could improve quick-start coverage without rendering or expensive KDF work.",
            "SSKR is checked before feature use: exact creation, official grouped recovery, insufficient quorum and damaged-value refusal. Its feature-first-use known answer is 16-byte entropy; an independently verified fixed 32-byte answer would additionally cover the longest BIP39 phrase. All five entropy lengths are already exercised by ordinary SSKR tests. Existing deterministic 32-byte fixtures were generated by the pinned bridge and alone do not provide independent cryptographic validation.",
        ],
        "codexSecurity": {"scanId": payload["scanId"], "completedAt": payload["completedScan"]["completedAt"],
                          "snapshotDigest": payload["completedScan"]["target"]["snapshotDigest"],
                          "findingId": findings[0]["findingId"], "occurrenceId": findings[0]["occurrenceId"],
                          "candidateId": "candidate-32a21b807714cca1",
                          "artifacts": payload["completedScan"]["artifacts"],
                          "coverageSurfaceCount": 48,
                          "targetWarnings": ["Working-tree contents changed while the scan was running; results were saved for the original snapshot."],
                          "usage": manifest["scan"].get("usage")},
    }
    followup = EVIDENCE / "startup-followup.command.json"
    if followup.is_file():
        original = json.loads(followup.read_text())
        assert original["exitCode"] == 0
        assert digest(EVIDENCE / "startup-followup.log") == original["logSha256"]
        record["startupFollowup"] = {
            "label": "startup-followup",
            "command": original["command"], "testsPassed": 21, "exitCode": 0,
            "sourceBefore": original["sourceBefore"], "sourceAfter": original["sourceAfter"],
            "logSha256": original["logSha256"],
            "limitation": "Supplemental check after concurrent edits; separate from the sealed diff's 189 tests.",
        }
    portable = EVIDENCE / "portable-warning.command.json"
    if portable.is_file():
        original = json.loads(portable.read_text())
        assert original["exitCode"] == 0
        assert digest(EVIDENCE / "portable-warning.log") == original["logSha256"]
        record["portableProbeReplay"] = {
            "label": "portable-warning",
            **{key: original[key] for key in
               ["command", "exitCode", "sourceBefore", "sourceAfter", "logSha256"]},
            "limitation": "Later portable-harness replay, separate from original sealed evidence.",
        }
    completion = EVIDENCE / "completion-metadata.json"
    if completion.is_file():
        record["codexSecurity"]["usage"] = json.loads(completion.read_text())["usage"]
    record = publish(record)
    write_json(json_path, record)
    lines = [f"# {AUDIT} — {record['title']}", "", "## Record metadata", "",
             "- **Audit number:** 20.", "- **Completed (UTC):** 2026-10-13; sealed scan completed at " + payload["completedScan"]["completedAt"] + ".",
             "- **Reviewer:** Codex coordinator with independent architecture, re-encoding, protection and input reviewers.",
             f"- **Model / effort:** {payload['model']} / {payload['reasoningEffort']} for the coordinator; worker model/effort were not exposed and remain unknown.",
             f"- **Reviewed commit:** `{snapshot['commit']}` plus 43 pre-existing dirty-tree files.",
             f"- **Source fingerprint:** `{source['sourceFingerprint']}`; method and changed-file hashes are in the JSON companion.",
             "- **Working tree:** Review-only baseline; no production edits, commit, push, release or history rewrite. Generated dist was rebuilt locally.",
             "- **Later changes:** Concurrent edits appeared after the guarded checks. They are excluded from this review; the original source fingerprint is authoritative.",
             f"- **Codex Security:** scan `{payload['scanId']}`, sealed canonical artifacts retained; the generated plugin report remains unchanged.",
             "", "## Finding register", "",
             "| Finding ID | Category | Kind | Severity | Status | Title |",
             "| --- | --- | --- | --- | --- | --- |",
             f"| {finding['id']} | SEC | finding | low | open | {finding['title']} |",
             "", "## Review evidence", "", "### Scope and methodology", "",
             "This is a targeted security review of the working-tree patch, including untracked source: 28 source/config/script inventory entries, five documents and ten tests. Supporting core, wallet evidence, SSKR, permissions, secret input and private export contracts were traced. All 43 changed paths are listed and hashed in the JSON companion; the sealed plugin coverage has 48 surfaces. This is not a whole-repository audit or release acceptance.",
             "", "The review used the codex-security security-diff-scan workflow and the wallet-full-audit workspace reporting procedure. Architecture mapping, three disjoint source reviews, coordinator challenge, normal-path reproduction and attack-path calibration were completed. No real wallet material, collision search, remote provider request or paid CI was used.",
             "", "Canonical procedure identities:", "", "| Procedure | SHA-256 |", "| --- | --- |"]
    lines.extend(f"| `{p['path']}` | `{p['sha256']}` |" for p in source["procedures"])
    lines += ["", "### Coverage ledger", "",
              "The canonical CHECK IDs organize the requested patch scope. A reviewed row records source inspection, not an unexecuted full suite. Inapplicable features and runtime gaps are explicit.", "",
              "| Check ID | Outcome | Evidence / gap |", "| --- | --- | --- |"]
    lines.extend(f"| {x['id']} | {x['outcome']} | {x['evidence']} |" for x in coverage())
    lines += ["", "### Checks", "", "| Label / actual command | Exit | Outcome | Log SHA-256 |",
              "| --- | --- | --- | --- |"]
    meanings = {"source-check": "Sandbox failure: spawnSync git EPERM, original retained.",
                "source-check-unsandboxed": "Identical bounded rerun passed all check gates.",
                "targeted-build": "Fresh build passed.", "re-encode-tests": "10 passed, 7 failed with blank CLI output under sandbox; original retained.",
                "re-encode-tests-unsandboxed": "Identical bounded rerun: 17/17 passed.",
                "input-composition-tests": "Four files: 172/172 passed.",
                "warning-probe": "Warning omission reproduced; not a fixed-state assertion.",
                "re-encode-pty": "Two focused real terminal recipes passed."}
    for check in record["checks"]["commands"]:
        command = shlex.join(check["command"]).replace("|", "\\|")
        lines.append(f"| `{check['label']}` / `{command}` | {check['exitCode']} | {meanings[check['label']]} | `{check['logSha256']}` |")
    lines += ["", "The unique successful ordinary-test count is 189 (17 + 172); the initial ten successes are overlapping and are not counted again. PTY recipes are reported separately. No assertion was relaxed for the sandbox reruns. Native execution-layer failure is not a confirmed product vulnerability.",
              "", "Checks ran sequentially with a 768 MiB Node heap, 120-second limit, 4 GiB start reserve and termination below 3 GiB MemAvailable. Minimum observed available memory was 3.846 GiB; no guard terminated a check. The entire host, other processes, browser and maximum-load behavior were not certified.",
              "", "Fresh local build identities:", "", "| Artifact | SHA-256 |", "| --- | --- |"]
    lines.extend(f"| `{x['path']}` | `{x['sha256']}` |" for x in final["artifacts"])
    lines += ["", "### Findings", "", "#### AUD-020-SEC001 — Low — Re-encode drops the fingerprint filter warning", "",
              "- **Category / status:** SEC / open (CWE-345).",
              "- **Release blocking:** false for this bounded warning defect; this is not release approval.",
              "- **Affected files/builds:** `src/cli/re-encode-command.ts:333-343`, `src/core/re-encoding.ts:115-117`; Node CLI `re-encode`, command-line and interactive wallet confirmation.",
              "- **Reproduction:** Build the reviewed snapshot. Run `node docs/audits/AUD-020-harnesses/warning.mjs` with the included public BIP39 fixture (abandon x11, about; empty passphrase; fingerprint `73c5da0a`). Exit 0 reproduces the original omission. The published portable probe differs from the retained execution probe only in repository path and formatting.",
              "- **Expected behavior:** Forward the library's warning before reporting fingerprint-only confirmation; explain that a 32-bit fingerprint is a filter, not proof.",
              "- **Observed behavior:** Library match is true and includes `FINGERPRINT_WARNING`; CLI exits 0, says the seed phrase is confirmed and omits the warning.",
              "- **Impact:** Loss of recovery-assurance information. No forged fingerprint collision, substituted backup, theft or secret disclosure was demonstrated.",
              "- **Evidence:** Original `warning-probe.log` and command record; log SHA-256 `" + finding["evidence"]["logSha256"] + "`.",
              "- **Recommended fix:** " + finding["recommendedFix"],
              "- **Required verification:** Preserve encoded output and print the warning for the public fixture; keep address/public-key confirmation free of fingerprint-specific warnings; retain mismatch/wrong-date refusal and private-screen clearing.",
              "", "**Source-to-outcome trace.** Operator-selected old backup enters `ReEncoding.of`. Master fingerprint evidence (`src/core/wallet-evidence.ts:435-448`) returns the 32-bit match with the warning defined at `src/core/wallet-check.ts:119-120`. `confirmByWallet` validates the matched boolean; `walletConfirms` discards the warning and prints the success line. `runReEncode` then uses `confirmedPhrase()` at line 155 to invoke Encode.",
              "", "```typescript", payload["finding"]["codeEvidence"][0]["code"], "```",
              "", "**Validation and severity.** The same legitimate public fixture proves the warning is supplied and lost. README at the reviewed line 550 already calls fingerprints filters and recommends an address/public key; the new comment also acknowledges chance matches. A malicious-host callback is already trusted under the library model. The broader chosen-collision hypothesis was narrowed out: an independent fixed-target collision and practical work factor were not produced. Low severity reflects the verified message defect and offline, operator-mediated reachability. Concrete malicious-substitution evidence could change the assessment; restoring and qualifying the warning closes the demonstrated defect.",
              "", "### Remediation and follow-up", "", "| Finding | Status | Fix commit | Verification commit | Evidence |",
              "| --- | --- | --- | --- | --- |",
              "| AUD-020-SEC001 | open | None | None | Original reproduction; no production fix applied. |",
              "", "### Informational observations and recommendations", ""]
    lines.extend("- " + item for item in record["informationalRecommendations"])
    if "startupFollowup" in record:
        followup = record["startupFollowup"]
        lines += ["", "**User-requested startup follow-up.** `pnpm exec vitest run test/startup-edges.test.ts --maxWorkers=1 --no-file-parallelism` passed 21/21 tests without a renderer or full vector replay. The tests inject incorrect representation answers, lost refusals, wrong SSKR recovery/creation, accepted incomplete quorum, accepted damaged values and host failures, and check wiping. Log SHA-256: `" + followup["logSha256"] + "`. This is a later supplemental check on source fingerprint `" + followup["sourceBefore"] + "`, reported separately from the sealed diff. No startup checks were added or production code changed by this reviewer."]
    if "portableProbeReplay" in record:
        replay = record["portableProbeReplay"]
        lines += ["", "**Portable probe replay.** The published warning.mjs probe reproduces the same warning omission with exit 0. It is a later supplemental replay, with source fingerprint `" + replay["sourceBefore"] + "` and log SHA-256 `" + replay["logSha256"] + "`; it does not extend the sealed snapshot."]
    lines += ["", "### Assessment and limitations", "",
              "One low finding survived validation; no critical, high or medium finding was confirmed within the reviewed diff. Passed targeted checks establish those cases only.", ""]
    lines.extend("- " + item for item in record["limitations"])
    lines += ["", "The JSON companion carries the retained source/procedure/build/command hashes and sealed finding identity. Raw evidence remains local and ignored under `AUD-020-evidence/`; the harnesses are reproducible review tools. Historical records are unchanged. The report and its harnesses have not been committed.", ""]
    with md_path.open("x") as out:
        out.write(publish("\n".join(lines)))
    print(json.dumps({"auditId": AUDIT, "report": str(md_path), "json": str(json_path),
                      "findings": 1, "laterChangedPaths": len(live_drift)}))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
