# AUD-009 audit harnesses

These read-only probes belong to the 2026-10-06 MnemoCode audit of dirty HEAD
`db83c4bd89a5942f1b0f3bb709ee372dbdf4bf41`. The report records the complete source
fingerprint; HEAD alone does not identify the reviewed refactor. Use only the public
BIP39 and synthetic SSKR fixtures embedded here. No real wallet material is needed.

Run from the repository root with its pinned Node 26.10.0 and installed dependencies:

```sh
node docs/audits/AUD-009-harnesses/snapshot.mjs baseline
node --import tsx docs/audits/AUD-009-harnesses/core-invariants.ts
node --import tsx docs/audits/AUD-009-harnesses/sskr-boundaries.mjs
pnpm exec tsc -p tsconfig.json --outDir docs/audits/AUD-009-evidence/compiled
node docs/audits/AUD-009-harnesses/artifact-consistency.mjs
node docs/audits/AUD-009-harnesses/snapshot.mjs final
```

`core-invariants.ts` tests checked date ownership, calendar/pattern validation,
sparse backup indexes, all phrase lengths/modes/forms, candidate records, final-word
recovery and published Bitcoin evidence. At the reviewed snapshot it exits 1 with
six passing and six failing assertions, supporting three root causes rather than
six independent findings. Its progress sentinel prevents an oversized search from
running. Earlier executions used narrower revisions and are not additive totals.

`sskr-boundaries.mjs` tests nested ShareSet immutability, injected JointRepair
services and date ownership in both backup-check classes. At the baseline it exits
1 with two passes and two failures. See [SSKR details](sskr-README.md). An initial
probe mistakenly marked a nonexistent fixture color index; correcting the harness
to index 5 made the platform injection assertion pass. That was not a product defect.

`artifact-consistency.mjs` requires the fresh compilation above, existing `dist/`,
the SSKR integrity manifest and the Linux executable in `release/`. It compares
compiler output, integrity pins and package exports, prints counts and artifact
hashes, and exits nonzero on a mismatch. It does not rebuild the executable or WASM.

`snapshot.mjs` records sorted file hashes outside `docs/audits/`, git status, HEAD,
and selected artifacts in ignored local evidence. The original artifact list uses
an obsolete WASM basename and omits that file; the separate consistency check
validates the actual `recovery_sskr_wasm_bg.wasm` integrity pin.

`run-command.mjs LABEL COMMAND ARGS...` records exact command, UTC times, exit code
and combined log hash in ignored `AUD-009-evidence/`. It preserves the child's exit
code. Example:

```sh
node docs/audits/AUD-009-harnesses/run-command.mjs suite pnpm exec vitest run --maxWorkers=2
```

The existing `AUD-008-harnesses/core-oracles.mjs` supplies the independent integer
packing/OpenSSL SHA-256 oracle. Normal terminal, executable and PDF checks use the
repository scripts named in the report. Run heavy checks sequentially. Audit
evidence and generated cards are local only, not published source.

`python3 docs/audits/AUD-009-harnesses/validate-report.py` requires installed
`jsonschema` and the final report pair, command records and both snapshots. It rejects
duplicate JSON keys, validates the common schema and 32-item ledger, checks finding
IDs, command log hashes, procedure hashes and source/artifact stability, and generates
local `report-validation.json` and `SHA256SUMS`. Success exits 0; any failed assertion
or schema check exits nonzero. It does not certify every Markdown link or semantic
claim; those require the coordinator's separate review.
