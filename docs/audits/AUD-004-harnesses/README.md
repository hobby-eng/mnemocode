# AUD-004 harnesses

These scripts accompany [AUD-004](../AUD-004-2026-09-30.md), reviewing commit
`d64ba4792c76d8ae4fe020f8413198aadff85580` plus the eight pre-existing changes described
in the report. Run from the existing MnemoCode checkout, with Node 26.10.0,
pnpm 10.19.0, installed dependencies, a fresh `pnpm build`, and only public inputs.
No script replaces production, fixture or vendored files. Results go to the ignored
`docs/audits/AUD-004-evidence/` folder. Nothing is committed or published by a script.

| Script | Check and expected result |
| --- | --- |
| `probe-input.py` | Finite public 2 MiB FIFO versus regular file. Exit 0 reproduces SEC001; after a fix its reproduction assertion fails. No unbounded device is opened. |
| `write-failure.mjs` | Injects a partial SSKR PDF write with public official shares. Exit 0 reproduces DOC001 and removes its temporary partial file. Restores the process-local filesystem adapter. |
| `render-check.mjs` | Actual Poppler raster and QR/text checks of 39 PDFs: 32 sheets, five fragments and two share recovery cards. Exit 0 and PASS mean all checks passed. Inputs are synthetic indexes and `vectors/sskr-v1.json`. Uses `/usr/bin/pdftocairo` and `/usr/bin/pdftotext`; adjust only these executable paths on other systems. |
| `rebuild.py` | Fresh offline build of the mounted `vendor/sskr/rust` in the pre-existing pinned Docker image recorded in the report; one CPU, 1536 MiB, no network. Writes only build artifacts under local evidence. Exit 0 means WASM matches. Requires that exact image/dependency cache; it does not download one. |
| `compare-bindings.mjs` | After rebuild.py, reduces generated glue to the synchronous offline API and compares all four generated artifacts. Exit 0 means exact matches; requires pinned Prettier. Does not replace vendored files. |
| `integrity-check.py` | Uses the local snapshot and npm dry-run log to compare tracked source, 17 installed pins, seven vendor hashes and package boundaries. Exit 0 means no snapshot drift. The newly added audit index entry intentionally differs after report publication; use the pre-report snapshot for historical verification. |
| `validate-report.py` | Strict JSON/schema, record IDs, links, harness syntax, log hashes and source/staging checks. Requires Python jsonschema and the shared audit schema. Exit 0 confirms the retained report checks. |
| `run.py` | Optional command recorder: label, `--`, argv. It refuses to overwrite an existing command record. `capture` requires the shared workspace procedure files and refuses to overwrite its baseline. Use fresh labels for reruns. |

Examples (repository root):

```sh
python3 docs/audits/AUD-004-harnesses/probe-input.py
node docs/audits/AUD-004-harnesses/write-failure.mjs
node docs/audits/AUD-004-harnesses/render-check.mjs
python3 docs/audits/AUD-004-harnesses/rebuild.py
node docs/audits/AUD-004-harnesses/compare-bindings.mjs
```

The first two scripts assert that the reviewed defects reproduce; they are not
acceptance tests for fixed code. The report also retains the exact one-command
public API reproduction. Every script exits non-zero for an unexpected check failure.
The original render attempt failed because the audit harness let pdf-lib rewrite
metadata while loading; the retained script uses `updateMetadata: false`. Both logs
remain local, and the report distinguishes this harness error from product findings.
