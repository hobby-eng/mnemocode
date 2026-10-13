"""AUD-018: writes docs/audits/AUD-018-2026-10-12.md and .json from one set of data and the
recorded evidence, so that both records say the same.

    python3 docs/audits/AUD-018-harnesses/write-report.py

Reads the ignored docs/audits/AUD-018-evidence/ (command records, snapshots, environment); refuses
to overwrite an existing report. Published text keeps home paths out and times in UTC.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-018-evidence"
REPORT = AUDITS / "AUD-018-2026-10-12"
FIX_COMMIT = "368fd0c71cc89d04cdd720d5975b890fcb325b59"
RECORDS_COMMIT = "fa948b6a0ef651b14ce64d2dfc721b16d87f917d"


def load(name):
    return json.loads((EVIDENCE / name).read_text())


baseline = load("baseline-snapshot.json")
final = load("final-snapshot.json")
environment = load("environment.json")
procedure = load("procedure-hashes.json")
assert baseline["fingerprint"] == final["fingerprint"], "the source changed during the audit"

CHECKS = [
    ("source-check", "Toolchain pins, Markdown lists, copy gate (50 tokens, 245 files), four TypeScript configurations"),
    ("format-check", "Prettier over the repository (docs/audits excluded by design)"),
    ("build", "Fresh dist/ from the reviewed snapshot"),
    ("ordinary-tests", "93 files: 1,888 passed, 4 skipped by their own condition (slow seedshift-legacy-valid multi-pattern cases); 11 PDF-rendering files excluded"),
    ("cli-self-test", "Full CLI self-test: PASS, 7 public vectors, 75 representation round trips, small card/QR exports"),
    ("terminal-input", "Real pseudo-terminal: menu, hidden prompts, Ctrl+C paths: all passed"),
    ("package-contents", "npm pack dry run: 515 files; no test, harness or evidence file"),
    ("dependency-advisories", "pnpm audit --audit-level high: no known vulnerabilities"),
    ("private-reporting", "GitHub private vulnerability reporting: enabled (read-only API)"),
    ("readme-examples", "README command examples without secret prompt or PDF: 19 passed, 15 skipped, 2 failed (both need a file that a skipped secret-prompt example writes; see AUD-018-DOC001)"),
    ("probes", "AUD-018 probes: AUD-018-SEC001 reproduces (1 failed), its control passes (1 passed)"),
    ("record-integrity", "59 audit documents, 79 commit citations, 1,056 relative links: 14 citation problems (AUD-018-DOC002), 1 dead link (observation)"),
    ("sskr-manifest", "All 7 SSKR engine files match sskr-wasm/integrity.json; nothing unlisted"),
    ("short-copies", "Diagnostic copy scan at 35 tokens: 1 repetition, overload declarations (rejected as a copy)"),
    ("skipped-cases", "Names the 4 skipped tests: seedshift-legacy-valid, 12 words, several patterns (44 passed, 4 skipped in this file)"),
]


def check_rows():
    rows = []
    for label, summary in CHECKS:
        record = load(f"{label}.command.json")
        command = " ".join(record["command"])
        if label == "ordinary-tests":
            command = "npx vitest run --maxWorkers=2 --testTimeout=180000 <93 test files: every test/*.test.ts except the 11 PDF files of run-checks.sh>"
        rows.append({
            "label": label,
            "command": command,
            "exitCode": record["exitCode"],
            "startedAt": record["startedAt"],
            "endedAt": record["endedAt"],
            "summary": summary,
            "sourceUnchanged": record["sourceBefore"] == record["sourceAfter"] == baseline["fingerprint"],
            "evidence": {"log": f"AUD-018-evidence/{label}.log", "sha256": record["logSha256"], "localOnly": True},
        })
    return rows


LEDGER = [
    ("CHECK-SEC-001", "SEC / Threat model and ownership", "passed", "Secret inputs traced from argument, file, standard input, private screen and QR image to their consumers; see AUD-018-SEC001 for the QR path"),
    ("CHECK-SEC-002", "SEC / Permissions and offline isolation", "passed", "protection.ts and protection-flags.json read: permission model, no network, dropped child/write rights, core dumps off and read back; terminal check passed. No browser vault exists in MnemoCode"),
    ("CHECK-SEC-003", "SEC / Network egress", "passed", "No fetch, HTTP, socket, DNS or storage API in src/; the CLI runs without network permission"),
    ("CHECK-SEC-004", "SEC / Randomness and encryption", "passed", "Only node:crypto and crypto.getRandomValues; age X25519/scrypt at work factor 18; candidate-file admission ceilings recomputed independently (155,189,248 and 155,292,688 bytes)"),
    ("CHECK-SEC-005", "SEC / Secret exceptional paths", "failed", "AUD-018-SEC001: QR image input not wiped; text input, share readers and candidate admission wipe as documented"),
    ("CHECK-SEC-006", "SEC / Injection and persistence", "passed", "No DOM, dynamic code or browser storage; console output only in src/cli. Terminal escape sequences in echoed user text not separately probed"),
    ("CHECK-SEC-007", "SEC / Input and availability bounds", "passed", "Text 1 MiB, QR 16 MiB and 4096 px, 2^24 word combinations, 2^31 date attempts, candidate-file ceilings: README and constants agree; bounded reads count actual bytes"),
    ("CHECK-FUN-001", "FUN / BIP39 and representations", "passed", "Startup and full self-test vectors, ordinary tests, date and record edge probes"),
    ("CHECK-FUN-002", "FUN / Coin derivation", "passed", "Coin vectors in the self-test; README recover-date examples matched a native SegWit address, a zpub and an Ethereum address"),
    ("CHECK-FUN-003", "FUN / BIP85, BIP38, messages, Silent Payments", "not-applicable", "MnemoCode implements none of them"),
    ("CHECK-FUN-004", "FUN / Scripts and descriptors", "not-applicable", "Only address-script classification for wallet checks, covered by FUN-002; no descriptor, Miniscript or multisig compiler"),
    ("CHECK-FUN-005", "FUN / Transactions and PSBT", "not-applicable", "No transaction or PSBT feature"),
    ("CHECK-FUN-006", "FUN / Recovery and SSKR", "passed", "Published SSKR vectors, repair, joint repair and recovery suites in the ordinary run; full self-test"),
    ("CHECK-FUN-007", "FUN / Local address search", "passed", "Local bounded comparisons only; providers and accounting not applicable"),
    ("CHECK-API-001", "API / Runtime and dependency contracts", "passed", "All 54 package exports resolve in dist/; README library example runs; new CandidateFileAdmission API reviewed and tested"),
    ("CHECK-API-002", "API / Cancellation and ownership", "passed", "AUD-014 to AUD-017 regression suites and Ctrl+C terminal cases passed"),
    ("CHECK-API-003", "API / Export contracts", "skipped", "The 11 PDF-rendering test files, card goldens and check-card-output.mjs not run (owner's order); the self-test's small exports passed"),
    ("CHECK-API-004", "API / Codec interoperability", "passed", "Bytewords, UR, CBOR, representation and record round trips with literal vectors in the ordinary run"),
    ("CHECK-BLD-001", "BLD / Module composition", "passed", "Portable-module and strict-consumer checks; export map complete"),
    ("CHECK-BLD-002", "BLD / Portable source and matrix", "skipped", "Linux only; Windows, macOS and browser hosts not executed"),
    ("CHECK-BLD-003", "BLD / Pins, lockfile and notices", "passed", "Exact pins, frozen lockfile, toolchain pins and documented versions agree; advisory scan clean. No full transitive licence audit"),
    ("CHECK-BLD-004", "BLD / SSKR source and output freshness", "skipped", "Manifest matches all 7 files; no Docker rebuild (pnpm verify:sskr), so source-to-bytes reproducibility is not shown"),
    ("CHECK-BLD-005", "BLD / Workflows and artifacts", "skipped", "Workflows read: read-only default permissions, pinned actions, shared setup and terminal actions, concurrency; no executable build, CI run or release operation"),
    ("CHECK-UI-001", "UI / Terminal viewports", "skipped", "Pseudo-terminal at its default size only"),
    ("CHECK-UI-002", "UI / Terminal inputs and navigation", "passed", "verify-terminal-input.py passed; menu and prompt tests in the ordinary run"),
    ("CHECK-UI-003", "UI / Help and privacy", "passed", "Every README option exists in the commands' --help; private-screen tests passed"),
    ("CHECK-ARC-001", "ARC / Module and class ownership", "passed", "Writes only through export/private-file.ts; file system only in the CLI and Node adapters; candidate admission one owner for size and header rules"),
    ("CHECK-ARC-002", "ARC / Duplication and dead code", "passed", "Copy gate at 50 tokens passed; 35-token diagnostic found only overload declarations"),
    ("CHECK-ARC-003", "ARC / Tests and comments", "passed", "Regressions of AUD-014 to AUD-017 present and passing; the QR read path has no wipe regression (AUD-018-SEC001)"),
    ("CHECK-DOC-001", "DOC / Capabilities and warnings", "passed", "README, SECURITY and CANDIDATES claims on protection, swap, cloud folders, limits and candidate files match the code"),
    ("CHECK-DOC-002", "DOC / Commands, links and licensing", "failed", "AUD-018-DOC001: two README examples are refused by the CLI"),
    ("CHECK-DOC-003", "DOC / Audit records", "failed", "AUD-018-DOC002: historical citations that the current history does not hold"),
]


def finding(fid, category, severity, title, **fields):
    return {"id": fid, "category": category, "kind": "finding", "title": title, "severity": severity,
            "status": "open", "releaseBlocking": False, **fields}


FINDINGS = [
    finding(
        "AUD-018-SEC001", "SEC", "low",
        "A QR image read as secret input leaves its file bytes and decoded pixels unwiped",
        releaseBlockingReason="Low: needs access to the process memory; the decoded text itself cannot be wiped in JavaScript.",
        affectedFiles=["src/cli/qr-input.ts (decodeQrPngFile)", "src/cli/input.ts (--qr-file)",
                       "src/cli/sskr-restore-command.ts (--share-qr)", "src/cli/share-repair.ts",
                       "src/cli/date-search.ts"],
        reproduction="docs/audits/AUD-018-harnesses/probes.ts, first case: the public record MNC1:direct:indexes with eleven 1s and a 4 (abandon … about) is saved with exportQrPayload and read with decodeQrPngFile; the bytes that readFileOrRefuse hands over and the RGBA data that pngjs decodes are captured.",
        expected="bounded-read.ts: \"the one copy returned is the caller's to wipe\"; SECURITY.md: temporary copies of the phrase data are cleared as far as possible. The text reader does so (input.ts decodedText), as the probe's control shows.",
        observed="After a successful read both buffers still hold their content: fileWiped false, pixelsWiped false. The control (readBoundedTextFile) wipes its bytes.",
        impact="An encoded record or a share given as a QR image stays in the heap as PNG bytes (up to 16 MiB) and as decoded pixels (about 2 MB for a 720-pixel code) until the memory is reused. Core dumps are off and the permission model applies, so reading it needs access to the process memory, swap or a hibernation image. jsQR's own working copies and the decoded string cannot be wiped.",
        evidence="AUD-018-evidence/probes.log (local), probes.command.json exit 1",
        recommendedFix="In decodeQrPngFile, wipe the file bytes and image.data in a finally block, on success and refusal alike, as decodedText does for text; add the probe as a regression test.",
        requiredVerification="The probe's first case passes; the QR tests and the CLI self-test still pass.",
    ),
    finding(
        "AUD-018-DOC001", "DOC", "low",
        "README card and QR examples combine --ask-secrets with --dates, which the CLI refuses",
        releaseBlockingReason="Low: the edit is not committed; the committed README has no such example.",
        affectedFiles=["README.md (uncommitted edit), section Cards and QR codes, lines 321-331"],
        reproduction="node dist/mnemocode.js encode --mode seedshift --ask-secrets --dates 23-09-2026 --format 5 --cards < /dev/null; the same with --qr my-palette-qr.png. The decode --qr-file my-palette-qr.png example after them needs that file.",
        expected="Every README example runs as written; the README's own table says that --ask-secrets asks for the dates on the private screen.",
        observed="Both refused before any prompt: \"mnemocode: --ask-secrets cannot be combined with --dates.\", exit 1. The committed README (HEAD) has no example that combines them: the uncommitted edit added them.",
        impact="A person who follows the examples gets an error and may move the phrase to --mnemonic, where the shell history keeps it. No secret is exposed by the tool itself.",
        evidence="AUD-018-evidence/readme-examples.log (local); direct run recorded in this report",
        recommendedFix="Drop --dates 23-09-2026 from the two encode examples (the dates are asked on the private screen), or show the public --mnemonic form for a demonstration.",
        requiredVerification="readme-examples.py: the corrected commands pass, or are skipped only for their secret prompt; a manual run with the prompts confirms the QR round trip.",
    ),
    finding(
        "AUD-018-DOC002", "DOC", "low",
        "Audit records cite commits that the current history no longer holds",
        releaseBlockingReason="Low: findings and outcomes are unaffected; only the published snapshot references cannot be followed.",
        affectedFiles=["docs/audits/AUD-001-2026-09-27.md/.json and AUD-001-harnesses/README.md (f17c323…, b4f334f…, 5547c9e…)",
                       "docs/audits/AUD-002-2026-09-27.md/.json and AUD-002-harnesses/README.md (b4f334f…, 5547c9e…)",
                       "docs/audits/README.md (b4f334f…, 5547c9e…)",
                       "docs/audits/AUD-010-2026-10-07.md/.json (multi-chain-wallet-tools c76141f…)"],
        reproduction="python3 docs/audits/AUD-018-harnesses/record-integrity.py; git merge-base --is-ancestor <commit> HEAD for each cited commit.",
        expected="AGENTS.md: a commit that an audit record names is changed only together with that record, whose hashes are then updated. CHECK-DOC-003: cross-report references resolve.",
        observed="14 citations of four commits do not resolve. b4f334f… and 5547c9e… (MnemoCode) are reachable only from local backup refs, not from main or origin; their counterparts with the same subject are 6d9100e… and 2705bf1…. f17c323… has no counterpart with the same subject. c76141f… is not an ancestor of multi-chain-wallet-tools HEAD.",
        impact="A reader cannot check the AUD-001 and AUD-002 reviewed and fixed snapshots on GitHub, nor AUD-010's schema reference.",
        evidence="AUD-018-evidence/record-integrity.log (local)",
        recommendedFix="With the owner's decision: cite the current counterparts (6d9100e29922ae3bcc964989fdedc93710ff56ef and 2705bf15558bd760daadf189fbf0ed727446eae7), say for f17c323… that the reviewed snapshot is not published, and cite multi-chain's current commit of the schema in AUD-010.",
        requiredVerification="record-integrity.py reports no citation problem.",
    ),
]

PRIOR = [
    ("AUD-014-SEC001", FIX_COMMIT), ("AUD-014-SEC002", FIX_COMMIT), ("AUD-014-FUN001", FIX_COMMIT),
    ("AUD-014-FUN002", FIX_COMMIT), ("AUD-014-FUN003", FIX_COMMIT),
    *[(f"AUD-014-API{n:03d}", FIX_COMMIT) for n in range(1, 13)],
    ("AUD-001-API001", FIX_COMMIT), ("AUD-012-SEC004", FIX_COMMIT),
    ("AUD-015-API001", FIX_COMMIT), ("AUD-015-API002", FIX_COMMIT), ("AUD-015-API003", FIX_COMMIT),
    ("AUD-015-UI001", FIX_COMMIT), ("AUD-015-SEC001", FIX_COMMIT), ("AUD-016-API001", FIX_COMMIT),
    ("AUD-017-DOC001", RECORDS_COMMIT),
]
PRIOR_EVIDENCE = ("Fix committed. Its regression tests (test/aud-014-*.test.ts, aud-015, aud-016, aud-017, "
                  "or the AUD-017 records for DOC001) passed in AUD-018 ordinary-tests. Not verified: the "
                  "snapshot is uncommitted, and the PDF test files and the render comparison were not run.")
REMEDIATION = [
    {"id": fid, "status": "fixed", "fixCommit": commit, "verificationCommit": None, "evidence": PRIOR_EVIDENCE}
    for fid, commit in PRIOR
] + [
    {"id": f["id"], "status": "open", "fixCommit": None, "verificationCommit": None, "evidence": "Original reproduction"}
    for f in FINDINGS
]

NOTES = [
    "AUD-012's report links ../../src/export/glass-layout.ts#L23, a file removed in 368fd0c; the link pointed at the reviewed state. Future reports should link a commit-pinned URL.",
    "docs/audits/README.md is shipped in the package (package.json files), but the records it links are not, so its links are dead inside an installed package.",
    "The 35-token copy diagnostic found only the overload signatures of askOrCancel in src/cli/ask.ts: declarations, not behaviour.",
    "publishNewFolder checks the target with absentPath and then renames the staging folder; POSIX rename replaces an empty folder that another local process creates in between. Only an empty folder can be replaced; not reported as a finding.",
    "Rendered PDFs and written QR images are not wiped after they are saved: pdf-lib and qrcode keep their own copies, and the documents describe wiping only for the byte arrays a part owns.",
    "Harness mistake, kept in the evidence: the first run-checks.sh put --timeout before the label, so two checks did not start (an empty local --timeout.log and a refused label). Corrected and run under their own labels; no result was lost.",
    "The candidate-file admission change (another session's work, reviewed before this audit) has its 34 tests in the ordinary run; its ceilings were recomputed by hand and agree.",
]

LIMITATIONS = [
    "Single reviewer (Claude Code, no subagents, no independent skeptic) at the owner's request.",
    "Not run: the 11 PDF-rendering test files, card goldens, check-card-output.mjs, the Docker rebuild of the SSKR engine, the executable build, Windows and macOS, CI, and any release step.",
    "The README examples that ask for secrets or draw PDFs were not run.",
    "The source review was risk-based: input and file boundaries, process protection, randomness and encryption, the candidate-file change, the newest remediation code, documents and records; not every line of the 43,000 lines of source was read.",
    "The snapshot includes another agent's uncommitted README edit and the uncommitted candidate-file admission change.",
]

TITLE = "Full-scope MnemoCode audit after the committed refactor, with the candidate-file admission change"


def json_record():
    return {
        "schemaVersion": 1,
        "auditId": "AUD-018",
        "auditNumber": 18,
        "date": "2026-10-12",
        "title": TITLE,
        "reviewer": {"name": "Claude Code, single reviewer", "model": "claude-opus-5-5", "reasoningEffort": None},
        "snapshot": {
            "commit": baseline["commit"],
            "commitComplete": True,
            "workingTree": baseline["workingTree"].splitlines(),
            "sourceFingerprint": baseline["fingerprint"],
            "sourceFingerprintMethod": "SHA-256 of the JSON list of {path, sha256} of every tracked or untracked, not ignored file outside docs/audits/ (audit.py source)",
            "uncommittedDiffSha256": baseline["uncommittedDiffSha256"],
            "capturedAt": baseline["capturedAt"],
            "finalCheckAt": final["capturedAt"],
            "files": len(baseline["files"]),
        },
        "scope": "Full scope of the 32 CHECK items, executed in part: the committed library, CLI, cards, SSKR engine, workflows, documents and audit records at fa948b6, with the uncommitted candidate-file admission change and README edit. Review only: no production, test or document change.",
        "procedureHashes": procedure,
        "environment": {
            "os": environment["os"],
            "node": environment["tools"][0]["output"],
            "pnpm": environment["tools"][1]["output"],
            "python": environment["tools"][2]["output"],
            "installedPackages": environment["installedPackages"],
            "lockfileSha256": environment["lockfileSha256"],
        },
        "checks": check_rows(),
        "coverageLedger": [
            {"checkId": cid, "group": group, "outcome": outcome, "method": method}
            for cid, group, outcome, method in LEDGER
        ],
        "findings": FINDINGS,
        "observations": [],
        "informationalNotes": NOTES,
        "remediation": REMEDIATION,
        "limitations": LIMITATIONS,
        "summary": {"findings": {"low": 3}, "releaseBlocking": 0, "ordinaryTestsPassed": 1888,
                    "ordinaryTestsSkipped": 4, "ordinaryTestFiles": 93},
    }


def markdown(record):
    lines = [f"# AUD-018 — {TITLE}", "", "## Record metadata", ""]
    lines += [
        f"- **Audit number:** 18.",
        f"- **Completed (UTC):** 2026-10-12; final snapshot {final['capturedAt']}.",
        "- **Reviewer:** Claude Code, single reviewer without subagents.",
        "- **Model:** claude-opus-5-5.",
        "- **Reasoning effort:** unknown.",
        "- **Reviewer phases:** one phase, one reviewer.",
        f"- **Reviewed commit:** `{baseline['commit']}`.",
        f"- **Working tree:** uncommitted candidate-file admission change (another session's work), its CHANGELOG and document lines, and another agent's README edit; diff SHA-256 `{baseline['uncommittedDiffSha256']}`.",
        f"- **Source fingerprint:** `{baseline['fingerprint']}` over {len(baseline['files'])} files, the same before every check and at the end.",
        "- **Artifacts:** fresh `dist/` from this snapshot; SSKR engine files hash-checked against their manifest, not rebuilt; no executable.",
        "",
        "## Finding register",
        "",
        "Three low findings; none is release blocking. No critical, high or medium finding.",
        "",
        "| Finding / record ID | Category | Kind | Severity | Recorded status | Title |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for f in FINDINGS:
        lines.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | {f['status']} | {f['title']} |")
    lines += ["", "## Review evidence", "", "### Scope and methodology", ""]
    lines += [
        record["scope"],
        "",
        f"Linux x86-64, Node {record['environment']['node']}, pnpm {record['environment']['pnpm']}, TypeScript {environment['installedPackages']['typescript']}, Vitest {environment['installedPackages']['vitest']}. Every command ran through `audit.py`, one at a time, with a 1,536 MiB Node heap and a 1.2 GiB host-memory reserve; none reached it. Raw logs and command records are local in the ignored `AUD-018-evidence/`.",
        "",
        "Method: the recorded checks below; source review of the input and file boundaries, process protection, randomness, encryption and candidate-file admission, the newest remediation code (wallet answers, missing-code search), documents and audit records; probes through production entry points with public data only.",
        "",
        "### Procedure identity",
        "",
        "| Procedure | SHA-256 |",
        "| --- | --- |",
    ]
    for name, value in procedure.items():
        lines.append(f"| `{name}` | `{value}` |")
    lines += ["", "### Coverage ledger", "", "| Check ID | Category / logical group | Outcome | Method / gap |", "| --- | --- | --- | --- |"]
    for row in record["coverageLedger"]:
        lines.append(f"| {row['checkId']} | {row['group']} | {row['outcome']} | {row['method']} |")
    lines += ["", "### Checks", "", "| Check | Exit | Result | Command |", "| --- | --- | --- | --- |"]
    for row in record["checks"]:
        lines.append(f"| {row['label']} | {row['exitCode']} | {row['summary']} | `{row['command']}` |")
    lines += ["", "Logs and their SHA-256 values are in the JSON record; the logs themselves stay local.", "", "### Findings", ""]
    for f in FINDINGS:
        lines += [
            f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}",
            "",
            f"- **Category:** {f['category']}.",
            f"- **Severity:** {f['severity']}.",
            f"- **Status:** {f['status']}.",
            f"- **Release blocking:** false; {f['releaseBlockingReason']}",
            f"- **Affected files and builds:** {'; '.join(f['affectedFiles'])}.",
            f"- **Reproduction:** {f['reproduction']}",
            f"- **Expected behavior:** {f['expected']}",
            f"- **Observed behavior:** {f['observed']}",
            f"- **Impact:** {f['impact']}",
            f"- **Evidence:** {f['evidence']}.",
            f"- **Recommended fix:** {f['recommendedFix']}",
            f"- **Required verification:** {f['requiredVerification']}",
            "",
        ]
    lines += ["### Remediation and follow-up", "", "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
    for row in REMEDIATION:
        commit = f"`{row['fixCommit'][:12]}`" if row["fixCommit"] else "Not fixed"
        evidence = "See note below" if row["fixCommit"] else row["evidence"]
        lines.append(f"| {row['id']} | {row['status']} | {commit} | Not verified | {evidence} |")
    lines += ["", f"Note for the earlier findings: {PRIOR_EVIDENCE}", "", "### Informational observations and recommendations", ""]
    lines += [f"- {note}" for note in NOTES]
    lines += ["", "### Assessment and limitations", ""]
    lines += [
        "The source, build, ordinary tests, full CLI self-test, real terminal check, package contents and advisory scan pass at this snapshot. The three findings are low: one secret-lifecycle gap on the QR input path, two documentation and record defects. The earlier findings of AUD-014 to AUD-017 are fixed in commits and their regressions pass, but stay unverified until the PDF tests and the render comparison run at a commit.",
        "",
    ]
    lines += [f"- {item}" for item in LIMITATIONS]
    lines += ["", "This is not a release acceptance or a security certification."]
    return "\n".join(lines) + "\n"


def main():
    record = json_record()
    for suffix, text in [(".json", json.dumps(record, indent=2) + "\n"), (".md", markdown(record))]:
        with REPORT.with_suffix(suffix).open("x") as out:
            out.write(text)
    print("written", REPORT.with_suffix(".md").name, REPORT.with_suffix(".json").name)


if __name__ == "__main__":
    main()
