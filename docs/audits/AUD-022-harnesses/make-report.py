"""Writes the AUD-022 report of MnemoCode (Markdown and JSON) from the findings below and the
recorded command evidence, validates the JSON against the workspace schema, checks privacy, and
writes the local SHA256SUMS and report-validation.json of the evidence. Run from the MnemoCode
repository root:

    python3 docs/audits/AUD-022-harnesses/make-report.py

Exit 1 when a check of the report fails.
"""
import getpass, hashlib, json, re, sys
from pathlib import Path
import jsonschema

HERE = Path(__file__).resolve().parent.parent
EVIDENCE = HERE / "AUD-022-evidence"
STEM = "AUD-022-2026-10-13"
SCHEMA = Path("../multi-chain-wallet-tools/docs/audit-report.schema.json")
PROCEDURES = [
    "multi-chain-wallet-tools/docs/FULL_AUDIT_GUIDE.md",
    "multi-chain-wallet-tools/docs/audits/AUDIT_STANDARD.md",
    "multi-chain-wallet-tools/docs/audits/AUDIT_TEMPLATE.md",
    "multi-chain-wallet-tools/docs/audit-report.schema.json",
]

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def anonymous(text):
    # Published text names no machine owner (AGENTS.md, Report privacy).
    return re.sub(r"/home/[^/\s\"'`]+", "/home/user", text)

snapshot = json.loads((EVIDENCE / "snapshot-initial.json").read_text())

def command(label):
    record = json.loads((EVIDENCE / f"{label}.command.json").read_text())
    return record


CHECKS = [
    ("source", "pnpm check", "Toolchain pins, Markdown lists, audit privacy gate, copy gate, four tsc projects."),
    ("format", "pnpm format:check", "Prettier over the repository."),
    ("docs-format", "pnpm exec prettier --check \"**/*.md\" \"**/*.json\"", "Markdown and JSON."),
    ("build", "pnpm build", "Fresh dist/ from the snapshot."),
    ("tests-other", "pnpm exec vitest run --maxWorkers=4 <88 test files without PDF generation>", "88 files: 1,653 passed, 1 failed (test/aud-002-remediation.test.ts, AUD-022-API001), 4 skipped."),
    *[(f"tests-pdf-{n:02d}", f"pnpm exec vitest run --maxWorkers=3 <3 PDF-generating test files, batch {n}>", s) for n, s in [
        (1, "72 passed."), (2, "28 passed."), (3, "25 passed."), (4, "34 passed."), (5, "39 passed."), (6, "29 passed."),
        (7, "73 passed."), (8, "209 passed, 1 failed (test/scan-fixes.test.ts S118, AUD-022-BLD001)."), (9, "28 passed."), (10, "52 passed (one file).")]],
    ("cli-self-test", "node dist/mnemocode.js self-test", "PASS: 7 public vectors, 75 representation round trips."),
    ("terminal-input", "python3 scripts/verify-terminal-input.py", "Every pseudo-terminal case of the menu and the private screen passed."),
    ("card-output", "node scripts/check-card-output.mjs docs/audits/AUD-022-evidence/card-output", "Card, material and SSKR PDFs rendered, QR codes read back exactly."),
    ("sskr-independent", "python3 scripts/verify-sskr-known-answers.py", "Official BCR-2020-011 vector from every valid quorum, invalid quorums refused, every deterministic set including 32 bytes."),
    ("seedshift-oracle", "python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py", "6,000 library comparisons and 400 random cases, 0 failures."),
    ("dependency-advisories", "pnpm audit --audit-level high", "No known vulnerabilities."),
    ("lockfile-frozen", "pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only", "Lockfile agrees with package.json."),
    ("package-manifest", "npm pack --dry-run --json --ignore-scripts", "867 files; every audit-index link target included; no evidence folder, output or release file."),
    ("records-schema", "python3 docs/audits/AUD-022-harnesses/validate-records.py", "All 21 docs/audits/AUD-*.json records valid, no duplicate keys, finding IDs in both twins."),
    ("aud021-fixed", "node docs/audits/AUD-022-harnesses/aud021-fixed.mjs", "13 checks of the fixed state of AUD-021, all passed."),
    ("aud021-core-probes", "node docs/audits/AUD-021-harnesses/core-probes.mjs", "Exit 1 as expected on a fixed tree: its first defect assertion no longer holds."),
    ("aud021-security-probes", "node docs/audits/AUD-021-harnesses/security-probes.mjs", "Exit 1 as expected on a fixed tree."),
    ("aud021-document-probes", "node docs/audits/AUD-021-harnesses/document-probes.mjs", "Exit 1 as expected on a fixed tree."),
    ("executable-build", "node scripts/build-executable.mjs output/aud022-executable", "Linux x64 executable and license notices."),
    ("executable-verify", "node scripts/verify-executable.mjs output/aud022-executable", "Every smoke step of the executable passed."),
    ("terminal-executable", "python3 scripts/verify-terminal-input.py output/aud022-executable/mnemocode-0.1.0-linux-x64", "Every pseudo-terminal case against the executable passed."),
]

FINDINGS = [
    dict(id="AUD-022-SEC001", category="SEC", severity="medium", releaseBlocking=True,
         releaseBlockingReason="A seed phrase reaches a file that the person did not ask for; secrets must stay on the private screen.",
         title="Re-encode writes the original seed phrase to standard output",
         affectedFiles=["src/cli/re-encode-command.ts:192", "src/cli/re-encode-command.ts:226", "src/cli/re-encode-command.ts:235", "src/cli/decode-command.ts:153-177", "src/cli/terminal.ts:83-87", "test/re-encode.test.ts:204"],
         reproduction="`node dist/mnemocode.js re-encode --input \"wool abuse actual wool abuse actual wool abuse actual wool abuse congress\" --old-mode seedshift --old-dates 23-09-2026 --mode seedshift --dates 01-01-2000 --format 1 --master-fingerprint 73c5da0a --output new.txt > stdout.txt`. Interactive: `re-encode --ask-secrets --input-file old.txt --old-mode seedshift` with standard output redirected to a file, the date typed, then Stop.",
         expected="Like Encode, standard output carries only the new backup; the decoded phrase is shown only on the private screen for the person to confirm it.",
         observed="Exit 0; the first line of stdout.txt is the unmasked public phrase `abandon … about`, followed by the new masked phrase. new.txt holds no plaintext. The encode control with the same options writes no plaintext line. In the interactive run the phrase went to the redirected file, not to the private screen, while the person was asked to recognise it; after Stop (exit 130) the plaintext stays in the file. The test at test/re-encode.test.ts:204 requires the phrase on stdout.",
         impact="Saving the new backup with `>`, `tee` or a pipe stores the original seed phrase beside it, which defeats the masking re-encode exists to make. No other sink was demonstrated.",
         evidence="Coordinator reproduction (AUD-022-evidence/reencode-stdout, local only) and the security reviewer's PTY probe (AUD-022-evidence/reviews/probes-security/reencode-stdout.py, local only).",
         recommendedFix="Show the recovered phrase of re-encode only on the terminal (private screen or standard error); with standard output not a terminal show only its fingerprint; on the command line with a wallet confirmation do not print the phrase at all. Change test/re-encode.test.ts:204 to require its absence.",
         requiredVerification="Redirected-stdout regressions for the options path and the --ask-secrets path; the interactive phrase still visible on the private screen; terminal check check_re_encode_menu.",
         tags=["re-encode", "secret-output"]),
    dict(id="AUD-022-SEC002", category="SEC", severity="low", releaseBlocking=True,
         releaseBlockingReason="Committing the uncommitted gate would publish the owner's username.",
         title="The audit privacy gate holds the owner's name and misses local times",
         affectedFiles=["scripts/verify-audit-privacy.mjs:18", "scripts/verify-audit-privacy.mjs:21-25", "package.json (check:audit-privacy)"],
         reproduction="Read line 18; run the timestamp pattern of lines 21-25 against a time with a space before a non-zero offset and against a time followed by a zone abbreviation.",
         expected="The gate keeps the owner's name out of published files without containing it, and refuses every non-UTC time; it scans every published file type.",
         observed="Line 18 tests the owner's name as a literal; the file is untracked, and no tracked file at HEAD contains the name. The pattern finds neither time (0 matches each). Only .md and .json files are scanned, while the package now ships harness .py/.mjs/.ts/.sh files. Every /home/<name> other than /home/user is refused, including synthetic test data in quoted source lines, which led to AUD-022-DOC001.",
         impact="The first commit of the gate publishes the name it guards; local times can pass the gate; synthetic test paths make it rewrite historical quotes.",
         evidence="Architecture reviewer (AUD-022-evidence/reviews/architecture-build.md, local only) and coordinator check of the regex.",
         recommendedFix="Read the owner's name and home at run time (os.userInfo, HOME) instead of a literal; accept a space before an offset and refuse zone names and offset-less local times; scan every published file type; allow known synthetic paths; add fixture tests that must fail.",
         requiredVerification="Fixture tests with an owner name, a non-zero offset after a space, a zone name, a time without a zone and a synthetic path; the gate over the real records.",
         tags=["privacy", "tooling"]),
    dict(id="AUD-022-FUN001", category="FUN", severity="medium", releaseBlocking=True,
         releaseBlockingReason="A supported recovery (one damaged share repaired below its threshold) is refused or turned into many variants.",
         title="Decoy-prefix share readings turn unique repairs into variant lists and below-threshold verdicts into a misfit",
         affectedFiles=["src/sskr/repair.ts:395-424 (addUnitModel)", "src/sskr/repair.ts:592-660 (colorUnicodePairings)", "src/sskr/repair.ts:1339", "src/sskr/joint-repair.ts:647", "src/sskr/joint-repair.ts:1112-1118"],
         relatedFindings=["AUD-021-FUN002"],
         reproduction="For each share of every deterministic set of vectors/sskr-v1.json, written as Unicode codes, word numbers and colors, mark its first three elements with ? and run repairCandidates and `node dist/mnemocode.js sskr-export --share \"<marked share>\"` (harness repair-leading-marks.mjs).",
         expected="One share below the threshold with a few marks repairs to its own share, or the person is told more shares are needed, as before the AUD-021-FUN002 remediation.",
         observed="33 of 45 cases give no unique repair or end with \"These shares do not fit together\". Single repair lists 3 to 32 candidates for Unicode codes and colors; 128-bit colors are refused with \"Too many elements are marked\". With the AUD-021 change undone in emulation (readings of the whole input only, and a capped reading ignored once another reading solved), the recovery reviewer found unique repairs and the verdict \"not enough shares\" in most of these cases. Decimal word numbers and Unicode codes also read as hexadecimal colors run together; with a marked header every color prefix is tried with the rest taken as decoys, and some prefixes solve as shares of another secret length.",
         impact="A damaged share given alone (sskr-export, the first answer of sskr-combine, the backup check) is refused or blamed on the set instead of asking for more shares; no wrong share is chosen silently, and with the quorum present the set is determined.",
         evidence="Coordinator harness AUD-022-harnesses/repair-leading-marks.mjs (33/45; AUD-022-evidence/repair-leading-marks.log, local only) and the recovery reviewer's probes p1-p14 (AUD-022-evidence/reviews/probes-recovery, local only).",
         recommendedFix="Add decoy prefixes only for the form the text is written in, not for a run-together reading in another form, or only where a decoy suffix plausibly exists; keep conflict and enoughMembers per share length; do not let a capped reading of another length veto a solved one.",
         requiredVerification="Regression: one share below threshold with its first one to three elements marked, in every form and length, expects a unique repair and \"not enough\"; the AUD-021-FUN002 cases still pass.",
         tags=["sskr", "repair", "regression"]),
    dict(id="AUD-022-FUN002", category="FUN", severity="medium", releaseBlocking=True,
         releaseBlockingReason="Separate business cards, a supported output, print at 56% of their size for most backups.",
         title="Separate cards saved by Encode are drawn shrunk on portrait pages",
         affectedFiles=["src/export/render.ts:48", "src/export/card-plan.ts:61", "src/cli/encode-export.ts:88-93", "src/export/business-cards.ts:261-264", "src/export/business-layout.ts:50-66"],
         reproduction="`node dist/mnemocode.js encode --mnemonic \"abandon ×23 art\" --mode direct --format 5 --template business-it --cards-dir sep24`, then `pdfinfo` a card file; control: `preview --template business-it --words 24 --cards-dir prev24`.",
         expected="Every separate card is a 90 × 50 mm page, as README (Page sizes) and the menu (\"Separate business cards, 90 × 50 mm\") say.",
         observed="18 files, each page 141.7 × 255.1 pt (50 × 90 mm, portrait) with the card drawn at about 0.56 scale in its middle; the preview control gives 255.1 × 141.7 pt. With no page size, the sheet plan's orientation is written into the shared content and separate cards read it. 12 words (landscape plan) come out right. Present at HEAD too.",
         impact="Most backups, every 24-word one, print as small cards with smaller codes that do not fit card stock; codes, decoys and QR stay right.",
         evidence="Cards reviewer (AUD-022-evidence/reviews/cards-ui.md, local only) and coordinator pdfinfo check (AUD-022-evidence/verify, local only).",
         recommendedFix="Keep the plan's orientation apart from the person's --orientation, or do not write it into content that separate cards draw.",
         requiredVerification="encode --cards-dir alone and with --pdf gives 90 × 50 mm pages for 8, 16 and 24 codes; the sheet keeps its plan.",
         tags=["cards", "export"]),
    dict(id="AUD-022-FUN003", category="FUN", severity="low", releaseBlocking=False,
         title="A decoy card marked with ? makes a share unreadable",
         affectedFiles=["src/sskr/repair.ts:413-416", "src/sskr/repair.ts:609-617"],
         reproduction="Share 1 of bip39-128-2-of-3 followed by three elements of another share as decoys, in colors, Unicode codes and word numbers; replace the first decoy by ?; call repairCandidates.",
         expected="Once the header is read, the share's own length is known and a mark after it carries nothing; phrase codes with a declared word count ignore such a mark.",
         observed="Complete share with decoys: 1 candidate, the right one. With the first decoy marked: \"No valid share fits the marked elements\" in all three forms; the joint repair says the share cannot be read.",
         impact="Bounded: deleting the decoys works, but the message points at the wrong elements, and docs/SSKR.md invites marking every unreadable element.",
         evidence="Coordinator check and recovery reviewer probe p12.",
         recommendedFix="With the header read, ignore marks after the share's own length, or say that elements after the first N are decoys.",
         requiredVerification="Marked decoy after a complete or marked share, in each form.", tags=["sskr", "repair"]),
    dict(id="AUD-022-FUN004", category="FUN", severity="low", releaseBlocking=False,
         title="Some card refusals come only after the seed phrase is typed",
         affectedFiles=["src/cli/encode-command.ts:201-205", "src/cli/sskr-split-command.ts:61-73", "src/cli/card-options.ts:51", "src/export/render.ts:79"],
         reproduction="prepareEncode, the step before any secret is asked, accepts (a) `--sskr --ask-secrets --share-format unicode --template business-it --card-company <65 characters> --pdf`, (b) `--sskr --ask-secrets --share-format unicode --template material-tile --pdf` for a 24-word phrase, (c) `--ask-secrets --format 5 --template material-tile --page-size business --pdf`.",
         expected="Every option is checked before the first secret question, as the code comments promise and plain Encode does for a long company.",
         observed="After the phrase is typed the same options are refused: (a) the company is too long for the card, (b) the tile material offers 27 samples for 33 share codes, (c) the design is printed on sheets only.",
         impact="The person types the phrase and dates, then nothing is saved; no secret leaks. The menu can reach (a) and (b).",
         evidence="Cards reviewer probe prep-probe.mjs (AUD-022-evidence/reviews/probes-cards, local only).",
         recommendedFix="Before the phrase, test-draw share cards with the longest sample share or refuse a material with fewer samples than the longest share plus one decoy; treat a card page size with --pdf or --images-dir as separate cards in validateCardOptions.",
         requiredVerification="The three combinations refused before a secret is asked.", tags=["cards", "ask-secrets"]),
    dict(id="AUD-022-API001", category="API", severity="low", releaseBlocking=True,
         releaseBlockingReason="The regression test fails, so `pnpm verify` and CI fail.",
         title="PNG admission dropped the distinct refusals that AUD-002 added",
         affectedFiles=["src/core/png-admission.ts:111-127", "test/aud-002-remediation.test.ts:213-224"],
         relatedFindings=["AUD-021-SEC001", "AUD-002-API003"],
         reproduction="`pnpm exec vitest run test/aud-002-remediation.test.ts`.",
         expected="A file with a wrong IHDR length or without IHDR is refused with its own reason, as AUD-002-API003 fixed and its test requires; or the test is changed with a recorded reason.",
         observed="`expected [Function] to throw error including 'invalid IHDR chunk length' but got 'The QR input is not a valid PNG file.'` PngAdmission checks chunk overhead and CRC first; the messages \"invalid IHDR chunk length\" and \"does not begin with an IHDR chunk\" no longer exist in src.",
         impact="Less specific diagnostics for damaged QR images, and a red suite; images are still refused.",
         evidence="tests-other (AUD-022-evidence, local only).",
         recommendedFix="Decide the wanted messages: restore the specific refusals in PngAdmission, or update the AUD-002 test with the reason.",
         requiredVerification="test/aud-002-remediation.test.ts and test/aud-021-security.test.ts.", tags=["png", "regression"]),
    dict(id="AUD-022-API002", category="API", severity="low", releaseBlocking=False,
         title="re-encode accepts --last-word for a backup that gives one phrase and ignores it",
         affectedFiles=["src/core/re-encoding.ts:78-83", "src/cli/re-encode-command.ts:191"],
         reproduction="`node dist/mnemocode.js re-encode --input \"abandon ×11 about\" --old-mode direct --old-format english --format 3 --recognised --last-word zoo`.",
         expected="An option that does not apply is refused, as MnemoCode refuses other options that do not fit.",
         observed="Exit 0; the phrase ending in about is re-encoded and zoo is ignored.",
         impact="A person who believes the backup needs its last word gets no hint that the mode is not the one they thought; confirmation is not bypassed.",
         evidence="Coordinator run (AUD-022-evidence/verify, local only) and security reviewer note.",
         recommendedFix="Refuse --last-word (and the last-word answer) unless the backup gives several phrases.",
         requiredVerification="Refusal test for a direct and a MnemoCode Seedshift backup.", tags=["re-encode"]),
    dict(id="AUD-022-UI001", category="UI", severity="low", releaseBlocking=False,
         title="Re-encode ends when an answer for the new backup is refused after the phrase is confirmed",
         affectedFiles=["src/cli/re-encode-command.ts:215-226", "src/cli/re-encode-command.ts:254-273"],
         reproduction="Menu entry 2: confirm the old phrase, then give the new backup a 65-character company, which the per-answer check (up to 100 characters) accepts and prepareEncode refuses.",
         expected="The refusal is shown and the new backup's questions are asked again, as Escape already does in the loop.",
         observed="askedNewBackup calls prepareEncode(fresh) without catching its refusal; the command ends.",
         impact="The old backup's codes, dates and possibly the last word must be typed again.",
         evidence="Cards reviewer source trace (AUD-022-evidence/reviews/cards-ui.md, local only); the trigger is the refusal of AUD-022-FUN004 (a).",
         recommendedFix="Catch a refusal of prepareEncode in the loop, show it and ask again.",
         requiredVerification="Terminal case: a refused new-backup answer is asked again without leaving the confirmed phrase.", tags=["re-encode", "menu"]),
    dict(id="AUD-022-BLD001", category="BLD", severity="low", releaseBlocking=True,
         releaseBlockingReason="The failing test makes `pnpm verify` and CI fail.",
         title="The share keeping note changed without its test",
         affectedFiles=["src/export/sskr-keeping-text.ts:38", "test/scan-fixes.test.ts:2300"],
         relatedFindings=["AUD-021-DOC001"],
         reproduction="`pnpm exec vitest run test/scan-fixes.test.ts -t S118`.",
         expected="The test and the production text agree.",
         observed="Expected \"…which only the same dates turn back into…\", received \"…which the owner's dates turn back into…\". The AUD-021 remediation ran neither this file nor the AUD-002 test.",
         impact="A red suite; the note itself reads correctly.",
         evidence="tests-pdf-08 (AUD-022-evidence, local only).",
         recommendedFix="Update the S118 literal (or derive it from MASKED_GOAL) and run the complete suite before recording a remediation as done.",
         requiredVerification="The complete suite, in parts as here.", tags=["tests", "regression"]),
    dict(id="AUD-022-ARC001", category="ARC", severity="low", releaseBlocking=False,
         title="Re-encode decides its fingerprint rule and notices in the command line, not the library",
         affectedFiles=["src/cli/re-encode-command.ts:139-146", "src/cli/re-encode-command.ts:337", "src/cli/re-encode-command.ts:82-83"],
         reproduction="Read walletLine and the notices; compare with ReEncodingConfirmation.warning and the Deriver's apps/key-derivation/src/ui/recovery-mnemocode-reencode.ts:213-256 (read only).",
         expected="The library says whether a confirmation proves the wallet and owns the notice texts; every host shows them (AGENTS.md, one source and delegation).",
         observed="walletLine chooses \"accepted, not proven\" from evidence.kind instead of the library's warning; the mismatch and old-backup notices exist only in the CLI; the Deriver words them on its own.",
         impact="A new evidence kind with a warning would be called confirmed by the CLI; the two hosts drift.",
         evidence="Architecture reviewer (AUD-022-evidence/reviews/architecture-build.md, local only).",
         recommendedFix="Let ReEncoding (or its confirmation) state whether it proves the wallet and export the notice texts.",
         requiredVerification="Hosts read the texts and the proof flag from the library; tests on both.", tags=["re-encode", "dry"]),
    dict(id="AUD-022-ARC002", category="ARC", severity="low", releaseBlocking=False,
         title="PngAdmission has no self-test",
         affectedFiles=["src/core/png-admission.ts", "src/cli/self-test.ts:79-96"],
         reproduction="Search for a png-admission self-test module and its registration.",
         expected="A new host-neutral part brings quick known answers with a case it must refuse (AGENTS.md, self-tests come with every feature); the Deriver already uses this part.",
         observed="No self-test module; the CLI's full self-test checks QR only by writing an image and reading it back, which cannot catch a reader that accepts too much, such as a second IHDR.",
         impact="A host cannot check its copy of the admission rules at start.",
         evidence="Architecture reviewer.",
         recommendedFix="Add core/png-admission-self-test.ts with exact filteredBytes for small non-interlaced and Adam7 headers and a refused second IHDR; register it in both hosts.",
         requiredVerification="Fault-injection test that the startup check fails on a wrong budget and on an accepted second IHDR.", tags=["png", "self-test"]),
    dict(id="AUD-022-DOC001", category="DOC", severity="low", releaseBlocking=False,
         title="A historical record's quoted source line was changed, and two records describe the edit",
         affectedFiles=["docs/audits/AUD-012-2026-10-08.json:9654", "docs/audits/AUD-012-2026-10-08.md:1355-1357", "docs/audits/AUD-021-2026-10-13.md:1116", "docs/audits/AUD-021-2026-10-13.json (remediationUpdates[0].privacy)", "test/aud-011-remediation.test.ts:108"],
         reproduction="`git diff HEAD -- docs/audits/AUD-012-2026-10-08.json`; `grep -n OneDrive test/aud-011-remediation.test.ts`.",
         expected="A quoted source anchor stays verbatim, and records do not describe edits of other records' metadata (the owner's standing rule).",
         observed="The anchor no longer equals the synthetic test path of the line it quotes; AUD-012 gained a section that describes the edit and AUD-021 repeats it. docs/audits/README.md:64-66, already pushed at HEAD, holds a similar section, which the owner should decide on.",
         impact="An inaccurate historical quote, and record text against the owner's rule.",
         evidence="Coordinator diff; documentation and architecture reviewers.",
         recommendedFix="Restore the original anchor and remove both descriptions; fix the gate (AUD-022-SEC002) so that synthetic test data is not taken for an owner's path.",
         requiredVerification="Records schema check; the gate over the restored record.", tags=["audit-records"]),
    dict(id="AUD-022-DOC002", category="DOC", severity="low", releaseBlocking=False,
         title="card-identities.md counts 30 slogans; the program has 29",
         affectedFiles=["docs/card-identities.md:19", "src/export/card-copy.ts:57"],
         reproduction="Compare the document with cardSlogans.length.", expected="29.", observed="\"30 slogans\".",
         impact="A stale count.", evidence="Documentation reviewer; coordinator check.",
         recommendedFix="Write 29, or let a test check the count against the document.", requiredVerification="Document text.", tags=["docs"]),
    dict(id="AUD-022-DOC003", category="DOC", severity="low", releaseBlocking=False,
         title="The help describes card kinds that no longer exist",
         affectedFiles=["src/cli/help-pages.ts:293", "src/cli/help-pages.ts:1573"],
         reproduction="`node dist/mnemocode.js encode --help`; `node dist/mnemocode.js help cards`.",
         expected="Separate cards are named by number and one code (01-ABCDEF.pdf); every card holds one code (docs/card-designs.md, CHANGELOG).",
         observed="Help line 293 gives 01-tuna-next-keep.pdf, a word-group card no export can make (shown in encode, re-encode, sskr-split and preview help); line 1573 says three designs put four, six or eight codes on each card, although the glass designs were removed.",
         impact="Misleading help.", evidence="Documentation reviewer; coordinator grep.",
         recommendedFix="Drop both statements.", requiredVerification="Help text test.", tags=["help"]),
    dict(id="AUD-022-DOC004", category="DOC", severity="low", releaseBlocking=False,
         title="SSKR examples combine ur shares with cards and are refused",
         affectedFiles=["docs/SSKR.md:32-35", "docs/SSKR.md:80-81", "src/cli/help-pages.ts:765", "src/cli/help-pages.ts:1295", "src/sskr/transport.ts:379-382"],
         reproduction="Run the examples with public data.",
         expected="Documented examples run.",
         observed="Each exits 1 with \"Shares written as ur have no cards: cards print shares in colors or in Unicode codes.\"",
         impact="A person following the guide is refused.", evidence="Documentation reviewer runs.",
         recommendedFix="Add --share-format colors or unicode to the examples.", requiredVerification="Example runs.", tags=["docs", "sskr"]),
    dict(id="AUD-022-DOC005", category="DOC", severity="low", releaseBlocking=False,
         title="Automatic sheet orientation is described as whichever gives larger cards",
         affectedFiles=["CHANGELOG.md:133", "README.md:303", "src/cli/encode-questions.ts:383", "src/cli/help-pages.ts:1555", "src/export/collection-sheet.ts:381-382", "src/export/collection-sheet.ts:421-428"],
         reproduction="Compare the texts with planCollectionSheet.",
         expected="A plan with at least MIN_SHEET_ROWS (3) rows wins before larger cards, as README.md:376 and CHANGELOG.md:122 say.",
         observed="The menu label, help, README:303, CHANGELOG:133 and a code comment still say the larger cards decide.",
         impact="The documents contradict each other.", evidence="Documentation reviewer.",
         recommendedFix="One wording from one source.", requiredVerification="Text check.", tags=["docs", "cards"]),
    dict(id="AUD-022-DOC006", category="DOC", severity="low", releaseBlocking=False,
         title="The AUD-021 remediation table still shows BLD001 as open",
         affectedFiles=["docs/audits/AUD-021-2026-10-13.md:999"],
         reproduction="Read the table; compare with the register (md:23), the finding (md:900), the addendum (md:1034, md:1052) and the JSON.",
         expected="fixed, as everywhere else.", observed="open.",
         impact="An inconsistent record.", evidence="Documentation reviewer; coordinator read.",
         recommendedFix="Correct the row.", requiredVerification="Records consistency check.", tags=["audit-records"]),
    dict(id="AUD-022-DOC007", category="DOC", severity="low", releaseBlocking=False,
         title="The re-encode help names --mode and --format for the old backup",
         affectedFiles=["src/cli/help-pages.ts:216", "src/cli/help-pages.ts:234", "src/cli/re-encode-options.ts:32-42"],
         reproduction="`node dist/mnemocode.js re-encode --help`.",
         expected="--old-mode and --old-format, which re-encode maps to the old backup.",
         observed="--qr-file says \"give --mode for a masked record\" and --old-format says \"a script must pass --format\"; in re-encode those options set the new backup.",
         impact="A script following the help sets the new backup's mode or format instead of the old one's.",
         evidence="Documentation reviewer; coordinator help output.",
         recommendedFix="Let the shared help text name the option through the command's own option names.", requiredVerification="help.test for re-encode.", tags=["help", "re-encode"]),
    dict(id="AUD-022-DOC008", category="DOC", severity="low", releaseBlocking=False,
         title="The sheet QR question says the code holds all the codes of the sheet",
         affectedFiles=["src/cli/encode-questions.ts:594", "src/cli/encode-questions.ts:598", "src/cli/help-pages.ts:1555"],
         reproduction="Read the question and its note; compare with content.payload.",
         expected="The QR holds the real codes of the backup, not the decoys (README:280, docs/SSKR.md:59).",
         observed="\"Add a QR code with all the codes of the sheet?\" and \"only the codes of the sheet\".",
         impact="A person may think the decoys are in the QR.", evidence="Cards reviewer.",
         recommendedFix="Reword from one source.", requiredVerification="Text check.", tags=["menu", "qr"]),
]

AUD021 = [
    ("AUD-021-SEC001", "Duplicate IHDR, IHDR after IDAT, unknown critical chunk, data after IEND, split IDAT, missing palette, bad CRC and bad depth refused before decoding; 4096 px admitted, 4097 refused."),
    ("AUD-021-SEC002", "The admission's inflation of an interlaced 1x1 RGBA image is bounded at 5 bytes and the bomb refused; valid interlaced and non-interlaced images of 1x1 to 17x2 admitted; truncated scanlines refused."),
    ("AUD-021-FUN001", "Color Unicode marks survive a declared word count at both ends, with decoys, in hexadecimal and symbols, raw and MNC1, for 12 to 24 words."),
    ("AUD-021-FUN002", "A marked colors share with one or three decoys repairs to the canonical share; a marked and an intact share with decoys restore the phrase through sskr-combine. Its remediation caused AUD-022-FUN001."),
    ("AUD-021-API001", "Uint16Array, Int8Array, plain arrays, DataView, a spoofed prototype and null refused; Buffer and subarray accepted; a two-faced getter is read once."),
    ("AUD-021-API002", "The result and its indexes cannot be changed while a wallet answer is awaited; the confirmed phrase is the checked one; dates frozen."),
    ("AUD-021-BLD001", "All 175 vendored files of the Deriver's source.json match this snapshot, png-admission and re-encoding included; browser runtime acceptance was not run."),
    ("AUD-021-SEC003", "Four malformed age identities are absent from message, cause, inspection and own properties."),
    ("AUD-021-FUN003", "A sheet PDF, its page image and separate cards of one encode run hold the same 9 cards; the image equals a render of the PDF pixel for pixel."),
    ("AUD-021-DOC001", "Heir texts follow Masking.wrongDateWarning per mode; docs/HEIRS.md promises no empty wallet. Its text change caused AUD-022-BLD001."),
    ("AUD-021-ARC001", "help-pages.ts formats MAX_SEARCH_COMBINATIONS and MAX_SHOWN_CANDIDATES."),
    ("AUD-021-DOC002", "docs/RELEASING.md uses TZ=UTC for the signed tag; no other date-writing recipe found."),
    ("AUD-021-BLD002", "The package holds every audit-index link target, 72 records and 280 harness files, and no evidence folder."),
]

LEDGER = [
    ("CHECK-SEC-001", "SEC / threat model and secret ownership", "failed", "Secrets traced input to output; AUD-022-SEC001."),
    ("CHECK-SEC-002", "SEC / isolation", "passed", "Permission model, seccomp and Landlock reviewed, FFI dropped before secrets, the documented re-encode exception; Vault, CSP and iframe items do not exist here."),
    ("CHECK-SEC-003", "SEC / network egress", "passed", "No network API in src; sockets refused by seccomp; protection flags grant no network."),
    ("CHECK-SEC-004", "SEC / randomness and encryption", "passed", "node:crypto randomness only; age one-stanza lock reviewed."),
    ("CHECK-SEC-005", "SEC / secret lifecycle", "passed", "PNG bytes and copies wiped on every path; JS strings and pngjs intermediates cannot be wiped (observation)."),
    ("CHECK-SEC-006", "SEC / browser APIs", "not-applicable", "MnemoCode has no browser page; terminal text sanitising reviewed."),
    ("CHECK-SEC-007", "SEC / availability bounds", "passed", "PNG admission probes, bounded readers, repair caps; memory amplification within the limits noted."),
    ("CHECK-FUN-001", "FUN / BIP39 and seed", "passed", "Seedshift oracle 6,000 comparisons; independent Python BIP39 and Seedshift answers; public vectors in the self-test."),
    ("CHECK-FUN-002", "FUN / derivation and coins", "passed", "No coin source changed since HEAD; the coin known answers pass in the self-test and the suite."),
    ("CHECK-FUN-003", "FUN / BIP85, BIP38, messages", "not-applicable", "Not in MnemoCode."),
    ("CHECK-FUN-004", "FUN / scripts and descriptors", "not-applicable", "Not in MnemoCode."),
    ("CHECK-FUN-005", "FUN / transactions and PSBT", "not-applicable", "Not in MnemoCode."),
    ("CHECK-FUN-006", "FUN / recovery and backup formats", "failed", "AUD-022-FUN001 and FUN003; independent SSKR restoration passes."),
    ("CHECK-FUN-007", "FUN / discovery and providers", "not-applicable", "MnemoCode writes candidate lists only; no provider."),
    ("CHECK-API-001", "API / dependency contracts", "failed", "sskr-export to joint repair traced; AUD-022-FUN001."),
    ("CHECK-API-002", "API / async state", "passed", "ReEncoding owns its result across an awaited wallet answer."),
    ("CHECK-API-003", "API / export fidelity", "failed", "One card plan across destinations holds; AUD-022-FUN002."),
    ("CHECK-API-004", "API / encoding interoperability", "failed", "Bytewords, CRC-32 and CBOR agree with every fixture; AUD-022-API001 and the cross-form reading of AUD-022-FUN001."),
    ("CHECK-BLD-001", "BLD / manifest and composition", "passed", "Exports, command table, help and menu include re-encode and png-admission; strict consumers compile."),
    ("CHECK-BLD-002", "BLD / matrix depth", "not-run", "Linux x64 only; Windows and macOS not run."),
    ("CHECK-BLD-003", "BLD / lockfile and licenses", "passed", "Frozen offline lockfile check, no advisories, exact pins, license notices beside the executable."),
    ("CHECK-BLD-004", "BLD / canonical WASM and Docker", "not-run", "Release-level rebuild not run."),
    ("CHECK-BLD-005", "BLD / artifacts and CI", "failed", "Executable build, verify and terminal checks pass; the suite fails (AUD-022-API001, BLD001), so CI would fail."),
    ("CHECK-UI-001", "UI / real files", "failed", "50,806 layouts and real sheets checked; AUD-022-FUN002."),
    ("CHECK-UI-002", "UI / navigation and inputs", "failed", "Terminal checks pass; AUD-022-UI001."),
    ("CHECK-UI-003", "UI / secret visibility, help, QR", "failed", "AUD-022-SEC001, FUN004, DOC008."),
    ("CHECK-ARC-001", "ARC / ownership and imports", "failed", "Host-neutral modules import no Node module; AUD-022-ARC001."),
    ("CHECK-ARC-002", "ARC / dead code and duplication", "failed", "Copy gate passes; AUD-022-ARC001 and dead branches (observations)."),
    ("CHECK-ARC-003", "ARC / tests and comments", "failed", "AUD-022-API001, BLD001, ARC002; stale comments (observations)."),
    ("CHECK-DOC-001", "DOC / capability descriptions", "failed", "Limits, menu, protection claims check out; AUD-022-DOC002, DOC003, DOC005, DOC007, DOC008."),
    ("CHECK-DOC-002", "DOC / commands and links", "failed", "Every link and anchor resolves; AUD-022-DOC004 and DOC007."),
    ("CHECK-DOC-003", "DOC / audit records", "failed", "21 records valid against the schema; AUD-022-DOC001 and DOC006."),
]

OBSERVATIONS = [
    "PNG memory within the admitted limits: an all-zero 16-bit RGBA image of 2048 px peaks at 260 MiB; about 0.7 GiB is estimated at the 4096 px limit for a file of about 130 KB. The exporter writes 720 px 8-bit images; a lower pixel budget or refusing 16-bit depth would narrow it.",
    "pngjs keeps its IDAT, inflated, unfiltered and bitmap buffers unwiped; the comment at src/cli/qr-input.ts:12-15 names only jsQR's copies.",
    "The protection line of interactive re-encode is printed once and not refreshed after dropUnneededAfterAnswers.",
    "--recognised on the command line confirms before the phrase is seen; this is the owner's documented choice (README).",
    "src/export/material-artwork.ts:543 still speaks of an individual fragment; card-copy.ts designTexts keeps a branch for separate material cards that can no longer happen.",
    "src/cli/qr-limits.ts re-exports MAX_PNG_PIXELS and MEGAPIXEL, which nothing imports from there; the moved limits lost their source comments; png-admission.ts builds its MiB message inline while bounded-read.ts owns that wording.",
    "test/aud-021-security.test.ts:245-256 checks malformed streams with a bare toThrow().",
    "No gate compares npm pack with the tracked docs/audits files; a new harness extension or folder would drop out silently.",
    "Pre-existing at HEAD: the import cycle ask.ts → bitcoin-options.ts → input.ts → ask.ts; MaterialCardOptions.pageSize used only by tests; CardPreview.assertSeparateCards and template-catalog assertSeparateCards share a name with different meanings; the menu hint says \"0 to 9 at once\" when secret entries are disabled.",
    "PreparedEncode and the return type of prepareSskrSplit have the same shape.",
    "preview --all --page-size business would render the business designs and then refuse at the first material design without naming it (not run).",
    "docs/audits/README.md:64-66 at HEAD holds a privacy metadata section; rewording pushed text is the owner's decision.",
    "AUD-020 lists machine-local /tmp/codex-security-artifacts paths in its command column without a local-only label; AUD-021 prints its finding counts as a Python dict.",
    "preview --list labels every design \"colors\", although each also prints Unicode codes; help cards merges the file-kind and layout questions; ARCHITECTURE.md says each part has its own path while export/card-renderer is reachable only through mnemocode/cards.",
]

LIMITATIONS = [
    "The coordinator wrote much of the code under review in the same session (re-encode, sheet layout, backdrops, crops, the AUD-020 fixes); five reviewer agents of the same model reviewed it, which is not independent certification.",
    "A first full test run was interrupted when the machine restarted; its partial log is kept. The suite was then run in parts: 88 files with four workers and 28 PDF-generating files three at a time (owner, 2026-10-13), each part capped at 8 GiB and 15 minutes. The counts of the parts are not overlapping.",
    "The comparison with HEAD for AUD-022-FUN001 is an emulation (readings of the whole input and HEAD's capped rule), since the workspace forbids a second working tree.",
    "Windows and macOS, browser runtime acceptance of the Deriver (prohibited there), the canonical Docker/WASM rebuild, release signing and provenance were not run. No full card gallery was rendered.",
    "No commit exists: every AUD-021 fix stays fixed, not verified. This audit does not authorise a release.",
    "The report was first kept outside the repository at the owner's request (2026-10-13) and added to it on the owner's request of 2026-10-13 (UTC); its findings and checks are unchanged by the move.",
]

# The remediation of the AUD-022 findings, on the owner's request of 2026-10-13 (UTC): fixed, not
# verified, since no commit exists. Each entry says what changed and what checks it.
REMEDIATION = {
    "AUD-022-SEC001": "Re-encode shows the original seed phrase only on standard error and only when it is a terminal (showOldPhrase); with standard output sent to a file, the file holds no word of it. The options path shows the original fingerprint only. reencode-stdout.py: 3 PASS; test/re-encode.test.ts.",
    "AUD-022-SEC002": "The privacy gate reads the machine owner's names where it runs (ownerNames) and holds none itself, reads every published audit file (scripts/audit-files.mjs) and refuses every time not given in UTC; fixture tests in test/audit-privacy.test.ts.",
    "AUD-022-FUN001": "Joint repair says that shares do not fit only when no reading of them fits (SolvedWays.needsMore, per reading); decoy prefixes are read only in the form the text is written in (readAcrossSeparators); a capped decoy reading no longer vetoes a solved one. repair-leading-marks.mjs: no case ends in \"do not fit\"; over 180 cases (5 sets, 3 shares, 4 forms, 1 to 3 leading marks) the joint verdict is not-enough, and the single repair holds the share in every case it does not refuse. test/aud-022.test.ts, checked by mutation.",
    "AUD-022-FUN002": "separateCardJob drops the sheet plan's orientation and keeps the person's (export/render.ts), and encode --cards-dir uses it: a 24-word phrase gives 255 x 142 pt cards. test/aud-022.test.ts.",
    "AUD-022-FUN003": "A read header fixes the share's own length: a mark after it is a decoy that carries nothing, in every form, Color Unicode too (ownCountRead, decoysFrom), also where a run of marks goes on past the end; a malformed decoy is still refused. test/aud-022.test.ts in colors, Unicode codes, word numbers and Color Unicode joined and apart, checked by mutation.",
    "AUD-022-FUN004": "validateCardOptions takes a card page size as separate cards; the split and sskr-export ask ShareCardSet.assertPrintable, which draws a share of the longest public secret, before any secret is asked, and a page can ask the same. test/aud-022.test.ts: three refusals through the command line, the library check, and controls.",
    "AUD-022-API001": "PngAdmission gives the distinct refusals of a damaged start again (incomplete, not a PNG, no leading IHDR, IHDR length; the type before the length, so that a first chunk of another type is named as such) before it reads the chunk stream; the AUD-002 and AUD-021 PNG tests and test/aud-022.test.ts pass. aud021-fixed.mjs takes that reason for an IHDR after the IDAT.",
    "AUD-022-API002": "ReEncoding.of refuses a last word for a backup that gives one phrase (LAST_WORD_NOT_TAKEN). test/aud-022.test.ts, test/re-encode.test.ts.",
    "AUD-022-UI001": "A refusal of the new backup's answers is shown and the questions are asked again under the confirmed phrase (newBackupAskedUntilTaken); the rights are given up only after prepareEncode. Terminal case check_re_encode_answer_refused, checked by mutation.",
    "AUD-022-BLD001": "The S118 test follows the share keeping note; the whole suite ran in parts.",
    "AUD-022-ARC001": "The library words how a phrase was confirmed (ReEncoding.confirmationLine, RE_ENCODING_WORDS); the command line only names its evidence. test/aud-022.test.ts.",
    "AUD-022-ARC002": "core/png-admission-self-test.ts: scanline budgets with and without Adam7, computed independently, and three refusals; in the CLI self-test and exported on its own path; fault injection in test/aud-022.test.ts.",
    "AUD-022-DOC001": "AUD-012 holds its committed bytes again; the AUD-021 sentences say what the record check verifies.",
    "AUD-022-DOC002": "docs/card-identities.md counts 29 slogans; a test counts them from the program.",
    "AUD-022-DOC003": "The help describes the cards that exist: every card prints one code.",
    "AUD-022-DOC004": "The SSKR examples give a form that has cards (--share-format colors, --format colors).",
    "AUD-022-DOC005": "Automatic orientation is described as the planner chooses it: at least three rows, then the largest cards (help, README, CHANGELOG, release notes).",
    "AUD-022-DOC006": "The AUD-021 remediation table shows BLD001 as fixed, as its register does.",
    "AUD-022-DOC007": "The re-encode help names --old-mode and --old-format for the old backup.",
    "AUD-022-DOC008": "The sheet QR question and the help say that the code holds the codes of the backup without the extra cards (SHEET_QR_HOLDS, one source).",
}

# How each informational observation was taken up, or why it was left.
OBSERVATIONS_DONE = [
    "PNG memory: left as it is. The limits are AUD-002's and admit every image the exporter writes; narrowing them is a decision of its own.",
    "pngjs buffers: the comment of decodeQrPngFile names what the libraries keep and cannot be wiped.",
    "Protection line: re-encode shows it again once the rights that the answers do not need are given up (showProtection, one function with the private screen's first line).",
    "--recognised: left; the owner's documented choice.",
    "Stale comment and dead branch: removed; designTexts takes only whether the cards are on sheets.",
    "qr-limits.ts removed; the limits keep their source comments in png-admission.ts; the size refusal comes from one place (core/byte-units.ts, InputTooLarge, limitName).",
    "Malformed PNG streams and inflated sizes are checked for the PNG refusal itself.",
    "Package gate: scripts/verify-audit-package.mjs in pnpm check finds every published audit file in npm pack; the privacy gate reads the same list (scripts/audit-files.mjs).",
    "Import cycle broken: the bounded text reader is its own module (cli/text-file.ts); no cycle is left in src/. MaterialCardOptions removed. CardPreview.assertOneDesign. The menu hint names the digits that the list has (\"7, 8, 9 or 0 at once\").",
    "PreparedEncode is the one type of a prepared encode, the split's included.",
    "renderCards checks every design against a card page size before any draws, and names the design that is printed on sheets only.",
    "docs/audits/README.md:64-66: left for the owner.",
    "AUD-020 and AUD-021: historical records, left unchanged.",
    "preview --list numbers the designs, as --template takes them, and names the forms that every design prints once; the cards help asks its two questions; export/card-renderer has an entry of its own.",
]

# The checks of the remediated source, each recorded as remediation-<label> by record.py.
REMEDIATION_CHECKS = [
    ("build", "pnpm build", "Fresh dist/ from the remediated source."),
    ("source", "pnpm check", "Toolchain pins, Markdown lists, audit privacy and package gates, copy gate, four tsc projects."),
    ("format", "pnpm format:check", "Prettier over the repository."),
    ("tests-other", "pnpm exec vitest run --maxWorkers=4 <test files without PDF generation>", None),
    *[(f"tests-pdf-{n:02d}", f"pnpm exec vitest run --maxWorkers=3 <PDF-generating test files, batch {n}>", None) for n in range(1, 11)],
    ("cli-self-test", "node dist/mnemocode.js self-test", None),
    ("terminal-input", "python3 scripts/verify-terminal-input.py", "Every pseudo-terminal case passed, check_re_encode_answer_refused included."),
    ("card-output", "node scripts/check-card-output.mjs docs/audits/AUD-022-evidence/remediation-card-output", "Card, material and SSKR PDFs rendered, QR codes read back exactly."),
    ("repair-leading-marks", "node docs/audits/AUD-022-harnesses/repair-leading-marks.mjs", None),
    ("reencode-stdout", "python3 docs/audits/AUD-022-harnesses/reencode-stdout.py", "3 PASS: the confirmation asked, the phrase on the private screen, none of it in the file."),
    ("sskr-independent", "python3 scripts/verify-sskr-known-answers.py", "The official vector from every valid quorum, invalid quorums refused, every deterministic set."),
    ("aud021-fixed", "node docs/audits/AUD-022-harnesses/aud021-fixed.mjs", None),
    ("executable-build", "node scripts/build-executable.mjs output/aud022-remediation-executable", "Linux x64 executable and license notices."),
    ("executable-verify", "node scripts/verify-executable.mjs output/aud022-remediation-executable", "Every smoke step of the executable passed."),
    ("terminal-executable", "python3 scripts/verify-terminal-input.py output/aud022-remediation-executable/mnemocode-0.1.0-linux-x64", "Every pseudo-terminal case against the executable passed."),
]

REMEDIATION_LIMITATIONS = [
    "Fixed, not verified: no commit exists, and the coordinator who fixed the findings also checked the fixes.",
    "With three leading marks some repairs remain lists of variants with the share among them: colors and Color Unicode of 160 to 256 bits and Unicode codes of 128 bits, which also read as colors run together. Three marked colors hold the checksum and the header, so 4 to 5 bits stay open for each length a share may have; more shares settle them. Three marked colors of 128 bits are refused, as AUD-021 intends.",
    "The Deriver's vendored MnemoCode source no longer matches: the changed host-neutral modules are handed over to the wallet tools.",
    "Windows and macOS, the canonical Docker/WASM rebuild, release signing and provenance were not run.",
]


def vitest_summary(label):
    """The counts of a recorded vitest run, from its log."""
    log = (EVIDENCE / f"{label}.log").read_text(errors="replace")
    files = re.search(r"Test Files\s+(.+?)\s+\((\d+)\)", log)
    tests = re.search(r"\n\s+Tests\s+(.+?)\s+\((\d+)\)", log)
    return f"{files.group(2)} files, {tests.group(2)} tests: {tests.group(1).replace(' | ', ', ')}." if files and tests else "No summary in the log."

def main():
    sys.path.insert(0, str(Path(__file__).parent))
    # The baseline's last check is its final snapshot; remediation changes the source later.
    final = json.loads((EVIDENCE / "snapshot-final.json").read_text())
    checks = []
    for label, cmd, summary in CHECKS:
        r = command(label)
        checks.append({
            "label": label, "command": cmd, "exitCode": r["exitCode"], "startedAt": r["startUtc"], "endedAt": r["endUtc"],
            "summary": summary, "sourceUnchanged": r["sourceBefore"] == r["sourceAfter"] == snapshot["sourceFingerprint"],
            "evidence": {"log": f"AUD-022-evidence/{label}.log", "logSha256": r["logSha256"], "localOnly": True}})
    findings = []
    for f in FINDINGS:
        entry = {"id": f["id"], "category": f["category"], "kind": "finding", "title": f["title"], "severity": f["severity"],
                 "status": "fixed" if f["id"] in REMEDIATION else "open", "releaseBlocking": f["releaseBlocking"]}
        if f["releaseBlocking"]: entry["releaseBlockingReason"] = f["releaseBlockingReason"]
        for key in ("affectedFiles", "reproduction", "expected", "observed", "impact", "evidence", "recommendedFix", "requiredVerification", "tags", "relatedFindings"):
            if key in f: entry[key] = f[key]
        findings.append(entry)
    counts = {}
    for f in findings: counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    blockers = sum(f["releaseBlocking"] for f in findings)
    record = {
        "schemaVersion": 1, "auditId": "AUD-022", "auditNumber": 22, "date": "2026-10-13",
        "title": "Re-check of the AUD-021 fixes and full audit of the 0.1.0 working tree",
        "reviewer": {"name": "Claude Code coordinator with five reviewer agents (security; recovery and formats; cards and terminal UI; architecture, tests and build; documentation)",
                     "model": "claude-opus-5-5", "reasoningEffort": None,
                     "phases": [{"phase": "coordinator", "model": "claude-opus-5-5", "reasoningEffort": None, "scope": "AUD-021 re-check, runtime queue, verification of every reviewer finding, report"},
                                {"phase": "reviewers", "model": "claude-opus-5-5", "reasoningEffort": None, "scope": "five source reviews with small probes"}]},
        "snapshot": {"commit": snapshot["commit"], "commitComplete": False, "workingTree": snapshot["workingTree"],
                     "sourceFingerprint": snapshot["sourceFingerprint"],
                     "sourceFingerprintMethod": "SHA-256 of compact JSON sorted path/SHA-256 entries for Git tracked and untracked non-ignored files, excluding docs/audits/; absent files excluded (the AUD-020 and AUD-021 method).",
                     "capturedAt": snapshot["capturedAt"], "finalCheckAt": final["capturedAt"], "finalSourceFingerprint": final["sourceFingerprint"],
                     "files": snapshot["fileCount"], "sameAsAud021Remediation": snapshot["sourceFingerprint"] == "991f61a993042265cf6ed9575cddc5ab0d84e605fbf0a1aaa2fccb62120e468e"},
        "scope": "The whole MnemoCode checkout at the snapshot: core representations, masking and recovery, SSKR transport and repair, re-encoding, PNG admission, candidate lists, CLI and menu, cards and sheets, tests and self-tests, package, workflows and documents; the AUD-021 findings re-checked. The Deriver was inspected read-only for vendored-source parity only.",
        "procedureHashes": {p.split("multi-chain-wallet-tools/docs/")[1]: sha("../" + p) for p in PROCEDURES},
        "environment": {"os": "Linux 7.0.0-38-generic x86_64", "node": "v26.10.0", "pnpm": "12.8.1", "python": "3.14.4",
                        "installedPackages": {"typescript": "7.0.2", "vitest": "5.0.3", "prettier": "3.9.9", "@noble/curves": "2.4.0", "@noble/hashes": "2.4.0", "@scure/base": "2.4.0", "@scure/bip32": "2.4.0", "@scure/bip39": "2.4.0", "age-encryption": "0.3.1", "jsqr": "1.4.0", "pdf-lib": "1.17.1", "pngjs": "7.0.0", "qrcode": "1.5.4"},
                        "lockfileSha256": sha("pnpm-lock.yaml")},
        "checks": checks,
        "interruptedChecks": [{"label": "tests-full-interrupted", "command": "pnpm exec vitest run --maxWorkers=2", "exitCode": None, "summary": "Interrupted by a machine restart before its summary; superseded by the runs in parts.", "evidence": {"log": "AUD-022-evidence/tests-full-interrupted.log", "localOnly": True}}],
        "testTotals": {"files": 116, "filesFailed": 2, "tests": 2248, "passed": 2242, "failed": 2, "skipped": 4},
        "coverageLedger": [{"checkId": i, "group": g, "outcome": o, "method": m} for i, g, o, m in LEDGER],
        "findings": findings, "observations": [],
        "informationalNotes": OBSERVATIONS,
        "remediation": [{"id": i, "status": "fixed", "fixCommit": None, "verificationCommit": None, "evidence": e}
                        for i, e in [*AUD021, *REMEDIATION.items()]],
        "remediationUpdates": [remediation_update(final)],
        "limitations": LIMITATIONS,
        "summary": {"findings": counts, "releaseBlocking": blockers, "verdict": "FAIL", "testsPassed": 2242, "testsFailed": 2, "testsSkipped": 4, "testFiles": 116},
    }
    text = anonymous(json.dumps(record, indent=2, ensure_ascii=False)) + "\n"
    (HERE / f"{STEM}.json").write_text(text)
    md = markdown(record)
    (HERE / f"{STEM}.md").write_text(anonymous(md))
    validate()

def remediation_summary(label, given):
    """What a remediation check showed: as given, or read from its log."""
    if given is not None: return given
    name = f"remediation-{label}"
    if label.startswith("tests"): return vitest_summary(name)
    log = (EVIDENCE / f"{name}.log").read_text(errors="replace")
    lines = [line.strip() for line in log.splitlines() if line.strip()]
    if label == "repair-leading-marks":
        misfits = sum("do not fit" in line for line in lines[:-1])
        open_cases = int(lines[-1].split()[0])
        return f"{misfits} of {len(lines) - 1} cases end in \"do not fit\"; {open_cases} keep a list of variants with the share among them or the refusal of 128-bit colors, as three leading marks leave them (remaining limitations)."
    return lines[-1]


def remediation_update(final):
    """The remediation addendum: the remediated source, the files that changed, and its checks."""
    remediated = json.loads((EVIDENCE / "snapshot-remediation.json").read_text())
    # The final check of the review found the source of the initial snapshot, whose files it lists.
    assert final["sourceFingerprint"] == snapshot["sourceFingerprint"]
    before = {f["path"]: f["sha256"] for f in snapshot["files"]}
    after = {f["path"]: f["sha256"] for f in remediated["files"]}
    checks, totals = [], {"files": 0, "tests": 0, "passed": 0, "failed": 0, "skipped": 0}
    for label, cmd, given in REMEDIATION_CHECKS:
        r = command(f"remediation-{label}")
        checks.append({
            "label": f"remediation-{label}", "command": cmd, "exitCode": r["exitCode"], "startedAt": r["startUtc"], "endedAt": r["endUtc"],
            "summary": remediation_summary(label, given),
            "sourceUnchanged": r["sourceBefore"] == r["sourceAfter"] == remediated["sourceFingerprint"],
            "evidence": {"log": f"AUD-022-evidence/remediation-{label}.log", "logSha256": r["logSha256"], "localOnly": True}})
        if label.startswith("tests"):
            log = (EVIDENCE / f"remediation-{label}.log").read_text(errors="replace")
            files = re.search(r"Test Files\s+.+?\s+\((\d+)\)", log)
            tests = re.search(r"\n\s+Tests\s+(.+?)\s+\((\d+)\)", log)
            totals["files"] += int(files.group(1)); totals["tests"] += int(tests.group(2))
            for count, kind in re.findall(r"(\d+) (passed|failed|skipped)", tests.group(1)): totals[kind] += int(count)
    return {
        "updatedAt": max(c["endedAt"] for c in checks), "timeZone": "UTC (+00:00)",
        "scope": "Remediation of the AUD-022 findings on the owner's request of 2026-10-13 (UTC); the review above and the local evidence are kept as they were.",
        "status": f"{len(REMEDIATION)} findings fixed, not verified: no fix or verification commit exists.",
        "sourceFingerprint": remediated["sourceFingerprint"], "files": remediated["fileCount"],
        "snapshotSha256": sha(EVIDENCE / "snapshot-remediation.json"), "capturedAt": remediated["capturedAt"],
        "affectedSourceSha256": [{"path": path, "sha256": after.get(path)} for path in sorted(set(before) | set(after)) if before.get(path) != after.get(path)],
        "checks": checks, "testTotals": totals, "observations": OBSERVATIONS_DONE, "limitations": REMEDIATION_LIMITATIONS,
    }


def addendum(r):
    """The Markdown of the remediation addendum."""
    u = r["remediationUpdates"][0]
    t = u["testTotals"]
    L = ["", f"## Remediation addendum ({u['updatedAt'][:10]} UTC)", "",
         f"- **Updated (UTC):** {u['updatedAt']}.",
         "- **Report time zone:** UTC (+00:00).",
         f"- **Remediated source:** `{u['sourceFingerprint']}` over {u['files']} files, by the method of the snapshot; snapshot SHA-256 `{u['snapshotSha256']}`, captured {u['capturedAt']}.",
         f"- **Current status:** {u['status']}",
         "", "The review above, its checks and its verdict are those of the snapshot. The register shows the current status of each finding. This is not a fresh audit.", "",
         "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
    L += [f"| {i} | fixed | Not committed | Not committed | {e} |" for i, e in REMEDIATION.items()]
    L += ["", "### Checks of the remediated source", "",
          "Run one at a time from the repository root, each under cap.sh (8 GiB, no swap, 15 minutes), the PDF-generating test files three at a time; the source was unchanged after each. Logs are local only.", "",
          "| Label / command | Exit | Outcome | Log SHA-256 |", "| --- | --- | --- | --- |"]
    L += [f"| `{c['label']}` / `{c['command']}` | {c['exitCode']} | {c['summary']} | `{c['evidence']['logSha256']}` |" for c in u["checks"]]
    L += ["", f"The suite in parts: {t['files']} files, {t['tests']} tests: {t['passed']} passed, {t['failed']} failed, {t['skipped']} skipped.", "",
          "### Informational observations", ""]
    L += [f"- {o}" for o in u["observations"]]
    L += ["", "### Changed files", "", f"{len(u['affectedSourceSha256'])} files differ from the snapshot; their SHA-256 values are in the JSON record (`remediationUpdates[0].affectedSourceSha256`), a removed file with null.", "",
          "### Remaining limitations", ""]
    L += [f"- {x}" for x in u["limitations"]]
    return L


def markdown(r):
    L = []
    s = r["snapshot"]
    L += [f"# AUD-022 — {r['title']}", "", "## Record metadata", "",
          "- **Audit number:** 22.",
          "- **Completed (UTC):** 2026-10-13.",
          f"- **Reviewer:** {r['reviewer']['name']}.",
          "- **Model:** claude-opus-5-5 for the coordinator and every reviewer.",
          "- **Reasoning effort:** unknown; the client does not retain it.",
          f"- **Reviewed commit:** `{s['commit']}` plus the uncommitted working tree (113 entries).",
          f"- **Source fingerprint:** `{s['sourceFingerprint']}` over {s['files']} files, the AUD-021 remediated source; unchanged at the final check (`{s['finalSourceFingerprint']}`).",
          f"- **Snapshot captured (UTC):** {s['capturedAt']}; final check {s['finalCheckAt']}.",
          "- **Artifacts:** a fresh dist/ build and a Linux x64 executable built from the snapshot into ignored output/aud022-executable/.",
          f"- **Verdict at the snapshot:** **FAIL**: {r['summary']['releaseBlocking']} release-blocking findings were open; two tests of the suite failed. Every finding was fixed afterwards, not verified ([Remediation addendum](#remediation-addendum-{r['remediationUpdates'][0]['updatedAt'][:10]}-utc)).",
          "", "## Finding register", "",
          "| ID | Category | Kind | Severity | Status | Release blocking | Title |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for f in r["findings"]:
        L.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | {f['status']} | {str(f['releaseBlocking']).lower()} | {f['title']} |")
    L += ["", "## Review evidence", "", "### Scope and methodology", "", r["scope"], "",
          "The coordinator re-checked every AUD-021 finding with probes of its own beyond the AUD-021 acceptance tests, ran every runtime check one at a time, and verified each reviewer's finding by source trace and a reproduction before accepting it. Five reviewer agents had distinct scopes and ran only small probes. Public fixtures only.", "",
          "Procedure files, read and hash-bound:", "", "| Procedure | SHA-256 |", "| --- | --- |"]
    for k, v in r["procedureHashes"].items(): L.append(f"| `multi-chain-wallet-tools/docs/{k}` | `{v}` |")
    L += ["", "### Coverage ledger", "", "| Check ID | Group | Outcome | Evidence / gap |", "| --- | --- | --- | --- |"]
    for c in r["coverageLedger"]: L.append(f"| {c['checkId']} | {c['group']} | {c['outcome']} | {c['method']} |")
    L += ["", "### Checks", "", "Every command ran from the repository root on the snapshot; the source was unchanged after each. Logs are local only (AUD-022-evidence/); the harness scripts are in [AUD-022-harnesses](AUD-022-harnesses/).", "",
          "| Label / command | Exit | Outcome | Log SHA-256 |", "| --- | --- | --- | --- |"]
    for c in r["checks"]:
        L.append(f"| `{c['label']}` / `{c['command']}` | {c['exitCode']} | {c['summary']} | `{c['evidence']['logSha256']}` |")
    t = r["testTotals"]
    L += ["", f"The suite in parts: {t['files']} files, {t['tests']} tests: {t['passed']} passed, {t['failed']} failed, {t['skipped']} skipped. A first single run was interrupted by a machine restart and is kept as `tests-full-interrupted` without a result. The original AUD-021 probes assert that their defects are present, so they exit 1 on a fixed tree, as their README says.", "",
          "### Findings", ""]
    for f in r["findings"]:
        L += [f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}", "",
              f"- **Category / status:** {f['category']} / {f['status']}.",
              f"- **Release blocking:** {str(f['releaseBlocking']).lower()}{'. ' + f['releaseBlockingReason'] if f['releaseBlocking'] else ''}",
              f"- **Affected files:** {', '.join('`' + a + '`' for a in f['affectedFiles'])}."]
        if f.get("relatedFindings"): L.append(f"- **Related:** {', '.join(f['relatedFindings'])}.")
        L += [f"- **Reproduction:** {f['reproduction']}", f"- **Expected:** {f['expected']}", f"- **Observed:** {f['observed']}",
              f"- **Impact:** {f['impact']}", f"- **Evidence:** {f['evidence']}", f"- **Recommended fix:** {f['recommendedFix']}",
              f"- **Required verification:** {f['requiredVerification']}", ""]
    L += ["### Remediation and follow-up", "", "The AUD-021 findings, re-checked at this snapshot. They stay fixed, not verified, because no commit exists.", "",
          "| Finding ID | Status | Fix commit | Verification commit | Evidence |", "| --- | --- | --- | --- | --- |"]
    for e in r["remediation"]:
        if e["id"].startswith("AUD-021-"): L.append(f"| {e['id']} | fixed | Not committed | Not committed | {e['evidence']} |")
    L += ["", f"The AUD-022 findings were open at the snapshot; the [Remediation addendum](#remediation-addendum-{r['remediationUpdates'][0]['updatedAt'][:10]}-utc) records their fixes.", "", "### Informational observations and recommendations", ""]
    L += [f"- {o}" for o in r["informationalNotes"]]
    L += ["", "### Assessment and limitations", "",
          f"Twenty findings are confirmed: {r['summary']['findings'].get('medium', 0)} medium and {r['summary']['findings'].get('low', 0)} low, {r['summary']['releaseBlocking']} of them release blocking. Three of them were caused by the AUD-021 remediation (FUN001, API001, BLD001), which ran neither the whole suite nor the affected files. The release is not acceptable on this evidence.", ""]
    L += [f"- {x}" for x in r["limitations"]]
    L += addendum(r)
    return "\n".join(L) + "\n"

def validate():
    record = json.loads((HERE / f"{STEM}.json").read_text(), object_pairs_hook=lambda pairs: dict(pairs) if len({k for k, _ in pairs}) == len(pairs) else (_ for _ in ()).throw(ValueError("duplicate key")))
    schema = json.loads(SCHEMA.read_text())
    jsonschema.Draft202012Validator(schema).validate(record)
    md = (HERE / f"{STEM}.md").read_text()
    missing = [f["id"] for f in record["findings"] if f["id"] not in md]
    # The machine owner's names, read here, as the repository's privacy gate reads them.
    owner = {getpass.getuser().lower(), Path.home().name.lower()} - {"user", "root", "runner"}
    private = [p for p in (HERE / f"{STEM}.md", HERE / f"{STEM}.json") if any(name in p.read_text().lower() for name in owner)]
    result = {"schemaValid": True, "duplicateKeys": False, "findingsInBoth": not missing, "privacy": not private,
              "findings": len(record["findings"]), "releaseBlocking": record["summary"]["releaseBlocking"]}
    (EVIDENCE / "report-validation.json").write_text(json.dumps(result, indent=1) + "\n")
    lines = []
    for path in sorted(p for p in EVIDENCE.rglob("*") if p.is_file() and p.name != "SHA256SUMS"):
        lines.append(f"{sha(path)}  {path.relative_to(EVIDENCE)}")
    (EVIDENCE / "SHA256SUMS").write_text("\n".join(lines) + "\n")
    print(json.dumps(result))
    if missing or private: sys.exit(1)

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    main()
