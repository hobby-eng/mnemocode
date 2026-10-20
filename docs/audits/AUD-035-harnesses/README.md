# AUD-035 release audit harnesses

Times and completion dates use UTC (+00:00). This audit belongs to the existing
MnemoCode checkout at commit
`261aaedaedeb17ac1e32cd31371c850f740d2ba5`, with preserved uncommitted fixes.
HEAD alone is insufficient: the 631 non-audit input fingerprint is
`a1d79fa9ffe68ced1f3f9e20de901e14f67380f90fd7791345c1a16b04f9ad2b`.
The private snapshot accounts for 1,094 baseline paths. These are baseline
counterexamples and release evidence, not fixes or release approval.

## Prerequisites and inputs

Run every command below from the repository root, in this checkout. Read both
AGENTS files and the shared audit/release guide. Use pinned Node 26.10.0,
pnpm/Corepack 12.8.1, Rust 1.99.0, Python 3.14.4, existing Python jsonschema and
Poppler. The project dependencies, Rust toolchain/dependency caches and built
`dist/` must be available. To prepare the ordinary JS build, use:

```sh
corepack pnpm install --frozen-lockfile --offline
corepack pnpm build
```

Offline installation requires the existing cache. Do not silently replace a
missing pinned toolchain or dependency. The build is expected to exit 0 and
populate the package's `dist/` entries. Source TypeScript probes use the
installed `tsx` loader; the actual typechecker is native TypeScript 7.0.2.

All inputs are public fixtures: `vectors/mnemocode-v1.json`,
`vectors/sskr-v1.json`, `src/sskr/known-answers.ts`, shipped English/Chinese word
tables and the existing `assets/`. Probes use the published zero-entropy phrase,
literal test entropy and synthetic colors/UTF-8, never personal wallet data.
The English BIP39 wordlist is supplied by the pinned `@scure/bip39` dependency.

Before heavy work, coordinate an exclusive slot with other sessions. Use one
worker/Cargo job, normally 1,152 MiB process-tree RSS and 256 MiB Node heap, and
reserve 3 GiB for the OS/other sessions. SEA building uses a recorded 1,408 MiB
budget. Two static reviewers is the maximum. The Linux guard samples process
trees and MemAvailable; it does not establish hard peaks or Docker-daemon RSS.

## Existing evidence and immutability

`../AUD-035-evidence/` is ignored local evidence. `capture.mjs` freezes source,
membership, instructions and the procedure. It refuses an existing snapshot.
`run.mjs LABEL COMMAND [ARGUMENTS]` reuses the unchanged sampled guard in
`AUD-026-harnesses/audit.py` and refuses existing log/receipt labels.
`suite.mjs` similarly refuses an existing test-universe/result capture. Do not
delete evidence or create another checkout to make a rerun work.

For an initial evidence directory only, the baseline/serial release sequence is:

```sh
node docs/audits/AUD-035-harnesses/capture.mjs
export CARGO_HOME="$PWD/../workingspace/cargo"
export RUSTUP_HOME="$PWD/../workingspace/rustup"
AUD026_RSS_MIB=1152 AUD026_HEAP_MIB=256 node docs/audits/AUD-035-harnesses/run.mjs gates corepack pnpm check
node docs/audits/AUD-035-harnesses/checks.mjs
node docs/audits/AUD-035-harnesses/summarize.mjs
```

At the frozen baseline, the completed `checks.mjs` sequence exits 0: format,
build, all 204 default files, full self-test, supplementary root-toolchain
native tests, independent SSKR, source PTY, card/QR checks, prior Linux artifact
acceptance, npm advisory check and package dry-run. The default suite expects
2,956 passed, zero failed/skipped, with the original 60-second test timeouts.
`summarize.mjs` reconciles file/assertion identities; totals are not added across
overlapping checks. Existing evidence must be inspected, not overwritten. A
future full review uses a new audit number/evidence namespace.

The original follow-on sequence was:

```sh
node docs/audits/AUD-035-harnesses/finish-checks.mjs
```

It honestly exited 1 at the whole-store payload comparison: the successful
frozen offline install pruned 386 rows from 15 obsolete unreachable versions.
`dependencies-before.json` and `dependencies-after.json` preserve the real
states. The explicit continuation, with the same workspace environment, is:

```sh
node docs/audits/AUD-035-harnesses/finish-resume.mjs
```

It first compares all root links/wrappers and proves every surviving payload
identical, no added/changed row, and no removed package reachable from the
before-root dependency graph. It then runs explicit pinned `cargo +1.99.0`
tests (14 passed), fresh Linux SEA build/empty-folder acceptance and executable
PTY. This sequence later stops at the too-small 384 MiB startup process-tree
budget (guard exit -15, adapter failure 241). Preserve that receipt. Its final
two unchanged checks are completed under fresh labels:

```sh
AUD026_RSS_MIB=768 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs startup-retry node docs/audits/AUD-035-harnesses/startup.mjs
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs close-cleanup node docs/audits/AUD-034-harnesses/close-error-probe.mjs docs/audits/AUD-035-evidence/close-cleanup.json
```

Both exit 0. Startup records five fresh protected public lookups (recorded
median about 1.1 seconds, not a timing invariant). The close-error probe returns
`exceptionPropagated:true` and `nonzeroBytesAfterRefusal:0`. Workspace paths are
provided by the caller; no machine-owner path is needed in published drivers.

## Reproduce the concrete counterexamples

On the exact built baseline, the following commands use new labels/results so
they do not replace the original observations. Choose another unused suffix if
the proposed label or `/tmp/` result already exists. Tiny probes need no full
suite, dependency download, Docker rebuild or real secret.

```sh
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs reproduce-parser node docs/audits/AUD-035-harnesses/parser-scratch.mjs /tmp/aud035-parser.json
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs reproduce-parser-edge node docs/audits/AUD-035-harnesses/parser-edges.mjs /tmp/aud035-parser-edge.json
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs reproduce-rgb node --import tsx docs/audits/AUD-035-harnesses/color-scratch.mjs /tmp/aud035-rgb.json
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs reproduce-utf8 node --import tsx docs/audits/AUD-035-harnesses/utf8-scratch.mjs /tmp/aud035-utf8.json
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs reproduce-sskr node docs/audits/AUD-035-harnesses/protocol-probes.mjs /tmp/aud035-sskr.json
```

Expected baseline output/exit behavior:

- Parser: correct public phrase and caller-borrowed control, but private parsed
  arrays remain nonzero after owner cleanup. Exit 0 means the counterexample
  observation completed, not that cleanup is correct.
- Parser edge: wrong count is refused by the expected code and detection gives
  no admitted format, but captured parser arrays still end in 3. Exit 0.
- RGB: correct synthetic colors, two actual scratch arrays with `allZero:false`.
  Exit 0. The observer delegates the real conversion unchanged.
- UTF-8: valid sequence accepted and invalid surrogate sequence refused, while
  real validation scratch remains nonzero. Exit 0.
- SSKR: selective operational host failure diagnoses genuine share 1 as odd;
  real bad-share control also works; raw/checked invalid group metadata restores
  literal public entropy while JS admission refuses it; forced digest mismatch
  returns `sskr.engine.combine`; wrapper cancellation resolves `stopped`. Exit 0.

Only the external host is faulted; no internal domain rule is replaced. The
failed-digest branch is actually reached, while its missing inner Vec owner is
proved from the checksum-authenticated pinned dependency source/archive, not
from reading freed memory. Native permanent regression snippets remain proposed,
not silently counted as executed tests. Once fixed, some counterexample
assertions must intentionally fail or be replaced by explicit red/green tests.

Original before/after source/dist/harness/native context bindings are produced
by `probe-bindings.mjs`. Two drivers were later normalized only for path
privacy, and this README was completed after final review. Exact original
bytes/hashes remain in private `execution-harnesses/` with the publication
mapping. Do not retrospectively describe those originals as reruns of the
later documentation or normalized drivers.

## Report and package validation

After independent source/evidence review, the audit-only assembly commands are:

```sh
node docs/audits/AUD-035-harnesses/coverage-v2.mjs
node docs/audits/AUD-035-harnesses/operations.mjs
node docs/audits/AUD-035-harnesses/ledgers.mjs
node docs/audits/AUD-035-harnesses/report.mjs
python3 docs/audits/AUD-035-harnesses/validate.py report-validation.json
node scripts/verify-audit-privacy.mjs
node scripts/verify-audit-package.mjs
```

Expected exit 0: 1,094 path dispositions; 78 package entries/11 CLI commands/four
native functions; 32 CHECK/104 guide/53 CORE IDs; five Low/open groups/eight
variants; schema/duplicate-key negative control/source/receipt/context hashes
valid; every published audit file packed; no owner names/non-UTC report times.
This validates an honest failed-conformance/incomplete-release assessment,
not a clean release. Regenerating later is not a fresh audit execution and must
not silently change the original completion date or historical evidence.

For a new final package listing label/result (both must be unused):

```sh
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 node docs/audits/AUD-035-harnesses/run.mjs package-reproduce npm pack --dry-run --json --ignore-scripts
node docs/audits/AUD-035-harnesses/package-review.mjs package-reproduce package-review-reproduce.json
```

Expected exit 0 and no unexpected/private/generated-output paths. The recorded
package contains 1,133 paths; future report/harness additions can change that
count. Intentional legal/native Rust source follows the unchanged manifest.
Earlier overly narrow audit allowlist/directory-pattern failures are preserved
and corrected without changing package inputs or product assertions.

See [RERUN.md](RERUN.md) for additional resource/history qualifications. Nothing
here tags, signs, uploads, commits, pushes, publishes or regenerates canonical
SSKR artifacts. Current browser-host and Windows/macOS acceptance is separate.

## Addendum 2026-10-20: inputs a reader cannot obtain

This documentation-only addendum answers AUD-037-DOC002; the scripts are
unchanged. "All inputs are public fixtures" under "Prerequisites and inputs"
is true of the data that the probes use, but not of every input. Several
scripts also read files that are not published. These files exist only on the
maintainer's machine, so a reader cannot rerun the scripts that need them:

- `capture.mjs` reads AUD-032's machine-local
  `docs/audits/AUD-032-evidence/coverage.json` and five machine-local AUD-033
  files under `docs/audits/AUD-033-evidence/`:
  `remediation/REMEDIATION-2026-10-16.json`,
  `arc002-2026-10-18/ARC002-CLOSURE-2026-10-18.json`, `protocol-review.json`,
  `interface-review.json` and `core-rule-dispositions.json`. It also hashes the
  procedure files of the neighbouring `multi-chain-wallet-tools` checkout and
  the workspace's instruction files from the private workspace repository.
- `inventory.mjs`, `structure.mjs` and `date-preservation.mjs` load the
  workspace's scratch TypeScript parser, version 5.9.3, from
  `../tmp/cancel-check/node_modules/typescript` beside the repository. The
  workspace repository ignores that folder, and it was installed from the
  range `^5.9.3`.
- `inventory.mjs` also reads AUD-033's machine-local
  `remediation/initial-snapshot.json`, every file in `remediation/` and
  `arc002-2026-10-18/ARC002-CLOSURE-2026-10-18.json`, and AUD-034's
  machine-local `docs/audits/AUD-034-evidence/snapshot.json`.
- `coverage.mjs` and `coverage-v2.mjs` read AUD-034's machine-local
  `file-coverage.json`; `ledgers.mjs` reads its `rule-coverage.json`; and
  `date-preservation.mjs` reads its `date-gap-2026-10-18/before.json`.
- `checks.mjs` verifies the local executable
  `release/aud034-fixed/mnemocode-0.1.0-linux-x64` from the AUD-034 follow-up.
- `summarize.mjs`, `adjudicate.mjs`, `operations.mjs`, `ledgers.mjs`,
  `report.mjs`, `validate.py`, `package-review.mjs`, `probe-bindings.mjs`,
  `finish-checks.mjs`, `finish-resume.mjs` and the `dependency-*.mjs` scripts
  read this audit's own machine-local evidence in
  `docs/audits/AUD-035-evidence/`. `validate.py` also requires HEAD and every
  source file to equal the frozen snapshot.
- `validate.py` and `history.mjs` import the Python package `jsonschema` and
  read the schema from the neighbouring checkout. No requirements file sits
  beside them, so they do not meet TOOL-03, and the version this audit used was
  not recorded. The [AUD-030 requirements file](../AUD-030-harnesses/requirements.md)
  pins a `jsonschema` environment by hash; install it in an audit environment
  with `python3 -m pip install --require-hashes -r docs/audits/AUD-030-harnesses/requirements.md`.
  `history.mjs` also expects exactly the report pairs published then, AUD-001
  to AUD-034 without AUD-023 and AUD-033, so it fails once later reports exist.

AUD-033 is withheld; its [summary](../README.md#aud-033-withheld-report) lists
the findings that these AUD-033 files belong to.

A reader can still run these commands from a clean checkout with the pinned
tools and a build. They read only published files: `run.mjs`, the command
recorder; `suite.mjs` and `startup.mjs`, after creating the ignored
`docs/audits/AUD-035-evidence/` folder; the five counterexample probes above
with unused result paths; and the AUD-034 close-error probe. Their results
describe the source they run on. At the corrected source some counterexample
assertions fail by design, as "Reproduce the concrete counterexamples" says.
