# AUD-035 release-audit evidence

Times and completion dates use UTC (+00:00). This directory contains audit
drivers and counterexamples, not production fixes. The report describes the
original immutable dirty-tree baseline. Private original logs, manifests and
reviewer records remain ignored under `../AUD-035-evidence/`.

Read `AGENTS.md` and the workspace audit/release procedure first. Use the
workspace toolchains, the existing checkout, public data, one heavy process at a
time, one test worker/Cargo job and a 3 GiB host-memory reserve. Coordinate the
heavy slot with other sessions. Supply the workspace `CARGO_HOME` and
`RUSTUP_HOME` through the calling environment; published drivers contain no
machine-owner-specific path.

`capture.mjs` freezes source, path membership, instructions and the procedure;
it refuses to overwrite the existing baseline. `run.mjs LABEL COMMAND ...`
uses the unchanged sampled AUD-026 process-tree guard and refuses existing
evidence labels. Its limits are controlled by `AUD026_RSS_MIB`,
`AUD026_HEAP_MIB` and `AUD026_TIMEOUT_SECONDS`. Samples are not hard peaks.

`checks.mjs` records format/build, the complete default suite in serial fresh
processes, requested full self-test, native tests, independent SSKR known
answers, actual PTY/export/standalone acceptance, npm advisories and the package
dry-run. `suite.mjs` retains original 60-second test timeouts and produces one
JSON result per file; `summarize.mjs` reconciles exact files/assertions rather
than adding overlapping totals. Explicit pinned Rust confirmation is in
`finish-resume.mjs`; the earlier root-default native run is supplementary.

The actual frozen offline install pruned obsolete, unreachable virtual-store
versions. `finish-checks.mjs` consequently stopped at the original honest
whole-store identity assertion. `finish-resume.mjs` records unchanged root
resolution, uses `dependency-reconcile.mjs` to prove no active before-graph
package changed or was pruned, then continues the remaining checks. This
reconciliation does not overwrite or convert the failed original receipt.

The five-process startup timing first hit a 384 MiB process-tree budget. The
unchanged timing command passed with a separate 768 MiB receipt. The normal
protected public lookup includes process/protection startup; it is not an
isolated self-test timer. The Linux SEA build uses a separately recorded
1,408 MiB process-tree budget. Heavy checks are sequential.

The tiny `parser-scratch.mjs`, `parser-edges.mjs`, `color-scratch.mjs`,
`utf8-scratch.mjs` and `protocol-probes.mjs` exercise real production paths.
Some transparently observe real allocations or inject an external host failure;
they do not replace internal domain decisions. `probe-bindings.mjs` hashes the
source/dist/harness/native context before and after execution. A counterexample
process exiting zero means its observation completed, not that its defect is
fixed. Use `node --import tsx` for the source TypeScript color/UTF-8 probes.

`coverage-v2.mjs` supersedes the preserved initial ledger generator; it retains
actual reviewer ranges and distinguishes named/selected/retained depth.
`operations.mjs`, `ledgers.mjs`, `report.mjs` and `validate.py` generate/check
explicit operation, CHECK, rule and paired-report records. The JavaScript
TypeScript 5.9 metadata parser was only an inventory helper; actual typechecking
uses the pinned native TypeScript 7 toolchain. `package-review.mjs` checks every
path in the final package dry-run. Validation uses the existing Python
`jsonschema` installation; it includes a duplicate-key negative control.

Two executed driver sources were later normalized only to remove personal
toolchain paths. Exact originals, hashes and the normalization mapping remain
in private evidence. The original execution context is not retrospectively
claimed to have used the normalized files. Earlier failed helper/guard checks
also remain retained. No canonical Docker rebuild, release signing, upload,
cross-platform acceptance or current browser-host acceptance is implied by
these harnesses.

The initial audit-only package checker also had two documented false alarms:
its first allowlist omitted intentionally shipped legal/native source files,
and its first directory pattern matched legitimate `export-*` source filenames.
Both diagnostic logs are preserved. The corrected boundary follows the
unchanged `package.json` and frozen native source inventory, and has positive
and negative controls for real source filenames versus private/output folders.
No package input or production assertion was weakened. Use a new dry-run label
and result filename when repeating the final package-path check; original
results are never overwritten.
