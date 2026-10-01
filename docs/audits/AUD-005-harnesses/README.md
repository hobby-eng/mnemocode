# AUD-005 harnesses

These scripts accompany [AUD-005](../AUD-005-2026-10-01.md), the full audit of commit
`8fbcb1361a45af962d524dfbac6789ecd11554cf` (clean tree). Run them from the root of the
MnemoCode checkout with Node.js 26.10.0, pnpm 10.19.0, installed dependencies
(`pnpm install --frozen-lockfile`) and a fresh `pnpm build`. They use only public data: the
`abandon … about` test phrase, `vectors/mnemocode-v1.json` and the published BCR-2020-011
shares in `vectors/sskr-v1.json`. They never change source, test, vendored or release files;
what they write goes to the ignored `docs/audits/AUD-005-evidence/`. Nothing is committed or
published by a script. Every script exits non-zero when one of its checks fails.

| Script | What it checks | Expected result |
| --- | --- | --- |
| `run.py` | Records one command: `run.py LABEL -- COMMAND …` writes `LABEL.log` and `LABEL.command.json` (argv, UTC start and end, exit code, log SHA-256). `run.py capture` records the snapshot, the procedure hashes (needs the workspace's `multi-chain-wallet-tools/docs/`) and the environment. It never overwrites a record; a rerun needs a new label. | The exit code of the recorded command. |
| `seedshift-oracle.py` | An independent Python implementation of BIP39 and of the translation in `docs/SEEDSHIFT_CONSTRUCTION.md`, compared with the seven public vectors and with the built library on 400 deterministic pseudo-random cases in five formats and three modes (6,000 comparisons). It also checks that the English list is the official BIP39 `english.txt`. | Exit 0, `failureCount: 0`. |
| `readme-examples.mjs` | Runs the README and `docs/SSKR.md` command examples (Seedshift, legacy, legacy-valid, records in five formats, the four recovery checks, word recovery, table, QR, 2-of-3 shares) and checks their printed results. | Exit 0, 30 passed. |
| `sskr-integrity.mjs` | Every entry of `vendor/sskr/integrity.json` matches its file and every file under `generated/` and `rust/` is listed; a disposable copy with one changed byte in the WASM or the bridge is refused with the integrity error and prints nothing, the unchanged copy restores the official entropy. | Exit 0, no failures. |
| `defect-probes.mjs` | Reproduces SEC001, API001, API002, BLD003, BLD004, BLD005, UI001 and UI002 through the production entry points. Without arguments it expects each defect; with `--fixed` it expects none. | Baseline: exit 0 without arguments. After the remediation: exit 0 with `--fixed`. |
| `bundled-licenses.mjs [folder]` | Lists the npm packages that the executable bundles (same esbuild options as the build) and checks that each executable in the folder (default `release/`) has a `…-licenses.txt` that names every one of them and Node.js. | Baseline: exit 1, no notice files (BLD002). After the remediation and `pnpm build:executable`: exit 0 for the executable built here. |
| `report-json.py` | Writes the JSON record from the Markdown report and the local command records, and stops when register, sections and remediation table disagree. | Exit 0. |
| `validate-report.py` | Schema (needs Python `jsonschema` and the workspace's `multi-chain-wallet-tools/docs/audit-report.schema.json`), duplicate keys, matching IDs, 32 coverage rows, relative links, script syntax, log hashes, no tracked or staged evidence; then writes `report-validation.json` and `SHA256SUMS` locally. | Exit 0. |

Examples, from the repository root:

```sh
pnpm build
python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py
node docs/audits/AUD-005-harnesses/readme-examples.mjs
node docs/audits/AUD-005-harnesses/sskr-integrity.mjs
node docs/audits/AUD-005-harnesses/defect-probes.mjs --fixed
pnpm build:executable && node docs/audits/AUD-005-harnesses/bundled-licenses.mjs
python3 docs/audits/AUD-005-harnesses/validate-report.py
```

`defect-probes.mjs` and `sskr-integrity.mjs` use `/bin/sh`, `umask` and symbolic links and
are meant for Linux or macOS. The first runs of `readme-examples.mjs` and `sskr-integrity.mjs`
failed because of harness mistakes (a label line on stdout; five shares that are not a quorum of
the grouped vector); the report keeps those runs and the corrected reruns apart.
