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

## Current AUD-036 follow-up

The latest complete local replay has **2,988 passing project tests in 210
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

- Current Linux candidate: `release/aud036/mnemocode-0.1.0-linux-x64`, SHA-256 `129798bce6fd43bb13ee26420ad81120af1667d27dd94ec5a26c0b7a889d2307`. Protected empty-folder acceptance, executable PTY and damaged-minimum-quorum refusal pass.
- Independent changed-code review covered 177 baseline paths and affected callers. It found the presentation omissions above and no new confirmed architectural, security-runtime or material performance defect. This does not establish globally optimal code or universal CORE compliance.
- Wallet-tools admitted coherent v5 metadata: all 239 selected producer files match, with 240 host manifest entries including a retained license. Actual browser acceptance remains separate. The host corrected real-browser card-text truncation and is checking a visibility regression introduced by its earlier cleanup correction: editing must preserve the selected “Show”, while explicit “Clear” hides sensitive fields. Final current browser results remain pending.
- Windows/macOS checks remain unexecuted for these unpublished bytes. The owner's push hold remains active; old-main CI is not current-source evidence.
- Platform acceptance requires actual source tests and execution of each platform's standalone file, including full self-test, recovery, files and real terminal input/cancellation. Compilation alone is not acceptance. The manual CI and Executable workflows provide these checks; their current results must be inspected separately. Wine is supplementary compatibility testing and has not been used as Windows acceptance evidence.
- Complete MnemoCode and its own browser acceptance first. MHFE integration testing is deferred until after the MnemoCode release, per the owner's sequencing instruction.
- Two previously published history items still need a pre-release decision: `ee4499e` is a one-line `fixup!` and `8aa9b25` has a work-in-progress title. No history rewrite or force-push is inferred from permission to make a local commit; preserve the cited audit identities until a regroup or an exception is explicitly authorized.
- Final documentation/package reconciliation and the local signed commit are recorded separately. No push, tag or release publication has been performed.

See [AUD-036](audits/AUD-036-2026-10-19.md) and its JSON companion for exact
bindings, failures, review scope and pending acceptance. The following AUD-035
sections retain their original history; older totals and artifacts are not the
current final replay.

## Corrections from AUD-035 (retained history)

| Finding ID / variant                               | Cause and required behavior                                                                                                    | Current state                         | Regression / verification                                                                                                                                                           | Independent review                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| AUD-029-SEC001 / parsed-backup-indexes             | Retire the privately parsed indexes after admission or refusal; preserve borrowed input to `of`.                               | Verified for current Linux snapshot   | Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / detected-format-indexes           | Retire every successfully parsed detection scratch, including wrong-count input.                                               | Verified for current Linux snapshot   | Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / rgb-scratch                       | Retire temporary byte conversion after RGB extraction, including exceptional exit.                                             | Verified for current Linux snapshot   | Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / utf8-validation-scratch           | Retire temporary validation bytes on valid and refused characters.                                                             | Verified for current Linux snapshot   | Actual owned-allocation regression fails before and passes after; borrowed inputs and returned values preserved. Final 2,974-case suite and source/standalone terminal checks pass. | scratch-review.json accepts the exact correction; final bytes unchanged.                                    |
| AUD-029-SEC001 / shorter-phrase-prefix-scratch     | Retire the private shorter prefix after admission/refusal; preserve the longer owner and returned recovery.                    | Verified for current Linux snapshot   | Existing sibling found independently: actual prefix regression fails before/passes after, longer owner/output preserved. Final suite passes.                                        | followup-review.json accepts ownership and behavior.                                                        |
| AUD-033-API003 / complete-input-operational-error  | Propagate operational combiner failures instead of diagnosing a valid share as bad; diagnose declared quorum refusals only.    | Verified for current Linux snapshot   | Four operational-fault cases fail before/pass after; declared-quorum and genuinely damaged-share controls pass. Combined68 and final full suite pass.                               | followup-review.json accepts error classification and caller contract.                                      |
| AUD-033-API003 / minimum-quorum diagnostic subsets | Skip only empty or insufficient omission subsets using the existing topology; propagate operational failures of valid subsets. | Verified for current scoped follow-up | Actual native and real CLI regressions fail before/pass after; current 46 cases and old/new binary comparison pass. Six host-native controls pass after coherent v2 intake.         | minimal-quorum-review.json and minimum-quorum-cli-review.json accept the exact source and checkers.         |
| AUD-035-SEC001 / native-failed-digest-owner        | Give the dependency's reconstructed secret a wiping owner before digest verification can fail.                                 | Verified for current Linux snapshot   | Actual native red/green, 18 native tests and Clippy pass; canonical write/uncached-stage compare match all four outputs and 32 pins. Final source/standalone checks pass.           | native-review.json accepts all 32 frozen source inputs; external host/platform acceptance remains separate. |
| AUD-035-API002 / native-group-index                | Reject a group index outside the declared group count at the native boundary.                                                  | Verified for current Linux snapshot   | Actual native red/green, 18 native tests and Clippy pass; canonical write/uncached-stage compare match all four outputs and 32 pins. Final source/standalone checks pass.           | native-review.json accepts all 32 frozen source inputs; external host/platform acceptance remains separate. |
| AUD-035-DOC001 / stopped-plan-contract             | Document the returned stopped assessment; preserve the correct cancellation behavior.                                          | Verified for current Linux snapshot   | Returned stopped plan is documented and tested; original public cleanup contract preserved. Strict types and final full suite pass.                                                 | followup-review.json and test-cleanup-review.json accept the documentation and corrected test.              |

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
[AUD-035 current-tree review](audits/AUD-035-2026-10-18.md). The baseline suite
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
