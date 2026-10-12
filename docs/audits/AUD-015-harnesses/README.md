# AUD-015 reproducible probes

These probes verify AUD-014 remediation and test additional input ownership, cancellation,
transport cleanup and QR-sidecar contracts. They belong to the targeted review completed on
2026-10-12 UTC: HEAD `2fc56164591bae26696cc15395bec18b064141c1` plus the dirty source
fingerprint `d36b710cf1ae73aad99208bf8a812b2fa5313b8b2a134f082a3e63ca0cec6768`.
They are not a release verification or an ordinary regression suite.

## Inputs and safeguards

Run from the repository root with its pinned Node.js, pnpm and installed dependencies. Build
`dist/` before the `.mjs` probes. Inputs are the public zero-entropy BIP39 phrase, the public
all-high-entropy phrase, `vectors/sskr-v1.json` deterministic entry 0, and opaque public file bytes.
Only a gated split uses the committed integrity-checked WASM; no canonical rebuild or vector
replay occurs. QR encoding and PDF drawing in `staging-probes.ts` are substituted with opaque
bytes: no image or PDF is created. Publication and reads use the actual filesystem. Every temporary
fixture directory is removed after its test, including deliberately retained staging copies.

`run.py` reuses AUD-014's frozen recorder rather than copying its memory guard. It monitors
available host memory, requires 4 GiB before starting, stops its own process group below a 3 GiB
reserve, sets a 768 MiB Node heap and limits each command to 120 seconds. Run checks one at a time.
Use fresh labels: evidence is never overwritten. The shared recorder writes local evidence under
`AUD-014-evidence/`; the wrapper retains byte-identical records under `AUD-015-evidence/`.
Both folders are ignored by Git. Exact originally executed commands and log hashes are in the
report's JSON companion. `collect review-remediation` imports this review's original local records
once and is not necessary for a replay.

## Commands

```sh
python3 docs/audits/AUD-015-harnesses/run.py snapshot replay-start
python3 docs/audits/AUD-015-harnesses/run.py check replay-check pnpm check
python3 docs/audits/AUD-015-harnesses/run.py check replay-build pnpm build
python3 docs/audits/AUD-015-harnesses/run.py check replay-core node docs/audits/AUD-015-harnesses/core-probes.mjs
python3 docs/audits/AUD-015-harnesses/run.py check replay-sskr node docs/audits/AUD-015-harnesses/sskr-probes.mjs
python3 docs/audits/AUD-015-harnesses/run.py check replay-labels node docs/audits/AUD-015-harnesses/labels-probes.mjs
python3 docs/audits/AUD-015-harnesses/run.py check replay-staging pnpm exec vitest run --config docs/audits/AUD-015-harnesses/probe.config.ts
```

The `.mjs` probes print named JSON checks and exit 1 if any assertion fails; the reviewed tree
fails their documented edge cases. Getter-based core cases are informational robustness probes,
not security findings about passive JSON or the native CLI. The staging probe runs five tests:
two common-save controls pass, three QR-sidecar cases fail. All these audit tests are opt-in;
no `.test.*` file is added to normal test discovery.

The scoped ordinary tests used in the report are:

```sh
pnpm exec vitest run test/aud-014-staging.test.ts test/aud-014-cli.test.ts test/aud-014-core.test.ts test/aud-014-secrets.test.ts test/aud-014-shares.test.ts test/aud-014-repair.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run test/aud-014-export.test.ts --maxWorkers=1 --no-file-parallelism -t 'AUD-014-API003|AUD-014-API012|recommendation 21'
pnpm exec vitest run test/private-file.test.ts test/private-file-fallback.test.ts test/joint-repair-secrets.test.ts --maxWorkers=1 --no-file-parallelism
```

They passed 85, 12 and eight tests in disjoint files; the export filter deliberately skips six
PDF-parsing cases. Run each line through `run.py check` with a fresh label for monitored evidence.
The existing AUD-014 CLI, runtime, SSKR, template-facts and metadata probes and the four-case PTY
subset also passed. The frozen AUD-014 export probe still fails its silent-cleanup-success oracle;
the report explains why that oracle cannot establish the adjudicated warning contract.

## Report generation and validation

`write-report.py` reconstructs the paired report from retained local command records and source
manifests. It asserts source stability and log hashes, anonymizes home paths, preserves AUD-014
bytes and adds or updates only the AUD-015 index row. Its generation requires this review's
original local evidence; normal readers can run the probes without regenerating the report.

```sh
python3 docs/audits/AUD-015-harnesses/validate-report.py
```

The validator requires the published Markdown/JSON pair, the shared JSON schema and this review's
local evidence. It checks duplicate keys, schema, finding IDs/statuses, source and log bindings,
historical-report preservation, privacy, relative links, index and ignored evidence, then writes
local `report-validation.json` and `SHA256SUMS`. Exit 0 means record consistency, not production
acceptance. Run validation after command recorders finish so their logs cannot change afterward.
