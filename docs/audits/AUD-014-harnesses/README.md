# AUD-014 audit harnesses

These harnesses support the full-scope current-tree audit AUD-014, resumed after an interruption on a changed implementation. They review the existing MnemoCode checkout in place and write only ignored local evidence under `docs/audits/AUD-014-evidence/`. The reviewed commit is `2fc56164591bae26696cc15395bec18b064141c1`; the resumed dirty-source fingerprint is `4e2f139be2bad10c84c4eade0b234f3395b51a077d7b719562fb3e027852d6b6`. It is recorded in `resumed-snapshot.json` and the final report. The initial interrupted attempt belongs to different source bytes and is not passing evidence for this review. No other checkout or repository copy is used.

## Source identity and command capture

Run from the repository root with the workspace's existing Node and pnpm toolchain:

```bash
python3 docs/audits/AUD-014-harnesses/audit.py snapshot initial
python3 docs/audits/AUD-014-harnesses/audit.py check source-check pnpm check
```

`snapshot` records Git identity and SHA-256 values for tracked and nonignored implementation, test, configuration and asset files. Audit documents and evidence are excluded from the implementation fingerprint. Labels must be fresh: existing snapshots and logs are not overwritten.

`check` records the exact command, UTC timestamps, exit status, log SHA-256, source fingerprints before and after, changed source paths, and host-memory samples every 250 ms. It uses a 768 MiB Node heap cap and a 120-second timeout. A command starts only with at least 4 GiB available and stops if the host has less than 3 GiB available. Only the command's own process group is terminated. Checks are run sequentially by the coordinator; reviewers read source and do not run their own builds or test suites.

Expected output is the command's own output followed by a compact JSON summary. Exit status is the command's status; insufficient memory produces status 125. No full vector replay, canonical rebuild, full card generation or release verification is run by this harness. Inputs for runtime probes are public vectors and synthetic data only.

The report identifies failed, skipped and unexecuted checks separately. This harness is deliberately self-contained for its immutable audit record; it does not alter the historical AUD-013 harness or evidence.

## Reproduce the findings without rendering PDFs

Build the current TypeScript output once with `pnpm build`. Run the following from the repository root, one command at a time. Direct commands do not apply the memory guard; prefix them with `python3 docs/audits/AUD-014-harnesses/audit.py check FRESH-LABEL` to record and bound them.

```bash
node docs/audits/AUD-014-harnesses/cli-probes.mjs
node docs/audits/AUD-014-harnesses/runtime-probes.mjs
node docs/audits/AUD-014-harnesses/sskr-probes.mjs
node docs/audits/AUD-014-harnesses/template-facts-probes.mjs
pnpm exec vitest run --config docs/audits/AUD-014-harnesses/probe.config.ts
python3 docs/audits/AUD-014-harnesses/terminal-subset.py
python3 docs/audits/AUD-014-harnesses/metadata-probes.py
```

- `cli-probes.mjs` uses public CLI input and a synthetic missing `/proc` root to test unknown-option and swap-advisory contracts.
- `runtime-probes.mjs` uses a public zero-entropy phrase and tiny synthetic files to check protection selection, wallet callback results, mode/date validation, JSON consistency and text/name boundaries. It does not run scrypt or create output documents. Its late-abort and unchecked-checksum observations require the report's contract qualification.
- `sskr-probes.mjs` reads only `deterministic[0]` from the existing public `vectors/sskr-v1.json`. It exercises the existing WASM, alternate CBOR, mixed marks, a gated async input edit, malformed bridge encoding, an empty input, a format typo and exceptional plan cleanup. It records zero/nonzero array counts, never a memory dump, and wipes observed public-fixture arrays afterwards.
- `template-facts-probes.mjs` changes only capacity on a complete stock template and uses the production heir route. A sentinel stops before rendering; it checks no PDF pixels.
- `export-probes.ts` is deliberately opt-in through `probe.config.ts`, so ordinary test runs cannot collect intentionally failing audit assertions. It runs real preflight/private publication with public opaque bytes, stubbing only rendering and one cleanup error. The original temporary `.test.ts` name and its failed log are retained as historical command evidence; use the opt-in command above to rerun it.
- `terminal-subset.py` imports four existing real-PTY assertions: decode/edit/clear, return from a question, cursor editing and menu Ctrl+C. It excludes card questions and PDF-producing commands.
- `metadata-probes.py` checks all seven local SSKR integrity entries, built package targets and relative file links in current documents. It does not rebuild WASM or query advisory databases.

On the reviewed dirty snapshot, the diagnostic JavaScript probes and the two publication assertions exit 1 with the failures retained in the report. The PTY subset and metadata checks exit 0. An unexpected crash or different result must be investigated; do not delete or relax an assertion to get green. All inputs are fixed public fixtures or synthetic bytes. Temporary fixture files are removed by the harnesses.

## Report assembly and validation

`inventory.py` writes fresh `resumed-*` metadata and the 32-check plan; those labels must not already exist. `write-report.py` assembles the report only after `resumed-snapshot.json` and `final-snapshot.json` agree. It imports the retained scoped review contributions and command records, anonymizes published home paths, and updates only this audit's report pair and index row. `validate-report.py` checks the shared JSON schema, duplicate keys, paired metadata/IDs, source/hash/link/evidence bindings and privacy; its local `report-validation.json` and `SHA256SUMS` are validation evidence. Existing raw logs are never redacted or rewritten.
