# AUD-007 harnesses

Read-only review and release verification of MnemoCode at
`6576088ec341d96b3f98cc0ec9e36042f0c7aab6` (2026-10-02).
Only public vectors and synthetic zero/counting entropy are used. No product file is
modified. Build outputs and command evidence stay in ignored directories.

From the repository root, with the pinned Node.js/pnpm and installed dependencies:

```sh
node docs/audits/AUD-007-harnesses/record-command.mjs verify -- pnpm verify
node docs/audits/AUD-007-harnesses/record-command.mjs local-invariants -- node docs/audits/AUD-007-harnesses/local-invariants.mjs
```

The recorder retains argv, UTC timestamps, exit status and a SHA-256 of each log in
`docs/audits/AUD-007-evidence/`. Use a new name on every run; records must not overwrite
older evidence. It propagates command failure. `local-invariants.mjs` checks all seven
SSKR source/output pins, removal of the generated network loader, concurrent split
calls, every pair of two 2-of-3 sets at all five BIP39 lengths, and rejection of
insufficient/duplicate shares. Expect 30 recovered quorums, 20 rejection checks,
and exit 0. It also prints the counterexample to an overbroad material-sample
comment; that observation does not imply a recovery failure.

The exact additional commands and results are in the report. Published-vector
oracle and prior-regression/license scripts are reused from AUD-005; their evidence
folders may receive new uniquely named temporary fixtures, not replacements of old
logs. Those scripts and their inputs already exist in this checkout. No other project
is needed for the MnemoCode build.

For a fresh canonical compilation through the production comparison script:

```sh
PATH="$PWD/docs/audits/AUD-007-harnesses/docker-shim:$PATH" pnpm verify:sskr
```

The shim changes only `docker build` to `docker buildx build --platform linux/amd64
--no-cache-filter built`. It retains the pinned toolchain/dependency layers but forces
the entire offline Rust compilation and wasm-bindgen stage to execute. Expect four
`same` results and exit 0. It neither overwrites `sskr-wasm` nor rebuilds the base image
or toolchain from scratch. `/usr/bin/docker` and Buildx are prerequisites.

The Linux executable and PDF/QR acceptance outputs belong to this audit's ignored
evidence folder. The executed tests are not physical print or camera-scanning tests.
Windows/macOS execution and GitHub publication are not emulated or performed here.

After the report is complete:

```sh
python3 docs/audits/AUD-007-harnesses/finalize-evidence.py
```

The finalizer checks the schema, duplicate JSON keys, all 32 checklist IDs,
paired finding IDs, unchanged baseline product hashes, command/log hashes and
absence of staged evidence. It writes the local validation record and SHA256SUMS.
It never deletes or changes product files. Exit 0 means record validation passed,
not that every release check passed; consult the report's execution ledger.
