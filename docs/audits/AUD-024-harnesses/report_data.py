"""The records of AUD-024, which make-report.py renders into the Markdown and JSON report."""

TITLE = "Compact audit of main after the coding-guide restructuring, with the AUD-022 fixes verified"
DATE = "2026-10-14"
REVIEWER = {
    "name": "Claude Code coordinator with five scoped reviewer agents and one skeptic agent per candidate finding",
    "model": "claude-opus-5-5",
    "reasoningEffort": None,
}
AUD022_SOURCE = {
    "commit": "870effe",
    "fingerprint": "89c0cf323e39545dcbb37b5f37027314cc3b39f57cf6cbfd9004bc2a7f34c68d",
    "note": "The tree of 870effe (a local object, not on any published branch) has the fingerprint that "
            "AUD-023 recorded for the source the AUD-022 remediation left. main's 8aa9b25 is 870effe "
            "with fixup commits of a cloud session folded in.",
}
PHASES = [
    {"phase": "coordinator", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "Snapshot, baseline commands, challenge of every candidate, report."},
    {"phase": "review: aud022-fixes", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "Fixes of AUD-022-SEC001, SEC002, FUN001-004, API001-002, UI001, BLD001, ARC001-002."},
    {"phase": "review: docs-tests", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "Fixes of AUD-022-DOC001-008; documents against code; audit records; test fidelity."},
    {"phase": "review: core", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "src/core and top-level modules since 870effe; BIP39, formats, wallet checks, encodings, candidate encryption, PNG bounds."},
    {"phase": "review: sskr-export", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "src/sskr, sskr-wasm and src/export since 870effe; the CORE-15 splits; wipes; exports; the rebuilt WASM."},
    {"phase": "review: cli-build", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "src/cli, scripts, workflows, package manifest and the guide's gates since 870effe; the Windows raw-mode fix."},
    {"phase": "challenge", "model": "claude-opus-5-5", "reasoningEffort": None,
     "scope": "Eight skeptic agents, one per candidate finding, each told to refute it; all eight confirmed, one re-rated from medium to low."},
]


def metadata(snapshot):
    return [
        ("Audit number", "24."),
        ("Completed (UTC)", DATE + "."),
        ("Reviewer", REVIEWER["name"] + "."),
        ("Model", "claude-opus-5-5 for the coordinator and every agent."),
        ("Reasoning effort", "unknown; the client does not retain it."),
        ("Reviewer phases", "coordinator; five reviewers (AUD-022 fixes; documents and tests; core; SSKR and export; "
                            "command line, build and gates); eight skeptics, one per candidate finding."),
        ("Reviewed commit", f"`{snapshot['commit']}` (main, one local fixup commit after `a03862c2d3f161b1b150498e3b69784f53e198ee`); working tree clean."),
        ("Source fingerprint", f"`{snapshot['sourceFingerprint']}` over {snapshot['fileCount']} files, by the method of AUD-020 to AUD-023; "
                               "unchanged at the end of the baseline."),
        ("Snapshot captured (UTC)", snapshot["capturedAt"] + "."),
        ("Base of the change review", "`870effe`, whose tree is the source that the AUD-022 remediation left (fingerprint "
                                      "`89c0cf323e39545dcbb37b5f37027314cc3b39f57cf6cbfd9004bc2a7f34c68d`, the value AUD-023 recorded); "
                                      "a local object, folded into main's `8aa9b25` with later fixups."),
        ("Artifacts", "a fresh dist/ build from the snapshot; no executable built locally (CI built and checked the three "
                      "executables at `a03862c`)."),
        ("Verdict", "**PASS with findings**: the suite, the gates, the self-test, the terminal checks and the "
                    "reproducibility check pass; all 20 AUD-022 findings are verified; eight new low findings, none release blocking. "
                    "All eight were fixed afterwards, with this record, not verified ([Remediation addendum](#remediation-addendum-2026-10-14-utc)). "
                    "Release acceptance is not established (see Assessment)."),
    ]


SCOPE_TEXT = [
    "A compact ordinary audit at the owner's request for a short one. The review covered what changed since the "
    "source that the AUD-022 remediation left (`git diff 870effe ee4499e`: 335 files outside docs/audits, 182 of them "
    "in src): the coding-guide restructuring (TS-01 compiler flags, TS-03 checks instead of non-null assertions, "
    "the lint and code-rules gates, CORE-15 module splits), the SSKR crate's lints with its rebuilt WASM, a cloud "
    "session's changes (QR image limits, shared test helpers), the Windows raw-mode fix and oxlint 1.88.0; and it "
    "verified the fixes of all 20 AUD-022 findings. Code unchanged since AUD-022 was not reviewed again.",
    "",
    "The coordinator ran every command once, one at a time, and challenged each candidate finding through a skeptic "
    "agent told to refute it. It then reproduced four findings with harnesses of its own (FUN001, API001, BLD001, BLD002) and ran the reproduction commands of ARC002, DOC001 and DOC002 itself; ARC001 rests on the reviewer's mutant run, repeated by its skeptic. Five reviewer agents "
    "had distinct scopes, made no change in the checkout and ran only single test files and small probes. Public "
    "fixtures only: the BIP39 test phrase, the README examples and vectors/.",
    "",
    "Earlier findings are treated as a regression checklist through the verification of AUD-022; AUD-023 was started "
    "at 8de80e2 with the uncommitted remediation and never completed; this audit supersedes it at a new snapshot.",
]

CHECKS = [
    ("aud022-source", "python3 docs/audits/AUD-024-harnesses/source-at-commit.py 870effe 89c0cf32…",
     "The tree of 870effe has the fingerprint of the AUD-022 remediated source (469 files)."),
    ("lockfile-frozen", "pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only",
     "Lockfile agrees with package.json."),
    ("build", "pnpm build", "Fresh dist/ from the snapshot."),
    ("source", "pnpm check",
     "Toolchain pins, Markdown lists, release key, audit privacy and package listing, copies, code rules (514 files), "
     "oxlint 1.88.0, clippy and rustfmt of the SSKR crate, three tsc projects."),
    ("format", "pnpm format:check", "Prettier over the repository."),
    *[(f"tests-{part}", f"pnpm exec vitest run <{text}>", result) for part, text, result in [
        ("other", "96 test files without PDF generation, 4 workers", "96 files: 1,728 passed, 4 skipped."),
        ("pdf-01", "3 PDF-generating test files, batch 1", "72 passed."),
        ("pdf-02", "batch 2", "45 passed."),
        ("pdf-03", "batch 3", "28 passed."),
        ("pdf-04", "batch 4", "16 passed."),
        ("pdf-05", "batch 5", "59 passed."),
        ("pdf-06", "batch 6", "17 passed."),
        ("pdf-07", "batch 7", "59 passed."),
        ("pdf-08", "batch 8", "52 passed."),
        ("pdf-09", "batch 9", "80 passed."),
        ("pdf-10", "batch 10", "98 passed."),
        ("pdf-11", "batch 11", "49 passed."),
        ("pdf-12", "batch 12, one file", "11 passed."),
    ]],
    ("cli-self-test", "node dist/mnemocode.js self-test", "PASS: 7 public vectors, 75 representation round trips."),
    ("terminal-input", "python3 scripts/verify-terminal-input.py", "Every pseudo-terminal case of the menu and the private screen passed."),
    ("card-output", "node scripts/check-card-output.mjs docs/audits/AUD-024-evidence/card-output",
     "Card, material and SSKR PDFs rendered, QR codes read back exactly."),
    ("repair-leading-marks", "node docs/audits/AUD-022-harnesses/repair-leading-marks.mjs",
     "45 cases: none ends in \"do not fit\"; 18 keep a list of variants with the share among them or the refusal of 128-bit colors, "
     "the result the AUD-022 remediation recorded."),
    ("reencode-stdout", "python3 docs/audits/AUD-022-harnesses/reencode-stdout.py",
     "Confirmation asked, phrase on the private screen, absent from the redirected file."),
    ("aud021-fixed", "node docs/audits/AUD-022-harnesses/aud021-fixed.mjs", "Every check of the fixed state of AUD-021 passed."),
    ("sskr-independent", "python3 scripts/verify-sskr-known-answers.py",
     "Official BCR-2020-011 vector from every valid quorum, every deterministic set restored from every quorum."),
    ("seedshift-oracle", "python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py", "6,000 library comparisons, 0 failures."),
    ("sskr-reproducible", "pnpm verify:sskr",
     "Docker rebuild of the SSKR engine equals sskr-wasm/generated byte for byte."),
    ("dependency-advisories", "pnpm audit --audit-level high", "No known vulnerabilities."),
    ("package-manifest", "npm pack --dry-run --json --ignore-scripts", "924 files, 5,007,914 bytes; no evidence folder, output or release file."),
    ("records-schema", "python3 docs/audits/AUD-022-harnesses/validate-records.py",
     "Every docs/audits/AUD-*.json record valid against the workspace schema, no duplicate keys, finding IDs in both twins, this report included."),
    ("probe-truncated-share", "node docs/audits/AUD-024-harnesses/truncated-share.mjs",
     "Exit 1 as the finding expects: five CRC-valid truncated records blamed on MnemoCode (AUD-024-FUN001)."),
    ("probe-entry-types", "bash docs/audits/AUD-024-harnesses/entry-types.sh",
     "Exit 1 as the finding expects: seven names missing from mnemocode/sskr/joint-repair (AUD-024-API001)."),
    ("probe-code-rules-gaps", "bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh",
     "Exit 1 as the findings expect: four violating cases pass the gate, both controls pass (AUD-024-BLD001, BLD002)."),
]
# The probes of this audit's findings fail while the defects exist; that is their expected outcome.
EXPECTED_FAILURES = {"probe-truncated-share": "failed (expected)", "probe-entry-types": "failed (expected)",
                     "probe-code-rules-gaps": "failed (expected)"}
CHECKS_NOTES = [
    "Suite total in parts: 2,414 passed and 4 skipped in 130 files, every part exit 0; no part was rerun.",
    "",
    "Not run locally, taken from CI at `a03862c2d3f161b1b150498e3b69784f53e198ee` (the reviewed commit differs only in "
    "docs/releases/v0.1.0.md): workflow CI run 38560572717 (`verify`, `portable (macos-15)`, `portable (windows-2025)`, all "
    "success, with the pseudo-terminal check on each) and workflow Executable run 38560572551 (`build` on ubuntu-24.04, "
    "macos-15 and windows-2025, success, each with its executable's pseudo-terminal check).",
    "",
    "Reviewer agents ran, each once: test/aud-022.test.ts (22), re-encode.test.ts (19), audit-privacy.test.ts (6), "
    "aud-002-remediation.test.ts (18), aud-021-security.test.ts (34), core.test.ts (73), ask-word-recovery.test.ts (11), "
    "sskr-integrity.test.ts and sskr-vectors.test.ts (20), all passed; scripts/verify-toolchain.mjs and the workspace's "
    "verify-action-pins.mjs exit 0; small probes kept in the local evidence (reviews/probes).",
]

LEDGER = [
    ("CHECK-SEC-001", "SEC / secret ownership", "passed", "No wipe, fill(0) or finally line removed in core; every removed wipe in src/sskr reappears in the split modules; terminal chunks still zeroed; owner types print nothing of the phrase (core and sskr-export reviewers)."),
    ("CHECK-SEC-002", "SEC / vault, CSP, sandbox", "not-applicable", "A command-line program without an iframe vault or CSP; its browser host is the multi-chain Deriver, outside this repository."),
    ("CHECK-SEC-003", "SEC / network and permission boundary", "passed", "protection-flags.json unchanged; neededPermissions, dropUnneeded and dropForMenu changed only by TS-03; no new network path. The Linux memory-locking removal (45c9f86) is documented."),
    ("CHECK-SEC-004", "SEC / randomness and encryption", "passed", "Age encryption of candidate lists: fresh identities, X25519 and passphrase round trips, wrong key and tampering refused with their codes (probe, all-zero entropy)."),
    ("CHECK-SEC-005", "SEC / lifecycle and exceptional paths", "passed", "Wipes kept through the splits and the TS-03 edits; planJointRepair still wipes in finally; the raw-mode fix keeps typed-ahead bytes wiped."),
    ("CHECK-SEC-006", "SEC / messages, logs, file names", "passed", "No new or changed message repeats typed text; defined() throws a fixed text."),
    ("CHECK-SEC-007", "SEC / input bounds", "passed", "PNG admission: 4096 px per side, 8 megapixels, 8-bit samples and the other refusals probed with independently built chunks; search bounds unchanged."),
    ("CHECK-FUN-001", "FUN / BIP39", "passed", "NFKD, case, spaces, 12 to 24 words, checksum and prefix refusals; checksum-valid Seedshift vectors 15 to 24 words."),
    ("CHECK-FUN-002", "FUN / fingerprint and wallet checks", "passed", "Master fingerprint 73c5da0a and the first BIP44/49/84/86 receiving addresses of the test phrase matched against literal published values."),
    ("CHECK-FUN-003", "FUN / BIP85, BIP38, messages, Silent Payments", "not-applicable", "Not implemented by MnemoCode."),
    ("CHECK-FUN-004", "FUN / scripts and descriptors", "not-applicable", "Not implemented by MnemoCode."),
    ("CHECK-FUN-005", "FUN / transactions and PSBT", "not-applicable", "Not implemented by MnemoCode."),
    ("CHECK-FUN-006", "FUN / recovery and backup formats", "failed", "All vectors in five forms, README examples, dates, MNC1, legacy; SSKR known answers and every quorum; the splits of repair and joint repair are moves. AUD-024-FUN001: truncated share CBOR blamed on MnemoCode."),
    ("CHECK-FUN-007", "FUN / discovery and providers", "not-applicable", "No provider or discovery code; candidate lists for the Scanner are covered by SEC-004 and API-003."),
    ("CHECK-API-001", "API / runtime contracts", "failed", "Error classes renamed to *Error with code (TS-06), consistent at run time and in the synced host copy; AUD-024-DOC001 (the host document names the removed field) and AUD-024-API001 (entry exports)."),
    ("CHECK-API-002", "API / async state and cancellation", "passed", "Raw mode left only after the read stops (32ae899); every withCtrlCWatch caller awaits; typed-ahead and Ctrl+C semantics unchanged; 13 terminal tests."),
    ("CHECK-API-003", "API / exports", "passed", "No expected value of an export test changed after 8aa9b25; card output check reads every QR back exactly."),
    ("CHECK-API-004", "API / encodings", "passed", "Colors, Color Unicode, Unicode codes, indexes and English read back to the vector; Array.from replaces string spreads with the same code points."),
    ("CHECK-BLD-001", "BLD / composition and entry points", "passed", "exports and files unchanged since 870effe; no new library module imports node:* or a new package; portable-modules test walks the split modules."),
    ("CHECK-BLD-002", "BLD / build matrix", "not-applicable", "One package and one executable per system; no feature matrix."),
    ("CHECK-BLD-003", "BLD / lockfile, pins, licenses, gates", "failed", "Frozen lockfile, exact versions and no advisories; .oxlintrc.json agrees with the guide; AUD-024-BLD001 and BLD002 (code-rules gaps)."),
    ("CHECK-BLD-004", "BLD / canonical WASM", "passed", "verify:sskr rebuilds the engine byte for byte; lib.rs changed only in doc comments; the WASM differs from 870effe's in two bytes (see observations)."),
    ("CHECK-BLD-005", "BLD / CI and release workflows", "passed", "Rust 1.99.0 pinned in three places and cross-checked; action pins match the table; permissions and concurrency set; CI at a03862c green on three systems. Release workflow not exercised (no tag)."),
    ("CHECK-UI-001", "UI / real files and viewports", "not-applicable", "No browser page in this repository; the terminal is covered under UI-002 and UI-003."),
    ("CHECK-UI-002", "UI / terminal navigation and questions", "passed", "Help pages identical apart from intended content changes; moved question code unchanged; pseudo-terminal checks on Linux here and on three systems in CI."),
    ("CHECK-UI-003", "UI / secret visibility", "passed", "Private screen, hidden input and the re-encode confirmation in the pseudo-terminal checks; the shortened re-encode notes fit their 37 columns."),
    ("CHECK-ARC-001", "ARC / ownership and imports", "failed", "No import cycle among the split modules; AUD-024-API001 (an entry lost the names of its results)."),
    ("CHECK-ARC-002", "ARC / duplication and dead code", "passed", "No duplicate bodies; no declaration defined twice; every split file under 800 lines."),
    ("CHECK-ARC-003", "ARC / tests and production-path fidelity", "failed", "Cases 1,449 to 1,478 and expect() calls 4,855 to 4,941 since 870effe; AUD-024-ARC001 and ARC002 (two regressions not guarded by the suite)."),
    ("CHECK-DOC-001", "DOC / capabilities and safety", "passed", "PNG limits agree across README, CHANGELOG, release notes and help; no overstated claim found in the changed documents."),
    ("CHECK-DOC-002", "DOC / commands, links, legal", "passed", "0 broken relative links or anchors; every absolute v0.1.0 link in the release notes has a local target; examples use current options."),
    ("CHECK-DOC-003", "DOC / audit records", "failed", "Index counts agree with the AUD-020 to AUD-022 records; AUD-024-DOC002 (the harness paragraph lists 4 of 22 folders)."),
]

FINDINGS = [
    dict(id="AUD-024-FUN001", category="FUN", severity="low", status="fixed", releaseBlocking=False,
         title="Truncated share CBOR is refused as a fault of MnemoCode instead of an invalid share",
         affectedFiles=["src/sskr/transport.ts:122", "src/sskr/transport.ts:126", "src/sskr/transport.ts:131", "src/core/defined.ts:1-16"],
         reproduction="`node docs/audits/AUD-024-harnesses/truncated-share.mjs` (five ur:sskr records whose CBOR is cut short and whose CRC32 is valid), or `node dist/mnemocode.js sskr-combine --share ur:sskr/hdrlprengr`.",
         expected="An input refusal, as at 870effe: \"Not an SSKR CBOR tag.\" or \"Invalid SSKR share byte string.\". src/core/defined.ts says a missing value is a fault of MnemoCode, never of its input.",
         observed="Every record throws \"MnemoCode expected a value that is not there: this is a fault of MnemoCode.\"; the CLI prints \"Share 1 cannot be read: mnemoCode expected a value that is not there…\" and exits 1. Commit bd4c948 (TS-03) replaced `cbor[1]!` and `cbor[offset++]!` by defined() on indexes that depend on the input.",
         impact="The share is still refused with the same exit code and nothing is accepted; the message blames the program instead of the share. Reachable only with a crafted or badly encoded record, since a typo fails the CRC32 first.",
         evidence="probe-truncated-share (exit 1, local log); sskr-export reviewer and skeptic probes against 870effe and HEAD (local only).",
         recommendedFix="In sharePayload check the length before each read and refuse with the existing messages; keep defined() for indexes the code guarantees.",
         requiredVerification="truncated-share.mjs exits 0; a test in test/sskr-boundaries.test.ts with these records fails before the fix and passes after it.",
         tags=["sskr", "ts-03", "regression"]),
    dict(id="AUD-024-API001", category="API", severity="low", status="fixed", releaseBlocking=False,
         title="The joint-repair entry no longer exports the types of its results after the CORE-15 split",
         affectedFiles=["src/sskr/joint-repair.ts:52-57", "src/sskr/joint-results.ts", "src/sskr/joint-solve.ts:41", "package.json (exports)"],
         reproduction="`bash docs/audits/AUD-024-harnesses/entry-types.sh`: a host project imports ElementHelp, JointAssessment, MarkedElement, RepairedSet, RepairedShares, ShareAssessment and DIGEST_BITS from mnemocode/sskr/joint-repair.",
         expected="The part's entry gives the same names as at 870effe; ARCHITECTURE.md and README say each part has an entry of its own that a host takes alone. A CORE-15 split is a move.",
         observed="tsc fails with TS2305/TS2459 for all seven names. Commit b0cf85e moved them into joint-results.ts and joint-solve.ts, which have no package entry, and only imported them back. Public declarations such as RepairReport.repairs(set: RepairedShares) and ShareSet.unsettled: MarkedElement[] now use types no entry exports.",
         impact="Compilation only: a host of the package cannot name these types (five can be derived from other exports); run-time behaviour is unchanged. The package is private and 0.1.0 unreleased; the multi-chain host compiles the synced sources and is not affected. A skeptic re-rated the reviewer's medium to low.",
         evidence="probe-entry-types (exit 1, local log); sskr-export reviewer's export comparison of every entry at 870effe and HEAD (local only).",
         recommendedFix="Re-export the six types from src/sskr/joint-repair.ts, and DIGEST_BITS or a recorded reason why it became internal; add a test that compares each entry's export names with a snapshot.",
         requiredVerification="entry-types.sh exits 0; the snapshot test fails on the current entry and passes after the fix.",
         tags=["sskr", "exports", "core-15"]),
    dict(id="AUD-024-BLD001", category="BLD", severity="low", status="fixed", releaseBlocking=False,
         title="code-rules passes a Python import that the script's existing requirements file does not pin",
         affectedFiles=["scripts/verify-code-rules.mjs:242-256", "test/code-rules.test.ts:77-93"],
         reproduction="`bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh`, case python-import-not-in-requirements: a script imports PIL and requests, and its requirements file pins only pillow with a hash.",
         expected="TOOL-03 (Check: code-rules): every non-standard package of a Python script is pinned with its hashes in the requirements file next to it.",
         observed="Exit 0. checkPythonPackages returns as soon as any candidate requirements file exists (line 249) and never compares its entries with the imports.",
         impact="A script can import an unpinned package and pass pnpm check while it has a requirements file. No current script does: the four requirements files cover their imports.",
         evidence="probe-code-rules-gaps (exit 1, local log); cli-build reviewer and skeptic probes (local only).",
         recommendedFix="Read the requirement names (normalised) and report each imported module none of them lists, with a small map for names that differ (PIL to pillow, fontTools to fonttools, winpty to pywinpty); add the case to test/code-rules.test.ts.",
         requiredVerification="code-rules-gaps.sh refuses the case; node scripts/verify-code-rules.mjs still exits 0 on the repository.",
         tags=["gates", "tool-03"]),
    dict(id="AUD-024-BLD002", category="BLD", severity="low", status="fixed", releaseBlocking=False,
         title="code-rules misses Cargo dependencies written as tables or dotted keys",
         affectedFiles=["scripts/verify-code-rules.mjs:296-312", "test/code-rules.test.ts:100-111"],
         reproduction="`bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh`, cases cargo-dependency-table (`[dependencies.serde]` with `version = \"1\"`), cargo-dev-dependency-table and cargo-dotted-key (`serde.version = \"1\"`).",
         expected="CORE-25 (Check: code-rules): every Cargo dependency is pinned with \"=x.y.z\".",
         observed="Exit 0 for all three. The section regex matches only names ending in dependencies, and the key regex does not take a dotted key, so the version inside is never read; the inline form is refused as it should be.",
         impact="A crate dependency added in table or dotted form with a range passes pnpm check. sskr-wasm/rust/Cargo.toml uses only pinned inline entries today.",
         evidence="probe-code-rules-gaps (exit 1, local log); cli-build reviewer and skeptic probes (local only).",
         recommendedFix="Treat a section `<dependencies>.<name>` (also dev-, build- and target-specific) and a dotted `<name>.version` key as one dependency and check its version; add the cases to test/code-rules.test.ts.",
         requiredVerification="code-rules-gaps.sh exits 0; the gate still passes the repository.",
         tags=["gates", "core-25"]),
    dict(id="AUD-024-ARC001", category="ARC", severity="low", status="fixed", releaseBlocking=False,
         title="The --ask-secrets path of the AUD-022-SEC001 fix has no regression in the suite or CI",
         affectedFiles=["src/cli/re-encode-command.ts:163-172", "test/re-encode-questions.test.ts", "test/re-encode.test.ts:217-218", "scripts/terminal_secret_checks.py:55-185"],
         relatedFindings=["AUD-022-SEC001"],
         reproduction="Change showOldPhrase in a copy of dist/cli/re-encode-command.js to write the phrase to standard output; the repository's three re-encode pseudo-terminal checks still pass (standard output and error are the same terminal there), and no test of re-encode-questions asserts that the old phrase is absent from standard output. Only docs/audits/AUD-022-harnesses/reencode-stdout.py fails, and no pnpm script or workflow runs it.",
         expected="AUD-022-SEC001's required verification asks for redirected-stdout regressions on the options path and the --ask-secrets path; CORE-33 asks for a test that fails before the fix and after it is undone.",
         observed="The options path has one (test/re-encode.test.ts:217-218); the --ask-secrets path is guarded only by the audit harness.",
         impact="The fix is intact today (the harness passes in this baseline); a later change could send the old phrase to a redirected file again without failing pnpm verify or CI.",
         evidence="aud022-fixes reviewer's mutant run and the skeptic's rerun (local only); reencode-stdout passes in this baseline.",
         recommendedFix="Add a case with standard error a terminal and standard output not, asserting that the old phrase stays off standard output, to test/re-encode-questions.test.ts or to the pseudo-terminal checks with output sent to a file.",
         requiredVerification="The new check fails with showOldPhrase writing to standard output and passes at the fix; it runs in pnpm verify or the CI terminal action.",
         tags=["tests", "re-encode"]),
    dict(id="AUD-024-ARC002", category="ARC", severity="low", status="fixed", releaseBlocking=False,
         title="The permission-denied save message lost its only test when recover-word moved to the shared terminal",
         affectedFiles=["test/ask-word-recovery.test.ts:256-291", "test/helpers/question-terminal.ts:133-137", "src/cli/save-retry.ts:24-25"],
         reproduction="`git grep -n 'no permission to write' 870effe -- test` finds test/ask-word-recovery.test.ts:324; the same at HEAD finds nothing; `git log -S'no permission to write there' 870effe..HEAD -- test` names 1d4f97b.",
         expected="A save that fails with EACCES keeps a test of its exact line, \"… could not be saved as <path>: there is no permission to write there.\", as at 870effe.",
         observed="The shared failingSave helper throws only ENOSPC; no test at HEAD sends EACCES or EPERM through saveWithRetry.",
         impact="A change to the permission reason, the usual one for a protected folder, would pass the suite; the behaviour at HEAD is unchanged.",
         evidence="docs-tests reviewer's removed_expects.py and the skeptic's rerun (local only).",
         recommendedFix="Let failingSave take an errno code (ENOSPC by default) and assert the EACCES line again; optionally one table-driven test over every SAVE_FAILURES entry.",
         requiredVerification="A test asserts the EACCES line and fails when SAVE_FAILURES.EACCES changes.",
         tags=["tests"]),
    dict(id="AUD-024-DOC001", category="DOC", severity="low", status="fixed", releaseBlocking=False,
         title="docs/CANDIDATES.md names the removed problem field of CandidateFileRefusedError",
         affectedFiles=["docs/CANDIDATES.md:103", "src/core/candidate-file-refusal.ts:18-27"],
         reproduction="Read docs/CANDIDATES.md:103; refuse a candidate file through dist/core/candidate-file-refusal.js and read the error: code is \"unsupported\", problem is undefined.",
         expected="DOC-06: the host contract names the field a host branches on, `code`, since commit 7c5ece9 renamed the class and the field (TS-06).",
         observed="The sentence was updated for the class name only and still says `problem: \"unsupported\"`.",
         impact="A host written from the document never matches the refusal and may give the wrong next step; the in-workspace host already uses code.",
         evidence="core reviewer's runtime probe and the skeptic's rerun (local only).",
         recommendedFix="Write `code: \"unsupported\"` and `code: \"damaged\"` in docs/CANDIDATES.md:103.",
         requiredVerification="docs/CANDIDATES.md names only fields that CandidateFileRefusedError has.",
         tags=["docs", "host-contract"]),
    dict(id="AUD-024-DOC002", category="DOC", severity="low", status="fixed", releaseBlocking=False,
         title="The audit index lists 4 of the 22 published harness folders",
         affectedFiles=["docs/audits/README.md:45-48"],
         reproduction="Read docs/audits/README.md:45-48; `git ls-files docs/audits | grep -oE 'AUD-0[0-9]+-harnesses' | sort -u | wc -l` gives 22.",
         expected="The paragraph names every published harness folder or points to the table, whose rows link them.",
         observed="It says the scripts are published one folder per audit and lists only AUD-001, AUD-002, AUD-004 and AUD-005; it dates from 2026-10-01.",
         impact="An incomplete list for a reader of the index; the table rows link the folders.",
         evidence="docs-tests reviewer and the skeptic's rerun (local only).",
         recommendedFix="Replace the list by a pointer to the Records column of the table.",
         requiredVerification="The paragraph is current; pnpm check passes.",
         tags=["docs", "audit-records"]),
]

AUD022 = ["SEC001", "SEC002", "FUN001", "FUN002", "FUN003", "FUN004", "API001", "API002", "UI001", "BLD001",
          "ARC001", "ARC002", "DOC001", "DOC002", "DOC003", "DOC004", "DOC005", "DOC006", "DOC007", "DOC008"]
AUD022_EVIDENCE = {
    "SEC001": "Phrase only on standard error when it is a terminal, else its fingerprint (src/cli/re-encode-command.ts:163-172); re-encode.test.ts 19 passed; reencode-stdout passes in this baseline. See AUD-024-ARC001 for the missing suite regression of the --ask-secrets path.",
    "SEC002": "verify-audit-privacy.mjs reads the account at run time and refuses non-UTC times in every published file type; audit-privacy.test.ts 6 passed; the gate passes over 345 files.",
    "FUN001": "Fix intact through the CORE-15 split (repair-models.ts, joint-solve.ts); aud-022.test.ts 22 passed; repair-leading-marks: 0 of 45 cases \"do not fit\", as recorded at the remediation.",
    "FUN002": "separateCardJob keeps the person's orientation; 90 × 50 mm card pages for 12, 18 and 24 words with --cards-dir alone and with --pdf (reviewer probe); card-output passes.",
    "FUN003": "A read header leaves marks after the share's own length out (repair-models.ts); its aud-022 test passes.",
    "FUN004": "validateCardOptions counts a card page size as separate cards, and share cards are checked printable before any secret (card-options.ts, sskr-output.ts); aud-022 tests pass.",
    "API001": "PngAdmission keeps the distinct IHDR refusals; aud-002-remediation.test.ts 18 and aud-021-security.test.ts 34 passed.",
    "API002": "ReEncoding.of refuses a last word for a backup that gives one phrase, and --last-word with --ask-secrets is refused (src/core/re-encoding.ts); its tests pass.",
    "UI001": "newBackupAskedUntilTaken asks again after a refused answer for the new backup; the pseudo-terminal case check_re_encode_answer_refused passes.",
    "BLD001": "S118, now in test/scan-fixes-s100-s148.test.ts, matches the keeping note of src/export/sskr-keeping-text.ts and passes.",
    "ARC001": "The fingerprint rule and notices of re-encode live in the library; its tests pass.",
    "ARC002": "PNG_ADMISSION_SELF_TEST runs at start and in self-test, now also with 16-bit samples; self-test passes.",
    "DOC001": "AUD-012 keeps its committed bytes and its quoted anchor equals the test line; the records no longer describe edits of other records (AUD-021 update, the privacy section of docs/audits/README.md).",
    "DOC002": "docs/card-identities.md says 29 slogans; test/card-copy.test.ts counts them against the program.",
    "DOC003": "The help names only current card kinds.",
    "DOC004": "docs/SSKR.md and the help example use share forms that have cards (read, not run: they draw cards).",
    "DOC005": "One source, SHEET_PLAN_TEXT, for the menu note and the help; README, CHANGELOG and the release notes agree with it.",
    "DOC006": "AUD-021's remediation table shows BLD001 fixed.",
    "DOC007": "The re-encode help names --old-mode and --old-format.",
    "DOC008": "One source, SHEET_QR_HOLDS, for the question and the help: the codes of the backup, without the extra cards.",
}
REMEDIATION = [dict(id=f"AUD-022-{key}", status="verified", fixCommit="8aa9b25", verificationCommit="ee4499e",
                    evidence=AUD022_EVIDENCE[key]) for key in AUD022]
REMEDIATION += [dict(id=f["id"], status="fixed", fixCommit=None, verificationCommit=None,
                     evidence="Fixed with this record, not verified; see the remediation addendum.") for f in FINDINGS]

ADDENDUM = {
    "date": DATE,
    "commit": "ee4499e891754158b4e6bcf0c919dc360ffc8b4e",
    "statusRule": "Fixed, not verified: the fixes are committed together with this record, and no later commit has "
                  "verified them yet. Each test below was seen failing before its fix and passing after it.",
    "fixes": [
        {"id": "AUD-024-FUN001", "files": ["src/sskr/transport.ts", "test/sskr-boundaries.test.ts"],
         "change": "sharePayload reads the tag bytes, the header and the one-byte length as input that may be missing and refuses a record cut short with \"Not an SSKR CBOR tag.\" or \"Invalid SSKR share byte string.\"; five CRC-valid truncated records are tested."},
        {"id": "AUD-024-API001", "files": ["src/sskr/joint-repair.ts", "test/joint-repair-entry.test.ts"],
         "change": "The entry re-exports ElementHelp, JointAssessment, MarkedElement, RepairedSet, RepairedShares, ShareAssessment and DIGEST_BITS; a type-level test of the test tsconfig fails when one goes missing (seven errors without the fix)."},
        {"id": "AUD-024-BLD001", "files": ["scripts/verify-code-rules.mjs", "test/code-rules.test.ts"],
         "change": "checkPythonPackages reads the existing requirements files and reports each imported package that none pins, by its published name (PIL, fontTools and winpty mapped) compared as pip compares names; one parser of requirement entries serves both checks."},
        {"id": "AUD-024-BLD002", "files": ["scripts/verify-code-rules.mjs", "test/code-rules.test.ts"],
         "change": "checkCargoManifest collects each dependency of a section in any TOML form (string, inline table, dotted keys, its own table, dev-, build- and target-specific) and checks its version when the section ends."},
        {"id": "AUD-024-ARC001", "files": ["test/re-encode-questions.test.ts"],
         "change": "re-encode --ask-secrets with standard output not a terminal: the new backup on standard output, no word of the old phrase there, the phrase on standard error only when it is a terminal; both cases fail with showOldPhrase writing to standard output."},
        {"id": "AUD-024-ARC002", "files": ["test/helpers/question-terminal.ts", "test/ask-word-recovery.test.ts"],
         "change": "failingSave takes the errno code of its failures (ENOSPC unless a test names another); recover-word asserts the exact EACCES line again and the off-screen EPERM rejection; a changed EACCES text fails the test."},
        {"id": "AUD-024-DOC001", "files": ["docs/CANDIDATES.md"],
         "change": "The host contract names code: \"unsupported\" and code: \"damaged\"."},
        {"id": "AUD-024-DOC002", "files": ["docs/audits/README.md"],
         "change": "The paragraph points to the table, whose rows link every harness folder."},
    ],
    "checks": [
        ("remediation-build", "pnpm build", "Fresh dist/."),
        ("remediation-source", "pnpm check", "Every gate, the code rules with the fixed checks included."),
        ("remediation-format", "pnpm format:check", "Prettier over the repository."),
        ("remediation-tests", "pnpm exec vitest run <17 test files of the fixes and the code they touch>", "17 files: 415 passed."),
        ("remediation-cli-self-test", "node dist/mnemocode.js self-test", "PASS."),
        ("remediation-terminal-input", "python3 scripts/verify-terminal-input.py", "Every pseudo-terminal case passed."),
        ("remediation-sskr-independent", "python3 scripts/verify-sskr-known-answers.py", "Official vector and every quorum restored."),
        ("remediation-probe-truncated-share", "node docs/audits/AUD-024-harnesses/truncated-share.mjs", "Exit 0: every truncated record refused as input."),
        ("remediation-probe-entry-types", "bash docs/audits/AUD-024-harnesses/entry-types.sh", "Exit 0: the host compiles."),
        ("remediation-probe-code-rules-gaps", "bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh", "Exit 0: every violating case refused, both controls pass."),
    ],
}

OBSERVATIONS = [
    "The rebuilt SSKR WASM differs from 870effe's in two bytes (offsets 228177 and 228193, 0xb0 to 0xb7), panic-location line numbers that the doc comments added to lib.rs moved; lib.rs changed only in comments, and verify:sskr reproduces the committed bytes.",
    "withRawTerminal lowers its session count before the awaited turn of leaveRawMode: a later caller that started a raw session without awaiting the previous one could see raw mode left under it. No caller does so; lowering the count after leaveRawMode would remove the fragility.",
    "docs/audits/AUD-015-harnesses/staging-probes.ts imports LeftStagingCopy, now LeftStagingCopyError (TS-06); it is frozen evidence but ships in the package and no longer compiles.",
    "The TS-06 renames of public names (…Error classes, .problem and .kind to .code) are not in CHANGELOG.md; with 0.1.0 unreleased nobody depends on the old names, but a line would help hosts.",
    "History before the release: main's 8aa9b25 is a work-in-progress commit to regroup, 45c9f86's message still says it is temporary and unsigned, and ee4499e is a fixup commit to fold (workspace Commits rules).",
    "The AUD-022 records say the remediation is not committed; it is in 8aa9b25, and this report records the fix and verification commits. The AUD-022 records stay unchanged.",
    "The multi-chain Deriver does not yet use RE_ENCODING_WORDS, confirmationLine or PNG_ADMISSION_SELF_TEST in its own host code, although its synced copy has them; the synced copies of the split files are byte-identical to HEAD.",
    "ci.yml runs the full pnpm verify, the pseudo-terminal check, the card round trip, the SSKR replay and pnpm audit on every push, and executable.yml builds three executables on push to main; CI-04 asks for fast checks only on push. Unchanged since AUD-022.",
    "Smaller gaps of code-rules that need no fix today: a second module after `import a as b, c`, `#!/usr/bin/env -S bash`, `long:` anywhere on a first line, and WEB-01 checked per line.",
    "The CLI lowercases the first letter of a library message, which reads \"mnemoCode expected …\" for the message of AUD-024-FUN001.",
    "test/aud-021-recovery.test.ts has three describe blocks with the same name; two header comments exceed 100 columns (scripts/verify-audit-privacy.mjs:4, src/core/png-admission-self-test.ts:3).",
    "The CHANGELOG's bound of about 200 MiB for the PNG decoder was not measured again; the cloud session measured about 170 MiB.",
]

ASSESSMENT = [
    "The reviewed main is in good order: the suite in parts, every gate of pnpm check, the self-test, the pseudo-terminal "
    "checks, card output, the SSKR known answers, the Seedshift oracle and the reproducible SSKR rebuild pass at the "
    "snapshot, and CI passed on Linux, macOS and Windows at the previous commit. The coding-guide restructuring moved code "
    "without changing behaviour, except where the findings say. All 20 AUD-022 findings are verified at ee4499e.",
    "",
    "The eight new findings are low and none blocks the release: one message regression of TS-03 (FUN001), one lost "
    "entry export of a CORE-15 split (API001), two gaps of the new code-rules gate (BLD001, BLD002), two regressions that "
    "the suite no longer guards (ARC001, ARC002) and two stale documents (DOC001, DOC002). Release acceptance is not "
    "established by this audit: no tag, no release-level verification, and history still to regroup. All eight were "
    "fixed with this record; a later audit verifies them.",
    "",
    "Limitations:",
]

LIMITATIONS = [
    "A compact audit of about one hour: the review covered the changes since 870effe and the AUD-022 fixes; code unchanged since AUD-022 was not reviewed again.",
    "No local Windows or macOS run; CI at a03862c covers their tests, pseudo-terminal checks and executables.",
    "No local executable build or check; CI built and checked the three executables at a03862c.",
    "No browser parity check of the multi-chain Deriver, which lives in another repository.",
    "The pnpm verify:sskr rebuild ran with the Docker cache; no uncached canonical rebuild.",
    "Reviewer probes and logs are kept locally (docs/audits/AUD-024-evidence/, ignored by Git); the three probes that reproduce findings are published in AUD-024-harnesses/.",
    "The reasoning effort of the coordinator and the agents is not retained by the client.",
]

CI_RUNS = [
    {"workflow": "CI", "runId": 38560572717, "commit": "a03862c2d3f161b1b150498e3b69784f53e198ee", "conclusion": "success",
     "jobs": ["verify", "portable (macos-15)", "portable (windows-2025)"]},
    {"workflow": "Executable", "runId": 38560572551, "commit": "a03862c2d3f161b1b150498e3b69784f53e198ee", "conclusion": "success",
     "jobs": ["build (ubuntu-24.04)", "build (macos-15)", "build (windows-2025)"]},
]
