"""AUD-019: writes docs/audits/AUD-019-2026-10-13.md and .json from one set of data and the
recorded evidence, so that both records say the same, with the remediation addendum.

    python3 docs/audits/AUD-019-harnesses/write-report.py

Reads the ignored docs/audits/AUD-019-evidence/ (command records, snapshots, environment); refuses
to overwrite an existing report. Published text keeps home paths out and times in UTC.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-019-evidence"
REPORT = AUDITS / "AUD-019-2026-10-13"
# The commit whose files outside docs/audits/ are the audited snapshot, byte for byte.
REVIEWED_COMMIT = "6a0701507c9b01283b083b4840667683a08de10b"
# The commits of the earlier fixes: AUD-014 to AUD-017 (as AUD-018 records them) and AUD-018.
PRIOR_FIX_COMMIT = "368fd0c71cc89d04cdd720d5975b890fcb325b59"
PRIOR_RECORDS_COMMIT = "fa948b6a0ef651b14ce64d2dfc721b16d87f917d"
AUD018_FIX_COMMIT = "ad91504be050764e497c748a714d114802ec360e"


def load(name):
    return json.loads((EVIDENCE / name).read_text())


baseline = load("baseline-snapshot.json")
final = load("final-snapshot.json")
remediation = load("remediation-snapshot.json")
environment = load("environment.json")
procedure = load("procedure-hashes.json")
assert baseline["fingerprint"] == final["fingerprint"], "the source changed during the audit"

CHECKS = [
    ("source-check", "Toolchain pins, tight Markdown lists in 15 files, copy gate (50 tokens, 254 files), four TypeScript configurations"),
    ("format-check", "Prettier over the repository (docs/audits excluded by design)"),
    ("build", "Fresh dist/ from the reviewed snapshot"),
    ("all-tests", "The whole collection, the PDF-rendering files included: 110 files, 2,079 passed, 4 skipped by their own condition (slow seedshift-legacy-valid multi-pattern cases)"),
    ("cli-self-test", "Full CLI self-test: PASS, 7 public vectors, 75 representation round trips, card, share-card, heir-sheet and QR exports"),
    ("terminal-input", "Real pseudo-terminal: menu, hidden prompts, word and Bytewords hints, entry 5 with codes, Ctrl+C paths: all passed"),
    ("card-output", "Card export of every template family, sheets and SSKR members, with exact QR round trips at 200 dpi: completed"),
    ("executable", "Single executable built and checked: version, full self-test, held by the system's sandbox (no sockets), masking, 2-of-3 restore, card PDF, help, licence notices"),
    ("package-contents", "npm pack dry run: 530 files; no test, harness or evidence file"),
    ("dependency-advisories", "pnpm audit --audit-level high: no known vulnerabilities"),
    ("private-reporting", "GitHub private vulnerability reporting: enabled (read-only API)"),
    ("sskr-manifest", "All 7 SSKR engine files match sskr-wasm/integrity.json; nothing unlisted"),
    ("record-integrity", "59 audit documents, 79 commit citations (12 explained by the index, 2 in multi-chain-wallet-tools), 1,059 relative links: 0 problems, 20 warnings (dead links to removed files, observation)"),
    ("readme-examples", "README command examples without a secret prompt or PDF: 19 passed, 15 skipped, 2 failed (both read a file that a skipped secret-prompt example writes: a harness limit, as in AUD-018)"),
    ("readme-secret-arguments", "Every README example with --ask-secrets accepted up to its terminal check: 0 refused"),
    ("short-copies", "Diagnostic copy scan at 35 tokens: 2 repetitions, the claim of a probed boundary in two sandboxes (AUD-019-ARC001) and overload declarations in ask.ts (rejected as a copy)"),
    ("probes", "AUD-019 probes: AUD-019-SEC001 reproduces (1 failed: the hint was given up to 12 words), the Linux kernel control passes (1 passed)"),
]


def check_rows():
    rows = []
    for label, summary in CHECKS:
        record = load(f"{label}.command.json")
        rows.append({
            "label": label,
            "command": " ".join(record["command"]),
            "exitCode": record["exitCode"],
            "startedAt": record["startedAt"],
            "endedAt": record["endedAt"],
            "summary": summary,
            "sourceUnchanged": record["sourceBefore"] == record["sourceAfter"] == baseline["fingerprint"],
            "evidence": {"log": f"AUD-019-evidence/{label}.log", "sha256": record["logSha256"], "localOnly": True},
        })
    return rows


LEDGER = [
    ("CHECK-SEC-001", "SEC / Threat model and ownership", "passed", "Secret inputs traced from argument, file, standard input, private screen and QR image to their consumers, and the new paths: word hints on secret prompts (AUD-019-SEC001), codes read apart or run together, entry 5, decoy codes"),
    ("CHECK-SEC-002", "SEC / Permissions and offline isolation", "passed", "Permission model and the new system sandbox read: Linux seccomp and Landlock for every thread, locked memory, core dumps off and read back; the kernel control probe and the executable check show sockets and programs refused. macOS and Windows code reviewed only; the menu's sandbox nesting (observation, fixed)"),
    ("CHECK-SEC-003", "SEC / Network egress", "passed", "No fetch, HTTP, socket, DNS or storage API in src/; seccomp refuses new sockets on Linux; the CLI runs without network permission"),
    ("CHECK-SEC-004", "SEC / Randomness and encryption", "passed", "Only node:crypto (randomInt, the fill for SSKR) and crypto.getRandomValues; decoy codes and card colours through the checked UniformChoice of the render platform; age X25519/scrypt unchanged"),
    ("CHECK-SEC-005", "SEC / Secret exceptional paths", "failed", "AUD-019-SEC001: each redraw of a hint decoded the whole answer typed so far into a new string; the other paths wipe as documented"),
    ("CHECK-SEC-006", "SEC / Injection and persistence", "passed", "No DOM, dynamic code or browser storage; saved PDFs carry no document information (check-card-output asserts it); console output only in src/cli"),
    ("CHECK-SEC-007", "SEC / Input and availability bounds", "passed", "Run-together reading stays under the text limits; marked codes 2^24 combinations; date attempts 2^31; candidate-file ceilings unchanged"),
    ("CHECK-FUN-001", "FUN / BIP39 and representations", "passed", "Startup and full self-test vectors; codes apart, run together and cut by a line break for every form in decode, check, marked codes and recover-word (test/codes-apart-and-joined.test.ts)"),
    ("CHECK-FUN-002", "FUN / Coin derivation", "passed", "Coin vectors in the self-test; README recover-date examples matched a native SegWit address, a zpub, an Ethereum address and a Taproot key"),
    ("CHECK-FUN-003", "FUN / BIP85, BIP38, messages, Silent Payments", "not-applicable", "MnemoCode implements none of them"),
    ("CHECK-FUN-004", "FUN / Scripts and descriptors", "not-applicable", "Only address-script classification for wallet checks, covered by FUN-002; no descriptor, Miniscript or multisig compiler"),
    ("CHECK-FUN-005", "FUN / Transactions and PSBT", "not-applicable", "No transaction or PSBT feature"),
    ("CHECK-FUN-006", "FUN / Recovery and SSKR", "passed", "Published SSKR vectors, Bytewords run together (new known answer), repair, joint repair and recovery suites; full self-test"),
    ("CHECK-FUN-007", "FUN / Local address search", "passed", "Local bounded comparisons only; providers and accounting not applicable"),
    ("CHECK-API-001", "API / Runtime and dependency contracts", "passed", "Package exports resolve in dist/; new APIs reviewed: WordList spacing, bytewordUnits, BackupReading.isCodes, EncodedForm.placeName, card decoys and plans"),
    ("CHECK-API-002", "API / Cancellation and ownership", "passed", "AUD-014 to AUD-018 regression suites and the Ctrl+C terminal cases passed"),
    ("CHECK-API-003", "API / Export contracts", "passed", "All PDF-rendering test files and check-card-output.mjs ran this time; exact QR round trips"),
    ("CHECK-API-004", "API / Codec interoperability", "passed", "Bytewords, UR, CBOR, representation and record round trips with literal vectors"),
    ("CHECK-BLD-001", "BLD / Module composition", "passed", "Portable-module and strict-consumer checks; export map complete; the sandbox modules only in src/cli"),
    ("CHECK-BLD-002", "BLD / Portable source and matrix", "skipped", "Linux only: the macOS and Windows sandbox code was never executed; CI runs it after the push"),
    ("CHECK-BLD-003", "BLD / Pins, lockfile and notices", "passed", "Exact pins, frozen lockfile, toolchain pins and documented versions agree; advisory scan clean; executable licence notices present. No full transitive licence audit"),
    ("CHECK-BLD-004", "BLD / SSKR source and output freshness", "skipped", "Manifest matches all 7 files; no Docker rebuild (pnpm verify:sskr)"),
    ("CHECK-BLD-005", "BLD / Workflows and artifacts", "skipped", "The Linux executable was built and passed its own checks; workflows read; no CI run or release operation"),
    ("CHECK-UI-001", "UI / Terminal viewports", "skipped", "Pseudo-terminal at its default size only"),
    ("CHECK-UI-002", "UI / Terminal inputs and navigation", "passed", "verify-terminal-input.py passed, with the new Bytewords hints and entry 5 cases; menu and prompt tests"),
    ("CHECK-UI-003", "UI / Help and privacy", "passed", "Every README option exists in the commands' --help; menu labels and notes fit their column; private-screen tests passed"),
    ("CHECK-ARC-001", "ARC / Module and class ownership", "passed", "Logic in library modules; code readers own their spacing rules; one sandbox class per system behind one interface"),
    ("CHECK-ARC-002", "ARC / Duplication and dead code", "failed", "AUD-019-ARC001: core-dump calls and the claim of a probed boundary written in more than one place; copy gate at 50 tokens passed"),
    ("CHECK-ARC-003", "ARC / Tests and comments", "passed", "Every new feature brings its startup known answers, full self-test row, unit tests and terminal case; the AUD-014 to AUD-018 regressions present and passing"),
    ("CHECK-DOC-001", "DOC / Capabilities and warnings", "failed", "AUD-019-DOC001 (changelog and release notes describe cards that no longer exist) and AUD-019-DOC002 (SECURITY.md denies the system's limits)"),
    ("CHECK-DOC-002", "DOC / Commands, links and licensing", "passed", "README examples run or are skipped only for a secret prompt or a PDF; 0 refused with --ask-secrets; the 2 failures are the harness limit"),
    ("CHECK-DOC-003", "DOC / Audit records", "passed", "record-integrity.py: 0 problems; 20 dead links of AUD-011 and AUD-012 to removed files (observation)"),
]


def finding(fid, category, severity, title, **fields):
    return {"id": fid, "category": category, "kind": "finding", "title": title, "severity": severity,
            "status": "fixed", "releaseBlocking": False, **fields}


FINDINGS = [
    finding(
        "AUD-019-SEC001", "SEC", "low",
        "A word hint is given the whole answer typed so far, which a secret prompt copies into strings that cannot be wiped",
        releaseBlockingReason="Low: needs access to the process memory; the typed answer itself becomes a string once it is read.",
        affectedFiles=["src/cli/terminal-input.ts (readLine, typedBefore)", "src/core/word-hints.ts (WordList.hint, completion)"],
        reproduction="docs/audits/AUD-019-harnesses/probes.ts, first case: the public phrase abandon … about is typed key by key into readLine with the production BIP39 hints, wrapped to count the words of each text a hint is given.",
        expected="The hint needs the word being typed and enough of the words before it to tell the form of the line; SECURITY.md: temporary copies of the phrase data are cleared as far as possible.",
        observed="typedBefore decoded line.subarray(0, cursor): each redraw built a string of the whole answer so far, up to all 12 words; the probe fails with 12 > 4.",
        impact="While a seed phrase is typed on the private screen, every pause leaves another copy of the words typed so far in the heap until the memory is reused: a few dozen strings for a 24-word phrase. Core dumps are off, so reading them needs access to the process memory, swap or a hibernation image.",
        evidence="AUD-019-evidence/probes.log (local), probes.command.json exit 1",
        recommendedFix="Give the hint only the word being typed and a few before it (a named constant), decoded from the buffer that readLine owns and wipes; add the probe as a regression test.",
        requiredVerification="The probe's first case passes; the word-hint and terminal tests and verify-terminal-input.py still pass.",
    ),
    finding(
        "AUD-019-ARC001", "ARC", "low",
        "Core-dump calls and the claim of a probed boundary are written in more than one place",
        releaseBlockingReason="Low: both copies behave the same today; the risk is a later change to one of them.",
        affectedFiles=["src/cli/protection.ts (switchOffCoreDumps, C_LIBRARY, RLIMIT_CORE, PR_SET_DUMPABLE)",
                       "src/cli/sandbox-linux.ts (libc, its probe claims)", "src/cli/sandbox-macos.ts (libSystem, its probe claims)",
                       "src/cli/system-sandbox.ts"],
        reproduction="node scripts/verify-no-copies.mjs --tokens 35: src/cli/sandbox-linux.ts:343-350 = src/cli/sandbox-macos.ts:170-177 (39 tokens). Reading protection.ts beside sandbox-linux.ts and sandbox-macos.ts: both open the same C library by its own literal name, and protection.ts keeps setrlimit and prctl apart from the sandbox of its system.",
        expected="AGENTS.md, no repetition: a rule, constant or library name has one source; a protection of a system belongs to that system's type (delegation).",
        observed="The code that records a probe's result as held, broken or unknown is written twice; RLIMIT_CORE, the struct rlimit size and the C library names appear in protection.ts and in the sandbox modules; protection.ts decides by platform whether core dumps exist, which the sandbox of that platform knows.",
        impact="A change to the rule of one platform, such as how a failed probe is reported, can miss the other copy, and a new system needs edits in protection.ts as well as its own module.",
        evidence="AUD-019-evidence/short-copies.log (local), short-copies.command.json exit 1; source review",
        recommendedFix="One SandboxRecord type for held boundaries and their reasons, with claim and reach; core dumps switched off and read back by each system's sandbox in start(), asked through coreDumps(); protection.ts asks the sandbox instead of keeping its own calls.",
        requiredVerification="The 35-token scan finds no sandbox copy; the sandbox and protection tests, the executable check and the CLI self-test pass; a protected process without node:ffi still refuses a secret.",
    ),
    finding(
        "AUD-019-DOC001", "DOC", "low",
        "The changelog and the release notes still describe share cards in every form, which the card redesign removed",
        releaseBlockingReason="Low and not blocking for the code; the release text must be corrected before v0.1.0 is published, since it is copied into the release.",
        affectedFiles=["CHANGELOG.md, line 38", "docs/releases/v0.1.0.md, line 33 and its card and secret-handling sections"],
        reproduction="Read CHANGELOG.md line 38 and docs/releases/v0.1.0.md beside src/export/card-codes.ts and the refusal \"Shares written as words have no cards\"; compare the release notes with the CHANGELOG entries of 2026-10-12 and 2026-10-13.",
        expected="The changelog and the release notes say what the code does; the release notes carry the changes of the release.",
        observed="Both say that share cards print word numbers, Unicode codes or Bytewords, three to a card, beside random colours; the code refuses cards of shares in words. The release notes also say that separate cards print the size of the set, which they no longer do, and lack the redesign, the word hints, the system sandbox, the wiping of saved documents and QR input, and codes read apart or run together.",
        impact="A reader of the release expects cards that the program refuses, and does not learn of new protections and inputs.",
        evidence="Source and document review recorded in this report",
        recommendedFix="Rewrite the changelog line for cards of colours and Unicode codes only; bring the release notes in line with the changelog.",
        requiredVerification="The changelog and release notes agree with the code and with each other; pnpm check (Markdown lists) passes.",
    ),
    finding(
        "AUD-019-DOC002", "DOC", "low",
        "SECURITY.md says that no limit of the operating system applies, though the system sandbox now enforces some",
        releaseBlockingReason="Low: it understates the protection rather than overstating it.",
        affectedFiles=["SECURITY.md, section on what limits MnemoCode, and the swap warning"],
        reproduction="Read SECURITY.md lines 22-27 beside src/cli/system-sandbox.ts and the executable check \"is held by the system's sandbox (kernel: no sockets)\".",
        expected="SECURITY.md describes the limits as they are: where the system enforces some, which differ by system and version, and what stays usable.",
        observed="\"Neither is a limit of the operating system\" and \"MnemoCode is not a sandbox\"; the swap warning does not say that it is left out when all memory is locked.",
        impact="A reader judges the protection by a wrong description; a person on a system with the sandbox does not learn that descriptors opened before it, such as the terminal, stay usable.",
        evidence="Source and document review recorded in this report",
        recommendedFix="Say that MnemoCode is not a complete sandbox, that only the limits the system enforces stop a compromised program from connecting, that they differ by system and version, and that descriptors opened before them stay usable; name the locked-memory case of the swap warning.",
        requiredVerification="SECURITY.md agrees with system-sandbox.ts and protection.ts; pnpm check passes.",
    ),
]

FIXES = {
    "AUD-019-SEC001": {
        "files": ["src/cli/terminal-input.ts", "test/terminal-input-echo.test.ts"],
        "change": "HINT_CONTEXT_WORDS = 4: typedBefore decodes only from the fourth word before the cursor, enough to tell Bytewords after the codes of another share or English words among codes. A regression test types abandon … about and asserts that no hint sees more than four words.",
    },
    "AUD-019-ARC001": {
        "files": ["src/cli/sandbox-record.ts (new)", "src/cli/system-sandbox.ts", "src/cli/sandbox-linux.ts",
                  "src/cli/sandbox-macos.ts", "src/cli/sandbox-windows.ts", "src/cli/protection.ts",
                  "test/system-sandbox.test.ts", "test/protection.test.ts", "docs/ARCHITECTURE.md"],
        "change": "sandbox-record.ts holds the interface, SandboxRecord (hold, lack, attempt, reach, claim) and switchOffCoreDumps with RLIMIT_CORE; each system's sandbox switches core dumps off in start() and reports them through coreDumps(); protection.ts keeps no system call of its own and refuses a secret when coreDumps() failed. Tests cover the record, claim and a protected process without node:ffi.",
    },
    "AUD-019-DOC001": {
        "files": ["CHANGELOG.md", "docs/releases/v0.1.0.md"],
        "change": "The changelog line now names cards of colours and Unicode codes only; the release notes drop the stale lines and carry the redesign, word hints, system sandbox, wiping of saved documents and QR input, entry 5 and codes read apart or run together.",
    },
    "AUD-019-DOC002": {
        "files": ["SECURITY.md"],
        "change": "MnemoCode is not a complete sandbox; only the limits the system enforces, which differ by system and version, stop a compromised program from connecting, and descriptors opened before them stay usable; the swap warning is left out when all memory is locked.",
    },
}

REMEDIATION_LABELS = [
    ("remediation-source-check", "pnpm check passed: copy gate at 50 tokens over 255 files"),
    ("remediation-format-check", "pnpm format:check passed"),
    ("remediation-build", "Fresh build"),
    ("remediation-all-tests", "The whole collection: 110 files, 2,083 passed, 4 skipped by their own condition"),
    ("remediation-cli-self-test", "Full CLI self-test PASS"),
    ("remediation-terminal-input", "Real pseudo-terminal: all cases passed"),
    ("remediation-probes", "Both probe cases pass: AUD-019-SEC001 no longer reproduces"),
    ("remediation-short-copies", "Exit 1 for one repetition left: the overload declarations of ask.ts (rejected as a copy); the sandbox copy is gone"),
    ("remediation-executable", "Single executable built and its checks passed, the system's sandbox included"),
]
FIX_STATUS = ("Fixed, not verified: the fixes are committed together with this record, and no later "
              "commit has verified them yet.")

PRIOR = [
    *[(f"AUD-014-{c}", PRIOR_FIX_COMMIT) for c in ["SEC001", "SEC002", "FUN001", "FUN002", "FUN003"]],
    *[(f"AUD-014-API{n:03d}", PRIOR_FIX_COMMIT) for n in range(1, 13)],
    ("AUD-001-API001", PRIOR_FIX_COMMIT), ("AUD-012-SEC004", PRIOR_FIX_COMMIT),
    *[(f"AUD-015-{c}", PRIOR_FIX_COMMIT) for c in ["API001", "API002", "API003", "UI001", "SEC001"]],
    ("AUD-016-API001", PRIOR_FIX_COMMIT), ("AUD-017-DOC001", PRIOR_RECORDS_COMMIT),
    ("AUD-018-SEC001", AUD018_FIX_COMMIT), ("AUD-018-DOC002", AUD018_FIX_COMMIT),
]
PRIOR_EVIDENCE = (
    f"Verified at {REVIEWED_COMMIT[:12]}: every file outside docs/audits/ of that commit is the audited "
    "snapshot byte for byte (source fingerprint below). The regression tests of these findings "
    "(test/aud-014-*.test.ts, aud-015, aud-016, aud-017, aud-018) passed in all-tests, the PDF-rendering files "
    "included, and check-card-output passed; AUD-017-DOC001 by the check records of AUD-018 and this "
    "audit, which bind the source before and after each command; AUD-018-DOC002 by record-integrity.py "
    "with 0 problems. The render comparison that AUD-014 and AUD-015 named compared cards before and after "
    "their fixes; the card redesign has changed the renders on purpose since, and the PDF tests and the "
    "export round trip were run instead."
)
STILL_FIXED = (
    "Fixed, not verified: every README example with --ask-secrets is accepted up to its prompt (0 refused), "
    "but the manual run with the prompts that its required verification names was not made."
)
REMEDIATION = [
    {"id": fid, "status": "verified", "fixCommit": commit, "verificationCommit": REVIEWED_COMMIT,
     "evidence": PRIOR_EVIDENCE}
    for fid, commit in PRIOR
] + [
    {"id": "AUD-018-DOC001", "status": "fixed", "fixCommit": AUD018_FIX_COMMIT, "verificationCommit": None,
     "evidence": STILL_FIXED},
] + [
    {"id": f["id"], "status": "fixed", "fixCommit": None, "verificationCommit": None,
     "evidence": f"Remediation addendum (2026-10-13). {FIX_STATUS}"}
    for f in FINDINGS
]

NOTES = [
    "Observation, fixed with ARC001: the start menu restricted the system sandbox for the widest needs of any command before it starts each command as a process of its own. On macOS a process inherits the sandbox of the process that starts it, and a second profile applied inside it may be refused, so a command could have run under the menu's wider profile only. Found in review, not executed (no macOS host). The menu now gives up node:ffi and file writes of the permission model only, and each command applies its own sandbox.",
    "AUD-011 and AUD-012 link 20 times to the frosted glass sources (src/export/glass-cards.ts, glass-artwork.ts, glass-layout.ts) that the card redesign removed; the links pointed at the reviewed state. Future reports should link a commit-pinned URL.",
    "readme-examples.py runs each command alone, so the two examples that read a file written by a skipped secret-prompt example fail (decode --input-file direct-unicode.txt, decode --qr-file my-palette-qr.png); a harness limit, recorded as in AUD-018.",
    "The 35-token copy diagnostic finds the overload signatures of askOrCancel in src/cli/ask.ts: declarations, not behaviour, as in AUD-018.",
    "The working tree of 2026-10-12 held another agent's README rewording together with later edits in the same paragraphs, and no copy of it survives; the states of AUD-018's baseline and remediation could therefore not be rebuilt as commits of their own. The reviewed source was committed as five commits ending at the reviewed commit; docs/ARCHITECTURE.md and test/portable-modules.test.ts match the AUD-018 baseline hashes.",
    "Node.js 26's libuv opens its io_uring rings at start, before MnemoCode runs, so seccomp can refuse io_uring_setup but not io_uring_enter on those rings; recorded in sandbox-linux.ts.",
    "The encode prompt for a seed phrase takes words only; whether it should also take codes is the owner's open question and not a finding.",
]

LIMITATIONS = [
    "Single reviewer (Claude Code, no subagents, no independent skeptic) at the owner's request; the same reviewer made the fixes.",
    "Not run: macOS and Windows (their sandbox code was reviewed only and runs first in CI after the push), the Docker rebuild of the SSKR engine, CI and any release step.",
    "The README examples that ask for secrets or draw PDFs were not run; the terminal check types secrets through a pseudo-terminal at its default size only.",
    "The source review was risk-based: the changes since AUD-018 (card redesign and decoys, word hints, the system sandbox, codes apart and joined, entry 5), input and secret paths, documents and records; not every line was read.",
    "The audited snapshot was the uncommitted tree on fa948b6; its files outside docs/audits/ were then committed unchanged as five signed commits ending at the reviewed commit.",
]

TITLE = "Full-scope MnemoCode audit after the card redesign, word hints, the system sandbox and codes apart or run together"


def remediation_rows():
    rows = []
    for label, summary in REMEDIATION_LABELS:
        record = load(f"{label}.command.json")
        expected = 1 if label == "remediation-short-copies" else 0
        assert record["exitCode"] == expected, label
        assert record["sourceBefore"] == record["sourceAfter"] == remediation["fingerprint"], label
        rows.append({"label": label, "command": " ".join(record["command"]), "exitCode": record["exitCode"],
                     "startedAt": record["startedAt"], "endedAt": record["endedAt"], "summary": summary,
                     "evidence": {"log": f"AUD-019-evidence/{label}.log", "sha256": record["logSha256"],
                                  "localOnly": True}})
    return rows


def json_record(addendum_checks):
    return {
        "schemaVersion": 1,
        "auditId": "AUD-019",
        "auditNumber": 19,
        "date": "2026-10-13",
        "title": TITLE,
        "reviewer": {"name": "Claude Code, single reviewer", "model": "claude-opus-5-5", "reasoningEffort": None},
        "snapshot": {
            "commit": REVIEWED_COMMIT,
            "commitComplete": True,
            "capturedOn": {"commit": baseline["commit"], "workingTree": baseline["workingTree"].splitlines(),
                           "uncommittedDiffSha256": baseline["uncommittedDiffSha256"]},
            "workingTree": "Captured as the uncommitted tree on its parent commit; committed unchanged as the reviewed commit, whose files outside docs/audits/ have the same source fingerprint.",
            "sourceFingerprint": baseline["fingerprint"],
            "sourceFingerprintMethod": "SHA-256 of the JSON list of {path, sha256} of every tracked or untracked, not ignored file outside docs/audits/ (audit.py source)",
            "capturedAt": baseline["capturedAt"],
            "finalCheckAt": final["capturedAt"],
            "files": len(baseline["files"]),
        },
        "scope": "Full scope of the 32 CHECK items, executed in part on Linux: the library, CLI, cards, SSKR engine, system sandbox, workflows, documents and audit records, with the changes since AUD-018 reviewed first. Baseline review without changes; the fixes followed in a separate phase, recorded in the remediation addendum.",
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
        "summary": {"findings": {"low": 4}, "releaseBlocking": 0, "testsPassed": 2079, "testsSkipped": 4,
                    "testFiles": 110},
        "remediationAddendum": {
            "date": "2026-10-13",
            "commit": remediation["commit"],
            "sourceFingerprint": remediation["fingerprint"],
            "uncommittedDiffSha256": remediation["uncommittedDiffSha256"],
            "capturedAt": remediation["capturedAt"],
            "statusRule": FIX_STATUS,
            "fixes": [{"id": fid, **fix} for fid, fix in FIXES.items()],
            "checks": addendum_checks,
        },
    }


def markdown(record):
    lines = [f"# AUD-019 — {TITLE}", "", "## Record metadata", ""]
    lines += [
        "- **Audit number:** 19.",
        f"- **Completed (UTC):** 2026-10-13; final snapshot {final['capturedAt']}, remediation snapshot {remediation['capturedAt']}.",
        "- **Reviewer:** Claude Code, single reviewer without subagents.",
        "- **Model:** claude-opus-5-5.",
        "- **Reasoning effort:** unknown.",
        "- **Reviewer phases:** baseline review, then remediation by the same reviewer on the owner's request.",
        f"- **Reviewed commit:** `{REVIEWED_COMMIT}`. The snapshot was captured as the uncommitted tree on `{baseline['commit']}` (diff SHA-256 `{baseline['uncommittedDiffSha256']}`) and then committed unchanged; every file outside `docs/audits/` of the reviewed commit has the same bytes.",
        f"- **Source fingerprint:** `{baseline['fingerprint']}` over {len(baseline['files'])} files, the same before every check, at the end and for the reviewed commit.",
        "- **Artifacts:** fresh `dist/` and Linux single executable from this snapshot; SSKR engine files hash-checked against their manifest, not rebuilt.",
        "",
        "## Finding register",
        "",
        "Four low findings; none is release blocking for the code. AUD-019-DOC001 must be corrected before the release text is published. No critical, high or medium finding. All four are fixed (see the remediation addendum).",
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
        f"Linux x86-64, Node {record['environment']['node']}, pnpm {record['environment']['pnpm']}, TypeScript {environment['installedPackages']['typescript']}, Vitest {environment['installedPackages']['vitest']}. Every command ran through `audit.py`, one at a time, recording the source fingerprint before and after it. Raw logs and command records are local in the ignored `AUD-019-evidence/`.",
        "",
        "Method: the recorded checks below, which this time include the whole test collection with the PDF-rendering files, the card export round trip and the executable; source review of the changes since AUD-018 and of the secret paths they touch; probes through production entry points with public data only.",
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
            "- **Status:** fixed (see the remediation addendum).",
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
        fix = f"`{row['fixCommit'][:12]}`" if row["fixCommit"] else "With this record"
        verification = f"`{row['verificationCommit'][:12]}`" if row["verificationCommit"] else "Not verified"
        if row["status"] == "verified":
            evidence = "See the first note below"
        elif row["fixCommit"]:
            evidence = "See the second note below"
        else:
            evidence = "Remediation addendum"
        lines.append(f"| {row['id']} | {row['status']} | {fix} | {verification} | {evidence} |")
    lines += ["", f"Note on the verified findings: {PRIOR_EVIDENCE}", "", f"Note on AUD-018-DOC001: {STILL_FIXED}", "", "### Informational observations and recommendations", ""]
    lines += [f"- {note}" for note in NOTES]
    lines += ["", "### Assessment and limitations", ""]
    lines += [
        "The source, build, the whole test collection with the PDF files, the full CLI self-test, the real terminal check, the card export round trip, the executable, package contents and advisory scan pass at this snapshot. The four findings are low: one secret-lifecycle gap in the word hints, one repetition in the sandbox code and two documents that describe the program wrongly. The earlier findings of AUD-014 to AUD-018 are verified at the reviewed commit, except AUD-018-DOC001, which still lacks its manual run.",
        "",
    ]
    lines += [f"- {item}" for item in LIMITATIONS]
    lines += ["", "This is not a release acceptance or a security certification."]
    addendum = record["remediationAddendum"]
    lines += [
        "",
        "## Remediation addendum (2026-10-13)",
        "",
        f"The findings above keep their reviewed text; only their status changes. The fixes were made by the same reviewer on the owner's request, on `{addendum['commit']}` with uncommitted changes, source fingerprint `{addendum['sourceFingerprint']}` (diff SHA-256 `{addendum['uncommittedDiffSha256']}`). {FIX_STATUS}",
        "",
        "| Finding ID | Files | Change |",
        "| --- | --- | --- |",
    ]
    for fid, fix in FIXES.items():
        lines.append(f"| {fid} | {', '.join(f'`{name}`' for name in fix['files'])} | {fix['change']} |")
    lines += ["", "| Check | Exit | Result | Command |", "| --- | --- | --- | --- |"]
    for row in addendum["checks"]:
        lines.append(f"| {row['label']} | {row['exitCode']} | {row['summary']} | `{row['command']}` |")
    lines += ["", "The logs stay local; their SHA-256 values are in the JSON record."]
    return "\n".join(lines) + "\n"


def main():
    record = json_record(remediation_rows())
    for suffix, text in [(".json", json.dumps(record, indent=2) + "\n"), (".md", markdown(record))]:
        with REPORT.with_suffix(suffix).open("x") as out:
            out.write(text)
    print("written", REPORT.with_suffix(".md").name, REPORT.with_suffix(".json").name)


if __name__ == "__main__":
    main()
