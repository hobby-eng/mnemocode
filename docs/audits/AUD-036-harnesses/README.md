# AUD-036 code and release checks

Run from the repository root with its pinned tools and public fixtures only.
This pre-commit review and release follow-up starts from the dirty in-place
candidate above base commit `261aaedaedeb17ac1e32cd31371c850f740d2ba5`.
Current source hashes, check outcomes and limitations belong to its report.
Historical AUD-035 results remain unchanged. All times are UTC (+00:00).

`run.mjs LABEL COMMAND [ARGUMENTS]` reuses the published
[AUD-035 recorder adapter](../AUD-035-remediation-harnesses/run.mjs), which
invokes the unchanged [AUD-026 resource recorder](../AUD-026-harnesses/audit.py).
`run.mjs --suite` reuses the [serial default-file suite](../AUD-035-remediation-harnesses/suite.mjs).
Only the output directory and nested recorder path are replaced in memory.
No test, fixture, assertion, timeout or file-selection rule is changed.
New local-only results go to the ignored `docs/audits/AUD-036-evidence/`.
Each executor refuses existing labels; use fresh labels for a later check.
For a complete rerun, set `AUD036_RUN` to a new short lowercase name, such as
`AUD036_RUN=final`. Both the suite and its child recorders then use that new
evidence subdirectory. Existing results remain unchanged.

Coordinate the exclusive heavy window with other active sessions first. Keep
the host reserve at 3 GiB, one test worker and one heavy command at a time.
The recorder samples available memory and the child process tree; this is not
a kernel limit or a proof of an absolute peak. The suite launcher adds small
parent-process overhead. Resource stops remain incomplete, never passed.

```sh
AUD026_RSS_MIB=1152 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-036-harnesses/run.mjs gates corepack pnpm check
AUD026_RSS_MIB=1152 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-036-harnesses/run.mjs build corepack pnpm build
AUD026_RSS_MIB=1152 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-036-harnesses/run.mjs --suite
```

Successful checks exit zero. The suite discovers Vitest's complete default
file list, freezes its test hashes and runs every file once in a fresh serial
worker. Individual receipts retain nonzero exits and resource stops.

The DOC-05 reproduction is `test/aud-036-fingerprint-notes.test.ts`, using
the existing public BIP39/SSKR fixtures and actual built CLI. Against the
pre-correction `dist/`, its required explanation assertions fail; after a build
with the correction they pass. The existing legacy private-view regressions
also check the explanation and retain the exact 128-row TSV assertions.

```sh
AUD026_RSS_MIB=1152 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=180 node docs/audits/AUD-036-harnesses/run.mjs fingerprint-notes node node_modules/vitest/vitest.mjs run test/aud-036-fingerprint-notes.test.ts test/aud-033-legacy-view.test.ts --pool=threads --maxWorkers=1 --no-file-parallelism
```

Node or Linux success does not establish browser, Windows or macOS acceptance.
Current source must be available to a runner before its result can count.
The owner's push hold is preserved; these helpers never commit, push, upload
source, dispatch CI, create tags or publish a release.

After retaining the completed evidence and final documentation-only manifest,
run `python3 docs/audits/AUD-036-harnesses/validate.py`. It uses the existing
Python `jsonschema` validator also used by AUD-035. Its adjacent
`requirements.md` reuses the frozen AUD-030 hash-pinned environment, whose
SHA-256 is `25982610c624a17fe3f944925c0c5fce12a2cfddea36fee88efca1c4c29672b7`.
To reproduce that environment, use
`python3 -m pip install --require-hashes -r docs/audits/AUD-036-harnesses/requirements.md`
in an approved audit environment. No installation was needed for this run;
all six installed distribution versions already match the existing pins.
The validator refuses Python optimization (`-O` or `PYTHONOPTIMIZE`) before
writing a passed receipt. It checks the canonical
envelope, duplicate-key refusal, exact local references, frozen runtime inputs,
the three documented prose changes, recomputed fingerprints, reported execution
fields against their bound receipts, suite counts, finding IDs, links and Linux
artifact hashes. Missing evidence or a mismatch fails; this is not a test
replay or a substitute for external platform/browser acceptance. Private
receipts must be present locally; they are deliberately absent from the package.
