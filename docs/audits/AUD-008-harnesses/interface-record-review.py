#!/usr/bin/env python3
"""Retain AUD-008 interface coverage, verified counterexamples and exact local evidence hashes."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-008-evidence"
BASELINE = "767ee995a91e98c1f9bde6b7930147e352fc5cff"
SHARED = ROOT.parent / "multi-chain-wallet-tools"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def retained(name):
    return {"local": True, "path": name, "sha256": sha256(EVIDENCE / name)}


def read(name):
    return json.loads((EVIDENCE / name).read_text())


head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
assert head == BASELINE
assert subprocess.check_output(["git", "diff", "--name-only", "HEAD", "--", "src", "test", "vectors"], cwd=ROOT, text=True).strip() == ""
source_paths = [
    "src/cli/menu.ts", "src/cli/terminal-choice.ts", "src/cli/private-screen.ts",
    "src/cli/terminal-input.ts", "src/cli/command-line.ts", "src/cli/input.ts",
    "src/cli/decode-command.ts", "src/cli/encode-report.ts", "src/cli/encode-export.ts",
    "src/cli/qr-input.ts", "src/cli/qr-export.ts", "src/cli/recover-date-command.ts",
    "src/cli/recover-word-command.ts", "src/cli/sskr-command.ts", "src/cli/heir-sheet.ts",
    "src/export/templates.ts", "src/export/render.ts", "src/export/card-qr.ts",
    "src/export/collection-sheet.ts", "src/export/glass-cards.ts",
    "src/export/material-cards.ts", "src/export/business-cards.ts", "src/export/sskr-cards.ts",
    "src/export/individual-cards.ts", "src/export/card-session.ts", "src/export/image-export.ts",
]
source_manifest = {path: sha256(ROOT / path) for path in source_paths}
source_fingerprint = hashlib.sha256(json.dumps(source_manifest, sort_keys=True).encode()).hexdigest()
procedure_paths = [
    "docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
    "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json",
]
contract_results = read("interface-contracts-results.json")
narrow_results = read("interface-narrow-terminal-results.json")
artifact_results = read("interface-artifact-results.json")
assert len([item for item in contract_results if item["kind"] == "pass"]) == 5
assert narrow_results[0]["visibleSelectionMarkersAfterTwoDownKeys"] == 1
assert narrow_results[1]["visibleSelectionMarkersAfterTwoDownKeys"] == 3
assert artifact_results["actualPngQrBytesExact"] is True

commands = []
for label in ["interface-contracts", "interface-narrow-terminal", "interface-artifact"]:
    ledger = read(f"{label}.command.json")
    assert ledger["logSha256"] == sha256(EVIDENCE / f"{label}.log")
    commands.append({"label": label, **ledger, "evidence": retained(f"{label}.log")})

findings = [
    {
        "id": "AUD-008-UI001", "category": "UI", "kind": "finding",
        "title": "Menu redraw leaves stale selections when terminal lines wrap",
        "severity": "low", "status": "open", "releaseBlocking": False,
        "releaseBlockingReason": "The defect obscures navigation in narrow terminals; standard-width navigation and direct CLI commands remain usable.",
        "affectedFiles": [
            {"path": "src/cli/terminal-choice.ts", "lines": [10, 47, 49, 58, 63, 165, 166]},
        ],
        "reproduction": "Run the normal protected launcher in a 40-row by 40-column pseudo-terminal with NO_COLOR=1 and TERM=xterm. Press Down twice. Capture the actual output and replay its VT cursor/erase controls with terminal wrapping. A 120-column control is run first.",
        "expected": "Exactly one visible selection should represent the current choice after a redraw, including when the terminal is narrower than 78 columns.",
        "observed": "The 120-column capture has one selection marker. The 40-column capture has three visible selection markers after two Down keys, with old item rows left above the current menu. LINE_WIDTH is fixed at 78 and redrawFrom receives logical line counts, while labels and hints occupy multiple physical rows.",
        "impact": "A user in a narrow terminal sees conflicting selected tasks and repeated rows. The probe does not establish incorrect command dispatch or secret leakage.",
        "evidence": [retained("interface-narrow-terminal.log"), retained("interface-menu-40.raw.txt"), retained("interface-menu-40.screen.txt"), retained("interface-menu-120.screen.txt")],
        "recommendedFix": "Account for the actual terminal column count and wrapped physical rows, or lay out/truncate each row to the current width before counting rows for redraw. Handle terminal resize consistently.",
        "requiredVerification": "Repeat the real protected PTY probe at 120, 80, 60 and 40 columns, including arrow navigation, selection, Escape and a resize, and confirm one visible selection with no stale rows.",
    },
    {
        "id": "AUD-008-UI002", "category": "UI", "kind": "finding",
        "title": "Displayed equivalent command changes shell-sensitive filename arguments",
        "severity": "low", "status": "open", "releaseBlocking": False,
        "releaseBlockingReason": "The active menu executes an argv array safely; this defect affects the command string shown for copying and later use.",
        "affectedFiles": [{"path": "src/cli/menu.ts", "lines": [796, 797, 798, 837]}],
        "reproduction": "Call the production typedCommand with ['preview','--pdf','output/a$(printf b).pdf']. Run the returned command in Bash with a harmless mnemocode function that prints its arguments instead of rendering anything.",
        "expected": "The 'The same as:' command must preserve the exact filename literal when copied to a supported shell.",
        "observed": "typedCommand returns mnemocode preview --pdf \"output/a$(printf b).pdf\". Bash expands the substitution and passes output/ab.pdf instead of the requested literal filename. Double quotes escape only double-quote characters, leaving dollar signs, backticks and backslashes with shell meaning.",
        "impact": "Copying the offered command can change the output destination. The harmless printf probe proves substitution; it does not imply an attacker supplies filenames or that active menu execution evaluates shell text.",
        "evidence": [retained("interface-contracts.log"), retained("interface-contracts-results.json")],
        "recommendedFix": "Use a tested shell-quoting routine appropriate to the supported shell and platform, or clearly display an argv representation that is not presented as a copyable equivalent shell command.",
        "requiredVerification": "Round-trip synthetic filenames with spaces, dollar signs, literal substitutions, backticks, backslashes, quotes and Unicode through the displayed command in supported shells; confirm arguments match byte for byte and no expansion runs.",
    },
]

report = {
    "schemaVersion": 1, "auditId": "AUD-008", "auditNumber": 8,
    "date": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
    "title": "MnemoCode AUD-008 interface reviewer handoff",
    "reviewer": {"name": "Interface reviewer 4", "model": None, "reasoningEffort": None},
    "snapshot": {"commit": head, "commitComplete": True, "workingTree": "Production, test and vector files match baseline; concurrent AUD-008 harness work is untracked.", "sourceFingerprint": source_fingerprint},
    "scope": {
        "checkIds": ["CHECK-UI-001", "CHECK-UI-002", "CHECK-UI-003", "CHECK-API-003"],
        "surface": "Protected CLI/menu/private-screen flows; all five record/QR forms; source review of all 16 approved card designs and individual/collection/SSKR routes; recovery ambiguity and confirmation messages; heir date instructions; one actual A6 PDF/PNG/JPEG export.",
        "browserChecks": "not-applicable: MnemoCode has a terminal menu and card library, with no shipped browser UI.",
        "monetaryFields": "not-applicable: no monetary report, CSV or XLSX feature exists in MnemoCode.",
    },
    "procedureHashes": {path: sha256(SHARED / path) for path in procedure_paths},
    "sourceManifest": source_manifest,
    "checks": [
        {"checkId": "CHECK-UI-001", "category": "UI", "outcome": "failed", "method": "Real protected PTY capture at 120 and 40 columns with independent bounded VT replay; one actual A6 PNG viewed manually.", "evidence": [retained("interface-narrow-terminal.log"), retained("interface-artifact.log")], "findingIds": ["AUD-008-UI001"]},
        {"checkId": "CHECK-UI-002", "category": "UI", "outcome": "failed", "method": "Menu action/source trace and real terminal arrow navigation; production typedCommand copied into a harmless Bash argv dumper.", "evidence": [retained("interface-contracts.log"), retained("interface-narrow-terminal.log")], "findingIds": ["AUD-008-UI002"]},
        {"checkId": "CHECK-UI-003", "category": "UI", "outcome": "passed", "method": "Source review of private-screen eligibility, terminal input, alternate-screen cleanup, keyboard/back controls, help/recovery warnings and QR/photo/reference separation; public QR payload probes and one manual export inspection.", "evidence": [retained("interface-contracts.log"), retained("interface-artifact.log")], "limits": "This scoped pass excludes cross-platform terminal behavior, screen readers and comprehensive per-design visual acceptance. The coordinator owns the full terminal-input acceptance script."},
        {"checkId": "CHECK-API-003", "category": "API", "outcome": "passed", "method": "Actual protected CLI emits five MNC1 records and five standalone PNG QRs; independently decode each QR and restore every record and QR. One actual CLI collection PDF/PNG retains eight numbered references and exact selected payload; document metadata is empty; real JPEG adapter emits a JPEG container.", "evidence": [retained("interface-contracts.log"), retained("interface-artifact.log")], "counts": {"recordFormats": 5, "standaloneQrFormats": 5, "exactRecordRestorations": 5, "exactQrRestorations": 5, "actualCardDesigns": 1, "printedReferences": 8}},
    ],
    "commands": commands,
    "findings": findings,
    "observations": [],
    "optionalImprovements": [
        {"title": "Repeat wallet-comparison guidance at ordinary decode and Seedshift share restoration", "affectedFiles": ["src/cli/decode-command.ts:87", "src/cli/sskr-command.ts:503"], "evidence": [retained("interface-wrong-date.stdout.txt"), retained("interface-wrong-date.stderr.txt")], "observed": "Decoding the public fixture with 24-09-2026 instead of 23-09-2026 returns a different phrase and reports BIP39 checksum: valid plus the returned fingerprint, without a wallet-comparison warning. This is expected Seedshift mathematics. The help, README, recover-date/recover-word warning and heir sheet explain wrong-date ambiguity, so this is retained as an optional runtime-message improvement rather than a confirmed protocol defect.", "recommendation": "After a Seedshift decode or share restoration, remind the user that a valid checksum does not confirm the dates or wallet, and suggest comparison with retained fingerprint/address evidence."},
    ],
    "remediation": [],
    "limitations": [
        "Exact client model identifier and reasoning setting were unavailable and remain null.",
        "Only one real glass collection export was independently rendered and manually inspected; source review and coordinator-owned suite evidence cover other designs. No claim of exhaustive print, camera, color calibration or font acceptance is made.",
        "The actual PNG QR was independently decoded. JPEG output container and real adapter execution were checked, but its QR was not independently decoded.",
        "The narrow menu result uses real PTY output plus an audit-only minimal VT replay, not a native terminal screenshot; raw bytes and screen text are retained for review.",
        "The review did not repeat broad tests, Docker/reproducibility, cryptographic vector replays or the coordinator-owned full terminal script.",
        "No production/test/vector/dependency/workflow files were edited and no commit or push was performed.",
    ],
    "artifactEvidence": artifact_results,
    "manualVisualInspection": {"local": True, "path": "interface-card-images/page.png", "sha256": sha256(EVIDENCE / "interface-card-images/page.png"), "result": "Header, ordered numbered references and QR are legible and separated, with no clipped visible content at A6 portrait."},
    "harnessHashes": {path.name: sha256(path) for path in sorted((ROOT / "docs/audits/AUD-008-harnesses").glob("interface-*"))},
}
target = EVIDENCE / "interface-review.json"
target.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"review": str(target), "sha256": sha256(target), "findings": [item["id"] for item in findings], "sourceFingerprint": source_fingerprint}, indent=2))
