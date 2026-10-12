# AUD-013 harnesses

These scripts support the bounded 2026-10-08 follow-up of AUD-012 and ten residual
AUD-011 findings. The reviewed checkout has HEAD
`7dd510b648015a4d553b5be24ab2564f6edbb6b2` plus uncommitted changes. The report binds
the source bytes separately; HEAD alone does not identify the reviewed code.

Run from the repository root with its configured Python, Node.js and pnpm. Dependencies
must already be installed. Inputs are synthetic text, public counting entropy, the
repository's existing test fixtures and `sskr-wasm/integrity.json`. No private input
is requested. No script builds WASM, renders a card or runs a full vector suite.

## Sequential checks and memory

`checks.py` records one command at a time in the ignored local evidence directory.
It samples host available memory, including other sessions, every 250 ms, keeps a
2 GiB reserve, uses a 512 MiB Node heap limit and stops its own process group after
90 seconds or when the reserve is reached. It refuses to start with less than
2.5 GiB available. Other sessions' processes are never stopped. A sampled process
group RSS is diagnostic only: short peaks, native allocations and other sessions
are not bounded by the Node heap limit. The wrapper propagates the command's exit
code; insufficient memory before starting returns 125.

```bash
python3 docs/audits/AUD-013-harnesses/checks.py critical-rerun pnpm exec vitest run test/aud-012-remediation.test.ts test/render-platform.test.ts --testNamePattern 'AUD-012|lists exactly' --maxWorkers 1 --no-file-parallelism
python3 docs/audits/AUD-013-harnesses/checks.py date-rerun pnpm exec vitest run test/date-search-core.test.ts --maxWorkers 1 --no-file-parallelism
python3 docs/audits/AUD-013-harnesses/checks.py source-rerun pnpm check
python3 docs/audits/AUD-013-harnesses/checks.py cleanup-rerun node --import tsx docs/audits/AUD-013-harnesses/candidate-cleanup.mjs
python3 docs/audits/AUD-013-harnesses/checks.py boundary-rerun node --import tsx docs/audits/AUD-013-harnesses/boundary-checks.mjs
```

The recorded critical run passes 11 tests and skips the three rendering tests.
The date run fails three exact-object assertions because their expectations omit
the added complete-date field. Preserve those failures; do not remove the new
field or weaken the assertions to obtain a passing result.

`candidate-cleanup.mjs` observes actual temporary byte arrays from the production
candidate-list functions in a disposable process. It reports two unwiped validation
copies and two wiped serialization copies, confirms borrowed entropy and successful
serialization survive, and asserts that a decoder CRC refusal wipes its owned copy.
It does not simulate a heap attack or establish total erasure. Its prototype hooks
are restored in `finally`. The unwiped-copy count is a diagnostic rather than an
acceptance assertion; exit zero is not proof that SEC003 is fully fixed.

`boundary-checks.mjs` reproduces the residual material `null` orientation bypass
using pure geometry, checks invalid strings still refuse, and asserts that all
seven existing SSKR file pins match. It expects the residual bypass to remain on
the audited snapshot; rejection after a later fix makes that baseline assertion
fail. No PDF, raster image or card is generated. Pin equality does not prove a
canonical rebuild.

## Source capture and report validation

```bash
python3 docs/audits/AUD-013-harnesses/snapshot.py distinct-label
python3 docs/audits/AUD-013-harnesses/validate-report.py
```

`snapshot.py` writes sorted source-path/SHA-256 pairs and their fingerprint. It
excludes audit files, never copies the checkout, and refuses to overwrite an
existing label. The report retains its initial and checked final snapshots, not
just the last manifest.

`validate-report.py` needs the local evidence retained by the maintainer and the
canonical procedure schema. It validates the paired reports, original IDs, command
hashes, coverage ledger, unchanged historical AUD-012 records, source citations,
ignored evidence and index. Source citations bind the captured checked manifest.
Later concurrent edits are disclosed separately; they do not inherit earlier test
passes. The validation output records any live drift and sets
`latestSnapshotUnchanged` to false when appropriate. It writes
`report-validation.json` and `SHA256SUMS` locally and exits nonzero on any report
inconsistency. A consistent historical report is not acceptance of later code.
It does not run application tests.

Logs and command records are local evidence only. Published reports state commands,
counts and hashes independently. Audit files are excluded from the repository
formatter; retained scripts and evidence are not reformatted.
