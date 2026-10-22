# Current remediation register

This is the current cross-audit status of known MnemoCode issues. Historical
audit reports describe their original snapshots and remain unchanged. Times
and verification dates here are UTC (+00:00).

Each row names one concrete variant under its original finding ID. A new
variant does not create a duplicate finding. A regression means the same
verified path failed again after an identified change; finding an older missed
path is recorded as a coverage gap instead. Tests, source identity and review
must support a `verified` state. Local verification and external host/platform acceptance are separate states;
pending host acceptance remains visible even after a local variant is verified.

## Standalone release acceptance (2026-10-22)

### Current release preparation after manual testing

Signed `633f120` contains the subsequent manual-testing corrections: menu spacing and independent output choices, retained results above follow-up questions, Escape cancellation, original words without a second code copy, automatic QR checks, share QR exports and Shamir repair within Re-encode before confirmation of the original phrase. `ae20050` dates version 0.1.0 for release. These changes are later than the native checkpoint below; its executable hashes and test totals do not describe this candidate.

The complete local run covered 3,654 tests in 279 files: 3,648 passed and six obsolete expectations failed. All six were corrected in five test files without changing runtime code or removing the checked security properties; all 81 cases in those files then passed. Mandatory gates, the full self-test, the complete real-terminal suite, independent SSKR known answers and the package-file review passed. The standard dependency audit reported no known vulnerabilities. These overlapping runs are not a new all-green full-suite total.

Release preparation is in progress. The signed release tag, complete tagged Windows/macOS/Linux checks, canonical SSKR comparison, new executable artifacts, attestations and OpenPGP signing must finish before publication. Earlier native artifacts remain evidence of their own source only. Browser/MHFE integration remains deferred by the owner's ordering.

### Retained native checkpoint before manual testing

Standalone pre-release verification is complete for the three tested native targets. The full [CI run](https://github.com/hobby-eng/mnemocode/actions/runs/39722442871) checked signed source `f980236`; all three source-test and real-terminal jobs passed. No confirmed high/medium code finding remains open in the reviewed release paths. This is bounded verification, not a claim that every possible defect or CORE violation has been ruled out.

| Native target | Passed | Failed | Conditional skips | Test files | Real terminal |
| ------------- | ------ | ------ | ----------------- | ---------- | ------------- |
| Linux x64     | 3,490  | 0      | 0                 | 269        | passed        |
| Windows x64   | 3,427  | 0      | 62                | 269        | passed        |
| macOS arm64   | 3,487  | 0      | 4                 | 269        | passed        |

Totals belong to each platform and are not added. Conditional skips cover platform-specific Unix signals, permissions, special paths/pipes and local Poppler availability; Linux has no skips. Windows uses a real ConPTY check, while Linux/macOS use real pseudo-terminals. Every applicable test passes; the Unix permission fixture runs on Unix, with portable lookup-fault checks on all three hosts.

The full Linux job also passed mandatory code/duplication/dead-export/type/lint gates, Rust tests and doctests, build, full self-test, PDF/image/QR export, independent SSKR known answers and the standard dependency audit, which reported no known vulnerabilities. The runtime source, native engine, dependencies, assets, embedded manual/vectors and executable-build inputs remain byte-identical to the three accepted [native executable jobs](https://github.com/hobby-eng/mnemocode/actions/runs/39719696645) at `2e8c249`. Those executables were built and tested on their own OS, including empty-folder execution and real terminal checks; their source identity is preserved rather than relabeled as a later rebuild. The Linux artifact also matches the two local builds byte for byte.

| Executable                    | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `mnemocode-0.1.0-linux-x64`   | `64e5671567f4232131f362a5cf6f02c175830167c81d6e9f83d61bc43717e769` |
| `mnemocode-0.1.0-macos-arm64` | `f54313585eff93b34e3ec8b0ae9f7963f1b5e880832f8ce21a76dec8960b796c` |
| `mnemocode-0.1.0-win-x64.exe` | `1d7191ede81a58048733d67677cb8d52d2632d837418e86cf3a71082e0cd72fa` |

No new tool, dependency or skill was installed for this closure. It uses the existing pinned Node/TypeScript/Vitest, Rust/Clippy/rustfmt, canonical Docker SSKR evidence, Git/GitHub Actions and the diagnosis/JavaScript testing skills. Independent read-only CORE-53 review accepted the exact portability changes and retained red/control/green checks.

Browser/MHFE integration remains deferred by the owner; the API handoff is record-only for later intake. No release tag, OpenPGP release signing or publication was performed. The document-only acceptance update does not change the tested runtime or build inputs. Earlier dated checkpoints below retain their original results and former holds; this current acceptance supersedes their pending native/dependency statuses.

### Native portability corrections

The full native run identified these platform-specific cases after the
frozen AUD-038 report's earlier local snapshot. No public API, mnemonic operation, native engine or executable-build
input changes in this correction.

| Finding                                           | Correction                                                                                                                                                                                                                                                            | Verification and current limit                                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-038-BLD003 / Git root aliases (low)           | Compare canonical physical directory names on both sides of the Git-root check. A short or aliased root previously made history checks report no checkout and file gates ignore Git's excludes. Nested directories remain rejected.                                   | New real-Git alias/junction regression fails before the correction and passes after it; existing blame and conflict/exclusion cases pass. Native Windows follow-up passed.                                                                  |
| AUD-038-BLD004 / macOS renderer fixture (low)     | Resolve the fixture's temporary root as the child shell does; exercise every original case with both direct and aliased roots. Production renderer PATH and CWD guards are unchanged.                                                                                 | Original three failures reproduced through an aliased temporary folder; all 16 cases pass. Restoring the faulty fixture makes three new aliased cases fail. Independent review accepted the exact file hash. Native macOS follow-up passed. |
| AUD-038-BLD005 / Python stderr line endings (low) | Canonicalize only CRLF to LF for the complete exact refusal message. Keep exit status, empty stdout, all inputs and independent Python logic unchanged.                                                                                                               | A real CRLF-configured Python stream reproduces all four failures before correction and passes afterwards. Native Windows follow-up passed.                                                                                                 |
| AUD-038-BLD006 / Unix permission fixture (low)    | Keep the actual chmod-based search-permission test on non-root Unix hosts. Add path-specific stat faults for missing/non-directory and denied/I/O failures on every host, with exact public and cause codes. Windows chmod cannot remove directory search permission. | Four portable fault cases and the existing applicable real-permission case pass. No production refusal handling changed. Native Windows follow-up passed.                                                                                   |

All seven affected test files pass locally: 93 cases, zero failures/skips.
Formatting, all mandatory gates, strict types, lint, Rust tests/doctests and
Git-root and formatting-reference validation pass. The red/control/green checks, exact source hashes,
resource records and independent reviews stay in local ignored evidence.
The full native follow-up has now passed on the correction. Conditional
platform-only cases are explicitly counted in the current acceptance table.

## Earlier local release checkpoint (2026-10-22)

[AUD-038](audits/AUD-038-2026-10-22.md) records the targeted pass-5 and standalone
release checks after the completed pass-4 continuation. It preserves earlier
correct fixes; it is not another complete all-files audit. The pass-4 signed
fixups `4ed59cb` and `230425c` passed 3,469 tests in 266 files. That retained
result is separate from the current complete run: **3,477 passed in 267 files,
zero failed or skipped**, with full source and standalone terminal acceptance.
Overlapping totals are not added.

| Finding and variant                                  | Status   | Fix / checked snapshot             | Current evidence                                                                                                                                                                                                               |
| ---------------------------------------------------- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUD-037-FUN004 / reordered missing leading color     | verified | `1137905` / `cecdd9c`              | Both color forms retain the original phrase; all 700 registered rotations across five phrase lengths pass. Shared search bounds and deduplication remain. A tiny known-answer startup case covers the original counterexample. |
| AUD-004-API001 / nullish wallet evidence             | verified | `1137905` / `cecdd9c`              | Null and undefined receive the existing stable refusal code before property access. The same new test fails before the guard and passes after it.                                                                              |
| AUD-038-UI001 / complete SSKR result requested again | verified | `1137905` / `cecdd9c`              | A regression observes only repeated output. Real PTY checks cover direct output and masked 80×24 paging with distinct fingerprints, complete backup and all shares.                                                            |
| AUD-038-BLD001 / stopped audit child returns zero    | verified | Reviewed harness hashes in AUD-038 | A real timeout with a SIGTERM handler returning zero fails before the wrapper guard and passes after it. Both child and wrapper statuses remain recorded; the historical monitor is unchanged.                                 |
| AUD-038-BLD002 / cached answers labeled as live      | verified | Reviewed harness hashes in AUD-038 | Every live advisory run uses a fresh folder; explicit replay alone reads cache. A network-edge regression fails before and passes after the correction.                                                                        |
| AUD-038-DOC001 / incorrect program fix reference     | verified | Corrected report fields            | All three program fixCommit fields now name `1137905`; verificationCommit remains `cecdd9c`. The original incorrect draft is retained as negative evidence.                                                                    |
| AUD-037-BLD001 / unreleased history regroup          | open     | Not performed                      | Signed fixups are retained. The explicit no-history-rewrite hold requires approval before regrouping and updating affected audit references.                                                                                   |

The program fixups are signed in UTC. The checked non-audit source fingerprint
at `cecdd9c` is
`7388084ba8a90e8ee914d4b4815a39676d91f739f5eb6c0f1329fb47f386f2b5`.
This subsequent register/index update changes documentation only; it does not
claim another full suite execution. Both independent reviewers accepted their
exact corrected source scopes and the failing-before/passing-after evidence.

Two fresh Linux builds of the final candidate match byte for byte. The file is
`release/readiness-final/mnemocode-0.1.0-linux-x64`, SHA-256
`64e5671567f4232131f362a5cf6f02c175830167c81d6e9f83d61bc43717e769`.
Standalone self-test, permission/sandbox checks and the full PTY suite pass.
Five fresh starts took 497–520 ms. A canonical Docker SSKR compilation with
the built-stage cache disabled also matches the committed WASM; no native or
generated byte changed.

Current dependencies have supplemental fresh official GitHub global-advisory
evidence: 217 npm versions, 134 Cargo registry versions, 21 queries and no
matches; a known-vulnerable positive control returned five matches. The
ordinary `pnpm audit` command still failed because its endpoint timed out.
The supplemental check does not relabel that failure as a pass.

Release acceptance remains **INCOMPLETE**: current Windows/macOS source and
executable checks require an authorized push, history regroup is on hold,
and the standard dependency-audit command has no successful current result.
Older green platform checks retain their original source identities.
Browser/MHFE integration is deferred by the owner's ordering; wallet-tools
received portable API notes for later intake only. No push, history rewrite,
tag, release signing or publication was performed by this follow-up.

All execution receipts, raw failures, source manifests, exact API handover and
review records stay local under `tmp/aud037/release-readiness/` and the ignored
`docs/audits/AUD-038-evidence/`. The report carries the hashes and portable
rerun instructions. No remaining confirmed high/medium code defect was found
in the reviewed paths; partial semantic coverage and unexecuted acceptance
remain explicit.

## Standard statuses (2026-10-20)

This table gives each correction that the register tracks from AUD-032 to
AUD-036 a status from the audit standard, with its fix and verification
commits. It was added on 2026-10-20 for AUD-037-DOC016 and AUD-037-DOC013.
It is a documentation change: no test or build was run again for it. The
sections below keep their wording, except the status column of the AUD-035
table, which now uses these values.

The fix commit is the first commit that contains the correction. The
corrections from AUD-032 to AUD-036 were made in an uncommitted working tree
and entered the history together in
`4978a620d43a8571b89ccfc01f3b5a58b3a8c421`. The verification commit is the
commit whose files the recorded passing checks covered. For `4978a62` these are
the AUD-036 checks: the complete local run of 2,988 project tests with none
failed or skipped, the 18 native Rust tests, the full self-test and the real
terminal checks. They ran before the commit, on files that AUD-036 binds
to it. On 2026-10-20 the machine-local AUD-036 manifest was compared with the
commit again. Every code, test and native file matches byte for byte; only
`CHANGELOG.md`, `docs/REMEDIATION.md` and `docs/releases/v0.1.0.md` differ.
The complete source tests later ran on
`f8d9a933ba9bde8290da39d42fa3a380de78385a` itself: in the
[complete CI run](https://github.com/hobby-eng/mnemocode/actions/runs/39291308933)
on Linux, macOS and Windows, and in the 3,001 tests of AUD-037.

A status covers the variant named in its row. Related defects that AUD-037
found later stay open under their own IDs. The AUD-033 report is withheld; the
[audit index](audits/README.md#aud-033-withheld-report) summarises its findings.

| Finding ID                                         | Status   | Fix commit | Verification commit | Evidence                                                                                                                                                                                    |
| -------------------------------------------------- | -------- | ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-032-BLD001                                     | verified | `4978a62`  | `4978a62`           | The literal inventory in `test/scan-fixes-s006-s061.test.ts` lists all 28 current redacted labels.                                                                                          |
| AUD-032-BLD002                                     | verified | `4978a62`  | `4978a62`           | `test/sskr-cli-export.test.ts` expects the current share-QR wording and still restores from members 1 and 3.                                                                                |
| AUD-032-DOC001                                     | verified | `4978a62`  | `4978a62`           | `SECURITY.md` names `crypto.randomFillSync`, which `src/sskr/share-platform-node.ts` calls; re-read at the commit on 2026-10-20.                                                            |
| AUD-033-API001                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-boundaries.test.ts`                                                                                                                                                           |
| AUD-033-API002                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-boundaries.test.ts`                                                                                                                                                           |
| AUD-033-API003                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-combiner-errors.test.ts` for direct and joint restore; later caller variants have their own rows.                                                                             |
| AUD-033-ARC001                                     | verified | `4978a62`  | `4978a62`           | All 55 members that AUD-033 listed have doc comments at the commit; re-read on 2026-10-20.                                                                                                  |
| AUD-033-ARC002                                     | verified | `4978a62`  | `4978a62`           | The two Rust and two TypeScript tests are named by their behaviour at the commit; re-read on 2026-10-20.                                                                                    |
| AUD-033-ARC003                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-srgb.test.ts`                                                                                                                                                                 |
| AUD-033-ARC004                                     | verified | `4978a62`  | `4978a62`           | `test/card-session.test.ts` uses deterministic choices.                                                                                                                                     |
| AUD-033-ARC005                                     | verified | `4978a62`  | `4978a62`           | `test/aud-014-cli.test.ts` keeps the real card planner.                                                                                                                                     |
| AUD-033-ARC006                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-terminal-session.test.ts` and the real terminal checks.                                                                                                                       |
| AUD-033-BLD001                                     | verified | `4978a62`  | `4978a62`           | The `test/aud-033-encryption-*.test.ts` files.                                                                                                                                              |
| AUD-033-BLD002                                     | verified | `4978a62`  | `4978a62`           | `test/self-test-integrity.test.ts` does not count an unreached fault as a passing control.                                                                                                  |
| AUD-033-SEC001                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-secret-sources.test.ts`                                                                                                                                                       |
| AUD-033-SEC002                                     | verified | `4978a62`  | `4978a62`           | `test/aud-033-signing-arguments.test.ts`                                                                                                                                                    |
| AUD-033-UI001                                      | verified | `4978a62`  | `4978a62`           | `test/aud-033-legacy-view.test.ts`                                                                                                                                                          |
| AUD-033-UI001 / common-SSKR-layout                 | verified | `7facfcc`  | `f8d9a93`           | The two common-layout regressions in `test/private-result.test.ts`, in the complete CI run.                                                                                                 |
| AUD-033-UI002                                      | verified | `4978a62`  | `4978a62`           | `test/ask-word-recovery.test.ts` and the real terminal secret checks.                                                                                                                       |
| AUD-033-UI003                                      | verified | `4978a62`  | `4978a62`           | `test/aud-033-help-safety.test.ts`                                                                                                                                                          |
| AUD-033-UI004                                      | verified | `4978a62`  | `4978a62`           | `test/aud-033-path-display.test.ts`                                                                                                                                                         |
| AUD-029-SEC001 / AUD-033 paths                     | verified | `4978a62`  | `4978a62`           | AUD-033 lifetime regressions such as `test/aud-033-working-memory.test.ts` and `test/aud-033-reader-lifetime.test.ts`.                                                                      |
| AUD-029-SEC001 / bounded-file-close-result         | verified | `4978a62`  | `4978a62`           | The five AUD-034 cases in `test/bounded-read-cleanup.test.ts`.                                                                                                                              |
| AUD-029-SEC001 / parsed-backup-indexes             | verified | `4978a62`  | `4978a62`           | `test/aud-035-parser-scratch.test.ts`                                                                                                                                                       |
| AUD-029-SEC001 / detected-format-indexes           | verified | `4978a62`  | `4978a62`           | `test/aud-035-parser-scratch.test.ts`                                                                                                                                                       |
| AUD-029-SEC001 / rgb-scratch                       | verified | `4978a62`  | `4978a62`           | `test/aud-035-byte-scratch.test.ts`                                                                                                                                                         |
| AUD-029-SEC001 / utf8-validation-scratch           | verified | `4978a62`  | `4978a62`           | `test/aud-035-byte-scratch.test.ts`                                                                                                                                                         |
| AUD-029-SEC001 / shorter-phrase-prefix-scratch     | verified | `4978a62`  | `4978a62`           | `test/aud-035-parser-scratch.test.ts`                                                                                                                                                       |
| AUD-033-API003 / complete-input-operational-error  | verified | `4978a62`  | `4978a62`           | `test/aud-035-share-input.test.ts`                                                                                                                                                          |
| AUD-033-API003 / minimum-quorum diagnostic subsets | verified | `4978a62`  | `4978a62`           | `test/aud-035-share-input.test.ts` and `test/aud-035-minimum-quorum-cli.test.ts`                                                                                                            |
| AUD-035-SEC001 / native-failed-digest-owner        | verified | `4978a62`  | `4978a62`           | The vendored native test `failed_authentication_wipes_actual_reconstructed_bytes_before_their_owner_is_freed`.                                                                              |
| AUD-035-API002 / native-group-index                | verified | `4978a62`  | `4978a62`           | `test/aud-035-native-self-test.test.ts` and the native test that refuses a group index outside the group count.                                                                             |
| AUD-035-DOC001 / stopped-plan-contract             | verified | `4978a62`  | `4978a62`           | `test/aud-035-cancellation-contract.test.ts`                                                                                                                                                |
| AUD-036-DOC001                                     | verified | `4978a62`  | `4978a62`           | `test/aud-036-fingerprint-notes.test.ts` and the legacy-view regressions.                                                                                                                   |
| AUD-036-UI001                                      | verified | `4978a62`  | `4978a62`           | The forced-colour 40/80-column cases in `test/menu-terminal.test.ts`.                                                                                                                       |
| AUD-036-BLD001                                     | verified | `4978a62`  | `4978a62`           | The negative controls of `docs/audits/AUD-036-harnesses/validate.py`; AUD-036's machine-local publication snapshot binds the validator bytes of this commit. Not part of the default suite. |
| AUD-036-BLD002                                     | verified | `4978a62`  | `4978a62`           | As AUD-036-BLD001.                                                                                                                                                                          |
| AUD-036-BLD003                                     | verified | `4978a62`  | `4978a62`           | The adjacent `requirements.md` reuses the AUD-030 hash-pinned file; no clean installation was run.                                                                                          |

The AUD-029 to AUD-031 rows of "Earlier corrections carried forward" keep the
statuses of their own reports. AUD-029 labels the byte-order-mark regression
that its lifetime review found "P2", both in its Markdown remediation notes and
as `"priority": "P2"` under the sub-ID `AUD-029-SEC001-review-001` in its JSON.
"P2" there is a legacy scheduling priority (`legacyPriority` in the standard's
terms), not an ID or a severity. The regression belongs to AUD-029-SEC001,
whose severity is low, and AUD-029 records it as fixed and accepted by an
independent follow-up. The AUD-029 record itself is not changed.

## Test-gate follow-up (2026-10-19)

The normal Vitest suite now discovers only `test/**/*.test.ts`. Before this
correction, discovery included 209 maintained test files, one published audit
runner probe and one ignored local diagnostic. Afterward the same 209 maintained
files remain, with neither diagnostic included. Historical probes stay on disk
and can be run explicitly; no maintained test, fixture or assertion was removed.
Earlier suite totals retain their original discovery scopes and are not revised.

`pnpm check:rust`, which is part of `pnpm check`, now also executes the Rust
workspace's tests. The three workspace crates pass all 18 cases, including the
vendored secret-lifetime regressions. Clippy and rustfmt remain in that command.
The full `pnpm check` passes with the existing 3 GiB memory reserve. The formatting
commit in `.git-blame-ignore-revs` now names the actual reachable commit
`0dbf39d3b6b0fbb3c08a46a5b1414cc20871a470`.

The main agent reviewed these changes under the owner's instruction to use no
additional agents. They change test selection and gates. Production sources,
native-engine files, dependency versions and executable-building code remain
unchanged. The parallel AUD-037 remains separate;
its unfinished candidate list is not represented as an accepted audit report.

## Latest private-output correction (2026-10-19)

An additional pagination coverage gap was confirmed from the concurrent audit's
ordinary 2-of-3 Unicode and colors-as-Unicode examples. The private viewer sized
a compact summary, while the terminal printed more header facts and both code
views. All three shares now use one rendered-line source for printing and
pagination. The pager strips only owned styling before measuring those lines;
redirected payloads and their stderr headers retain their original channels.

This is tracked beside AUD-033-UI001 as the common-SSKR-layout variant.
Both new regressions fail before the correction. The nearest four-file run
passes all 31 cases with no skips; a registration-only split then passes all
21 cases in the affected file. These overlapping totals are not added.
`pnpm check`, the source build and the complete real pseudo-terminal checks
pass. Earlier resource stops and the initial overlong test-group lint refusal
remain in local evidence; neither was counted as a program pass. The test
group was split without changing its assertions or relaxing the line limit.

The owner requested no additional agents. The main agent reviewed this delta;
the concurrent audit's original reproduction is retained separately. No new
independent review of the correction is claimed. The initial correction
checkpoint ran targeted checks; the later complete source matrix below verifies
the resulting candidate separately. Portable
library and native-engine bytes are unchanged. The corrected standalone Linux file now passes all nine empty-folder checks
and the complete real pseudo-terminal suite. Its SHA-256 is
`f3a35d61000a7231bad3e0edd974c03e63479e5fdffbba91ec47d6be3166c634`;
the file is `release/local-7facfcc/mnemocode-0.1.0-linux-x64`.
The [Executable run](https://github.com/hobby-eng/mnemocode/actions/runs/39288756606)
for signed source `7facfccedd950a084df94933a230ca2f7a0f473a` also passes
build, executable acceptance and real terminal checks on Linux, Windows and
macOS. This establishes execution of the files on those systems, separately
from the full source-test results below.

The owner subsequently authorized pushing the signed checkpoints and running
full CI and Executable checks, without a tag or release. The initial jobs checked `abf7729` and were superseded by `7facfcc`.
GitHub's delayed Actions processing was an external execution delay, recorded in
its [incident record](https://www.githubstatus.com/incidents/8tzbpcnl75jp),
not passing platform acceptance.

## Full-CI test portability follow-up (2026-10-19)

The full source-test runs for both signed snapshots exposed test-support
problems that the existing local evidence had not reached. Their failing logs
remain retained, separately from successful executable acceptance.

- The historical recorder test now creates its ignored evidence parent in a clean checkout and runs its recorder with the caller's installed tools rather than a historical machine-specific PATH.
- Child-only self-test fault injection passes its preload as a file URL, including on Windows drive paths. The actual faults and exact critical-refusal assertions remain in place.
- The independent Python arithmetic test normalizes CRLF before comparing logical output lines; every word number, refusal and checksum assertion remains exact.
- Cancellation tests assert Windows' intentional raw-mode retention and Unix's immediate line-mode restoration, while continuing to require stopped reads, removed listeners, cancellation, wiped input and propagated failures.
- Exhaustive Encode menu checks are registered by all five first-form answers, with the same subsequent traversal and assertions. The real-screen walk also checks Escape before that first answer. Every case retains the original 60-second limit; no path is intentionally omitted.

The first six-file Linux follow-up passes all 111 cases. Its earlier sandboxed
attempt could not start Bash/Python/Node children (`EPERM`) and is not a
successful application check. The final two-file menu run passes all 68 cases, including the separate
first-question Escape control. Both walks assert the complete agreed first-form
list, so adding a form cannot silently escape their registration. These totals
overlap the earlier run and are not added. `pnpm check` passes: strict types,
type-aware lint, duplication, rule, privacy/package and Rust gates.
The complete source matrix below subsequently verified this signed checkpoint.
This follow-up leaves production, dependency, native-engine and portable-library
inputs unchanged. The owner requested no
additional agents; review is by the main agent, with no independent acceptance
claimed.

## Native acceptance completed (2026-10-19)

The [complete CI run](https://github.com/hobby-eng/mnemocode/actions/runs/39291308933)
passes on signed checkpoint `f8d9a933ba9bde8290da39d42fa3a380de78385a`.
Every job builds and executes the program, runs its full self-test and source
tests, and drives the real terminal, including private input and cancellation.
These are actual completed results, not compilation alone.

| System                    | Passed source tests | Existing conditional skips | Failed |
| ------------------------- | ------------------- | -------------------------- | ------ |
| Linux (Ubuntu 24.04, x64) | 3,000               | 0                          | 0      |
| macOS 15 (arm64)          | 2,997               | 4                          | 0      |
| Windows 2025 (x64)        | 2,973               | 26                         | 0      |

The platform totals are not added as different tests. Nine extra registrations
split existing menu products; that count does not represent nine new behaviors.
macOS skips three Poppler-dependent cases and one Linux-only check. Windows
skips one
`pdftocairo`-dependent case and 25 POSIX/Linux-only cases covering filenames,
permissions, job control, dump protection and shell/audit helpers. Their existing
conditions are unchanged; skips are not passes. Linux executes every source
case, plus the PDF/image/QR round trip, independent SSKR known answers and
`pnpm audit --audit-level high`, which reports no known vulnerabilities.
Native image conversion with `pdftocairo` was not executed on macOS or Windows.

The separate [Executable run](https://github.com/hobby-eng/mnemocode/actions/runs/39288756606)
passes on all three systems for `7facfccedd950a084df94933a230ca2f7a0f473a`.
Each standalone file passes nine empty-folder checks and the real terminal
suite. Subsequent test-support and status-document changes leave all production,
dependency, native and build inputs unchanged. The local Linux file also matches
the independently built Ubuntu file byte for byte. Exact SHA-256 values are:

| Standalone file               | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `mnemocode-0.1.0-linux-x64`   | `f3a35d61000a7231bad3e0edd974c03e63479e5fdffbba91ec47d6be3166c634` |
| `mnemocode-0.1.0-win-x64.exe` | `e97b73af761a5969c796cd7f6a51ef8476a6790c65592525b2839fa5e7261c71` |
| `mnemocode-0.1.0-macos-arm64` | `e2f1224c30b0c296891d4334bc8f2b86eafd2300707d219c5cb5228d190a34f2` |

The full package-path review contains 1,155 candidate entries and two untracked
harnesses from the owner's separate concurrent audit. Those two files remain
outside this signed checkpoint and are absent from a clean CI checkout. The
local dry-run is not published or represented as a clean-source tarball. No
local evidence, generated user exports or test directories are packed.

The confirmed corrections and planned native/browser acceptance are now closed
within the recorded scope. Historical failed runs and resource refusals remain
separate evidence. Universal CORE compliance, globally optimal code and the
absence of every defect remain unproved.
Tagging, release publication, release signing, history rewriting and the
owner-deferred G1/Rust-port work are separate from these checks and were not
performed.

## Browser acceptance follow-up (2026-10-19)

Both remaining encrypted candidate-list scenarios now pass in Firefox 157.0,
one in each edition. Each actual Deriver writes the list to the Scanner key;
the Scanner opens it and removes it. The main session reconciled the raw
reports, logs, current harness identities and all four literal HTML hashes.
Both executions exit zero, with no HTTP requests or page errors, and all owned
children are reaped. The measured aggregate peaks are 1,791,956 KiB and
1,860,624 KiB, within the 1,920 MiB budget; the 3 GiB system reserve is retained.

Current evidence therefore contains **60 passing scenarios**: the 58 retained
cases below and these two new executions. The 96 raster exports remain inside
the four raster cases, not additional scenarios. No replay of all 58 is implied.
Selected producer/host library and artifact identities remain unchanged.

Each new Firefox run also records three unsupported `clipboard-write` warnings
and two fixed `invalid tag` stream errors. Source tracing identifies a matching
startup negative control: it changes the last byte of a public encrypted
fixture and requires decryption to refuse it. Attribution of these exact console
events to that control is a static inference, not an instrumented rerun. The
messages are retained without filtering; no zero-console-error claim is made.
The runtime handoffs pass their original assertions. This closes the two
previously missing cases, without claiming every option combination or native
OS protections in a browser.

## Retained AUD-036 follow-up

This section retains the status recorded before the later push authorization
and the CLI correction above. Its execution and artifact identities are historical.

The recorded AUD-036 complete local replay has **2,988 passing project tests in 210
versionable files, zero failed or skipped**. Unchanged default discovery also
executes one ignored historical diagnostic: the raw result is 2,989 passed in
211 files. These counts describe the same execution and are never added.
All 649 frozen source inputs and every discovered test hash matched before
and after the replay. Source fingerprint:
`a01fe1d1f6ee09025f67b7b7a7afd1e02082cfe19a0efb2ea5802efa36643080`.
The exact local receipt is
`docs/audits/AUD-036-evidence/final/suite-summary.json`.

| Finding / variant                            | Cause and correction                                                                                                                                                            | Current verification                                                                                                         | Independent review                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AUD-036-DOC001 / fingerprint explanation     | One shared sentence now reaches the result and reference presentations. Wallet values, arguments, original hint exports and all 128 legacy TSV rows stay unchanged.             | Actual CLI red/green, 132 nearest cases, complete final suite and source/executable PTY pass.                                | Exact disclosure and final record/fixture snapshots accepted.                                              |
| AUD-036-DOC001 / introduced label regression | The first correction expanded a short label to 44 characters. Keep the short label and append a display-only explanation through the existing parsed-result/display separation. | First complete run retained: 2,986 passed, one failed. Final full run passes; the unchanged width assertion was not relaxed. | Final eight-file capsule accepted; earlier acceptance that missed the geometry problem remains historical. |
| AUD-036-UI001 / secondary explanation colour | The added explanation inherited cyan from the value. Apply the existing muted style to the explanation alone.                                                                   | Identical 40/80-column forced-colour cases fail before the one-line correction and pass after it; final full suite passes.   | Exact source, literal SGR controls and fixture addendum accepted.                                          |

These presentation corrections use two finding IDs. The label regression corrects the first remediation;
it is not a duplicate root or a defect attributed to an earlier author. A Python
terminal helper still expected the old question. Only that exact literal
changed; fingerprint, answer sequence and exact matching remain intact.
The complete source PTY rerun passed.

The independent final-document review also found three Low defects in the new
audit-only validator. It independently reconciled the actual program results
correctly; these are defects in acceptance of inconsistent evidence, not new
MnemoCode production failures.

| Finding        | Audit-support correction                                                                                                                              | Verification and review                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-036-BLD001 | Refuse optimized Python before removed assertions could produce a passing receipt.                                                                    | Exact prior script accepts a wrong artifact under optimization; corrected script refuses before replacing the success receipt. Independent follow-up accepts the guard.     |
| AUD-036-BLD002 | Recompute both ordered source fingerprints and compare reported execution fields, commands and log identity with the bound receipts.                  | Wrong execution and documentation fingerprints are accepted before and refused after correction; correct current evidence passes. Independent follow-up accepts the checks. |
| AUD-036-BLD003 | Declare the existing Python environment through an adjacent hash-pinned requirements recipe and check the frozen pin manifest and installed versions. | All six existing versions match; manifest hash and installation recipe reviewed. No dependency installation or clean-environment replay was performed.                      |

The three audit-support findings were corrected by the main agent and accepted
by the independent reviewer. Their original review and exact prior script,
negative controls and separate follow-up remain local. This brings the current
AUD-036 register to five finding IDs, with the program and support-tool scopes
kept explicit.

Strict types, lint, duplication and Rust gates, build, full source self-test,
source PTY, 18 native tests, independent SSKR oracle, actual card/QR output,
advisory audit and fresh Linux executable acceptance/PTY passed. The final full
suite includes the earlier minimum-quorum correction. Production, native,
dependency and build inputs remain unchanged during final report reconciliation.

- Signed implementation checkpoint: `4978a620d43a8571b89ccfc01f3b5a58b3a8c421`; its SSH signature was verified cryptographically and both commit dates are UTC. Subsequent status-document changes do not change executable, test, native or dependency inputs.
- Current local Linux build: `release/local-4978a62/mnemocode-0.1.0-linux-x64`, SHA-256 `129798bce6fd43bb13ee26420ad81120af1667d27dd94ec5a26c0b7a889d2307`. Its fresh build and nine empty-folder acceptance checks pass. It is byte-identical to the earlier `release/aud036/` candidate, whose executable PTY and damaged-minimum-quorum refusal passed. The first fresh-build attempt stopped at its RSS budget; that incomplete attempt is retained separately from the successful retry.
- Independent changed-code review covered 177 baseline paths and affected callers. It found the presentation omissions above and no new confirmed architectural, security-runtime or material performance defect. This does not establish globally optimal code or universal CORE compliance.
- Wallet-tools admitted coherent v5 metadata: all 239 selected producer files still match, with 240 host manifest entries including a retained license. Its source review traced 11 commands, 91 unique options and 337 command-option bindings without a confirmed missing function. This is static tracing, not every possible runtime combination.
- Current browser evidence contains 58 passing scenarios: 16 lifecycle, four raster, 32 functional, four card and two Chromium candidate-list scenarios. The four raster scenarios include 96 image exports; 58 and 96 must not be added. Actual logs, reports and four HTML identities were reconciled. Two Firefox self-test console diagnostics containing a fixed “invalid tag” remain recorded; no zero-console-error claim is made.
- The host corrected card-text truncation, the introduced “Show” reset, and retained DOM text from retired encoded views. Complete browser acceptance remains **INCOMPLETE**: encrypted candidate-list handoff in both Firefox editions is still pending. The attempted Multi-Chain case stopped at its resource budget; the Dash case has not run. A safe memory floor is required before a retry, with a 3 GiB reserve; no application assertion failure or passing result is inferred from a budget stop.
- Browser and CLI interfaces have explicit differences: UR versus Bytewords as the initial SSKR display, initial orientation, a 65,536-unit UTF-16 browser raw-text limit versus 1 MiB UTF-8 file input, downloads/ZIP instead of native destination paths, and native OS protection. Presence of all operations/settings does not establish identical defaults, admitted inputs or OS capabilities.
- Windows/macOS checks remain unexecuted for these unpublished bytes. The owner's push hold remains active; old-main CI is not current-source evidence.
- Platform acceptance requires actual source tests and execution of each platform's standalone file, including full self-test, recovery, files and real terminal input/cancellation. Compilation alone is not acceptance. The manual CI and Executable workflows provide these checks; their current results must be inspected separately. Wine is supplementary compatibility testing and has not been used as Windows acceptance evidence.
- A later owner instruction permits separate MHFE work to resume. MnemoCode acceptance remains incomplete, and the push hold remains active; resuming that work does not establish a MnemoCode release.
- Two previously published history items still need a pre-release decision: `ee4499e` is a one-line `fixup!` and `8aa9b25` has a work-in-progress title. No history rewrite or force-push is inferred from permission to make a local commit; preserve the cited audit identities until a regroup or an exception is explicitly authorized.
- Code and local browser evidence are reconciled separately from pending acceptance. No push, tag, history rewrite or release publication has been performed; the owner explicitly reconfirmed the push hold.

See [AUD-036](audits/AUD-036-2026-10-19.md) and its JSON companion for exact
bindings, failures, review scope and pending acceptance. The following AUD-035
sections retain their original history; older totals and artifacts are not the
current final replay.

## Corrections from AUD-035 (retained history)

On 2026-10-20 the status column took the standard value `verified`; the scope words it
held before (current Linux snapshot or current scoped follow-up) now open the verification
cell. Fix and verification commits are in [Standard statuses](#standard-statuses-2026-10-20).

| Finding ID / variant                               | Cause and required behavior                                                                                                    | Status   | Regression / verification                                                                                                                                                                           | Independent review                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| AUD-029-SEC001 / parsed-backup-indexes             | Retire the privately parsed indexes after admission or refusal; preserve borrowed input to `of`.                               | verified | Linux snapshot: Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / detected-format-indexes           | Retire every successfully parsed detection scratch, including wrong-count input.                                               | verified | Linux snapshot: Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / rgb-scratch                       | Retire temporary byte conversion after RGB extraction, including exceptional exit.                                             | verified | Linux snapshot: Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / utf8-validation-scratch           | Retire temporary validation bytes on valid and refused characters.                                                             | verified | Linux snapshot: Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / shorter-phrase-prefix-scratch     | Retire the private shorter prefix after admission/refusal; preserve the longer owner and returned recovery.                    | verified | Linux snapshot: Existing sibling found independently: actual prefix regression fails before/passes after, longer owner/output preserved. Final suite passes.                                        | followup-review.json accepts ownership and behavior.                                                        |
| AUD-033-API003 / complete-input-operational-error  | Propagate operational combiner failures instead of diagnosing a valid share as bad; diagnose declared quorum refusals only.    | verified | Linux snapshot: Four operational-fault cases fail before/pass after; declared-quorum and genuinely damaged-share controls pass. Combined68 and final full suite pass.                               | followup-review.json accepts error classification and caller contract.                                      |
| AUD-033-API003 / minimum-quorum diagnostic subsets | Skip only empty or insufficient omission subsets using the existing topology; propagate operational failures of valid subsets. | verified | Scoped follow-up: Actual native and real CLI regressions fail before/pass after; current 46 cases and old/new binary comparison pass. Six host-native controls pass after coherent v2 intake.       | minimal-quorum-review.json and minimum-quorum-cli-review.json accept the exact source and checkers.         |
| AUD-035-SEC001 / native-failed-digest-owner        | Give the dependency's reconstructed secret a wiping owner before digest verification can fail.                                 | verified | Linux snapshot: Actual native red/green, 18 native tests and Clippy pass; canonical write/uncached-stage compare match all four outputs and 32 pins. Final source/standalone checks pass.           | native-review.json accepts all 32 frozen source inputs; external host/platform acceptance remains separate. |
| AUD-035-API002 / native-group-index                | Reject a group index outside the declared group count at the native boundary.                                                  | verified | Linux snapshot: Actual native red/green, 18 native tests and Clippy pass; canonical write/uncached-stage compare match all four outputs and 32 pins. Final source/standalone checks pass.           | native-review.json accepts all 32 frozen source inputs; external host/platform acceptance remains separate. |
| AUD-035-DOC001 / stopped-plan-contract             | Document the returned stopped assessment; preserve the correct cancellation behavior.                                          | verified | Linux snapshot: Returned stopped plan is documented and tested; original public cleanup contract preserved. Strict types and final full suite pass.                                                 | followup-review.json and test-cleanup-review.json accept the documentation and corrected test.              |

At the AUD-035 baseline, the affected logic of the original eight variants
was already present at `261aaedaedeb17ac1e32cd31371c850f740d2ba5`.
The pre-existing uncommitted edits at those sites were comments or an unrelated
export; the native source, lockfile, representation detection, UTF-8 validation
and cancellation wrapper had no such body changes then. These were existing
missed paths, not demonstrated regressions from the latest Copilot fixes.
The corrections tracked above were made after that baseline. Author attribution
is not inferred from uncommitted files.

The scoped reviewer also caught a type-contract mistake in the new cancellation test before acceptance: `using` required a disposal member absent from the public `JointPlan` interface. Strict compilation reproduced TS2741. The test now calls the existing `wipe()` contract in `finally`; strict compilation and independent follow-up passed. No public API was widened to accommodate the test.

## Previously verified controls retained

| Finding ID / variant                       | Current state                                                                 | Evidence retained                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-029-SEC001 / bounded-file-close-result | Verified at the AUD-035 baseline; not reopened by the scratch variants above. | Five default regressions and the original close-error probe: original exception preserved, zero unreturned bytes left nonzero.                                    |
| Date-recovery test skips                   | Verified at the AUD-035 baseline.                                             | All 48 cases execute with unchanged fixtures, assertion/oracle bodies and 60-second timeout. Full baseline suite: 2,956 passed in 204 files, zero failed/skipped. |

## Earlier corrections carried forward

These entries index corrections retained at the AUD-035 baseline. Original
reports and source-bound evidence keep their qualifications; this table does
not relabel historical snapshots as clean. Current AUD-029-SEC001 and
AUD-033-API003 variants are tracked separately above.

| Original IDs                                                   | Retained correction / tracking boundary                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-029-ARC001 through ARC007                                  | Granular entries, narrow SSKR capabilities, forwarding, configuration snapshots, injected timing, one export policy and release-helper cancellation. [Recorded corrections](audits/AUD-029-2026-10-15.json).            |
| AUD-030-SEC001; AUD-015-API001; AUD-030-API001 through API003  | Redacted native refusal, cancellation handoffs, Unicode scalar validation and distinct-share counts. [Recorded corrections](audits/AUD-030-2026-10-15.json).                                                            |
| AUD-030-BLD001; DOC001 through DOC003; UI001                   | Fast CI policy, threshold guidance, harness links/recorder metadata and terminal combining cells.                                                                                                                       |
| AUD-031-ARC001; DOC001; BLD001; API001; DOC002; SEC001; FUN001 | Formatting, example disposal, shipped release docs, coded manifest errors, corrected ownership claims, redacted font refusal and retained checked card options. [Recorded corrections](audits/AUD-031-2026-10-15.json). |
| AUD-032-BLD001; BLD002; DOC001                                 | Current owner inventory/share-QR assertions and actual random-fill adapter wording. [Recorded corrections](audits/AUD-032-2026-10-16.json).                                                                             |
| AUD-033-API001                                                 | Bound single-share candidate enumeration before listing; boundary regression retained.                                                                                                                                  |
| AUD-033-API002                                                 | Dense immutable word-hint snapshot; boundary regression retained.                                                                                                                                                       |
| AUD-033-API003                                                 | Direct/joint restore distinguishes host faults from invalid quorums; complete-input sibling is tracked above.                                                                                                           |
| AUD-033-UI001                                                  | Page legacy-valid candidates on the private screen; legacy-view regression retained.                                                                                                                                    |
| AUD-029-SEC001 / AUD-033 paths                                 | Candidate, geometry, artwork and PDF-reader cleanup; new scratch/native variants stay separate above.                                                                                                                   |
| AUD-033-ARC001                                                 | Public class-member API comments; documentation inventory reviewed in AUD-035.                                                                                                                                          |
| AUD-033-ARC002                                                 | Behavioral test names; no fixtures/assertions removed to rename them.                                                                                                                                                   |
| AUD-033-ARC003                                                 | One sRGB linearization rule and its regression.                                                                                                                                                                         |
| AUD-033-ARC004                                                 | Deterministic card-session diversity check.                                                                                                                                                                             |
| AUD-033-ARC005                                                 | CLI regression uses actual card planning; adapters replace external input boundaries only.                                                                                                                              |
| AUD-033-ARC006                                                 | PTY distinguishes OS errors from empty reads/closure.                                                                                                                                                                   |
| AUD-033-BLD001                                                 | Cached candidate-encryption known answers run before feature use.                                                                                                                                                       |
| AUD-033-SEC001                                                 | Private input or explicit local files for material-valued CLI input.                                                                                                                                                    |
| AUD-033-SEC002                                                 | Release-tool refusals redact raw invalid arguments.                                                                                                                                                                     |
| AUD-033-UI002                                                  | Repeat-passphrase prompts identify the secret and purpose.                                                                                                                                                              |
| AUD-033-UI003                                                  | Command/topic help retains the closing safety line.                                                                                                                                                                     |
| AUD-033-UI004                                                  | Terminal display sanitizes outside paths.                                                                                                                                                                               |

The AUD-033 correction dossier remains local and was included in the
[AUD-035 current-tree review](audits/AUD-035-2026-10-18.md). The
[audit index](audits/README.md#aud-033-withheld-report) summarises the AUD-033
findings and says why their report is withheld. The standard status of the
AUD-032 and AUD-033 rows is in [Standard statuses](#standard-statuses-2026-10-20).
The baseline suite
executed all 2,956 cases with no skips. These rows preserve those correction
scopes; they do not claim that every sibling variant has been found or that
external host/platform acceptance is complete.

## Deferred work and external acceptance

| Item                                                         | State and boundary                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1-001 / TypeScript-Rust Bytewords and UR ownership          | Previously owner-deferred to the later Rust port (see [Roadmap](ROADMAP.md#mnemocode-in-rust)); not silently treated as fixed or as a new 0.1.0 defect.                                                                         |
| Current wallet-tools intake                                  | Coherent v5 metadata and all 239 selected producer files verified, with 240 host manifest entries including a license. Earlier controls retain their exact source qualifications; final current browser acceptance is separate. |
| Windows/macOS and complete browser-host acceptance           | Not established by local Linux success. Actual host/platform results must identify exact producer and host bytes.                                                                                                               |
| Committed release identity, CI, attestations and publication | Pending a requested release action; a dirty-tree test result does not establish these.                                                                                                                                          |

## Retained AUD-035 verification history

Status reconciliation at `2026-10-19T02:08:08+00:00` confirmed that all 648
non-audit inputs still match the accepted follow-up fingerprint
`e14058722c713600607845159ba456feb8ddb39f93e1be70fcaa4c99c219c4b0`.
The freshly fetched `origin/main` and local `HEAD` both remain
`261aaedaedeb17ac1e32cd31371c850f740d2ba5`; the corrections remain in the
working tree. All 802 baseline and 800 remediation sealed evidence files,
and the corrected Linux executable below, retain their recorded hashes.
This is a new identity check, not a repeated test run or a new whole-project
audit. Its local receipt is
`docs/audits/AUD-035-evidence/status-2026-10-19/identity-reconciliation.json`.

The host's retained check at `2026-10-19T01:52:27+00:00` passed metadata,
project facts, strict types and duplication checks over 736 source files.
Its actual receipt and log hashes were verified, and all 239 selected
MnemoCode file hashes and both source manifests still match coherent v2.
The third metadata file, the bridge package, reports the matching version
0.1.8; its current hash is captured separately rather than attributed to
the retained intake report.
The host has since changed MHFE interface files to correct input cleanup;
that work reports no new MnemoCode producer defect. The earlier host pass
therefore does not establish current whole-host or browser acceptance.
The host's stale canonical-manifest/build-recipe provenance remains open;
it is distinct from MnemoCode's verified canonical SSKR capsule. Qualified
bindings are local in
`docs/audits/AUD-035-evidence/status-2026-10-19/host-partial-acceptance-v2.json`.

Current closure recorded at `2026-10-19T01:16:59.296451+00:00`. All ten
currently known local production variants in the table have a correction,
regression evidence and independent scoped acceptance. External acceptance is
kept separate below; this is not a universal no-defect or CORE certification.

The first complete pass ran **2,974 tests in 209 files: zero failed or skipped**,
with unchanged test timeouts and one fresh worker per file. All 204 baseline
test files remained byte-identical; five regression files added 18 cases.
Mandatory gates, full source self-test, source PTY, fresh Linux executable
acceptance from an empty folder and executable PTY passed. Its 647-input source
fingerprint was `314ca1bbb9ba69896dac5e9167596554f1f08cbed84a5fd5c8cb9976f1ac61ff`.
The sampled minimum host available memory was about 5.5 GiB, above the 3 GiB
reserve, with no resource stop. Sampling is not an absolute-peak proof.

Host intake then found a **regression introduced by the first remediation**:
a failed minimal quorum reached a local insufficient-subset refusal while
trying to identify a wrong share. Final closure was stopped. The new guard
uses the existing topology's quorum decision before attempting each diagnostic
subset; operational faults of valid subsets continue to propagate unchanged.
This is tracked under AUD-033-API003 rather than blamed on an earlier author or
assigned a duplicate root ID.

The current narrow follow-up has **46 passing targeted tests**, including
actual native damaged-minimum recovery, minimum multi-group and empty
one-of-one boundaries, original operational-fault controls and the real CLI.
Two library regressions failed before the correction and passed afterwards;
the unchanged CLI checker also failed on the previous build and passed after
rebuilding. Mandatory gates, all strict types, lint, Rust Clippy/format and
source build passed again. The new Linux executable passed the full self-test,
sandbox, masking, re-encoding, healthy recovery, PDF, help and notices checks
from an empty folder. One unchanged artifact checker fails on the retained
old binary and passes on the corrected binary, including no supplied phrase
or share in output.

- Current Linux executable: `release/aud035-quorum-fixed/mnemocode-0.1.0-linux-x64`, SHA-256 `abc8351632094f9c1312e70b1d2026b126efafcc5bf0abbdb4b5994fd28e85e1`.
- Retained earlier binary: `release/aud035-remediated/mnemocode-0.1.0-linux-x64`, SHA-256 `6520c57450f91ad992dd7560386b07931e0ef7a49008b80ccf21ae8299c7444d`; it remains the failing baseline for this last case.
- All native source/generated files remain byte-identical to the accepted canonical write and separate uncached final-stage comparison: four outputs and 32 pins. The native workspace's 18 tests pass. Retained Docker toolchain/dependency layers and sampled memory do not establish an independent clean-machine build or cgroup-enforcement proof.
- Coherent host intake v2 and six actual native/ShareInput controls passed, including the original damaged-minimum counterexample. The 239 selected file hashes and actual command/log hashes are bound in the local follow-up evidence. The later retained host types/metadata/copies pass has the qualifications above; current browser and host provenance acceptance remain pending.
- The full default suite and complete PTY matrix were not repeated after this narrow topology correction. Their earlier results remain bound to their exact bytes; the changed negative path has current real CLI, executable and host-native coverage. Totals are never added or presented as a repeated full-suite result.

Current package/doc checks run after updating this register. Original reports
and all 802 sealed baseline evidence files remain unchanged. Current follow-up
receipts, review hashes and native/producer identities are in
`docs/audits/AUD-035-evidence/remediation-2026-10-19/followup-verification.json`.
A committed, signed and published release and external Windows/macOS acceptance
are not established by these local results.

## Evidence and completion policy

No new audit tool or skill was installed for this remediation. It uses the
existing pinned Node/TypeScript/Vitest and Rust/Clippy/rustfmt/Docker tools,
the shared diagnosis and JavaScript testing skills, and post-patch validation
criteria applied in place. The latter skill's worktree runner was not used:
the workspace forbids extra checkouts. Native review and live pre-free byte
tests do not establish assembly-level or physical erasure. The vendored
bc-shamir runtime keeps version 0.13.0 and reuses the already locked zeroize.

Support-harness review caught a first-run parent-directory gap before acceptance.
The exact embedded directory-creation statement reproduced `FileNotFoundError`
with a missing parent and passed after adding recursive parent creation. This
changes audit recording only; it does not change program behavior or erase any
baseline evidence. The separate support follow-up review records its disposition.

- Original baseline: [AUD-035 report](audits/AUD-035-2026-10-18.md) and its JSON companion.
- New red/green logs, scoped manifests, patches and reviewer records stay local under `docs/audits/AUD-035-evidence/remediation-2026-10-19/`.
- After each cohesive correction, record the exact changed snapshot, failing-before and passing-after checks, independent findings/disposition and unexecuted checks in the row above.
- A passing whole-suite total is not a replacement for a regression that exercises the original defect. Later checks reuse valid unchanged evidence where appropriate.
- API or host integration changes are sent to the wallet-tools session before intake. Native corrections require source, pinned dependency patch, generated bridge/WASM and integrity data to agree.
- This register covers the current AUD-035 corrections and explicitly carried deferred/acceptance work. It does not retroactively relabel every historical finding as verified.
