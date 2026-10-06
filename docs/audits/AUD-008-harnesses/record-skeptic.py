#!/usr/bin/env python3
"""Record the coordinator's sixth review role; no production edits or new tests."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"


def main():
    snapshot = json.loads((EVIDENCE / "snapshot.json").read_text())
    inventory = json.loads((EVIDENCE / "skeptic-document-inventory.json").read_text())
    paths = inventory["documentFileLinkScan"]["files"] + [
        "src/index.ts", "src/core.ts", "src/core/candidates.ts",
        "src/core/date-recovery.ts", "src/bitcoin-evidence.ts",
        "src/sskr/shares.ts", "src/sskr/repair.ts", "src/sskr/joint-repair.ts",
        "src/cli/recover-date-command.ts", "src/cli/private-screen.ts",
        "src/cli/menu.ts", "src/cli/terminal-choice.ts",
        "scripts/build-executable.mjs", "package.json",
    ]
    finding = {
        "candidateId": "documentation-permission-model",
        "category": "DOC",
        "title": "Security policy gives conflicting descriptions of CLI permission restrictions",
        "severity": "low",
        "status": "open",
        "releaseBlocking": False,
        "releaseBlockingReason": "Documentation ambiguity; the canonical launcher denied the reviewed scopes.",
        "affectedFiles": [{"path": "SECURITY.md", "lines": [23, 31, 37, 42]}],
        "reproduction": "Read Security model alongside Secret lifecycle and local boundaries. Compare with the canonical CLI permission observation and its explicitly granted-rights control.",
        "expected": "Distinguish the normal CLI's Node permission restrictions from an unisolated library host and from operating-system isolation. State whether deliberate launch grants are trusted.",
        "observed": "The first description says the program runs with the starting Node process's file/process/network rights, while the later one says it always denies network/workers/addons. Normal relaunch denies them, but explicitly pre-granted rights survive. The library-host warning itself remains correct.",
        "impact": "Readers receive inconsistent descriptions of what the launcher enforces. No default network transmission or malicious-code isolation guarantee is established.",
        "evidence": ["SECURITY.md", "security-permissions-complete.log"],
        "recommendedFix": "Describe the normal CLI restriction and library-host responsibilities separately, retain the trusted offline-computer requirement, and qualify intentional permission overrides unless the launcher explicitly drops them.",
        "requiredVerification": "Check the revised wording against normal-launch and intentionally pre-granted scope probes. Do not imply an OS sandbox or remove the offline warning.",
    }
    dispositions = [
        {"candidate": "date-recovery-cancellation", "decision": "confirmed", "severity": "medium", "reason": "Real supported CLI search and documented private-screen interrupt promise; synchronous source loop confirms PTY evidence."},
        {"candidate": "core-invalid-key-evidence", "decision": "confirmed", "severity": "medium", "reason": "CLI reachable. Independent OpenSSL rejects the same curve point; comparator silently returns non-match. WIF scalar range follows the same missing semantic validation."},
        {"candidate": "core-empty-word-place", "decision": "confirmed", "severity": "medium", "reason": "An empty readonly array is structurally valid; the reusable direct module hangs. It is not re-exported from the stable root facade and CLI parsing prevents this shape; those limits must remain explicit."},
        {"candidate": "core-invalid-mode", "decision": "confirmed, reduced severity", "severity": "low", "reason": "Only invalid runtime discriminants violate the TypeScript contract; correct modes and CLI paths pass. Runtime rejection is useful, but no normal-mode failure is demonstrated."},
        {"candidate": "core-passphrase-coercion", "decision": "confirmed, reduced severity", "severity": "low", "reason": "Native PBKDF2 interpolation differs from the previous dependency boundary. Malformed non-string host values are needed; CLI and valid string inputs remain correct."},
        {"candidate": "sskr-surplus-share", "decision": "confirmed", "severity": "medium", "reason": "Root independently altered another payload byte: the full set passes and the pair with that member fails. A valid quorum really does restore; the unsupported claim is that surplus backup members have thereby been validated. CRC-valid altered content is a prerequisite; ordinary CRC-detected typos are not silently accepted."},
        {"candidate": "sskr-legacy-repair", "decision": "confirmed", "severity": "medium", "reason": "Root confirmed an intact accepted legacy Bytewords member causes no-fit when another canonical member is marked. Accepted transport/repair contracts diverge. Legacy compatibility can be narrowed explicitly instead of mandated universally."},
        {"candidate": "AUD-008-UI001", "decision": "confirmed", "severity": "low", "reason": "Actual PTY output wraps; source redraw counts logical rows. Minimal VT replay is evidence with an explicit rendering limitation, not a screenshot."},
        {"candidate": "AUD-008-UI002", "decision": "confirmed", "severity": "low", "reason": "Double quotes permit shell expansion. Active menu execution passes an argv array safely; no attacker-controlled filename injection is alleged."},
        {"candidate": "devops-executable-build-failure", "decision": "confirmed", "severity": "low", "reason": "Exact-source mocked failure proves ordering and cleanup defects. Failed workflow steps do not publish; no actual SEA failure or fresh rebuild was run."},
        {"candidate": "documentation-permission-model", "decision": "confirmed", "severity": "low", "reason": "Source/control-backed internal description conflict."},
        {"candidate": "wrong-date-checksum-warning", "decision": "optional improvement", "reason": "README and heirs explicitly distinguish a valid checksum from correct dates. An immediate runtime reminder would help but no checksum guarantee or arithmetic defect is inferred."},
        {"candidate": "broader-permission-grants", "decision": "observation", "reason": "Requires deliberate trusted caller rights. Default launcher denies the scopes; no exfiltration."},
        {"candidate": "temporary-buffer-overwrites", "decision": "observation", "reason": "Missing wipes demonstrated under retained references; no production GC lifetime or cross-process memory disclosure established. Tighten ownership without claiming guaranteed JS erasure."},
        {"candidate": "package-document-allowlist", "decision": "observation", "reason": "Missing documents matter if package archives become a supported distribution; current private/repository distribution retains them."},
    ]
    report = {
        "auditId": "AUD-008",
        "reviewer": {"name": "Coordinator: documentation and skeptic (sixth role)", "model": None, "reasoningEffort": None},
        "coordinationLimit": "Five delegated reviewers plus the coordinator participated. A sixth delegated thread and a historical-thread continuation both failed with agent thread limit reached; no sixth independent subagent is claimed.",
        "snapshot": {"commit": snapshot["commit"], "sourceFingerprint": snapshot["sourceFingerprint"]},
        "coverage": [
            {"checkId": "CHECK-DOC-001", "outcome": "failed", "method": "Read current README/security/recovery/candidate/heirs descriptions against source, private-screen and permission evidence.", "evidence": "Permission-description finding; wrong-date warning and hidden-prompt example remain separate limited suggestions."},
            {"checkId": "CHECK-DOC-002", "outcome": "passed", "method": "Twelve relevant documents' local file targets resolve; actual menu, CLI and package outputs reviewed by interface/DevOps.", "limitations": "Remote URL reachability and all Markdown anchors were not validated; package allowlist omissions are conditional."},
            {"checkId": "CHECK-DOC-003", "outcome": "passed", "method": "All seven earlier canonical JSON records validate against the shared schema. Preserve old snapshots/remediation entries and reconcile this audit's logs/source hashes and candidate scopes.", "limitations": "Historical platform verification remains historical; this does not rerun prior release checks."},
            {"checkId": "CHECK-FUN-004", "outcome": "not-applicable", "reason": "No descriptor/Miniscript/multisig script construction or parsing. Simple supported Bitcoin address evidence is covered by FUN-002."},
            {"checkId": "CHECK-FUN-005", "outcome": "not-applicable", "reason": "No transaction or PSBT parser, signer, constructor or broadcaster."},
            {"checkId": "CHECK-FUN-007", "outcome": "not-applicable", "reason": "MnemoCode exports local candidates but performs no discovery scan, provider request, balance/proof/accounting or connected lookup. The external Discovery Scanner is outside this repository's audit."},
        ],
        "candidateFindings": [finding],
        "dispositions": dispositions,
        "inventory": inventory,
        "sourceHashes": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths},
        "limitations": [
            "The skeptic was the coordinator rather than a sixth independent delegated reviewer due to the tool thread cap.",
            "The first skeptic-checks run used incorrect result-field names; original source/log are retained and the corrected challenge run passes. That assertion failure is not a product finding.",
            "No production edits, full-suite replay, release rebuild, advisory scan, remote write, commit or push.",
        ],
    }
    (EVIDENCE / "documentation-skeptic-review.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"dispositions": len(dispositions), "coverage": len(report["coverage"]), "findings": 1}))


if __name__ == "__main__":
    main()
