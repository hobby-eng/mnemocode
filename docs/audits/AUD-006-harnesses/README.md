# AUD-006 audit harnesses

These audit-only scripts support the full MnemoCode audit at reviewed commit
`f9c069371e7446a3a7b5a9a695baf1620d66a377`.

## Inputs and scope

The command recorder runs a supplied command from the repository root and writes
the exact argv, timestamps, exit status, allowlisted environment variables and
log hash. Use only public vectors and synthetic data. Never pass real phrases,
private keys, shares, credentials or wallet files.

## Run

From the repository root, record a normal check with:

```sh
node docs/audits/AUD-006-harnesses/record-command.mjs verify -- pnpm verify
```

Use a unique lowercase name for every command. The recorder creates one `.log`
and one `.command.json` in the ignored local folder
`docs/audits/AUD-006-evidence/`; it never overwrites previous evidence and
propagates a non-zero command status.

The audit also runs any focused probes named in its report through this recorder.
Their fixtures and expected outcomes are documented there. A passing probe may
intentionally reproduce a defect; consult the report's finding rather than
interpreting a zero exit code as product acceptance.

## Audit probes

All commands below use public test data only and are safe for the CLI/library
scope. The full card-output command below was run once before the owner asked not
to repeat bulk card/PDF generation. Do not repeat it for this audit.

| Script or command | Check | Expected interpretation |
| --- | --- | --- |
| `pnpm verify` | Format, toolchain, build and complete unit suite | Exit 0; test count is recorded in the report. |
| `python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py` | Seven published vectors and 400 deterministic cases against the independent public-rule implementation | Exit 0 and zero mismatches. |
| `node docs/audits/AUD-005-harnesses/readme-examples.mjs` | README and SSKR CLI examples with the public `abandon ... about` vector | Exit 0 and all examples pass. |
| `node docs/audits/AUD-005-harnesses/defect-probes.mjs --fixed` | Eight AUD-005 production regressions | Exit 0 and none of the fixed defects reproduce. |
| `node docs/audits/AUD-005-harnesses/sskr-integrity.mjs` | Every vendor hash, coverage of generated/Rust files, recovery and corruption refusal | Exit 0; intact fixture restores and one-byte corruption is refused. |
| `node scripts/check-card-output.mjs output/aud-006-card-output` | Actual public-fixture PDFs/QR round trips | Already run once; exit 0. It generated 59 ignored files, removed by the finalizer after preserving the log. Do not repeat. |
| `python3 docs/audits/AUD-006-harnesses/rebuild-sskr-wasm.py` | Fresh SSKR build with wasm-bindgen 0.2.129 in the existing pinned offline container | Exit 0 if the generated WASM is identical; build products stay under ignored evidence and vendored files are never replaced. |
| `node docs/audits/AUD-006-harnesses/compare-sskr-bindings.mjs` | Removes only wasm-bindgen's generic async loader, formats generated declarations, then compares the offline SSKR bridge | Exit 0 when all four normalized files match. Run after the WASM rebuild. |
| `node docs/audits/AUD-006-harnesses/record-command.mjs sskr-output -- node dist/mnemocode.js encode --sskr --mnemonic 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' --threshold 2 --shares 3 --output output/aud-006-sskr-shares.txt` | Verifies the documented SSKR share-file format using a public vector | Exit 0; three UR shares are written, not an MNC1 record. Output is ignored. |
| `node scripts/build-executable.mjs docs/audits/AUD-006-evidence/executable-linux` | Builds one Linux executable without touching `release/` | Exit 0; output is local evidence only. |
| `node docs/audits/AUD-005-harnesses/bundled-licenses.mjs docs/audits/AUD-006-evidence/executable-linux` | Checks the executable's bundled npm/Node license notices | Exit 0 and no notice gaps. |

The executable was smoke-tested only with `--version`, `--help` and a public
test-vector encode. Do not use its `self-test` command for AUD-006: the full
self-test renders card templates, and the owner asked not to repeat that work.

## Finalize evidence

After the report and index are final, the audit finalizer validates the JSON
schema, duplicate keys, paired finding IDs and local links, then writes the
snapshot, environment, procedure hashes, validation result and `SHA256SUMS`:

```sh
python3 docs/audits/AUD-006-harnesses/finalize-evidence.py
```

It exits non-zero on a schema, link, hash or staged-evidence failure. Evidence
is local and ignored; do not commit it. Before hashing, the finalizer removes
only the audit's exact generated card-output folder, public SSKR share-text file
and SSKR Cargo/toolchain build directories. It keeps all command logs, reports,
normalized WASM comparison results and the audit-built Linux executable.

## Expected results

The expected result is a complete, hash-identified record, whether the command
passes, fails or is blocked. Evidence remains local and must not be committed.
The harness belongs to AUD-006 and the reviewed commit above; using it on another
snapshot does not update this audit's conclusions.