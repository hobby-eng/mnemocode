# AUD-008 harnesses

These scripts belong to the ordinary full-scope audit of MnemoCode at commit
`2d80c86c050c7e3b7de395b9f96548867c9cd44c`, dated 2026-10-06. They use public
BIP39/SSKR vectors or invented data. They do not fix production code or authorize a release.
Five delegated reviewers and the coordinator covered six roles; the tool refused a sixth
delegated thread. The coordinator performed the documentation and skeptic role.

Run commands from the existing MnemoCode checkout with its pinned Node.js and pnpm, installed
locked dependencies and a fresh `pnpm build`. Do not copy the project. Scripts import the local
`dist/` files. PTY scripts need Linux/Python; rendering needs trusted local Poppler. The audit
does not establish Windows/macOS execution, full release acceptance or canonical reproducibility.

## Recording and replay

`record-command.py` records argv, cwd, timestamps, exit status, relevant toolchain environment,
combined output and SHA-256 under ignored `docs/audits/AUD-008-evidence/`. Labels cannot be reused:

```bash
python3 docs/audits/AUD-008-harnesses/record-command.py --label replay-core --timeout 90 -- \
  node docs/audits/AUD-008-harnesses/core-oracles.mjs
```

The original command records are retained locally; the report JSON contains their exact argv
and log hashes. Public artifacts, logs and intermediate failed harness versions are local only.
Some tool sandboxes block child stdout/stderr independently of MnemoCode. The audit retained
those failures, proved an ordinary Node control outside that sandbox, and reran affected tests
without altering the application's permission flags.

## Harness map

| Script                                           | Purpose                                                                                                                                                 | Baseline expected output                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture-snapshot.py`                            | Hash tracked product files excluding `docs/audits/`, HEAD and the shared procedure/instruction files; verify against the initial record on later calls. | Unchanged snapshot, exit 0. It does not copy a checkout.                                                                                                         |
| `core-oracles.mjs`                               | Independent Seedshift, representation, checksum and word-candidate comparisons for all five widths.                                                     | Counts and exit 0. Consume candidate arrays immediately; they may be reused.                                                                                     |
| `core-bitcoin.mjs`                               | Separate OpenSSL/BIP32/address serialization oracle, literal Bitcoin vectors, Unicode/NFKD fingerprints and invalid locations.                          | 96 located comparisons and 30 fingerprints pass, exit 0.                                                                                                         |
| `core-contracts.mjs`                             | Invalid date modes, invalid point/WIF evidence and a bounded child-process empty-place hang.                                                            | Contract assertions fail, exit 1, while the baseline defects are open. Child guard prevents an unbounded test process.                                           |
| `core-cli-evidence.mjs`                          | Real CLI invalid compressed-point evidence with public word candidates.                                                                                 | Exit 0 and 128 normal non-match rows on the baseline. This confirms current behavior; it is not a post-fix acceptance test.                                      |
| `core-passphrase.mjs`                            | Compare invalid runtime passphrase inputs with the pinned BIP39 dependency and explicit string conversion.                                              | Baseline coercions printed, exit 0; valid strings are checked separately.                                                                                        |
| `sskr-coverage.mjs`                              | Official grouped quorums, all widths/formats, transport oracles, GF(256), bounded repair and ambiguity.                                                 | Nine logical groups pass, exit 0.                                                                                                                                |
| `sskr-defects.mjs`                               | CRC-valid inconsistent surplus member and accepted transport forms that fail marked repair.                                                             | Five assertions fail for two root causes, exit 1. A successful valid quorum is not evidence that every surplus member is usable.                                 |
| `sskr-record-review.mjs`                         | Write the SSKR review record from retained logs/hashes.                                                                                                 | Record written; requires original local evidence. See [SSKR details](sskr-README.md).                                                                            |
| `security-age.mjs`                               | Recipient round trips, malformed/authentication rejections and unavailable-RNG behavior without scrypt work.                                            | Focused checks pass, exit 0.                                                                                                                                     |
| `security-files-limits.mjs`                      | Synthetic private-file publication, no overwrite and bounded-input checks.                                                                              | Focused checks pass, exit 0.                                                                                                                                     |
| `security-cancellation.py`                       | Real protected CLI PTY; SIGINT after date-search progress with a short observation window and process-group kill guard.                                 | Prints delayed cancellation/no alternate-screen leave on the baseline, exit 0 after its bounded diagnosis. After a fix, inspect exit 130 and cleanup explicitly. |
| `security-cleanup.mjs`                           | Instrument mutable candidate/passphrase buffers using retained synthetic references.                                                                    | Prints missing-overwrite observations, not a memory-disclosure proof. See [security details](security-README.md).                                                |
| `security-permissions.mjs` and related observers | Observe canonical and explicitly caller-granted Node scopes without transmitting anything.                                                              | Canonical scopes denied; intentional grants retained. Diagnostic variants are explained in the security guide.                                                   |
| `interface-contracts.mjs`                        | Actual protected CLI records/QR round trips, wrong-date output, and harmless copied-command quoting probe.                                              | Valid formats pass; quoting contract fails, exit 1.                                                                                                              |
| `interface-narrow-terminal.py`                   | Actual 120/40-column PTY capture and bounded VT replay.                                                                                                 | Narrow redraw assertion fails, exit 1; wide control has one selection.                                                                                           |
| `interface-artifact.mjs`                         | Real A6 PDF/PNG, printed references, metadata, QR decoding and JPEG adapter.                                                                            | One design/PNG QR passes; JPEG container checked, JPEG QR untested.                                                                                              |
| `devops-inventory.py`                            | Manifest/lock/export/notice/integrity/workflow inventory.                                                                                               | Corrected inventory passes, exit 0. No install or canonical build.                                                                                               |
| `devops-build-failure.mjs`                       | Evaluate exact build-script source with in-memory VM mocks and injected bundler/SEA/notice failure.                                                     | Preservation/cleanup assertions fail, exit 1. Needs `node --experimental-vm-modules`; no actual rebuild or artifact writes.                                      |
| `skeptic-checks.mjs`                             | Coordinator challenges exports, passphrase coercion, curve validation and both SSKR findings with a different surplus mutation.                         | Observation-confirming assertions pass, exit 0; not a post-fix regression gate.                                                                                  |
| `runner-probe.test.ts`                           | Diagnostic ordinary Node child stdout control, independent of application hardening.                                                                    | Fails under the affected tool sandbox; not a production test or finding.                                                                                         |
| `record-skeptic.py`                              | Record scoped documentation/claims and final candidate dispositions.                                                                                    | Writes the local sixth-role record using original evidence.                                                                                                      |
| `assemble-report.py`                             | Reconcile original review records into canonical Markdown/JSON, keeping initial failures and actual coverage limits.                                    | 11 findings, 32 coverage IDs; requires retained original records.                                                                                                |
| `validate-report.py`                             | Validate schema, IDs, source/procedure/log/artifact/reviewer/harness hashes and local-evidence ignore boundary.                                         | Exit 0 and local validation/checksum manifest.                                                                                                                   |

Additional helper scripts in this folder support those probes; they are audit-owned, not
production entry points. Initial mistaken harness versions remain in ignored evidence. They
are distinguished from baseline product-contract failures and are never used to assert a fix.
Some published harnesses were formatted with the pinned Prettier after execution. Original
review records retain execution-time harness hashes; the final report also hashes the formatted
published files. Formatting did not change the probe logic, and no original command log was replaced.

The coordinator also ran the repository's ordinary `scripts/verify-terminal-input.py`, which
passed paste, editing, menu return and prompt cancellation. The separate date-search interrupt
probe demonstrates a computation-time cancellation gap despite those normal input checks.

## Selected tests

The report retains the exact 22-file selection: 440 distinct tests, initially 426 passed and
14 failed because of the tool sandbox's child-stream behavior. The five affected files passed
31/31 on the host; two files with negative child assertions passed 23/23 there. These reruns
overlap the original 440 tests. No full-suite, Docker, executable or release-verification claim
should be inferred from these counts.

Do not run the expensive rendering/scrypt/release jobs concurrently merely to replay this audit.
Never substitute real phrases, passphrases, candidate records, WIFs, dates or shares.

## Targeted UI and executable-build remediation review

These three follow-up harnesses review the owner-modified working tree based on the same
`2d80c86c050c7e3b7de395b9f96548867c9cd44c` HEAD. They hash the exact current source that they use;
they do not change product files or build an executable. Local follow-up logs are retained under
`docs/audits/AUD-008-evidence/` with `recheck-` names, separately from the original failures.

```bash
node --experimental-vm-modules docs/audits/AUD-008-harnesses/recheck-ui-build-boundaries.mjs
node docs/audits/AUD-008-harnesses/recheck-ui-build-command-display.mjs
node docs/audits/AUD-008-harnesses/recheck-ui-build-resize-counts.mjs
```

- `recheck-ui-build-boundaries.mjs` extends only the mocks of
  `remediation-build-failure.mjs`, using checked single replacements. It executes the current
  builder unchanged and injects staging-allocation, publication-rename and macOS-signing errors.
  The reviewed snapshot preserves the old set on signing failure, but leaves work after staging
  allocation failure and mixed artifact generations after the second or third publication rename
  fails. Its expected exit code is 1 while those residual cases keep `AUD-008-BLD001` open.
- `recheck-ui-build-command-display.mjs` extracts the exact current `typedCommand` and `wrapText`
  bodies, removes TypeScript annotations/export modifiers, and uses the menu's actual width and
  indent. A harmless POSIX `sh` function prints argv. The original literal substitution filename
  is preserved; two spaces in a filename collapse to one, and hard display wrapping breaks a long
  command. Its expected exit code is 1 while these residual cases keep `AUD-008-UI002` open. This
  probe needs permission to start `sh`; a sandbox-blocked invocation is an environment failure,
  and the retained host rerun supplies the contract evidence. Windows shells remain untested.
- `recheck-ui-build-resize-counts.mjs` executes exact stripped `terminal-choice.ts` bodies with
  synthetic terminal I/O and the real ten menu labels. Its explicit model assumes existing rows
  reflow after a 120-to-40-column resize, before the next Down key. The initial 12 rows then occupy
  21 modeled rows, but the first redraw moves up only 12, leaving a 9-row mismatch in this model.
  Its expected exit code is 1 while `AUD-008-UI001` remains open with a partial mitigation. Static
  real PTY captures at 30, 40, 60, 80 and 120 columns pass with one selection after two Down keys.
  **No actual host terminal-emulator resize/reflow capture was performed.** The model does not
  replace the original required resize, selection and Escape acceptance checks.

The documentation follow-up `AUD-008-DOC001` is verified by comparing the revised `SECURITY.md`
with the unchanged permission implementation and retained normal/intentional-pregrant scope
observations. This is targeted documentation consistency evidence. These follow-ups establish
neither a successful executable build on every supported system nor release-level verification.

## Remediation record binding

The dated 2026-10-06 follow-up reviews the owner's uncommitted fixes at the same HEAD,
source fingerprint `1b05926f5234b36d7b767a7b1698bfa992ee902234f4abe08af06dd74eddfe3d`.
`recheck-snapshot.py` includes untracked product tests and writes separate local records;
it never replaces the original clean audit snapshot. A later call compares the current product
files with that follow-up snapshot. `recheck-narrow-terminal.py` repeats the retained static-width
PTY harness with new evidence filenames, without replacing the original capture.

`recheck-validate.py` validates the dated addendum, both preserved and new execution log hashes,
current source/dist/procedure bindings, seven verified/four open dispositions and the ignored
local-evidence boundary. Run it after the source-snapshot comparison:

```bash
python3 docs/audits/AUD-008-harnesses/recheck-snapshot.py
python3 docs/audits/AUD-008-harnesses/recheck-validate.py
```

Both binding checks expect exit 0 on this recorded follow-up state. Original
`capture-snapshot.py` and `validate-report.py` intentionally remain bound to the original clean
baseline; they do not certify a subsequently changed product tree. The residual-contract helpers
for SSKR, displayed commands, publication failures and modeled resize currently exit 1 with the
remaining acceptance failures. That is retained defect evidence, not a failed source-binding gate.

## Authorized four-fix phase

The owner subsequently authorized production fixes for FUN001, UI001, UI002 and BLD001.
This phase uses source fingerprint
`20ab1841be1812ab1e150f657e097e50da3156e8dd95bb6e32340f4af209790d`
at the same HEAD. The original audit and first seven-verified/four-open phase retain their
own snapshots and evidence. Their expected-failure probes are historical, not acceptance
checks for the modified source. In particular, the old builder mocks lack the newly used
filesystem operations; replay the new harness for the new builder.

```bash
pnpm check
pnpm build
pnpm exec vitest run test/aud-008-final-fixes.test.ts test/terminal-choice-resize.test.ts \
  test/aud-008-remediation.test.ts test/menu.test.ts test/backup-check.test.ts \
  test/sskr-repair.test.ts test/sskr-joint-repair.test.ts test/sskr-thresholds.test.ts \
  test/sskr-vectors.test.ts --maxWorkers 2
node --experimental-vm-modules docs/audits/AUD-008-harnesses/fix-build-failure.mjs
node docs/audits/AUD-008-harnesses/recheck-ui-build-resize-counts.mjs
python3 docs/audits/AUD-008-harnesses/fix-resized-terminal.py
python3 scripts/verify-terminal-input.py
python3 docs/audits/AUD-008-harnesses/fix-snapshot.py
python3 docs/audits/AUD-008-harnesses/fix-validate.py
```

- The final nine test files contain 242 tests: structured recovery metadata, strict wrapper
  rejection, incomplete groups, unreadable surplus members, normal backup checks, vectors,
  exact displayed-command POSIX argv, and actual choice-function resize regression.
- `fix-build-failure.mjs` executes the exact builder source in an in-memory filesystem.
  All 38 cases should pass: allocations, build/signing/output generation, backup copying,
  each publication rename, normal publication with absent/partial/complete prior sets,
  and preservation of recoverable backups when rollback itself fails. No release files are written.
- `fix-resized-terminal.py` runs six real protected Linux PTY resize cases with public menu
  labels, repeated navigation and Enter/Escape. It retains new local raw output and screen
  replays. The replay assumes logical rows reflow; it is not physical emulator capture.
- `fix-snapshot.py` creates a separate local product/dist manifest on its first call and
  verifies the product snapshot on later calls. `fix-validate.py` checks canonical JSON,
  original and first-phase evidence preservation, source/procedure/log/review hashes,
  eleven verified dispositions and the ignored evidence boundary.

New evidence uses `fix-*` filenames. Do not overwrite original or `recheck-*` records.
The package build is fresh; no standalone executable/Docker build, Windows/macOS execution,
crash consistency, concurrent publication, universal terminal policy or release approval is claimed.
