# AUD-030 audit harnesses

This full-scope baseline reviews the existing dirty checkout on signed commit
`0d7898fed2efc4af59b2bff91b0da77d1f99315f`, after the reviewed date-owner correction.
The baseline phase changed no production source, project tests, dependencies, workflows or canonical outputs.
All inputs are existing public fixtures or synthetic data.

The report's later remediation addendum is a separate authorized phase with new exact-source
bindings. Its source changes deliberately invalidate a live-baseline replay: do not rerun the
baseline generator to overwrite the completed report or its original evidence. Remediation
commands use fresh `run.mjs` labels, retain failed attempts, and name the current snapshot.

The reviewed non-audit source fingerprint is
`45a2b48aadba5193d512bfc532f67052c04234e31d6c048c3d53f2917c728cf6`.
HEAD alone does not identify the dirty tree. The [report](../AUD-030-2026-10-15.md)
and its JSON companion publish baseline paths/hashes and all findings, methods and limitations.

## Inputs and prerequisites

- Use the repository's pinned Node.js/pnpm and installed project dependencies. `dist/` must
  have been built from the source being examined; a stale build is not acceptance evidence.
- `boundary-probes.mjs` imports the actual built public modules and the existing public
  `sskrSetVector` from `dist/sskr/known-answers.js`. MissingCodes uses eleven public
  `abandon` words and a missing final word. The wrong-UR-type token is synthetic.
- `record-probes.py` uses only Python's standard library. It reads the retained AUD-001/002
  README/helper text and evaluates paths; it never executes or copies the old harnesses.
- `records.py` and `validate-report.py` need the existing Python schema environment, recorded
  as Python 3.14.4 / jsonschema 4.19.2. `requirements.md` pins all six packages with official
  PyPI distribution hashes. This is a literal pip requirements file; the `.md` suffix keeps it
  inside the existing published audit-file allowlist, and `pip -r` accepts that suffix. No package
  was installed by this audit. If preparing an authorized
  environment, use `python3 -m pip install --require-hashes -r docs/audits/AUD-030-harnesses/requirements.md`
  in its configured environment, not a new
  global/default cache or this repository.
- `inventory.mjs` uses the already present workspace scratch TypeScript 5.9.3 parser at
  `../tmp/cancel-check/node_modules/typescript`; it does not install it. Without that parser
  it records a gap requiring a manual inventory. This is distinct from the project TS7 gate.
- Schema/procedure inputs are the read-only shared files under the neighboring
  `multi-chain-wallet-tools/docs/`, selected by the workspace audit instructions. MnemoCode
  itself has no build/run-time dependency on that project.

## Snapshot and command evidence

Run from the repository root:

```sh
node docs/audits/AUD-030-harnesses/inventory.mjs
```

The inventory records every tracked or trackable file, hashes, sizes, assigned review scopes,
current Git identity and applicable procedure hashes. It retains an uncommitted diff locally.
Ignored files and this audit's own records are excluded explicitly. It inventories public
exports and class members with the existing workspace scratch TypeScript parser, if present;
it installs nothing. Exit 0 means inventory creation, not completed semantic review.
Local evidence is ignored in `docs/audits/AUD-030-evidence/`.
An existing snapshot is never overwritten; the command refuses it with a nonzero exit.
For the retained audit, inspect the existing snapshot rather than recapturing it.

Recorded command execution uses the existing sequential memory guard from AUD-026 through
an audit-specific wrapper. The report distinguishes static review, reused source-bound results,
new execution and unavailable checks. No release signing, publishing or CI dispatch is performed.

For a new command use a fresh label; existing logs/command records are refused:

```sh
node docs/audits/AUD-030-harnesses/run.mjs replay-boundary node docs/audits/AUD-030-harnesses/boundary-probes.mjs
node docs/audits/AUD-030-harnesses/run.mjs replay-records python3 -B docs/audits/AUD-030-harnesses/record-probes.py
```

The wrapper reuses `AUD-026-harnesses/audit.py` without copying it. It records exact argv,
UTC times, exit code, log SHA-256, source-before/after, RSS/available-memory samples and
stop reason. Default limits are 300 seconds, 1GiB process-tree RSS, 256MiB Node heap and a
3GiB machine reserve; the `AUD026_*` guard options retain their original meaning.
It propagates nonzero exits and preserves diagnostic failures. It installs nothing.

## Expected baseline output

`boundary-probes.mjs` prints 19 literal acceptance rows and exits 1 because seven fail at
the reviewed baseline. They represent six runtime root causes/variants, not seven defects:
final-progress stop flag, high/low surrogate refusal, combining-mark cell width, duplicate
quorum guidance, raw-bridge type reflection, and late joint confirmation. Its normal controls
also run. This is a reproduction, not a remediation test added to the product suite.

`record-probes.py` prints seven rows and exits 1 because three fail: two instances of the
same wrong provenance fragment and one relocated recorder-cwd defect. All paths are evaluated
without another checkout or directory layout being created. An unexpected input/exception also
fails rather than silently passing. This script recognizes the original three-parent helper
expression; it is a baseline proof, not an interpreter of a future corrected recorder. A fix
needs its own actual-cwd regression. Keep the original probe bytes and result for comparison.

The ordinary targeted checks recorded in the report can be rerun with fresh labels through
the wrapper. Do not add overlapping scoped counts, and do not treat exit0 from a diagnostic
that merely prints observed values as acceptance of those values.

## Report assembly and validation

`report-data.json` contains reviewed finding descriptions; `coverage-data.json` contains all
32 procedure dispositions and the guarantee inventory. They are inputs, not executed checks.
`make-report.py` combines them with the ignored original review ledgers, source/command
manifests, actual skill resource records and external host attribution. Independent AI source
reading is not reproducible by running a report generator. The public JSON contains its
resulting file/public-contract ledgers; missing original local evidence is an explicit limit.

With the retained local evidence present:

```sh
python3 -B docs/audits/AUD-030-harnesses/make-report.py
python3 -B docs/audits/AUD-030-harnesses/validate-report.py --preview
python3 -B docs/audits/AUD-030-harnesses/records.py
```

Exit0 creates/validates local `report-preview.md` and `.json`, checks schema without duplicate
keys, paired findings, evidence identities, the 958 baseline hashes, counts and staged-evidence
exclusion. It does not run the product. `records.py` separately checks all 28 original baseline
report pairs; schema validity is not semantic verification of historical claims.
Its expected original-baseline result is exit0, with `records: 28` entries and `failed: 0`
in ignored `historical-record-validation.json`; original execution/log/artifact bytes are
not reconstructed by that command.

Only the audit coordinator uses `make-report.py --publish`, after independent review and test
body gap closure. It writes this audit's canonical Markdown/JSON pair without a Git commit.
`validate-report.py` without `--preview` checks that pair and permits only the audit's added
index row as a baseline-document publication delta; all other baseline bytes must still match.
It writes ignored `report-validation.json`. `SHA256SUMS` is generated locally after all review
writes stop, excluding that checksum file itself. Published files omit the machine owner's
name and use UTC; original local command records remain unaltered.

No full vector replay, mutation execution, fuzzing, scanner database, optimized wipe/timing
proof, browser matrix, canonical reproduction or release operation is implied by these scripts.
