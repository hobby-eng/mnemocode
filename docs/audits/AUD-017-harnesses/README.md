# AUD-017 harnesses

This targeted follow-up reviews the uncommitted AUD-016 remedies at HEAD `2fc56164591bae26696cc15395bec18b064141c1`, source fingerprint `a7dd6a9c859bae635177e258f9573e407bb599044b0b5f0d0609e513a1afcf48`. It differs from the claimed `c430b1b3f71c413d20c404ed1ef29560066bda5a96f6bf8b5c5abc211247c0cb` fix snapshot only in README wording. The paired report retains both identities and all previous evidence. No production or ordinary test file is changed by these harnesses.

Run in the existing MnemoCode checkout with its pinned Node/pnpm toolchain and installed dependencies. Python's `jsonschema` package is needed for record validation. All fixtures are public. No script generates PDFs, cards or QR images, replays full vectors, or invokes Docker.

## Recorder and probes

`run.py` loads only definitions from the frozen AUD-014 recorder, then sets AUD-017's evidence directory before constructing it. Its historical unguarded CLI is not executed. This avoids writing duplicate records into earlier audit folders. The shared recorder's hash is in the report. Commands run sequentially with a 768 MiB Node heap, at least 4 GiB available before starting, a 3 GiB stop reserve and a 120-second timeout. Choose a fresh label every time; existing logs are never overwritten.

```bash
python3 docs/audits/AUD-017-harnesses/run.py snapshot start
python3 docs/audits/AUD-017-harnesses/run.py check build pnpm build
python3 docs/audits/AUD-017-harnesses/run.py check edges node docs/audits/AUD-017-harnesses/edges.mjs
python3 docs/audits/AUD-017-harnesses/run.py check evidence python3 docs/audits/AUD-017-harnesses/evidence-check.py
```

`edges.mjs` imports the current `dist/` build; build the intended snapshot first. It exercises a valid custom wallet result whose extra getter reads a private class field, both directly and through the actual word-search output. Constructor-captured transport arrays must actually exist and be zeroed for first/middle/last unknown tokens, bad CRC and bad metadata. Positive controls preserve caller-owned bytes, ordinary wallet fields, one-read matching, list cancellation and split getters. At this reviewed snapshot 18 of 20 checks pass; the two branded-getter cases fail with a private-field receiver error, so the script exits 1. The own-field enumeration row is informational, not a separate defect.

`evidence-check.py` validates the prior JSON envelope, reconstructs its original MD/JSON identities, checks the saved remediation manifest, compares it to this review, verifies all 13 cited logs and the 48 relocated records, and identifies general check records without before/after source identities. It exits 1 for that attribution gap. It also states the historical checksum list's actual parent-directory basis; those digests are correct, but they omit the remediation log/command pairs. Historical source differences are not treated as failures.

The original AUD-016 probe remains frozen. It still exits 1 because it observes only `Uint8Array.from` allocations, while the repaired decoder uses a constructor. The new probe verifies actual allocations; no old assertion is weakened to get green.

The ordinary regression command used here runs 58 tests in three files:

```bash
pnpm exec vitest run test/aud-016.test.ts test/aud-015.test.ts test/startup-edges.test.ts --maxWorkers=1 --no-file-parallelism
```

## Reports

`report.py` writes only AUD-017 and its index row from retained evidence. `validate.py` checks the canonical envelope, snapshot/source/log/harness/procedure hashes, historical report bindings, IDs, privacy and ignored evidence, then writes local validation/checksum records. It never substitutes a full test suite or release approval. Earlier reports and their validators are not edited.

```bash
python3 docs/audits/AUD-017-harnesses/report.py
python3 docs/audits/AUD-017-harnesses/validate.py
```
