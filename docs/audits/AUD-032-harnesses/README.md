# AUD-032 pre-release audit harnesses

These scripts support the expanded, review-only audit of the standalone TypeScript MnemoCode
at commit `261aaedaedeb17ac1e32cd31371c850f740d2ba5`, completed on 2026-10-16 UTC.
The 607 non-audit inputs have source fingerprint
`eb39e55876f8fc5187e785895c0c54944106cf697bb3c20c19ffa8d282e3fa2c`.
The report and JSON companion distinguish fresh executions, targeted source reasoning and
retained assessments at their original depth. Inventory and hash equality are not body review.

Use the existing checkout, installed pinned Node.js 26.10.0, pnpm 12.8.1 through Corepack,
Rust 1.99.0 for the SSKR workspace, Docker 29.x, Python 3 and public fixtures only.
Do not make another checkout, install tools, replace canonical generated files, fix tests,
sign, upload or publish anything to rerun this audit.
All recorded command times are UTC. Original local logs are not privacy-redacted in place.

## Command recorder

From the repository root:

```sh
AUD026_RSS_MIB=1536 AUD026_HEAP_MIB=768 AUD026_TIMEOUT_SECONDS=300 \
  node docs/audits/AUD-032-harnesses/run.mjs fresh-label COMMAND ARGUMENTS
```

`run.mjs` reuses the inspected [AUD-026 memory recorder](../AUD-026-harnesses/audit.py);
it does not copy that implementation. Each fresh label writes an immutable `.log` and
`.command.json` under ignored `docs/audits/AUD-032-evidence/`, recording exact argv,
UTC start/end, exit code, source fingerprints before/after, log hash, environment overrides
and sampled process-tree RSS/MemAvailable. The original recorder also creates its existing
AUD-026 evidence directory on import; no historical file is overwritten.

The machine reserve is at least 3 GiB; tests and Cargo use one worker and heavy checks run
serially. Defaults remain the original recorder's limits unless the explicit profile above is
supplied. Samples are not a kernel memory cap. Docker daemon/build processes are outside the
client process tree, so the host-wide available-memory reserve is the additional control.
The recorder exits with the child code, or nonzero when its resource/time gate stops the child.
Never reuse a retained evidence label.

Set `CARGO_HOME` and `RUSTUP_HOME` to the workspace's installed toolchain homes when necessary,
and set `CARGO_BUILD_JOBS=1`. Set `TMPDIR` to the existing workspace scratch directory
`../tmp/mnemocode-aud032` for host temporary fixtures. Do not use `/tmp` for another project
or an evidence copy. The canonical Docker build's own paths inside its container are different.

## Snapshot and coverage

```sh
node docs/audits/AUD-032-harnesses/capture.mjs
node docs/audits/AUD-032-harnesses/admit-prior.mjs
node docs/audits/AUD-032-harnesses/contracts.mjs
node docs/audits/AUD-032-harnesses/history.mjs
node docs/audits/AUD-032-harnesses/coverage.mjs
```

- `capture.mjs` reserves AUD-032 only after checking the numbering, captures all 1,038 baseline paths, source/inventory identities, the four canonical procedure hashes and instruction hashes, all 32 pre-execution owners/evidence plans, declarations/imports and separate ignored dist/release inventories. Environment evidence is recorded separately. It refuses an existing snapshot.
- `admit-prior.mjs` requires the retained local AUD-031 final source manifest and eight actual independent remediation dossiers, with their published bindings. It checks all 607 source paths and dependency/caller/procedure context. A match preserves only the prior stated assessment depth; it creates no fresh execution or semantic-review credit. Missing local inputs are a gap, not permission to manufacture them.
- `contracts.mjs` needs the current `dist/` build. It supplements 1,955 declarations and 1,598 explicit members with callable/type/inheritance shapes, generated declarations, Rust exports, 78 package entries and 11 actual CLI command registries. Those counts include types/re-exports and are not executed-operation counts or a complete compiler-proven inheritance graph.
- `history.mjs` uses the already available Python `jsonschema` module and rejects duplicate keys. It validates all 30 prior report pairs structurally without rerunning historical checks. The abandoned AUD-023 remains explicitly abandoned.
- `coverage.mjs` needs the actual coordinator assessment, admitted retained context, suite results and historical assessment. It records a method and honest depth for every frozen path and individual dispositions for 53 CORE plus 51 language/area rules. It cannot reconstruct an independent reviewer or make every body reviewed.

The AST inventory uses the already installed TypeScript 5.9.3 parser under the workspace's
`tmp/cancel-check/node_modules/typescript`; acceptance still uses the project's pinned
TypeScript 7.0.2 compiler. These scripts install nothing.
The canonical procedure/schema files are read-only references in the existing neighboring
`multi-chain-wallet-tools` checkout. They are not runtime dependencies of MnemoCode.

## Full serial test execution

Build first, then run with the recorder profile and `TMPDIR` above:

```sh
node docs/audits/AUD-032-harnesses/suite.mjs
```

This runs each current test file separately with Vitest's thread pool, one worker and no file
parallelism. Each file gets its own receipt and machine-readable result. Successful retained
files are resumed, not silently rerun. An orphan log left by interruption receives a distinct
interruption record and a new retry label; it is never overwritten or counted as a pass.

The audit inventoried 185 test files and executed 184: 2,784 tests passed, two failed and four
were explicitly skipped by the existing date-recovery suite. `test/self-test-integrity.test.ts`
was not executed because it creates disposable complete dist/vector installations under the
explicit no-project-copy constraint; its source/assertion structure was reviewed instead.
The configured skips and the excluded file are separate from failures.

Exit 1 preserves a genuine failing file. Exit 125 after otherwise successful files means the
explicit exclusion remains. A resource-boundary stop also fails and must be inspected before
resuming. A per-file aggregate is not a claim that monolithic `pnpm verify` was invoked.

## Exact current regressions

```sh
node docs/audits/AUD-032-harnesses/reproduce-regressions.mjs
```

This executes the two existing assertions without changing them. At the audited baseline,
exit 1 means both confirmed defects reproduce: the stale 16-label redaction inventory sees 28
labels (`AUD-032-BLD001`), and the share-QR test expects the obsolete success wording
(`AUD-032-BLD002`). The focused run has two failures and 46 selected-out cases; do not add
them to the full disjoint-suite totals. A separately authorized correction should make both
pass without dropping owner coverage or the actual QR/quorum checks.

`AUD-032-DOC001` is a static mismatch: `SECURITY.md` names `randomBytes`, while the production
adapter uses `randomFillSync`. Both are cryptographic Node APIs; no weak RNG is alleged.

## Real outputs and independent answers

```sh
node docs/audits/AUD-032-harnesses/media.mjs
node docs/audits/AUD-032-harnesses/legacy-control.mjs
```

`media.mjs` requires the current build and local Poppler. It uses only the public
`abandon ... about` phrase, creates a private ignored `AUD-032-evidence/media/` directory,
and checks actual PDF/PNG/JPEG output, no PDF Info metadata, owner-only file modes, exact record
and QR restoration, a real 300-dpi PNG-page QR, three share QR images and exact recovery from
members 1 and 3. Exit 0 prints and retains artifact hashes; any assertion fails nonzero.
It refuses an existing directory rather than overwriting exports.

`legacy-control.mjs` writes a fresh public English word-list JSON, checks its official SHA-256,
supplies it to the unchanged [independent Python oracle](../AUD-026-harnesses/legacy-valid-oracles.py),
and compares real encoding/recovery APIs at all five phrase lengths. Exit 0 means exact stored
outputs, candidate counts and original-phrase inclusion match. The original audit invocation
omitted this required argument and failed; that failed receipt remains separate from the
corrected result. Existing word-list evidence is never overwritten.

The audit also executed these unchanged repository checks with individual recorder labels:

```sh
node dist/mnemocode.js self-test
python3 -B scripts/verify-terminal-input.py
node scripts/check-card-output.mjs docs/audits/AUD-032-evidence/card-output
python3 -B scripts/verify-sskr-known-answers.py
python3 -B docs/audits/AUD-005-harnesses/seedshift-oracle.py
```

The card check covers all 13 current designs and actual PDF-to-PNG-to-QR handoff.
The independent Seedshift check reproduces seven published vectors and 6,000 comparisons
over 400 deterministic public cases. These and the full self-test overlap ordinary tests;
their totals are not added. No physical-print, full visual/pixel-diff or browser acceptance is
implied by a QR match.

## Canonical SSKR comparison

```sh
node docs/audits/AUD-032-harnesses/reproduce-sskr.mjs
```

This invokes the unchanged `scripts/build-sskr-wasm.mjs --check`, adding only Docker's
`--no-cache-filter built` to its one build command. The final Rust/wasm-bindgen compilation
stage runs fresh with one Cargo job, `--locked --offline` and `--network=none`; installed pinned
toolchain/dependency layers may be reused. The four generated files and integrity inventory
must match exactly. Exit 0 is a comparison, not regeneration or authorization to replace bytes.
It is not an entirely cold toolchain build or independent-machine reproduction.

## Standalone artifacts and package listing

The audit built two ignored Linux artifact sets with the existing build script, ran
`scripts/verify-executable.mjs` and the complete real PTY driver on the first, and then ran:

```sh
node docs/audits/AUD-032-harnesses/artifacts.mjs
node docs/audits/AUD-032-harnesses/package-review.mjs fresh-package-label
```

`artifacts.mjs` requires both `AUD-032-evidence/linux-executable/` and
`linux-executable-repeat/`, created with `scripts/build-executable.mjs OUTPUT_FOLDER`.
It checks exact same-host equality, the unchanged pre-existing `release/` files, license
sections, the 567-file current dist inventory and five actual core self-test timings.
This is not cross-platform provenance or a signed release.

`package-review.mjs` runs `npm pack --dry-run --json --ignore-scripts`, examines every path
against the admitted source/dist/audit inventory, requires legal/release documents and every
published audit file, and refuses private evidence, exports, caches and unadmitted paths.
It writes no archive. Exit 0 records its exact listing; any missing/unexpected path fails.
The initial listing precedes the canonical report pair. Final validation requires a separate
`final-package-review` label after both reports exist, so the earlier listing is not silently
presented as the final package content hash.

## Report assembly and final validation

```sh
node docs/audits/AUD-032-harnesses/report.mjs
node docs/audits/AUD-032-harnesses/report.mjs --publish
node docs/audits/AUD-032-harnesses/validate.mjs --preflight
node docs/audits/AUD-032-harnesses/validate.mjs
```

Assembly needs the actual local review dossiers, findings, coverage, source, command and artifact
records; it is not a way to recreate absent reviewers or old execution credit.
Preview is local only. Publication refuses existing canonical reports and writes the English
Markdown/JSON pair only from admitted inputs. It never fixes the product or approves a release.

The optional preflight checks structure/source/privacy/bindings but explicitly leaves final
independent acceptance pending and writes a different local result. It is not final closure.
The final validator uses the canonical JSON schema with duplicate-key rejection, checks paired
IDs/counts, all 32 checks, all 1,038 paths and 104 rules, current non-audit source identity,
original command/log and reviewer input hashes, expected index-only historical change,
privacy/UTC, links, ignored unstaged evidence and the independent exact-pair completeness
acceptance. It writes local `report-validation.json`. After that command ends, checksum maintenance
`node docs/audits/AUD-032-harnesses/validate.mjs --seal` writes `SHA256SUMS`, including the
completed validation receipt/log and excluding only the checksum file itself.
Exit 0 validates the audit record, not a passing release: the two mandatory regressions remain
open, and full host/browser and Windows/macOS release execution remain unverified.

## Addendum 2026-10-20: inputs a reader cannot obtain

This documentation-only addendum answers AUD-037-DOC002; the scripts are unchanged. The AUD-032
JSON binds the original bytes of this README in `ownHarnessInputs` (SHA-256
`82e7d686bddc31ec06f8077948007ec7f2b7b9ef1a602bf946baf7155915292e`), so the binding check of
`validate.mjs` no longer matches this file.
`git show 4978a62:docs/audits/AUD-032-harnesses/README.md` prints the original bytes.

Most scripts read files that are not published. These inputs exist only on the maintainer's
machine, so a reader cannot rerun the scripts that need them:

- `capture.mjs` and `contracts.mjs` load the workspace's scratch TypeScript parser, version 5.9.3,
  from `../tmp/cancel-check/node_modules/typescript` beside the repository. The workspace
  repository ignores that folder, and it was installed from the range `^5.9.3`. `capture.mjs` also
  hashes the workspace's instruction files from the private workspace repository, and it refuses to
  run once an audit after AUD-031 exists.
- `admit-prior.mjs` reads AUD-031's machine-local final source manifest
  `docs/audits/AUD-031-evidence/r47-current-source.json` and its remediation dossiers.
- `remediation.mjs`, which the sections above do not describe, records the dated remediation
  addendum of the AUD-032 report pair. Run without arguments, it writes that addendum into the pair
  from the accepted baseline; with `--check` it compares the pair with the addendum. It reads
  AUD-033's machine-local `docs/audits/AUD-033-evidence/snapshot.json` (AUD-033 is withheld; see
  its [summary](../README.md#aud-033-withheld-report)), this audit's own local
  `remediation-review.json`, `accepted-baseline-AUD-032-2026-10-16.md` and `.json` and five
  `remediation-*` receipts and logs, and the local executable
  `release/aud032-fixed/mnemocode-0.1.0-linux-x64`.
- `admit-prior.mjs`, `contracts.mjs`, `history.mjs`, `coverage.mjs`, `suite.mjs`, `artifacts.mjs`,
  `package-review.mjs`, `report.mjs` and `validate.mjs` read this audit's own machine-local
  evidence in `docs/audits/AUD-032-evidence/`, starting with the `snapshot.json` that
  `capture.mjs` wrote.
- `history.mjs` and `validate.mjs` run Python code that imports `jsonschema`. No requirements file
  sits beside them, so they do not meet TOOL-03, and the version this audit used was not recorded.
  The [AUD-030 requirements file](../AUD-030-harnesses/requirements.md) pins a `jsonschema`
  environment by hash: jsonschema 4.19.2, attrs 25.4.0, jsonschema-specifications 2023.12.1,
  referencing 0.36.2, rpds-py 0.27.1 and typing-extensions 4.15.0. Install it in an audit
  environment with
  `python3 -m pip install --require-hashes -r docs/audits/AUD-030-harnesses/requirements.md`.
  Both scripts also read the schema from the neighbouring `multi-chain-wallet-tools` checkout.

A reader can still run these commands from a clean checkout with the pinned tools and a build.
They read only published files; `media.mjs` and `legacy-control.mjs` write into an ignored
`docs/audits/AUD-032-evidence/` folder, which must exist first:

- `run.mjs`, the command recorder;
- `reproduce-regressions.mjs`; both tests pass in the complete runs from `4978a62` on, because
  both findings are fixed;
- `media.mjs` (needs Poppler) and `legacy-control.mjs`;
- `reproduce-sskr.mjs` (needs Docker).
